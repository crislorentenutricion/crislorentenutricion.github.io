// Tests de la Rebanada 2 del backoffice (Agente 5):
//   - Vista Detalle paciente: página, renderers puros, condicional de acciones.
//
// Mismo patrón que backoffice-vistas.test.js: funciones puras contra strings
// HTML, build con before() para frescura de _site/.

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ROOT, SITE } = require("./_helpers/paths");

// Cargar BoUi/BoLogic como globals para que backoffice-paciente los resuelva
// via `window.BoUi` (que los módulos leen en call-time).
const BoUi    = require("../src/backoffice/ui.js");
const BoLogic = require("../src/backoffice/logic.js");
global.window = global.window || {};
global.window.BoUi    = BoUi;
global.window.BoLogic = BoLogic;
const BoPaciente = require("../src/backoffice/backoffice-paciente.js");

// ===================================================================
// renderCabecera
// ===================================================================

test("BoPaciente.renderCabecera: muestra nombre en Title Case (no MAYÚSCULAS)", () => {
  const html = BoPaciente.renderCabecera({
    nombre: "MARTA PÉREZ",
    estado: "activo",
    email: "marta@example.com",
    anamnesis: { telefono: "+34 600 11 22 33" },
    anamnesis_completed_at: "2026-04-10T08:00:00.000Z"
  });
  assert.match(html, /<h1>Marta Pérez<\/h1>/);
  const visible = html.replace(/<[^>]+>/g, " ");
  assert.ok(!/MARTA PÉREZ/.test(visible), "no debe mostrar el nombre en MAYÚSCULAS");
});

test("BoPaciente.renderCabecera: estado 'activo' → 'Activa', 'cerrado' → 'Cerrada'", () => {
  const act = BoPaciente.renderCabecera({ nombre: "ANA", estado: "activo" });
  assert.match(act, /data-col="estado">Activa</);
  const cer = BoPaciente.renderCabecera({ nombre: "ANA", estado: "cerrado" });
  assert.match(cer, /data-col="estado">Cerrada</);
});

test("BoPaciente.renderCabecera: muestra email y teléfono desde anamnesis", () => {
  const html = BoPaciente.renderCabecera({
    nombre: "ANA",
    estado: "activo",
    email: "ana@x.com",
    anamnesis: { telefono: "+34 600 11 22 33" }
  });
  assert.match(html, /data-col="email">ana@x\.com</);
  assert.match(html, /\+34 600 11 22 33/);
});

test("BoPaciente.renderCabecera: sin teléfono → '—' (sin mostrar undefined)", () => {
  const html = BoPaciente.renderCabecera({ nombre: "ANA", estado: "activo", email: "a@a" });
  assert.match(html, /data-col="telefono">—</);
  assert.ok(!/undefined/.test(html));
});

test("BoPaciente.renderCabecera: última actualización formateada DD/MM/AAAA", () => {
  const html = BoPaciente.renderCabecera({
    nombre: "ANA", estado: "activo",
    anamnesis_completed_at: "2026-04-10"
  });
  assert.match(html, /data-col="actualizada">10\/04\/2026</);
});

// ===================================================================
// renderAnamnesis
// ===================================================================

test("BoPaciente.renderAnamnesis: JSONB null/vacío → 'Anamnesis no rellena'", () => {
  for (const v of [null, undefined, {}]) {
    const html = BoPaciente.renderAnamnesis(v);
    assert.match(html, /Anamnesis no rellena/);
    assert.match(html, /data-bo-anamnesis-vacia/);
  }
});

test("BoPaciente.renderAnamnesis: campos parciales → solo muestra los presentes", () => {
  const html = BoPaciente.renderAnamnesis({
    objetivo: "perder_grasa",
    peso: 72.5,
    altura: 168
  });
  assert.match(html, /Objetivo principal/);
  assert.match(html, /Perder grasa/);       // humanizado
  assert.match(html, /Peso \(kg\)/);
  assert.match(html, />72\.5</);
  assert.match(html, /Altura \(cm\)/);
  // No debe aparecer secciones vacías
  assert.ok(!/Medicación/.test(html), "no debe mostrar grupo Medicación si está vacío");
  assert.ok(!/Sueño/.test(html), "no debe mostrar Sueño si falta");
});

test("BoPaciente.renderAnamnesis: agrupa en secciones lógicas con data-bo-grupo", () => {
  const html = BoPaciente.renderAnamnesis({
    objetivo: "mantener_hábitos",
    alergias: ["gluten", "lactosa"],
    medicacion: "Ninguna"
  });
  assert.match(html, /data-bo-grupo="Objetivo"/);
  assert.match(html, /data-bo-grupo="Alergias y patologías"/);
  assert.match(html, /data-bo-grupo="Medicación"/);
});

test("BoPaciente.renderAnamnesis: arrays se formatean con comas y humanización", () => {
  const html = BoPaciente.renderAnamnesis({
    alergias: ["gluten", "frutos_secos"]
  });
  assert.match(html, /Gluten, Frutos secos/);
});

test("BoPaciente.renderAnamnesis: texto largo se trunca a 160 chars con …", () => {
  const largo = "a".repeat(200);
  const html = BoPaciente.renderAnamnesis({ motivacion: largo });
  // Aparece el texto truncado con puntos suspensivos
  assert.match(html, /…/);
  // El texto completo queda en title (no se pierde del DOM)
  assert.match(html, /title="a{200}"/);
  assert.match(html, /class="bo-anamnesis-libre"/);
});

test("BoPaciente.renderAnamnesis: ignora strings vacíos y arrays vacíos", () => {
  const html = BoPaciente.renderAnamnesis({
    objetivo: "",
    alergias: [],
    medicacion: "   ",
    peso: 70
  });
  assert.match(html, /Peso \(kg\)/);
  assert.ok(!/Objetivo principal/.test(html), "no debe mostrar objetivo vacío");
  assert.ok(!/Alergias/.test(html), "no debe mostrar alergias vacías");
});

// ===================================================================
// renderTimeline
// ===================================================================

test("BoPaciente.renderTimeline: orden descendente con menús, sesiones y revisiones", () => {
  const eventos = {
    menus: [
      { id: "m1", numero: 1, vigente_desde: "2026-01-01", created_at: "2026-01-01T00:00:00Z", pdf_url: "https://x/m1.pdf" }
    ],
    sesiones: [
      { id: "s1", fecha: "2026-03-10T09:00:00Z", calendar_event_id: "evt-1" },
      { id: "s2", fecha: "2026-04-15T10:00:00Z", calendar_event_id: "evt-2" }
    ],
    revisiones: [
      { id: "r1", contenido: { peso: 71 }, created_at: "2026-04-01T12:00:00Z" }
    ]
  };
  const html = BoPaciente.renderTimeline(eventos);
  // El más reciente (sesión 15/04/2026) aparece antes que menú 01/01/2026
  const idxSesionTarde = html.indexOf("15/04/2026");
  const idxMenu       = html.indexOf("01/01/2026");
  const idxRevision   = html.indexOf("01/04/2026");
  const idxSesionTemp = html.indexOf("10/03/2026");
  assert.ok(idxSesionTarde > -1 && idxMenu > -1 && idxRevision > -1 && idxSesionTemp > -1,
    "todos los eventos deben renderizarse");
  assert.ok(idxSesionTarde < idxRevision, "15/04 antes que 01/04");
  assert.ok(idxRevision < idxSesionTemp, "01/04 antes que 10/03");
  assert.ok(idxSesionTemp < idxMenu, "10/03 antes que 01/01");
});

test("BoPaciente.renderTimeline: sesión incluye calendar_event_id", () => {
  const html = BoPaciente.renderTimeline({
    sesiones: [{ id: "s1", fecha: "2026-04-12T09:00:00Z", calendar_event_id: "evt-xyz" }]
  });
  assert.match(html, /Sesión del 12\/04\/2026/);
  assert.match(html, /evt-xyz/);
  assert.match(html, /data-bo-evento="sesion"/);
});

test("BoPaciente.renderTimeline: menú con pdf_url → enlace Ver PDF con data-bo-menu-path", () => {
  // pdf_url guarda la RUTA dentro del bucket privado menus-pdf (no URL
  // absoluta). El <a> lleva data-bo-menu-path, el click dispara
  // createSignedUrl en conectarClickPdf (ver backoffice-paciente.js).
  const html = BoPaciente.renderTimeline({
    menus: [{ id: "m1", numero: 3, vigente_desde: "2026-04-01", created_at: "2026-04-01T10:00:00Z", pdf_url: "uuid-xyz/menu-3.pdf" }]
  });
  assert.match(html, /Menú 3/);
  assert.match(html, /data-bo-menu-path="uuid-xyz\/menu-3\.pdf"/);
  assert.match(html, /data-bo-menu-filename="menu-3\.pdf"/);
  assert.match(html, />Ver PDF</);
});

test("BoPaciente.renderTimeline: revisión con peso se resume", () => {
  const html = BoPaciente.renderTimeline({
    revisiones: [{ id: "r1", contenido: { peso: 68.5, adherencia: "alta" }, created_at: "2026-04-10T09:00:00Z" }]
  });
  assert.match(html, /Revisión del 10\/04\/2026/);
  assert.match(html, /Peso 68\.5/);
  assert.match(html, /Adherencia Alta/);
});

test("BoPaciente.renderTimeline: sin eventos → mensaje de vacío", () => {
  const html = BoPaciente.renderTimeline({});
  assert.match(html, /Sin eventos registrados/);
});

// ===================================================================
// renderAcciones
// ===================================================================

function _ctxBase(over) {
  return Object.assign({
    paciente: { id: "p1", nombre: "MARTA", estado: "activo", email: "marta@x.com" },
    menus: [],
    checkins: [],
    sesiones: [],
    hoy: new Date(2026, 3, 22) // 22/04/2026
  }, over || {});
}

test("BoPaciente.renderAcciones: siempre muestra /crear-menu y /seguimiento-paciente (copy)", () => {
  const html = BoPaciente.renderAcciones(_ctxBase());
  assert.match(html, /data-bo-comando="\/crear-menu MARTA"/);
  assert.match(html, /data-bo-comando="\/seguimiento-paciente MARTA"/);
});

test("BoPaciente.renderAcciones: ya no muestra botón 'Enviar menú' (decisión 2026-04-24)", () => {
  // El envío del menú es la cola natural de /crear-menu en Claude Code; el
  // botón en el detalle no aportaba.
  const html = BoPaciente.renderAcciones(_ctxBase({
    menus: [{ id: "m1", numero: 1, pdf_url: "https://x.pdf" }]
  }));
  assert.ok(!/data-bo-function="enviar-menu"/.test(html));
  assert.ok(!/data-bo-comando="\/enviar-menu/.test(html));
  assert.ok(!/>Enviar menú</.test(html));
});

test("BoPaciente.renderAcciones: /repescar-paciente oculto si check-in reciente (<3 días)", () => {
  const ctx = _ctxBase({
    checkins: [{ paciente_id: "p1", fecha: "2026-04-21" }] // 1 día atrás
  });
  const html = BoPaciente.renderAcciones(ctx);
  assert.ok(!/repescar-paciente/.test(html), "check-in reciente no debe disparar /repescar");
});

test("BoPaciente.renderAcciones: /repescar-paciente aparece como backend si ≥3 días sin check-in", () => {
  const ctx = _ctxBase({
    checkins: [{ paciente_id: "p1", fecha: "2026-04-15" }] // 7 días atrás
  });
  const html = BoPaciente.renderAcciones(ctx);
  assert.match(html, /data-bo-function="repescar-paciente"/);
  assert.match(html, /&quot;paciente_id&quot;:&quot;p1&quot;/);
  assert.match(html, /data-bo-comando="\/repescar-paciente MARTA"/); // fallback
});

test("BoPaciente.renderAcciones: /repescar-paciente aparece si nunca hubo check-in (activa)", () => {
  const html = BoPaciente.renderAcciones(_ctxBase());
  assert.match(html, /data-bo-function="repescar-paciente"/);
});

test("BoPaciente.renderAcciones: /reagendar aparece como copy si hay próxima sesión futura", () => {
  const html = BoPaciente.renderAcciones(_ctxBase({
    sesiones: [{ id: "s1", paciente_id: "p1", fecha: "2026-05-02T09:00:00Z", calendar_event_id: "evt-99" }]
  }));
  // Decisión 2026-04-24: simplificado a copy-command. La Edge Function
  // existe pero no aporta sin estar desplegada y el copy es trivial.
  assert.match(html, /data-bo-comando="\/reagendar MARTA"/);
  assert.match(html, />Reagendar sesión</);
  assert.ok(!/data-bo-function="reagendar"/.test(html), "ya no es backend");
});

test("BoPaciente.renderAcciones: /reagendar NO aparece si todas las sesiones son pasadas", () => {
  const html = BoPaciente.renderAcciones(_ctxBase({
    sesiones: [{ id: "s1", paciente_id: "p1", fecha: "2026-01-01T09:00:00Z" }]
  }));
  assert.ok(!/data-bo-comando="\/reagendar/.test(html));
});

test("BoPaciente.renderAcciones: /agendar aparece como copy si paciente activa", () => {
  const html = BoPaciente.renderAcciones(_ctxBase());
  assert.match(html, /data-bo-comando="\/agendar MARTA"/);
  // Etiqueta legible: verbo de acción.
  assert.match(html, />Agendar sesión</);
});

test("BoPaciente.renderAcciones: /agendar NO aparece si paciente cerrada", () => {
  const html = BoPaciente.renderAcciones(_ctxBase({
    paciente: { id: "p1", nombre: "MARTA", estado: "cerrado" }
  }));
  assert.ok(!/data-bo-comando="\/agendar/.test(html));
});

test("BoPaciente.renderAcciones: /cerrar-paciente aparece como backend NO destructivo si activa", () => {
  // Desde 0014 (modelo binario) el cierre NO es destructivo: marca
  // estado='cerrado' + closed_at + close_reason. La fila se conserva para
  // reactivación. Destructivo (bo-btn-destructivo) queda reservado para
  // /borrar-paciente-rgpd, que solo aparece cuando la paciente ya está
  // cerrada.
  const html = BoPaciente.renderAcciones(_ctxBase());
  assert.match(html, /data-bo-function="cerrar-paciente"/);
  assert.match(html, /&quot;paciente_id&quot;:&quot;p1&quot;/);
  assert.match(html, /data-bo-comando="\/cerrar-paciente MARTA"/); // fallback
  // NO debe tener clase destructiva — cerrar ya no es irreversible.
  assert.ok(!/bo-btn-accion[^"]*bo-btn-destructivo/.test(html) &&
           !/bo-btn-destructivo[^"]*cerrar-paciente/.test(html));
  assert.match(html, />Cerrar paciente</);
});

test("BoPaciente.renderAcciones: paciente cerrada expone /reactivar-paciente y /borrar-paciente-rgpd", () => {
  // Modelo binario: cuando está cerrada, las acciones disponibles son
  // reactivar (volver a 'activo') y borrar RGPD (destructivo, solo bajo
  // petición del titular). El botón Cerrar desaparece.
  const html = BoPaciente.renderAcciones(_ctxBase({
    paciente: { id: "p1", nombre: "MARTA", estado: "cerrado" }
  }));
  assert.match(html, /data-bo-comando="\/reactivar-paciente MARTA"/);
  assert.match(html, /data-bo-comando="\/borrar-paciente-rgpd MARTA"/);
  assert.match(html, /bo-btn-destructivo/); // Borrar RGPD sí es destructivo
  assert.ok(!/\/cerrar-paciente/.test(html));
});

test("BoPaciente.renderAcciones: /alta-paciente aparece como copy solo si estado alta_pendiente", () => {
  const normal = BoPaciente.renderAcciones(_ctxBase());
  assert.ok(!/\/alta-paciente/.test(normal));
  const pend = BoPaciente.renderAcciones(_ctxBase({
    paciente: { id: "p1", nombre: "MARTA", estado: "alta_pendiente", email: "marta@x.com" }
  }));
  // Sigue siendo copy en el detalle (edge case).
  assert.match(pend, /data-bo-comando="\/alta-paciente MARTA marta@x\.com"/);
});

test("BoPaciente.renderAcciones: contenedor con data-bo-bloque='acciones'", () => {
  const html = BoPaciente.renderAcciones(_ctxBase());
  assert.match(html, /data-bo-bloque="acciones"/);
});

// ===================================================================
// Build: /backoffice/paciente/index.html
// ===================================================================

before(() => {
  // Si _site/ ya existe (build previo del workflow CI o de `npm run serve`),
  // no reconstruimos — evita race con otros ficheros de test que corren en
  // paralelo y podrían borrar/regenerar passthrough files a mitad de lectura.
  if (fs.existsSync(path.join(SITE, "backoffice", "index.html"))) return;
  execFileSync("npx", ["eleventy"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
});

test("build: /backoffice/paciente/index.html existe con noindex,nofollow", () => {
  const file = path.join(SITE, "backoffice", "paciente", "index.html");
  assert.ok(fs.existsSync(file), "falta _site/backoffice/paciente/index.html");
  const html = fs.readFileSync(file, "utf8");
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
});

test("build: /backoffice/paciente/ contiene los 5 contenedores (estado, cabecera, anamnesis, timeline, acciones)", () => {
  const html = fs.readFileSync(path.join(SITE, "backoffice", "paciente", "index.html"), "utf8");
  for (const id of ["estado-paciente", "cabecera", "anamnesis", "timeline", "acciones"]) {
    assert.match(html, new RegExp(`<div id="${id}"`), `falta contenedor #${id}`);
  }
});

test("build: /backoffice/paciente/ carga backoffice-paciente.js", () => {
  const html = fs.readFileSync(path.join(SITE, "backoffice", "paciente", "index.html"), "utf8");
  assert.match(html, /src="\/backoffice\/backoffice-paciente\.js"/);
  assert.ok(fs.existsSync(path.join(SITE, "backoffice", "backoffice-paciente.js")),
    "falta _site/backoffice/backoffice-paciente.js");
});

test("build: /backoffice/paciente/ invoca BoAuth.iniciar con onListo → BoPaciente.arrancar", () => {
  const html = fs.readFileSync(path.join(SITE, "backoffice", "paciente", "index.html"), "utf8");
  assert.match(html, /window\.BoAuth\.iniciar/);
  assert.match(html, /window\.BoPaciente\.arrancar\(supa, id\)/);
});

test("build: /backoffice/pacientes/ enlaza detalle con ?id=", () => {
  // Verificación cruzada: la tabla ya usa el patrón que esta página consume.
  const js = fs.readFileSync(path.join(SITE, "backoffice", "backoffice-pacientes.js"), "utf8");
  assert.match(js, /\/backoffice\/paciente\/\?id=/);
});

test("build: sitemap.xml no incluye /backoffice/paciente/", () => {
  const xml = fs.readFileSync(path.join(SITE, "sitemap.xml"), "utf8");
  assert.ok(!xml.includes("/backoffice/paciente"), "sitemap.xml incluye detalle por error");
});
