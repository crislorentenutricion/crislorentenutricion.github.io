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

test("BoPaciente.renderAcciones: 'Enviar menú' es panel directo cuando hay menú con PDF", () => {
  // Desde tarea 16 enviar-menu es botón panel directo (no copy-command),
  // aparece solo si algún menú tiene pdf_url.
  const sinPdf = BoPaciente.renderAcciones(_ctxBase({
    menus: [{ id: "m1", numero: 1, pdf_url: null }]
  }));
  assert.ok(!/>Enviar menú</.test(sinPdf), "no debe aparecer sin PDF");

  const conPdf = BoPaciente.renderAcciones(_ctxBase({
    menus: [{ id: "m1", numero: 1, pdf_url: "https://x.pdf" }]
  }));
  assert.match(conPdf, /data-bo-panel="enviar-menu"/);
  assert.match(conPdf, />Enviar menú</);
  assert.ok(!/data-bo-function="enviar-menu"/.test(conPdf), "no debe ser backend");
  assert.ok(!/data-bo-comando="\/enviar-menu/.test(conPdf), "no debe ser copy");
});

test("BoPaciente.renderAcciones: repescar aparece siempre como panel directo si activa", () => {
  // Desde tarea 16 repescar es botón panel directo (no copy-command).
  const reciente = BoPaciente.renderAcciones(_ctxBase({
    checkins: [{ paciente_id: "p1", fecha: "2026-04-21" }]
  }));
  assert.match(reciente, /data-bo-panel="repescar"/);
  const lejano = BoPaciente.renderAcciones(_ctxBase({
    checkins: [{ paciente_id: "p1", fecha: "2026-04-15" }]
  }));
  assert.match(lejano, /data-bo-panel="repescar"/);
  const sinCheckin = BoPaciente.renderAcciones(_ctxBase());
  assert.match(sinCheckin, /data-bo-panel="repescar"/);
  // Y nunca como backend.
  for (const h of [reciente, lejano, sinCheckin]) {
    assert.ok(!/data-bo-function="repescar-paciente"/.test(h),
      "repescar no debe ser backend");
    assert.ok(!/data-bo-comando="\/repescar-paciente MARTA"/.test(h),
      "repescar ya no es copy-command");
  }
});

test("BoPaciente.renderAcciones: /repescar-paciente NO aparece si paciente cerrada", () => {
  const html = BoPaciente.renderAcciones(_ctxBase({
    paciente: { id: "p1", nombre: "MARTA", estado: "cerrado" }
  }));
  assert.ok(!/\/repescar-paciente/.test(html));
});

test("BoPaciente.renderAcciones: reagendar aparece como panel directo si hay próxima sesión futura", () => {
  const html = BoPaciente.renderAcciones(_ctxBase({
    sesiones: [{ id: "s1", paciente_id: "p1", fecha: "2026-05-02T09:00:00Z", calendar_event_id: "evt-99" }]
  }));
  // Desde tarea 16 es botón panel directo, no copy-command.
  assert.match(html, /data-bo-panel="reagendar"/);
  assert.match(html, />Reagendar sesión</);
  assert.ok(!/data-bo-function="reagendar"/.test(html), "no debe ser backend");
  assert.ok(!/data-bo-comando="\/reagendar MARTA"/.test(html), "ya no es copy-command");
});

test("BoPaciente.renderAcciones: reagendar NO aparece si todas las sesiones son pasadas", () => {
  const html = BoPaciente.renderAcciones(_ctxBase({
    sesiones: [{ id: "s1", paciente_id: "p1", fecha: "2026-01-01T09:00:00Z" }]
  }));
  assert.ok(!/data-bo-panel="reagendar"/.test(html));
  assert.ok(!/data-bo-comando="\/reagendar/.test(html));
});

test("BoPaciente.renderAcciones: agendar aparece como panel directo si paciente activa", () => {
  const html = BoPaciente.renderAcciones(_ctxBase());
  // Desde tarea 16 es botón panel directo, no copy-command.
  assert.match(html, /data-bo-panel="agendar"/);
  assert.match(html, />Agendar sesión</);
  assert.ok(!/data-bo-comando="\/agendar MARTA"/.test(html), "ya no es copy-command");
});

test("BoPaciente.renderAcciones: agendar NO aparece si paciente cerrada", () => {
  const html = BoPaciente.renderAcciones(_ctxBase({
    paciente: { id: "p1", nombre: "MARTA", estado: "cerrado" }
  }));
  assert.ok(!/data-bo-panel="agendar"/.test(html));
  assert.ok(!/data-bo-comando="\/agendar/.test(html));
});

test("BoPaciente.renderAcciones: cerrar aparece como panel directo NO destructivo si activa", () => {
  // El cierre NO es destructivo: marca estado='cerrado'. Desde tarea 16
  // es botón panel directo, no copy-command.
  const html = BoPaciente.renderAcciones(_ctxBase());
  assert.match(html, /data-bo-panel="cerrar"/);
  assert.match(html, />Cerrar paciente</);
  assert.ok(!/data-bo-function="cerrar-paciente"/.test(html), "no debe ser backend");
  assert.ok(!/data-bo-comando="\/cerrar-paciente MARTA"/.test(html), "ya no es copy-command");
  // NO debe tener clase destructiva — cerrar no es irreversible.
  assert.ok(!/bo-btn-destructivo[^>]*data-bo-panel="cerrar"|data-bo-panel="cerrar"[^>]*bo-btn-destructivo/.test(html));
});

test("BoPaciente.renderAcciones: paciente cerrada expone reactivar como panel directo", () => {
  // Cuando está cerrada el botón Cerrar desaparece y aparece Reactivar (panel).
  const html = BoPaciente.renderAcciones(_ctxBase({
    paciente: { id: "p1", nombre: "MARTA", estado: "cerrado" }
  }));
  assert.match(html, /data-bo-panel="reactivar"/);
  assert.ok(!/data-bo-panel="cerrar"/.test(html));
  assert.ok(!/\/cerrar-paciente/.test(html));
  assert.ok(!/data-bo-comando="\/reactivar-paciente MARTA"/.test(html), "ya no es copy-command");
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

test("BoPaciente.renderAcciones: no hay botones backend en el detalle (copy o panel)", () => {
  // Desde tarea 16 los botones son copy-command o panel inline — nunca
  // backend directo a Edge Function.
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

// -------------------------------------------------------------------
// renderAcciones — nuevas aserciones tarea 16 (panel inline + bo-btn-via)
// -------------------------------------------------------------------

test('renderAcciones activa: directas con data-bo-panel, copy solo para crear-menu/seguimiento/rgpd', () => {
  const html = BoPaciente.renderAcciones({ paciente: { nombre: 'MARTA', estado: 'activo' }, sesiones: [], menus: [], hoy: new Date('2026-06-11') });
  assert.match(html, /data-bo-action="panel" data-bo-panel="agendar"/);
  assert.match(html, /data-bo-panel="registrar-pago"/);
  assert.match(html, /data-bo-panel="repescar"/);
  assert.match(html, /data-bo-panel="cerrar"/);
  assert.match(html, /\/crear-menu MARTA/);
  assert.match(html, /\/seguimiento-paciente MARTA/);
  assert.match(html, /\/borrar-paciente-rgpd MARTA/);
  assert.match(html, /bo-btn-via/);
  assert.doesNotMatch(html, /data-bo-panel="reagendar"/);
  assert.doesNotMatch(html, /data-bo-panel="enviar-menu"/);
  assert.match(html, /id="bo-panel-accion"/);
});

test('renderAcciones: enviar-menu con menú con PDF; reagendar con sesión futura', () => {
  const html = BoPaciente.renderAcciones({
    paciente: { nombre: 'MARTA', estado: 'activo' },
    sesiones: [{ fecha: '2099-01-01T10:00:00Z', calendar_event_id: 'ev' }],
    menus: [{ id: 'm1', numero: 1, pdf_url: 'x.pdf' }],
    hoy: new Date('2026-06-11')
  });
  assert.match(html, /data-bo-panel="reagendar"/);
  assert.match(html, /data-bo-panel="enviar-menu"/);
});

test('renderAcciones cerrada: reactivar directo + rgpd copy', () => {
  const html = BoPaciente.renderAcciones({ paciente: { nombre: 'MARTA', estado: 'cerrado' }, sesiones: [], menus: [], hoy: new Date() });
  assert.match(html, /data-bo-panel="reactivar"/);
  assert.match(html, /borrar-paciente-rgpd/);
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

test("build: /backoffice/paciente/ contiene los 5 contenedores (estado, cabecera, panel-anamnesis, panel-timeline, acciones)", () => {
  const html = fs.readFileSync(path.join(SITE, "backoffice", "paciente", "index.html"), "utf8");
  for (const id of ["estado-paciente", "cabecera", "panel-anamnesis", "panel-timeline", "acciones"]) {
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

// ===================================================================
// slugTabValido (puro)
// ===================================================================

test('slugTabValido: slugs válidos pasan tal cual', () => {
  for (const s of ['anamnesis', 'evolucion', 'adherencia', 'pagos', 'timeline']) {
    assert.equal(BoPaciente.slugTabValido(s), s);
  }
});

test('slugTabValido: trim previo', () => {
  assert.equal(BoPaciente.slugTabValido('  pagos  '), 'pagos');
  assert.equal(BoPaciente.slugTabValido('\tanamnesis\n'), 'anamnesis');
});

test('slugTabValido: case-sensitive (canónicos minúsculas)', () => {
  assert.equal(BoPaciente.slugTabValido('Anamnesis'), null);
  assert.equal(BoPaciente.slugTabValido('PAGOS'), null);
});

test('slugTabValido: rechaza slugs con tilde y otros inválidos', () => {
  assert.equal(BoPaciente.slugTabValido('evolución'), null);
  assert.equal(BoPaciente.slugTabValido('foo'), null);
  assert.equal(BoPaciente.slugTabValido(''), null);
  assert.equal(BoPaciente.slugTabValido(null), null);
  assert.equal(BoPaciente.slugTabValido(undefined), null);
  assert.equal(BoPaciente.slugTabValido(42), null);
});

// ===================================================================
// urlConTab (puro)
// ===================================================================

test('urlConTab: añade tab cuando no estaba', () => {
  assert.equal(BoPaciente.urlConTab('pagos', '?id=abc'), '?id=abc&tab=pagos');
});

test('urlConTab: reemplaza tab existente sin duplicar', () => {
  assert.equal(BoPaciente.urlConTab('pagos', '?id=abc&tab=anamnesis'), '?id=abc&tab=pagos');
});

test('urlConTab: con search vacío inicia el querystring', () => {
  assert.equal(BoPaciente.urlConTab('anamnesis', ''), '?tab=anamnesis');
});

test('urlConTab: preserva otros parámetros', () => {
  const r = BoPaciente.urlConTab('timeline', '?id=abc&foo=bar');
  // URLSearchParams puede reordenar, pero ambos params deben aparecer.
  // El prefijo es '?' (siempre que la salida no esté vacía), así que el
  // separador antes del primer param es `?`; luego `&` entre ellos.
  assert.match(r, /[?&]id=abc(&|$)/);
  assert.match(r, /[?&]foo=bar(&|$)/);
  assert.match(r, /[?&]tab=timeline(&|$)/);
});

test('urlConTab: tolera search sin "?" inicial', () => {
  assert.equal(BoPaciente.urlConTab('pagos', 'id=abc'), '?id=abc&tab=pagos');
});

// ===================================================================
// siguienteTab (puro)
// ===================================================================

test('siguienteTab: next avanza una posición', () => {
  assert.equal(BoPaciente.siguienteTab(['a', 'b', 'c'], 'a', 'next'), 'b');
});

test('siguienteTab: prev retrocede una posición', () => {
  assert.equal(BoPaciente.siguienteTab(['a', 'b', 'c'], 'b', 'prev'), 'a');
});

test('siguienteTab: next desde el último envuelve al primero', () => {
  assert.equal(BoPaciente.siguienteTab(['a', 'b', 'c'], 'c', 'next'), 'a');
});

test('siguienteTab: prev desde el primero envuelve al último', () => {
  assert.equal(BoPaciente.siguienteTab(['a', 'b', 'c'], 'a', 'prev'), 'c');
});

test('siguienteTab: first y last saltan al extremo', () => {
  assert.equal(BoPaciente.siguienteTab(['a', 'b', 'c'], 'b', 'first'), 'a');
  assert.equal(BoPaciente.siguienteTab(['a', 'b', 'c'], 'b', 'last'), 'c');
});

test('siguienteTab: slug actual desconocido cae en el primero', () => {
  assert.equal(BoPaciente.siguienteTab(['a', 'b', 'c'], 'fantasma', 'next'), 'a');
});

test('siguienteTab: dirección desconocida devuelve el actual', () => {
  assert.equal(BoPaciente.siguienteTab(['a', 'b', 'c'], 'b', 'no-existe'), 'b');
});
