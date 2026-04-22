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

test("BoHoy.renderFilaSesion: incluye nombre en Title Case, hora y botón Copiar comando", () => {
  const html = BoHoy.renderFilaSesion({
    pacienteId: "p1",
    nombre: "MARTA PÉREZ",
    hora: "10:30",
    comando: "/seguimiento-paciente MARTA PÉREZ"
  });
  assert.match(html, /data-bo-fila="sesion"/);
  assert.match(html, />Marta Pérez</);           // Title Case en copy UI
  assert.match(html, />10:30</);
  assert.match(html, /data-bo-comando="\/seguimiento-paciente MARTA PÉREZ"/);
  assert.match(html, />Copiar comando</);         // etiqueta, no color
});

test("BoHoy.renderFilaMenuCrear: muestra 'Sin menú vigente' cuando diasParaCaducar es null", () => {
  const html = BoHoy.renderFilaMenuCrear({
    nombre: "ANA",
    diasParaCaducar: null,
    comando: "/crear-menu ANA"
  });
  assert.match(html, /Sin menú vigente/);
  assert.match(html, /data-bo-comando="\/crear-menu ANA"/);
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

test("BoHoy.renderFilaMenuEnviar: incluye número de menú y botón Copiar comando", () => {
  const html = BoHoy.renderFilaMenuEnviar({
    nombre: "LUCÍA", numero: 4, pdfUrl: "https://x", comando: "/enviar-menu LUCÍA"
  });
  assert.match(html, />Lucía</);
  assert.match(html, /Menú 4/);
  assert.match(html, /data-bo-comando="\/enviar-menu LUCÍA"/);
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

test("BoHoy.renderTodosLosBloques: contiene los 4 atributos data-bo-block", () => {
  const agrupado = { sesionesHoy: [], menusCrearSemana: [], menusEnviar: [], alertas: [] };
  const html = BoHoy.renderTodosLosBloques(agrupado);
  for (const key of ["sesiones-hoy", "menus-crear-semana", "menus-enviar", "alertas"]) {
    assert.match(html, new RegExp(`data-bo-block="${key}"`), `falta bloque ${key}`);
  }
});

test("BoHoy.renderTodosLosBloques: título 'Menús a crear esta semana' (cadencia explícita)", () => {
  // feedback_copy_cadencia.md: bloques semanales deben decirlo.
  const agrupado = { sesionesHoy: [], menusCrearSemana: [], menusEnviar: [], alertas: [] };
  const html = BoHoy.renderTodosLosBloques(agrupado);
  assert.match(html, /Menús a crear esta semana/);
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

test("BoPacientes.construirFila: devuelve <tr> con 6 columnas y data-bo-paciente-id", () => {
  const html = BoPacientes.construirFila(_pacEj());
  assert.match(html, /<tr data-bo-paciente-id="p-1"/);
  for (const col of ["nombre", "estado", "proxima-sesion", "dias-sin-checkin", "menu-vigente", "acciones"]) {
    assert.match(html, new RegExp(`data-col="${col}"`), `falta columna ${col}`);
  }
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

test("BoPacientes.construirFila: 2 botones copy-command (crear-menu + seguimiento-paciente)", () => {
  const html = BoPacientes.construirFila(_pacEj());
  assert.match(html, /data-bo-comando="\/crear-menu MARTA PÉREZ"/);
  assert.match(html, /data-bo-comando="\/seguimiento-paciente MARTA PÉREZ"/);
  assert.match(html, />Copiar \/crear-menu</);
  assert.match(html, />Copiar \/seguimiento-paciente</);
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

test("BoPacientes.renderTabla: tiene las 6 cabeceras esperadas", () => {
  const html = BoPacientes.renderTabla([_pacEj()]);
  for (const h of [
    "Nombre", "Estado", "Próxima sesión",
    "Días desde último check-in", "Menú vigente", "Acciones"
  ]) {
    assert.match(html, new RegExp(`<th[^>]*>${h}</th>`), `falta cabecera ${h}`);
  }
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
