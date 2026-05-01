// Tests de la Rebanada 1 del backoffice (Agente 4):
//   - Vista Hoy: 4 bloques con atributos data-bo-block, render funcional puro.
//   - Vista Pacientes: tabla con cabeceras + filtro, filas con 2 botones
//     copy-command y link a la futura vista detalle.
//   - Helpers BoUi: formateo (DD/MM/AAAA), Title Case, primer nombre.
//
// Patrón: tests puros con node:test (sin navegador, sin Supabase). Los
// módulos exponen funciones de render que devuelven HTML strings; eso se
// compara contra regexps estables (no acoplarse al orden exacto de atributos
// salvo en los data-* marcadores).
//
// Los tests de build (HTML en _site/) dependen del build ya ejecutado por
// backoffice-build.test.js. Para aislar este fichero si se corre solo,
// lo ejecutamos con un before() que invoca eleventy — misma estrategia.

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ROOT, SITE } = require("./_helpers/paths");

// -----------------------------------------------------------------
// Módulos bajo prueba (funciones puras)
// -----------------------------------------------------------------

const BoUi       = require("../src/backoffice/ui.js");
const BoLogic    = require("../src/backoffice/logic.js");
// Los módulos backoffice-hoy/backoffice-pacientes buscan deps en window y en
// require. Para node tests hacemos ambas cosas disponibles.
global.window = global.window || {};
global.window.BoUi    = BoUi;
global.window.BoLogic = BoLogic;
const BoHoy       = require("../src/backoffice/backoffice-hoy.js");
const BoPacientes = require("../src/backoffice/backoffice-pacientes.js");

// ===================================================================
// BoUi — formateo y helpers
// ===================================================================

test("BoUi.formatearFecha: ISO puro 'YYYY-MM-DD' → 'DD/MM/AAAA' sin desfase TZ", () => {
  assert.equal(BoUi.formatearFecha("2026-04-22"), "22/04/2026");
  assert.equal(BoUi.formatearFecha("2026-01-05"), "05/01/2026");
});

test("BoUi.formatearFecha: Date → 'DD/MM/AAAA'", () => {
  assert.equal(BoUi.formatearFecha(new Date(2026, 3, 22)), "22/04/2026");
});

test("BoUi.formatearFecha: entrada nula/inválida → ''", () => {
  assert.equal(BoUi.formatearFecha(null), "");
  assert.equal(BoUi.formatearFecha(""), "");
  assert.equal(BoUi.formatearFecha("no-es-fecha"), "");
});

test("BoUi.formatearHora: Date → 'HH:MM' 24h", () => {
  assert.equal(BoUi.formatearHora(new Date(2026, 3, 22, 9, 30)), "09:30");
  assert.equal(BoUi.formatearHora(new Date(2026, 3, 22, 17, 5)), "17:05");
});

test("BoUi.formatearHora: inválida → ''", () => {
  assert.equal(BoUi.formatearHora("not-a-date"), "");
  assert.equal(BoUi.formatearHora(null), "");
});

test("BoUi.titleCase: 'MARÍA JOSÉ' → 'María José' (tildes preservadas)", () => {
  assert.equal(BoUi.titleCase("MARÍA JOSÉ"), "María José");
});

test("BoUi.titleCase: 'D'AMBROSIO' → 'D'Ambrosio'", () => {
  assert.equal(BoUi.titleCase("D'AMBROSIO"), "D'Ambrosio");
});

test("BoUi.titleCase: null/vacío → ''", () => {
  assert.equal(BoUi.titleCase(null), "");
  assert.equal(BoUi.titleCase(""), "");
});

test("BoUi.primerNombre: devuelve primer token en Title Case", () => {
  assert.equal(BoUi.primerNombre("MARÍA JOSÉ GARCÍA"), "María");
  assert.equal(BoUi.primerNombre("ANA"), "Ana");
  assert.equal(BoUi.primerNombre(null), "");
});

test("BoUi.escapeHtml: escapa < > & \" '", () => {
  assert.equal(BoUi.escapeHtml(`<script>"&'x`), "&lt;script&gt;&quot;&amp;&#39;x");
  assert.equal(BoUi.escapeHtml(null), "");
});

// ===================================================================
// BoHoy — renderers puros
// ===================================================================

test("BoHoy.renderFilaSesion: incluye nombre en Title Case, hora y link al detalle", () => {
  // Las acciones viven en el detalle del paciente: la fila de Hoy es un
  // link al detalle, sin botones de copy en esta vista.
  const html = BoHoy.renderFilaSesion({
    pacienteId: "p1",
    nombre: "MARTA PÉREZ",
    hora: "10:30",
    comando: "/seguimiento-paciente MARTA PÉREZ",
    tipo: "seguimiento"
  });
  assert.match(html, /data-bo-fila="sesion"/);
  assert.match(html, />Marta Pérez</);           // Title Case en copy UI
  assert.match(html, />10:30</);
  assert.match(html, /href="\/backoffice\/paciente\/\?id=p1"/);
  assert.ok(!/data-bo-comando=/.test(html), "la vista Hoy no debe incluir botones copy");
});

test("BoHoy.renderFilaSesion: tipo='seguimiento' → badge verde 'Seguimiento'", () => {
  const html = BoHoy.renderFilaSesion({
    pacienteId: "p1", nombre: "MARTA", hora: "10:30", tipo: "seguimiento"
  });
  assert.match(html, /class="bo-fila-tag is-seguimiento"/);
  assert.match(html, /data-bo-tag="seguimiento"/);
  assert.match(html, />Seguimiento</);
});

test("BoHoy.renderFilaSesion: tipo='valoracion' → badge azul 'Primera consulta', sin link al detalle", () => {
  // Una valoración es un prospecto pre-pago: no hay fila en `pacientes`
  // todavía, así que la fila no enlaza a /backoffice/paciente/.
  const html = BoHoy.renderFilaSesion({
    pacienteId: null, nombre: "JORGE NAVARRO", hora: "11:00", tipo: "valoracion"
  });
  assert.match(html, /class="bo-fila-tag is-valoracion"/);
  assert.match(html, /data-bo-tag="valoracion"/);
  assert.match(html, />Primera consulta</);
  assert.match(html, />Jorge Navarro</);
  assert.ok(!/<a class="bo-fila-link-row"/.test(html), "valoración no debe llevar <a> a paciente");
  assert.match(html, /<div class="bo-fila-link-row">/);
});

test("BoHoy.renderFilaProximaSesion: badge según tipo, link solo si hay paciente", () => {
  const seg = BoHoy.renderFilaProximaSesion({
    pacienteId: "px", nombre: "MARTA", fechaISO: "2026-04-25",
    hora: "10:30", diaLabel: "Sáb 25 abr", tipo: "seguimiento"
  });
  assert.match(seg, /class="bo-fila-tag is-seguimiento"/);
  assert.match(seg, /href="\/backoffice\/paciente\/\?id=px"/);

  const val = BoHoy.renderFilaProximaSesion({
    pacienteId: null, nombre: "ANTONIA MARCO", fechaISO: "2026-04-30",
    hora: "09:00", diaLabel: "Jue 30 abr", tipo: "valoracion"
  });
  assert.match(val, /class="bo-fila-tag is-valoracion"/);
  assert.match(val, />Primera consulta</);
  assert.ok(!/<a class="bo-fila-link-row"/.test(val), "valoración sin link");
});

test("BoHoy.renderFilaMenuCrear: muestra 'Sin menú vigente' cuando diasParaCaducar es null", () => {
  const html = BoHoy.renderFilaMenuCrear({
    pacienteId: "p2",
    nombre: "ANA",
    diasParaCaducar: null,
    comando: "/crear-menu ANA"
  });
  assert.match(html, /Sin menú vigente/);
  assert.match(html, /href="\/backoffice\/paciente\/\?id=p2"/);
});

test("BoHoy.renderFilaMenuCrear: diasParaCaducar > 0 dice 'Caduca en N días'", () => {
  const html = BoHoy.renderFilaMenuCrear({
    nombre: "ANA",
    diasParaCaducar: 3,
    comando: "/crear-menu ANA"
  });
  assert.match(html, /Caduca en 3 días/);
});

test("BoHoy.renderFilaMenuCrear: singular 'día' cuando queda 1", () => {
  const html = BoHoy.renderFilaMenuCrear({
    nombre: "ANA", diasParaCaducar: 1, comando: "/crear-menu ANA"
  });
  assert.match(html, /Caduca en 1 día\b/);
});

test("BoHoy.renderFilaMenuCrear: diasParaCaducar <= 0 dice 'Caducado hace...'", () => {
  const html = BoHoy.renderFilaMenuCrear({
    nombre: "ANA", diasParaCaducar: -2, comando: "/crear-menu ANA"
  });
  assert.match(html, /Caducado hace 2 días/);
});

test("BoHoy.renderFilaMenuCrear: anamnesisLista=true → botón 'Crear menú' con data-bo-comando", () => {
  const html = BoHoy.renderFilaMenuCrear({
    pacienteId: "p1",
    nombre: "ANA",
    diasParaCaducar: 3,
    anamnesisLista: true,
    comando: "/crear-menu ANA"
  });
  assert.match(html, /<button[^>]+data-bo-comando="\/crear-menu ANA"/);
  // Etiqueta legible (verbo de acción), no "Copiar /xxx".
  assert.match(html, />Crear menú</);
  // Y NO debe pintar el badge de aviso.
  assert.ok(!/data-bo-warning="anamnesis-pendiente"/.test(html));
});

test("BoHoy.renderFilaMenuCrear: anamnesisLista=false → badge 'Anamnesis pendiente', sin botón", () => {
  const html = BoHoy.renderFilaMenuCrear({
    pacienteId: "p1",
    nombre: "ANA",
    diasParaCaducar: null,
    anamnesisLista: false,
    comando: "/crear-menu ANA"
  });
  assert.match(html, /data-bo-warning="anamnesis-pendiente"/);
  assert.match(html, />Anamnesis pendiente</);
  assert.ok(!/data-bo-comando=/.test(html), "no debe haber botón copy si la anamnesis no está rellena");
});

test("BoHoy.renderFilaMenuCrear: anamnesisLista no definida → trata como pendiente (defensivo)", () => {
  const html = BoHoy.renderFilaMenuCrear({
    pacienteId: "p1", nombre: "ANA", diasParaCaducar: 3, comando: "/crear-menu ANA"
  });
  assert.match(html, /data-bo-warning="anamnesis-pendiente"/);
});

test("BoHoy.renderFilaMenuCrear: link al detalle convive con la acción a la derecha", () => {
  const html = BoHoy.renderFilaMenuCrear({
    pacienteId: "p1", nombre: "ANA", diasParaCaducar: 3,
    anamnesisLista: true, comando: "/crear-menu ANA"
  });
  // El nombre vive dentro del <a> que enlaza al detalle.
  assert.match(html, /<a class="bo-fila-link-row" href="\/backoffice\/paciente\/\?id=p1"/);
  // El botón es sibling, NO está dentro del <a> (HTML válido).
  // Comprobamos que la <a> cierra antes de que aparezca <button>.
  const cierreA = html.indexOf('</a>');
  const aperturaBoton = html.indexOf('<button');
  assert.ok(cierreA > 0 && aperturaBoton > cierreA, "botón debe ir tras cerrar <a>");
});

// -------------------------------------------------------------------
// BoHoy — bloque "Pendientes de resolver"
// -------------------------------------------------------------------

test("BoHoy.renderFilaPendiente: pinta nombre Title Case, hora y dos botones [Dar de alta] [Descartar]", () => {
  const html = BoHoy.renderFilaPendiente({
    valoracionId: "v-uuid",
    nombre: "JORGE NAVARRO",
    email: "jorge@x.com",
    hora: "13:00",
    diaLabel: "Hoy",
    esHoy: true,
    comandoAlta: "/alta-paciente JORGE NAVARRO jorge@x.com"
  });
  assert.match(html, /data-bo-fila="pendiente"/);
  assert.match(html, /class="bo-fila bo-fila-pendiente"/);
  assert.match(html, />Jorge Navarro</);
  // esHoy=true → no muestra prefijo de día, solo la hora.
  assert.match(html, />13:00</);
  assert.ok(!/Hoy · 13:00/.test(html), "esHoy=true debe omitir prefijo de día");

  // Botón "Dar de alta": copy-command estándar.
  assert.match(html, /data-bo-action="copy"/);
  assert.match(html, /data-bo-comando="\/alta-paciente JORGE NAVARRO jorge@x\.com"/);
  assert.match(html, />Dar de alta</);

  // Botón "Descartar": acción directa con id+nombre para el handler.
  assert.match(html, /data-bo-action="descartar-valoracion"/);
  assert.match(html, /data-bo-valoracion-id="v-uuid"/);
  assert.match(html, /data-bo-valoracion-nombre="JORGE NAVARRO"/);
  assert.match(html, />Descartar</);
});

test("BoHoy.renderFilaPendiente: esHoy=false → muestra 'Ayer · 13:00' (o etiqueta de día)", () => {
  const html = BoHoy.renderFilaPendiente({
    valoracionId: "v-2",
    nombre: "ANA",
    email: "a@x.com",
    hora: "13:00",
    diaLabel: "Ayer",
    esHoy: false,
    comandoAlta: "/alta-paciente ANA a@x.com"
  });
  assert.match(html, /Ayer · 13:00/);
});

test("BoHoy.renderFilaPendiente: escapa caracteres especiales en email/nombre", () => {
  const html = BoHoy.renderFilaPendiente({
    valoracionId: "v-x",
    nombre: 'JOSÉ "CHARO"',
    email: "x&y@z.com",
    hora: "10:00",
    esHoy: true,
    comandoAlta: '/alta-paciente JOSÉ "CHARO" x&y@z.com'
  });
  // El nombre interno en data-bo-valoracion-nombre debe quedar escapado.
  assert.match(html, /data-bo-valoracion-nombre="JOSÉ &quot;CHARO&quot;"/);
  // El comando también escapado en data-bo-comando.
  assert.match(html, /&quot;CHARO&quot;/);
  assert.match(html, /x&amp;y@z\.com/);
});

test("BoHoy.renderTodosLosBloques: pinta el bloque 'pendientes' cuando hay items", () => {
  const agrupado = {
    sesionesHoy: [],
    pendientes: [{
      valoracionId: "v1", nombre: "X", email: "x@x", hora: "10:00",
      esHoy: true, comandoAlta: "/alta-paciente X x@x"
    }],
    proximos7Dias: [],
    menusCrearSemana: [],
    alertas: []
  };
  const html = BoHoy.renderTodosLosBloques(agrupado);
  assert.match(html, /data-bo-block="pendientes"/);
  assert.match(html, /Pendientes de resolver/);
});

test("BoHoy.renderTodosLosBloques: bloque 'pendientes' vacío se oculta", () => {
  const agrupado = {
    sesionesHoy: [{ pacienteId: "p1", nombre: "A", hora: "10:00", tipo: "seguimiento" }],
    pendientes: [],
    proximos7Dias: [], menusCrearSemana: [], alertas: []
  };
  const html = BoHoy.renderTodosLosBloques(agrupado);
  assert.ok(!/data-bo-block="pendientes"/.test(html));
});

test("BoHoy.renderFilaAlerta: diasSinCheckin null → 'Sin check-ins aún'", () => {
  const html = BoHoy.renderFilaAlerta({
    nombre: "NOA", diasSinCheckin: null, comando: "/repescar-paciente NOA"
  });
  assert.match(html, /Sin check-ins aún/);
});

test("BoHoy.renderFilaAlerta: diasSinCheckin=5 → '5 días sin check-in'", () => {
  const html = BoHoy.renderFilaAlerta({
    nombre: "NOA", diasSinCheckin: 5, comando: "/repescar-paciente NOA"
  });
  assert.match(html, /5 días sin check-in/);
});

test("BoHoy.renderBloque: sección con atributo data-bo-block + título + lista", () => {
  const html = BoHoy.renderBloque({
    key: "sesiones-hoy",
    titulo: "Sesiones hoy",
    items: [{ nombre: "ANA", hora: "09:00", comando: "/seguimiento-paciente ANA" }],
    renderFila: BoHoy.renderFilaSesion,
    emptyMsg: "Hoy no hay sesiones agendadas."
  });
  assert.match(html, /<section[^>]*data-bo-block="sesiones-hoy"/);
  assert.match(html, /Sesiones hoy/);
  assert.match(html, /<ul class="bo-lista">/);
});

test("BoHoy.renderBloque: items vacíos muestran emptyMsg y no pinta <ul>", () => {
  const html = BoHoy.renderBloque({
    key: "sesiones-hoy",
    titulo: "Sesiones hoy",
    items: [],
    renderFila: BoHoy.renderFilaSesion,
    emptyMsg: "Hoy no hay sesiones agendadas."
  });
  assert.match(html, /Hoy no hay sesiones agendadas\./);
  assert.ok(!/<ul class="bo-lista">/.test(html));
});

test("BoHoy.renderTodosLosBloques: pinta los 4 bloques cuando todos tienen items", () => {
  // Item mínimo por bloque para forzar el render de los 4.
  const agrupado = {
    sesionesHoy: [{ pacienteId: "p1", nombre: "ANA", hora: "10:00", comando: "/seguimiento-paciente ANA" }],
    proximos7Dias: [{ pacienteId: "p1", nombre: "ANA", fechaISO: "2026-04-23", hora: "10:00", diaLabel: "Mañana", comando: "/seguimiento-paciente ANA" }],
    menusCrearSemana: [{ pacienteId: "p1", nombre: "ANA", diasParaCaducar: 1, comando: "/crear-menu ANA" }],
    alertas: [{ pacienteId: "p1", nombre: "ANA", diasSinCheckin: 5, comando: "/repescar-paciente ANA" }]
  };
  const html = BoHoy.renderTodosLosBloques(agrupado);
  for (const key of ["sesiones-hoy", "proximos-7-dias", "menus-crear-semana", "alertas"]) {
    assert.match(html, new RegExp(`data-bo-block="${key}"`), `falta bloque ${key}`);
  }
  // El bloque "Enviar menú" se eliminó de la vista Hoy (vive en el detalle).
  assert.ok(!/data-bo-block="menus-enviar"/.test(html));
});

test("BoHoy.renderTodosLosBloques: título 'Menús a crear esta semana' (cadencia explícita)", () => {
  // feedback_copy_cadencia.md: bloques semanales deben decirlo.
  const agrupado = {
    sesionesHoy: [],
    proximos7Dias: [],
    menusCrearSemana: [{ pacienteId: "p1", nombre: "ANA", diasParaCaducar: 1, comando: "/crear-menu ANA" }],
    alertas: []
  };
  const html = BoHoy.renderTodosLosBloques(agrupado);
  assert.match(html, /Menús a crear esta semana/);
});

// -------------------------------------------------------------------
// BoHoy — bloque "Próximos 7 días"
// -------------------------------------------------------------------

test("BoHoy.renderFilaProximaSesion: nombre Title Case + diaLabel + hora + link al detalle", () => {
  const html = BoHoy.renderFilaProximaSesion({
    pacienteId: "px",
    nombre: "MARTA PÉREZ",
    fechaISO: "2026-04-25",
    hora: "10:30",
    diaLabel: "Sáb 25 abr",
    comando: "/seguimiento-paciente MARTA PÉREZ"
  });
  assert.match(html, /data-bo-fila="proxima-sesion"/);
  assert.match(html, />Marta Pérez</);
  assert.match(html, /Sáb 25 abr · 10:30/);
  assert.match(html, /href="\/backoffice\/paciente\/\?id=px"/);
  assert.ok(!/data-bo-comando=/.test(html), "la vista Hoy no debe llevar botones copy");
});

test("BoHoy.renderFilaProximaSesion: diff=1 → 'Mañana · HH:MM'", () => {
  const html = BoHoy.renderFilaProximaSesion({
    pacienteId: "px",
    nombre: "ANA",
    fechaISO: "2026-04-23",
    hora: "09:00",
    diaLabel: "Mañana",
    comando: "/seguimiento-paciente ANA"
  });
  assert.match(html, /Mañana · 09:00/);
});

test("BoHoy.renderTodosLosBloques: orden por urgencia (pendientes → sesiones-hoy → menús → alertas → próximos-7-días)", () => {
  // Orden canónico (de más urgente a más informativo):
  //   1. pendientes — valoraciones atascadas, exigen decisión
  //   2. sesiones-hoy — ocurren hoy
  //   3. menus-crear-semana — deadline semanal
  //   4. alertas — prevención abandono
  //   5. proximos-7-dias — vista anticipada
  const agrupado = {
    pendientes: [{
      valoracionId: "v1", nombre: "X", email: "x@x", hora: "10:00",
      esHoy: true, comandoAlta: "/alta-paciente X x@x"
    }],
    sesionesHoy: [{ pacienteId: "p1", nombre: "ANA", hora: "10:00", comando: "/seguimiento-paciente ANA" }],
    menusCrearSemana: [{ pacienteId: "p1", nombre: "ANA", diasParaCaducar: 1, comando: "/crear-menu ANA" }],
    alertas: [{ pacienteId: "p1", nombre: "ANA", diasSinCheckin: 5, comando: "/repescar-paciente ANA" }],
    proximos7Dias: [{ pacienteId: "p1", nombre: "ANA", fechaISO: "2026-04-23", hora: "10:00", diaLabel: "Mañana", comando: "/seguimiento-paciente ANA" }]
  };
  const html = BoHoy.renderTodosLosBloques(agrupado);
  const idxPend  = html.indexOf('data-bo-block="pendientes"');
  const idxHoy   = html.indexOf('data-bo-block="sesiones-hoy"');
  const idxMenu  = html.indexOf('data-bo-block="menus-crear-semana"');
  const idxAlert = html.indexOf('data-bo-block="alertas"');
  const idxProx  = html.indexOf('data-bo-block="proximos-7-dias"');
  assert.ok(
    idxPend >= 0 && idxHoy >= 0 && idxMenu >= 0 && idxAlert >= 0 && idxProx >= 0,
    "faltan bloques"
  );
  assert.ok(idxPend < idxHoy, "pendientes debe ir antes de sesiones-hoy");
  assert.ok(idxHoy < idxMenu, "sesiones-hoy debe ir antes de menus-crear-semana");
  assert.ok(idxMenu < idxAlert, "menus-crear-semana debe ir antes de alertas");
  assert.ok(idxAlert < idxProx, "alertas debe ir antes de proximos-7-dias");
});

test("BoHoy.renderTodosLosBloques: proximos7Dias undefined no rompe (defensa)", () => {
  // Defensa: agrupado sin la clave no debe petar; como está vacío, el
  // bloque ni siquiera se renderiza (UX: panel limpio).
  const agrupado = { sesionesHoy: [], menusCrearSemana: [], alertas: [] };
  const html = BoHoy.renderTodosLosBloques(agrupado);
  assert.ok(!/data-bo-block="proximos-7-dias"/.test(html), "bloque vacío no debe renderizarse");
});

// -------------------------------------------------------------------
// BoHoy — bloques vacíos se ocultan (UX: panel despejado)
// -------------------------------------------------------------------

test("BoHoy.renderTodosLosBloques: oculta bloques con items vacíos", () => {
  // Solo 'alertas' tiene contenido. Los otros 3 no deben renderizarse.
  const agrupado = {
    sesionesHoy: [],
    proximos7Dias: [],
    menusCrearSemana: [],
    alertas: [{ pacienteId: "p1", nombre: "ANA", diasSinCheckin: 5, comando: "/repescar-paciente ANA" }]
  };
  const html = BoHoy.renderTodosLosBloques(agrupado);
  assert.match(html, /data-bo-block="alertas"/);
  for (const key of ["sesiones-hoy", "proximos-7-dias", "menus-crear-semana"]) {
    assert.ok(
      !new RegExp(`data-bo-block="${key}"`).test(html),
      `bloque vacío ${key} no debería renderizarse`
    );
  }
  // Ni mensaje "vacío" global (hay al menos uno con contenido).
  assert.ok(!/data-bo-block="vacio"/.test(html));
});

test("BoHoy.renderTodosLosBloques: todos vacíos → único mensaje 'Día despejado'", () => {
  const agrupado = { sesionesHoy: [], proximos7Dias: [], menusCrearSemana: [], alertas: [] };
  const html = BoHoy.renderTodosLosBloques(agrupado);
  assert.match(html, /data-bo-block="vacio"/);
  assert.match(html, /Sin tareas pendientes\. Día despejado\./);
  // Y NINGÚN bloque concreto.
  for (const key of ["sesiones-hoy", "proximos-7-dias", "menus-crear-semana", "alertas"]) {
    assert.ok(!new RegExp(`data-bo-block="${key}"`).test(html), `${key} no debería renderizarse`);
  }
});

test("BoHoy.renderTodosLosBloques: agrupado vacío {} no rompe", () => {
  const html = BoHoy.renderTodosLosBloques({});
  assert.match(html, /Día despejado/);
});

// ===================================================================
// BoHoy — tarjeta de métricas
// ===================================================================

test("BoHoy.renderMetricas: 3 celdas con etiquetas de cadencia explícita", () => {
  const html = BoHoy.renderMetricas({
    activas: 12,
    menusEsteMes: 5,
    repescas: { numerador: 2, denominador: 3, label: "Respuesta a repescas (últimos 90 días)" }
  });
  assert.match(html, /<section id="metricas"[^>]*data-bo-block="metricas"/);
  // Cadencia explícita en etiquetas (feedback_copy_cadencia.md)
  assert.match(html, /Pacientes activas hoy/);
  assert.match(html, /Menús creados este mes/);
  assert.match(html, /Respuesta a repescas \(últimos 90 días\)/);
  // Valores visibles
  assert.match(html, /<div class="bo-metrica-valor">12<\/div>/);
  assert.match(html, /<div class="bo-metrica-valor">5<\/div>/);
  assert.match(html, /<div class="bo-metrica-valor">2\/3<\/div>/);
});

test("BoHoy.renderMetricas: repescas 'Sin datos suficientes' → muestra '—' + etiqueta", () => {
  const html = BoHoy.renderMetricas({
    activas: 8,
    menusEsteMes: 3,
    repescas: { numerador: 0, denominador: 0, label: "Sin datos suficientes" }
  });
  assert.match(html, /data-bo-metrica="repescas"/);
  assert.match(html, /<div class="bo-metrica-valor">—<\/div>/);
  assert.match(html, /Sin datos suficientes/);
  // No debe aparecer "0/0" como valor numérico
  assert.ok(!/0\/0/.test(html), "no mostrar 0/0 cuando faltan datos");
});

test("BoHoy.renderMetricas: input vacío no rompe (defensivo)", () => {
  const html = BoHoy.renderMetricas();
  assert.match(html, /<section id="metricas"/);
  assert.match(html, /Sin datos suficientes/);
});

test("BoHoy.renderMetricas: cada celda lleva data-bo-metrica con su clave", () => {
  const html = BoHoy.renderMetricas({
    activas: 0, menusEsteMes: 0,
    repescas: { numerador: 0, denominador: 0, label: "Sin datos suficientes" }
  });
  for (const key of ["activas", "menus-mes", "repescas"]) {
    assert.match(html, new RegExp(`data-bo-metrica="${key}"`), `falta celda ${key}`);
  }
});

// ===================================================================
// BoPacientes — renderers puros
// ===================================================================

function _pacEj(over) {
  return Object.assign({
    id: "p-1",
    nombre: "MARTA PÉREZ",
    email: "marta@example.com",
    estado: "activo",
    proximaSesion: "2026-04-30T09:00:00.000Z",
    diasSinCheckin: 2,
    tieneMenuVigente: true
  }, over || {});
}

test("BoPacientes.construirFila: devuelve <tr> con 5 columnas y data-bo-paciente-id", () => {
  // Sin columna Acciones: las acciones viven en el detalle del paciente.
  const html = BoPacientes.construirFila(_pacEj());
  assert.match(html, /<tr data-bo-paciente-id="p-1"/);
  for (const col of ["nombre", "estado", "proxima-sesion", "dias-sin-checkin", "menu-vigente"]) {
    assert.match(html, new RegExp(`data-col="${col}"`), `falta columna ${col}`);
  }
  assert.ok(!/data-col="acciones"/.test(html), "la columna acciones ya no existe");
});

test("BoPacientes.construirFila: nombre visible en Title Case", () => {
  const html = BoPacientes.construirFila(_pacEj({ nombre: "MARTA PÉREZ" }));
  assert.match(html, />Marta Pérez</);
  // Y NO debe aparecer "MARTA PÉREZ" como texto visible — sólo en el comando.
  // Para verificarlo nos quedamos con lo que haya entre > y < (texto visible),
  // ignorando atributos.
  const visible = html.replace(/<[^>]+>/g, " ");
  assert.ok(!/MARTA PÉREZ/.test(visible), "no debe mostrar MAYÚSCULAS en texto visible");
});

test("BoPacientes.construirFila: link a /backoffice/paciente/?id=...", () => {
  const html = BoPacientes.construirFila(_pacEj({ id: "abc-123" }));
  assert.match(html, /href="\/backoffice\/paciente\/\?id=abc-123"/);
});

test("BoPacientes.construirFila: no tiene botones copy (las acciones viven en el detalle)", () => {
  const html = BoPacientes.construirFila(_pacEj());
  assert.ok(!/data-bo-comando=/.test(html), "la fila de la tabla no debe llevar botones copy");
});

test("BoPacientes.construirFila: estado 'cerrado' → 'Cerrada' (Title Case)", () => {
  const html = BoPacientes.construirFila(_pacEj({ estado: "cerrado" }));
  assert.match(html, /<td data-col="estado">Cerrada<\/td>/);
});

test("BoPacientes.construirFila: estado 'activo' → 'Activa'", () => {
  const html = BoPacientes.construirFila(_pacEj({ estado: "activo" }));
  assert.match(html, /<td data-col="estado">Activa<\/td>/);
});

test("BoPacientes.construirFila: menú vigente 'Sí' / 'No'", () => {
  const conMenu = BoPacientes.construirFila(_pacEj({ tieneMenuVigente: true }));
  assert.match(conMenu, /<td data-col="menu-vigente">Sí<\/td>/);
  const sinMenu = BoPacientes.construirFila(_pacEj({ tieneMenuVigente: false }));
  assert.match(sinMenu, /<td data-col="menu-vigente">No<\/td>/);
});

test("BoPacientes.construirFila: próxima sesión 'DD/MM/AAAA · HH:MM'", () => {
  // 2026-04-30T09:00:00.000Z → en UTC es 09:00; en TZ local podrá variar.
  // Comprobamos el patrón, no valores exactos (horario local depende del runner).
  const html = BoPacientes.construirFila(_pacEj());
  assert.match(html, /<td data-col="proxima-sesion">\d{2}\/\d{2}\/\d{4} · \d{2}:\d{2}<\/td>/);
});

test("BoPacientes.construirFila: proximaSesion null → '—'", () => {
  const html = BoPacientes.construirFila(_pacEj({ proximaSesion: null }));
  assert.match(html, /<td data-col="proxima-sesion">—<\/td>/);
});

test("BoPacientes.construirFila: diasSinCheckin null → '—', 0 → 'Hoy', 1 → '1 día'", () => {
  assert.match(BoPacientes.construirFila(_pacEj({ diasSinCheckin: null })),
    /<td data-col="dias-sin-checkin">—<\/td>/);
  assert.match(BoPacientes.construirFila(_pacEj({ diasSinCheckin: 0 })),
    /<td data-col="dias-sin-checkin">Hoy<\/td>/);
  assert.match(BoPacientes.construirFila(_pacEj({ diasSinCheckin: 1 })),
    /<td data-col="dias-sin-checkin">1 día<\/td>/);
  assert.match(BoPacientes.construirFila(_pacEj({ diasSinCheckin: 5 })),
    /<td data-col="dias-sin-checkin">5 días<\/td>/);
});

test("BoPacientes.renderTabla: tiene las 5 cabeceras esperadas (sin Acciones)", () => {
  const html = BoPacientes.renderTabla([_pacEj()]);
  for (const h of [
    "Nombre", "Estado", "Próxima sesión",
    "Días desde último check-in", "Menú vigente"
  ]) {
    assert.match(html, new RegExp(`<th[^>]*>${h}</th>`), `falta cabecera ${h}`);
  }
  assert.ok(!/<th[^>]*>Acciones<\/th>/.test(html), "la cabecera Acciones ya no existe");
  assert.match(html, /<table class="bo-tabla"/);
  assert.match(html, /data-bo-tabla="pacientes"/);
});

test("BoPacientes.renderTabla: lista vacía muestra fila vacía 'No hay pacientes en este filtro.'", () => {
  const html = BoPacientes.renderTabla([]);
  assert.match(html, /No hay pacientes en este filtro\./);
  assert.match(html, /bo-fila-vacia/);
});

test("BoPacientes.renderFiltro: incluye las 3 opciones y marca la seleccionada", () => {
  const html = BoPacientes.renderFiltro("cerradas");
  assert.match(html, /<option value="activas">Activas<\/option>/);
  assert.match(html, /<option value="cerradas" selected>Cerradas<\/option>/);
  assert.match(html, /<option value="todas">Todas<\/option>/);
  assert.match(html, /data-bo-filtro/);
});

test("BoPacientes.decorarPaciente: sin checkins → diasSinCheckin null", () => {
  const dec = BoPacientes.decorarPaciente(
    { id: "p1", nombre: "ANA", email: "a@a", estado: "activo", proximaSesion: null },
    { hoy: new Date(2026, 3, 22), checkinsByPac: new Map(), menusByPac: new Map() }
  );
  assert.equal(dec.diasSinCheckin, null);
  assert.equal(dec.tieneMenuVigente, false);
});

test("BoPacientes.decorarPaciente: checkin hace 3 días → 3", () => {
  const m = new Map();
  m.set("p1", [{ fecha: "2026-04-19" }]); // hoy = 2026-04-22
  const dec = BoPacientes.decorarPaciente(
    { id: "p1", nombre: "ANA", estado: "activo", proximaSesion: null },
    { hoy: new Date(2026, 3, 22), checkinsByPac: m, menusByPac: new Map() }
  );
  assert.equal(dec.diasSinCheckin, 3);
});

test("BoPacientes.decorarPaciente: menú con vigente_desde pasado → tieneMenuVigente true", () => {
  const m = new Map();
  m.set("p1", [{ vigente_desde: "2026-04-01" }]);
  const dec = BoPacientes.decorarPaciente(
    { id: "p1", nombre: "ANA", estado: "activo", proximaSesion: null },
    { hoy: new Date(2026, 3, 22), checkinsByPac: new Map(), menusByPac: m }
  );
  assert.equal(dec.tieneMenuVigente, true);
});

test("BoPacientes.decorarPaciente: menú futuro (no vigente aún) → false", () => {
  const m = new Map();
  m.set("p1", [{ vigente_desde: "2027-01-01" }]);
  const dec = BoPacientes.decorarPaciente(
    { id: "p1", nombre: "ANA", estado: "activo", proximaSesion: null },
    { hoy: new Date(2026, 3, 22), checkinsByPac: new Map(), menusByPac: m }
  );
  assert.equal(dec.tieneMenuVigente, false);
});

test("BoPacientes.construirVista: incluye filtro + tabla en un solo string", () => {
  const datos = {
    pacientes: [
      { id: "p1", email: "a@a", nombre: "ANA", estado: "activo", alta: "2026-01-01" }
    ],
    sesiones: [],
    checkins: [],
    menus: []
  };
  const html = BoPacientes.construirVista(datos, "activas");
  assert.match(html, /data-bo-filtro/);
  assert.match(html, /data-bo-tabla="pacientes"/);
  assert.match(html, />Ana</);
});

test("BoPacientes.construirVista: filtro 'cerradas' → pacientes activos NO aparecen", () => {
  const datos = {
    pacientes: [
      { id: "p1", email: "a@a", nombre: "ANA", estado: "activo", alta: "2026-01-01" },
      { id: "p2", email: "b@b", nombre: "BEATRIZ", estado: "cerrado", alta: "2025-12-01" }
    ],
    sesiones: [], checkins: [], menus: []
  };
  const html = BoPacientes.construirVista(datos, "cerradas");
  assert.ok(!/>Ana</.test(html), "no debe aparecer Ana (activa) con filtro cerradas");
  assert.match(html, />Beatriz</);
});

// ===================================================================
// Build: verificar que los HTML generados llevan las nuevas estructuras
// ===================================================================

before(() => {
  // Si _site/ ya existe (build previo del workflow CI o de `npm run serve`),
  // no reconstruimos — evita race con otros ficheros de test que corren en
  // paralelo y podrían borrar/regenerar passthrough files a mitad de lectura.
  if (fs.existsSync(path.join(SITE, "backoffice", "index.html"))) return;
  execFileSync("npx", ["eleventy"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
});

test("build: /backoffice/ carga backoffice-hoy.js (script de la vista)", () => {
  const html = fs.readFileSync(path.join(SITE, "backoffice", "index.html"), "utf8");
  assert.match(html, /src="\/backoffice\/backoffice-hoy\.js"/);
});

test("build: /backoffice/pacientes/ carga backoffice-pacientes.js", () => {
  const html = fs.readFileSync(path.join(SITE, "backoffice", "pacientes", "index.html"), "utf8");
  assert.match(html, /src="\/backoffice\/backoffice-pacientes\.js"/);
});

test("build: ambas páginas cargan ui.js desde el layout", () => {
  for (const rel of ["backoffice/index.html", "backoffice/pacientes/index.html"]) {
    const html = fs.readFileSync(path.join(SITE, rel), "utf8");
    assert.match(html, /src="\/backoffice\/ui\.js"/, `${rel} no carga ui.js`);
  }
});

test("build: los 4 scripts del backoffice se copian al _site/", () => {
  for (const f of ["logic.js", "auth.js", "ui.js", "backoffice-hoy.js", "backoffice-pacientes.js"]) {
    assert.ok(
      fs.existsSync(path.join(SITE, "backoffice", f)),
      `falta _site/backoffice/${f}`
    );
  }
});

test("build: /backoffice/ contiene contenedor #bloques y #estado-auth", () => {
  const html = fs.readFileSync(path.join(SITE, "backoffice", "index.html"), "utf8");
  assert.match(html, /<div id="bloques"><\/div>/);
  assert.match(html, /id="estado-auth"/);
});

test("build: /backoffice/ contiene <section id=\"metricas\"> arriba de #bloques", () => {
  const html = fs.readFileSync(path.join(SITE, "backoffice", "index.html"), "utf8");
  assert.match(html, /<section id="metricas"[^>]*data-bo-block="metricas"/);
  // La sección metricas debe preceder al div #bloques en el HTML.
  const idxMetricas = html.indexOf('id="metricas"');
  const idxBloques = html.indexOf('id="bloques"');
  assert.ok(idxMetricas > -1 && idxBloques > -1, "faltan los contenedores");
  assert.ok(idxMetricas < idxBloques, "metricas debe aparecer antes que #bloques");
});

test("build: /backoffice/ carga el mismo script backoffice-hoy.js (no regresión)", () => {
  const html = fs.readFileSync(path.join(SITE, "backoffice", "index.html"), "utf8");
  assert.match(html, /src="\/backoffice\/backoffice-hoy\.js"/);
});

test("build: /backoffice/pacientes/ contiene contenedor #tabla-pacientes", () => {
  const html = fs.readFileSync(path.join(SITE, "backoffice", "pacientes", "index.html"), "utf8");
  assert.match(html, /<div id="tabla-pacientes"><\/div>/);
});

test("build: las invocaciones de BoAuth usan onListo que dispara el arrancar correcto", () => {
  const hoy = fs.readFileSync(path.join(SITE, "backoffice", "index.html"), "utf8");
  assert.match(hoy, /window\.BoHoy\.arrancar\(supa\)/);
  const pac = fs.readFileSync(path.join(SITE, "backoffice", "pacientes", "index.html"), "utf8");
  assert.match(pac, /window\.BoPacientes\.arrancar\(supa\)/);
});

// ===================================================================
// renderFilaPagoPendiente — bloque "Pagos pendientes"
// ===================================================================

test("renderFilaPagoPendiente: vencido → badge 🔴 con clase bo-pago-vencido", () => {
  const html = BoHoy.renderFilaPagoPendiente({
    pacienteId: "p1",
    nombre: "NEREA",
    fechaEsperada: "2026-04-28",
    estado: "vencido",
    diasDiff: -3
  });
  assert.match(html, /data-bo-fila="pago-pendiente"/);
  assert.match(html, /Nerea/); // titleCase
  assert.match(html, /vencido hace 3 días/);
  assert.match(html, /28 abr/);
  assert.match(html, /class="[^"]*bo-pago-vencido/);
  assert.match(html, /data-bo-comando="\/registrar-pago NEREA"/);
  assert.match(html, /Registrar pago/);
  assert.match(html, /href="\/backoffice\/paciente\/\?id=p1"/);
});

test("renderFilaPagoPendiente: aviso → badge 🟡 con clase bo-pago-aviso", () => {
  const html = BoHoy.renderFilaPagoPendiente({
    pacienteId: "p2",
    nombre: "SARA",
    fechaEsperada: "2026-05-01",
    estado: "aviso",
    diasDiff: 0
  });
  assert.match(html, /Sara/);
  assert.match(html, /vence hoy/);
  assert.match(html, /1 may/);
  assert.match(html, /class="[^"]*bo-pago-aviso/);
  assert.ok(!/bo-pago-vencido/.test(html));
});

test("renderFilaPagoPendiente: nombre va a comando en MAYÚSCULAS, visible en Title Case", () => {
  const html = BoHoy.renderFilaPagoPendiente({
    pacienteId: "p1",
    nombre: "MARÍA JOSÉ",
    fechaEsperada: "2026-05-02",
    estado: "aviso",
    diasDiff: 1
  });
  assert.match(html, /data-bo-comando="\/registrar-pago MARÍA JOSÉ"/);
  // En el cuerpo visible aparece en Title Case (no MAYÚSCULAS)
  const visible = html.replace(/<[^>]+>/g, " ").replace(/data-bo-comando="[^"]*"/g, "");
  assert.match(visible, /María José/);
});

test("renderFilaPagoPendiente: HTML escapado (defensa XSS)", () => {
  const html = BoHoy.renderFilaPagoPendiente({
    pacienteId: 'p<script>alert(1)</script>',
    nombre: 'MAL"<script>',
    fechaEsperada: "2026-05-01",
    estado: "aviso",
    diasDiff: 0
  });
  assert.ok(!/<script>/.test(html));
});

// ===================================================================
// Bloque "Pagos pendientes" — integrado en renderTodosLosBloques
// ===================================================================

test("renderTodosLosBloques: bloque pagos-pendientes aparece tras 'Sesiones hoy' y antes de 'Menús'", () => {
  // Construimos un agrupado con items en cada bloque relevante.
  const agrupado = {
    pendientes: [],
    sesionesHoy: [{
      pacienteId: "s1", nombre: "ANA", hora: "10:00", comando: "/seguimiento-paciente ANA", tipo: "seguimiento"
    }],
    pagosPendientes: [{
      pacienteId: "p1", nombre: "NEREA", fechaEsperada: "2026-05-01", estado: "aviso", diasDiff: 0
    }],
    menusCrearSemana: [{
      pacienteId: "m1", nombre: "EVA", diasParaCaducar: 3, anamnesisLista: true, comando: "/crear-menu EVA"
    }],
    alertas: [],
    proximos7Dias: []
  };
  const html = BoHoy.renderTodosLosBloques(agrupado);
  const ordenSesiones = html.indexOf('data-bo-block="sesiones-hoy"');
  const ordenPagos    = html.indexOf('data-bo-block="pagos-pendientes"');
  const ordenMenus    = html.indexOf('data-bo-block="menus-crear-semana"');
  assert.ok(ordenSesiones >= 0, "bloque sesiones-hoy presente");
  assert.ok(ordenPagos    >= 0, "bloque pagos-pendientes presente");
  assert.ok(ordenMenus    >= 0, "bloque menus-crear-semana presente");
  assert.ok(ordenSesiones < ordenPagos, "pagos-pendientes va DESPUÉS de sesiones-hoy");
  assert.ok(ordenPagos    < ordenMenus, "pagos-pendientes va ANTES de menus-crear-semana");
});

test("renderTodosLosBloques: bloque pagos-pendientes vacío → oculto", () => {
  const agrupado = {
    pendientes: [],
    sesionesHoy: [],
    pagosPendientes: [],
    menusCrearSemana: [{
      pacienteId: "m1", nombre: "EVA", diasParaCaducar: 3, anamnesisLista: true, comando: "/crear-menu EVA"
    }],
    alertas: [],
    proximos7Dias: []
  };
  const html = BoHoy.renderTodosLosBloques(agrupado);
  assert.ok(!/data-bo-block="pagos-pendientes"/.test(html));
});

test("renderTodosLosBloques: todos los bloques vacíos incluido pagos → mensaje 'Sin tareas pendientes'", () => {
  const agrupado = {
    pendientes: [], sesionesHoy: [], pagosPendientes: [],
    menusCrearSemana: [], alertas: [], proximos7Dias: []
  };
  const html = BoHoy.renderTodosLosBloques(agrupado);
  assert.match(html, /Sin tareas pendientes/);
});

test("renderTodosLosBloques: título del bloque es 'Pagos pendientes'", () => {
  const agrupado = {
    pendientes: [], sesionesHoy: [],
    pagosPendientes: [{
      pacienteId: "p1", nombre: "NEREA", fechaEsperada: "2026-05-01", estado: "aviso", diasDiff: 0
    }],
    menusCrearSemana: [], alertas: [], proximos7Dias: []
  };
  const html = BoHoy.renderTodosLosBloques(agrupado);
  assert.match(html, /<h2[^>]*>Pagos pendientes<\/h2>/);
});
