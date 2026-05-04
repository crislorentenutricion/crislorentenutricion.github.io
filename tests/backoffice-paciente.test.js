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

test("BoPaciente.renderAnamnesis: texto largo NO se trunca en HTML", () => {
  const largo = "a".repeat(200);
  const html = BoPaciente.renderAnamnesis({ motivacion: largo });
  // El texto completo aparece en el DOM, sin '…' ni 'title='
  assert.match(html, /a{200}/);
  assert.ok(!/…/.test(html), "no debe truncar con '…'");
  assert.ok(!/title="a+/.test(html), "no debe usar atributo title");
});

test("BoPaciente.renderAnamnesis: valores no vacíos se envuelven en span con clase + id único", () => {
  const html = BoPaciente.renderAnamnesis({
    objetivo: "perder_grasa",
    motivacion: "Texto de motivación"
  });
  const matches = html.match(/<span class="bo-anamnesis-valor" id="bo-libre-\d+">/g) || [];
  assert.ok(matches.length >= 2, "esperaba al menos 2 spans con clase bo-anamnesis-valor");
  const ids = matches.map(s => s.match(/id="(bo-libre-\d+)"/)[1]);
  assert.equal(new Set(ids).size, ids.length, "los ids deben ser únicos en cada render");
});

test("BoPaciente.renderAnamnesis: contador de ids se reinicia entre llamadas", () => {
  const html1 = BoPaciente.renderAnamnesis({ motivacion: "A" });
  const html2 = BoPaciente.renderAnamnesis({ motivacion: "B" });
  // Cada llamada arranca en bo-libre-1
  assert.match(html1, /id="bo-libre-1"/);
  assert.match(html2, /id="bo-libre-1"/);
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
// renderEvolucion — sustituye al SEGUIMIENTO_[NOMBRE].xlsx (deprecado 2026-04-30)
// ===================================================================

test("BoPaciente.renderEvolucion: sin peso en anamnesis ni revisiones → string vacío", () => {
  assert.equal(BoPaciente.renderEvolucion([], null, null), "");
  assert.equal(BoPaciente.renderEvolucion([], { altura: 168 }, "2026-03-01"), "");
  assert.equal(
    BoPaciente.renderEvolucion(
      [{ created_at: "2026-04-01", contenido: { adherencia: "buena" } }],
      null, null
    ),
    ""
  );
});

test("BoPaciente.renderEvolucion: solo anamnesis con peso → fila INICIO sin sparkline", () => {
  const html = BoPaciente.renderEvolucion([], { peso: 75, cintura: 78 }, "2026-03-12");
  assert.match(html, /data-bo-bloque="evolucion"/);
  assert.match(html, /data-bo-fila="inicio"/);
  assert.match(html, />75\.0</);
  assert.match(html, />78</);
  assert.ok(!/<svg/.test(html), "no debe haber sparkline con un solo punto");
  // No mostramos "Actual" / "Δ peso" si solo hay un punto.
  assert.ok(!/Actual:/.test(html));
  assert.ok(!/Δ peso/.test(html));
});

test("BoPaciente.renderEvolucion: anamnesis + 1 revisión → 2 filas, sparkline, Δ correcto", () => {
  const html = BoPaciente.renderEvolucion(
    [{ created_at: "2026-04-10T08:00:00Z", contenido: { peso: 73 } }],
    { peso: 75 },
    "2026-03-12"
  );
  assert.match(html, /data-bo-fila="inicio"/);
  assert.match(html, /data-bo-fila="revision"/);
  assert.match(html, /<svg[^>]*class="bo-evol-spark"/);
  assert.match(html, /<polyline/);
  // Resumen: Inicio 75.0, Actual 73.0, Δ peso -2
  assert.match(html, /Inicio:.*75\.0 kg/);
  assert.match(html, /Actual:.*73\.0 kg/);
  assert.match(html, /Δ peso:.*-2/);
});

test("BoPaciente.renderEvolucion: orden ascendente de revisiones (más antigua primero)", () => {
  const html = BoPaciente.renderEvolucion(
    [
      { created_at: "2026-04-20T10:00:00Z", contenido: { peso: 71 } },
      { created_at: "2026-04-10T10:00:00Z", contenido: { peso: 73 } },
      { created_at: "2026-04-30T10:00:00Z", contenido: { peso: 70 } }
    ],
    { peso: 75 },
    "2026-03-12"
  );
  // Las filas <tr data-bo-fila="..."> deben aparecer en orden ASC.
  const filas = html.match(/data-bo-fila="(inicio|revision)"/g);
  assert.deepEqual(filas, [
    'data-bo-fila="inicio"',
    'data-bo-fila="revision"',
    'data-bo-fila="revision"',
    'data-bo-fila="revision"'
  ]);
  // Cabecera resumen toma primera (75) y última (70) por peso.
  assert.match(html, /Inicio:.*75\.0 kg/);
  assert.match(html, /Actual:.*70\.0 kg/);
  assert.match(html, /Δ peso:.*-5/);
});

test("BoPaciente.renderEvolucion: peso como string con coma decimal se normaliza", () => {
  const html = BoPaciente.renderEvolucion(
    [{ created_at: "2026-04-10", contenido: { peso: "72,5" } }],
    { peso: "75" },
    "2026-03-12"
  );
  assert.match(html, />75\.0</);
  assert.match(html, />72\.5</);
});

test("BoPaciente.renderEvolucion: medidas mostradas en columnas y celdas vacías como —", () => {
  const html = BoPaciente.renderEvolucion(
    [{ created_at: "2026-04-10", contenido: { peso: 73, cintura: 76 } }],
    { peso: 75, cintura: 78, cadera: 95 },
    "2026-03-12"
  );
  assert.match(html, /<th>Cintura<\/th>/);
  assert.match(html, /<th>Cadera<\/th>/);
  assert.match(html, /<th>Pecho<\/th>/);
  assert.match(html, />78</);  // cintura inicio
  assert.match(html, />95</);  // cadera inicio
  assert.match(html, />76</);  // cintura revisión
  // Cadera de la revisión no informada → "—"
  const conteoEm = (html.match(/—/g) || []).length;
  assert.ok(conteoEm >= 1, "debe haber al menos una celda — para datos no informados");
});

test("BoPaciente.renderEvolucion: columna Δ vs inicio se rellena para cada revisión", () => {
  const html = BoPaciente.renderEvolucion(
    [
      { created_at: "2026-04-10", contenido: { peso: 73 } },
      { created_at: "2026-04-20", contenido: { peso: 71.5 } }
    ],
    { peso: 75 },
    "2026-03-12"
  );
  // Captura las celdas <td class="bo-evol-delta">…</td> en orden de fila.
  const celdasDelta = [...html.matchAll(/<td class="bo-evol-delta">([^<]*)<\/td>/g)].map(m => m[1]);
  // INICIO no tiene Δ (—); las dos revisiones sí.
  assert.deepEqual(celdasDelta, ['—', '-2', '-3.5']);
});

test("BoPaciente.renderEvolucion: sin anamnesis, primera revisión es la referencia (Δ '—')", () => {
  const html = BoPaciente.renderEvolucion(
    [
      { created_at: "2026-04-10", contenido: { peso: 73 } },
      { created_at: "2026-04-20", contenido: { peso: 72 } }
    ],
    null,
    null
  );
  const celdasDelta = [...html.matchAll(/<td class="bo-evol-delta">([^<]*)<\/td>/g)].map(m => m[1]);
  assert.deepEqual(celdasDelta, ['—', '-1']);
});

test("BoPaciente.renderEvolucion: anamnesis sin peso pero revisiones con peso → sin INICIO", () => {
  const html = BoPaciente.renderEvolucion(
    [
      { created_at: "2026-04-10", contenido: { peso: 73 } },
      { created_at: "2026-04-20", contenido: { peso: 72 } }
    ],
    { altura: 168 },
    "2026-03-12"
  );
  assert.ok(!/data-bo-fila="inicio"/.test(html), "sin peso en anamnesis no se incluye fila INICIO");
  assert.match(html, /data-bo-fila="revision"/);
  assert.match(html, /<svg/);
});

// ===================================================================
// renderPagos — tabla `pagos` de Supabase (migración 0019)
// ===================================================================

test("BoPaciente.renderPagos: lista vacía → 'Sin pagos registrados todavía'", () => {
  for (const v of [[], null, undefined]) {
    const html = BoPaciente.renderPagos(v);
    assert.match(html, /data-bo-bloque="pagos"/);
    assert.match(html, /Sin pagos registrados todavía/);
    assert.ok(!/<table/.test(html));
  }
});

test("BoPaciente.renderPagos: un pago → resumen + tabla con fila", () => {
  const html = BoPaciente.renderPagos([
    { id: "p1", fecha: "2026-04-10", importe: 40, concepto: "alta", metodo: "Bizum" }
  ]);
  assert.match(html, /Total cobrado:.*40 €/);
  assert.match(html, /1 pago<\/p>/);
  assert.match(html, /data-bo-pago-id="p1"/);
  assert.match(html, />Alta</);
  assert.match(html, />Bizum</);
});

test("BoPaciente.renderPagos: múltiples pagos → orden DESC y suma correcta", () => {
  const html = BoPaciente.renderPagos([
    { id: "p2", fecha: "2026-03-10", importe: 40, concepto: "alta" },
    { id: "p1", fecha: "2026-04-10", importe: 40, concepto: "renovacion" },
    { id: "p3", fecha: "2026-05-10", importe: 40, concepto: "renovacion" }
  ]);
  // Suma 120
  assert.match(html, /Total cobrado:.*120 €/);
  assert.match(html, /3 pagos/);
  // Orden DESC: p3 antes que p1 antes que p2
  const ids = html.match(/data-bo-pago-id="(p[123])"/g);
  assert.deepEqual(ids, ['data-bo-pago-id="p3"', 'data-bo-pago-id="p1"', 'data-bo-pago-id="p2"']);
});

test("BoPaciente.renderPagos: importe con decimales → formato es-ES con coma", () => {
  const html = BoPaciente.renderPagos([
    { id: "p1", fecha: "2026-04-10", importe: 40.5, concepto: "renovacion" }
  ]);
  assert.match(html, /40,50 €/);
});

test("BoPaciente.renderPagos: concepto desconocido → humanizado, no rompe", () => {
  const html = BoPaciente.renderPagos([
    { id: "p1", fecha: "2026-04-10", importe: 80, concepto: "otro", metodo: "transferencia", notas: "dos meses" }
  ]);
  assert.match(html, />Otro</);
  assert.match(html, />transferencia</);
  assert.match(html, />dos meses</);
});

test("BoPaciente.renderPagos: campos opcionales vacíos → '—' visible, sin undefined", () => {
  const html = BoPaciente.renderPagos([
    { id: "p1", fecha: "2026-04-10", importe: 40, concepto: "alta" }
  ]);
  assert.ok(!/undefined/.test(html));
  // Método y notas vacíos → "—" en la celda (notas vacío → string vacío visible).
  assert.match(html, /<td>—<\/td>/); // método "—"
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
  // createSignedUrl en conectarClickPdf. Única excepción a la regla
  // "todo en esta vista es copy-command" — ver `negocio/backoffice.md`.
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

test("BoPaciente.renderAcciones: /repescar-paciente aparece siempre como copy si activa", () => {
  // Desde 2026-04-24 todas las acciones del detalle son copy-command y
  // Repescar se ofrece siempre que la paciente esté activa: Cristina decide
  // cuándo lanzarla. El bloque "Alertas" de la vista Hoy sigue filtrando por
  // ≥3 días sin check-in, pero en el detalle no hay condición.
  const reciente = BoPaciente.renderAcciones(_ctxBase({
    checkins: [{ paciente_id: "p1", fecha: "2026-04-21" }]
  }));
  assert.match(reciente, /data-bo-comando="\/repescar-paciente MARTA"/);
  const lejano = BoPaciente.renderAcciones(_ctxBase({
    checkins: [{ paciente_id: "p1", fecha: "2026-04-15" }]
  }));
  assert.match(lejano, /data-bo-comando="\/repescar-paciente MARTA"/);
  const sinCheckin = BoPaciente.renderAcciones(_ctxBase());
  assert.match(sinCheckin, /data-bo-comando="\/repescar-paciente MARTA"/);
  // Y nunca como backend.
  for (const h of [reciente, lejano, sinCheckin]) {
    assert.ok(!/data-bo-function="repescar-paciente"/.test(h),
      "/repescar-paciente debe ser copy, no backend");
  }
});

test("BoPaciente.renderAcciones: /repescar-paciente NO aparece si paciente cerrada", () => {
  const html = BoPaciente.renderAcciones(_ctxBase({
    paciente: { id: "p1", nombre: "MARTA", estado: "cerrado" }
  }));
  assert.ok(!/\/repescar-paciente/.test(html));
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

test("BoPaciente.renderAcciones: /cerrar-paciente aparece como copy NO destructivo si activa", () => {
  // Desde 0014 (modelo binario) el cierre NO es destructivo: marca
  // estado='cerrado' + closed_at + close_reason. La fila se conserva para
  // reactivación. Destructivo (bo-btn-destructivo) queda reservado para
  // /borrar-paciente-rgpd, que solo aparece cuando la paciente ya está
  // cerrada. Desde 2026-04-24 el detalle usa copy-command, no backend.
  const html = BoPaciente.renderAcciones(_ctxBase());
  assert.match(html, /data-bo-comando="\/cerrar-paciente MARTA"/);
  assert.match(html, />Cerrar paciente</);
  assert.ok(!/data-bo-function="cerrar-paciente"/.test(html), "ya no es backend");
  // NO debe tener clase destructiva — cerrar ya no es irreversible.
  assert.ok(!/bo-btn-destructivo[^"]*cerrar-paciente|cerrar-paciente[^"]*bo-btn-destructivo/.test(html));
});

test("BoPaciente.renderAcciones: paciente cerrada expone /reactivar-paciente", () => {
  // Cuando está cerrada el botón Cerrar desaparece y aparece Reactivar.
  // Borrar RGPD se expone aparte — aparece en cualquier estado (ver test
  // siguiente): el derecho al olvido se puede ejercer siempre.
  const html = BoPaciente.renderAcciones(_ctxBase({
    paciente: { id: "p1", nombre: "MARTA", estado: "cerrado" }
  }));
  assert.match(html, /data-bo-comando="\/reactivar-paciente MARTA"/);
  assert.ok(!/\/cerrar-paciente/.test(html));
});

test("BoPaciente.renderAcciones: /borrar-paciente-rgpd aparece siempre (activa y cerrada) como copy destructivo", () => {
  // El derecho al olvido RGPD se puede ejercer en cualquier estado. El
  // botón está siempre visible y lleva la clase destructiva para indicar
  // que es irreversible (borra físicamente: Supabase, auth.users, checkins,
  // menús, PDFs, carpeta Drive).
  for (const estado of ['activo', 'cerrado']) {
    const html = BoPaciente.renderAcciones(_ctxBase({
      paciente: { id: "p1", nombre: "MARTA", estado: estado }
    }));
    assert.match(html, /data-bo-comando="\/borrar-paciente-rgpd MARTA"/,
      'falta botón Borrar RGPD en estado ' + estado);
    assert.match(html, /bo-btn-destructivo/,
      'falta clase destructiva en Borrar RGPD (' + estado + ')');
  }
});

test("BoPaciente.renderAcciones: /alta-paciente aparece como copy solo si estado alta_pendiente", () => {
  const normal = BoPaciente.renderAcciones(_ctxBase());
  assert.ok(!/\/alta-paciente/.test(normal));
  const pend = BoPaciente.renderAcciones(_ctxBase({
    paciente: { id: "p1", nombre: "MARTA", estado: "alta_pendiente", email: "marta@x.com" }
  }));
  assert.match(pend, /data-bo-comando="\/alta-paciente MARTA marta@x\.com"/);
});

test("BoPaciente.renderAcciones: todos los botones son copy-command (no backend) en el detalle", () => {
  // Decisión 2026-04-24: el detalle del paciente es una lanzadera de prompts
  // para Claude. Backend + fallback desaparecen — cada botón copia el
  // comando y Cristina lo pega en Claude Code.
  const activa = BoPaciente.renderAcciones(_ctxBase());
  const cerrada = BoPaciente.renderAcciones(_ctxBase({
    paciente: { id: "p1", nombre: "MARTA", estado: "cerrado" }
  }));
  for (const html of [activa, cerrada]) {
    assert.ok(!/data-bo-action="backend"/.test(html), "sin botones backend en el detalle");
    assert.ok(!/data-bo-function=/.test(html), "sin data-bo-function en el detalle");
    assert.ok(!/data-bo-payload=/.test(html), "sin data-bo-payload en el detalle");
  }
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

// ===================================================================
// renderPagos — línea "Próximo pago esperado" (Tarea 7)
// ===================================================================

test("BoPaciente.renderPagos: paciente activo con pagos → línea próximo pago renderizada", () => {
  const html = BoPaciente.renderPagos(
    [{ id: "p1", fecha: "2026-04-01", importe: 40, concepto: "alta" }],
    { id: "x", estado: "activo" },
    new Date(2026, 4, 1) // 1 may → vence hoy → estado aviso
  );
  assert.match(html, /data-bo-proximo-pago="aviso"/);
  assert.match(html, /Próximo pago esperado/);
  assert.match(html, /hoy/);
});

test("BoPaciente.renderPagos: paciente cerrado → línea NO renderizada", () => {
  const html = BoPaciente.renderPagos(
    [{ id: "p1", fecha: "2026-04-01", importe: 40, concepto: "alta" }],
    { id: "x", estado: "cerrado" },
    new Date(2026, 4, 1)
  );
  assert.ok(!/data-bo-proximo-pago/.test(html));
  assert.ok(!/Próximo pago esperado/.test(html));
});

test("BoPaciente.renderPagos: paciente sin pagos → solo 'Sin pagos registrados todavía'", () => {
  const html = BoPaciente.renderPagos(
    [],
    { id: "x", estado: "activo" },
    new Date(2026, 4, 1)
  );
  assert.match(html, /Sin pagos registrados todavía/);
  assert.ok(!/Próximo pago esperado/.test(html));
});

test("BoPaciente.renderPagos: estado vencido → clase bo-proximo-pago-vencido", () => {
  const html = BoPaciente.renderPagos(
    [{ id: "p1", fecha: "2026-03-01", importe: 40, concepto: "alta" }],
    { id: "x", estado: "activo" },
    new Date(2026, 4, 5) // 5 may, próximo era 1 abr → vencido 34 días
  );
  assert.match(html, /data-bo-proximo-pago="vencido"/);
  assert.match(html, /class="[^"]*bo-proximo-pago-vencido/);
  assert.match(html, /vencido/i);
});

test("BoPaciente.renderPagos: estado al_dia → línea sin clase de color", () => {
  const html = BoPaciente.renderPagos(
    [{ id: "p1", fecha: "2026-04-15", importe: 40, concepto: "alta" }],
    { id: "x", estado: "activo" },
    new Date(2026, 4, 1) // 1 may, próximo 15 may → al_dia (14 días)
  );
  assert.match(html, /data-bo-proximo-pago="al_dia"/);
  assert.match(html, /en 14 días/);
  assert.ok(!/bo-proximo-pago-vencido/.test(html));
  assert.ok(!/bo-proximo-pago-aviso/.test(html));
});

test("BoPaciente.renderPagos: backwards-compat — sin paciente/hoy → no rompe (línea ausente)", () => {
  // Tests existentes pasan paciente=undefined, hoy=undefined. La firma
  // extendida es opcional: renderPagos(pagos, paciente?, hoy?). Si no se
  // pasan los argumentos extra, la línea simplemente no se renderiza.
  const html = BoPaciente.renderPagos([
    { id: "p1", fecha: "2026-04-10", importe: 40, concepto: "alta" }
  ]);
  assert.match(html, /Total cobrado/); // resumen sí
  assert.ok(!/Próximo pago esperado/.test(html)); // línea NO
});
