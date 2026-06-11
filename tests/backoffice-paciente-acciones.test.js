// Tests del wiring de acciones del detalle de paciente.
//
// Desde tarea 16 hay dos tipos de botón: copy-command y panel inline.
// Copy: crear-menu, seguimiento-paciente, borrar-paciente-rgpd.
// Panel: agendar, reagendar, registrar-pago, repescar, cerrar, reactivar, enviar-menu.

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ROOT, SITE } = require("./_helpers/paths");

const BoUi    = require("../src/backoffice/ui.js");
const BoLogic = require("../src/backoffice/logic.js");
global.window = global.window || {};
global.window.BoUi    = BoUi;
global.window.BoLogic = BoLogic;
const BoPaneles = require("../src/backoffice/paneles.js");
global.window.BoPaneles = BoPaneles;
const BoPaciente = require("../src/backoffice/backoffice-paciente.js");

// -------------------------------------------------------------------
// Handler de click — _manejarClickAccion
//
// Simulamos los nodos con una fachada mínima. Node --test no incluye jsdom;
// esto es suficiente para verificar el flujo.
// -------------------------------------------------------------------

function _fakeBtn(attrs) {
  const a = Object.assign({}, attrs || {});
  const btn = {
    _attrs: a,
    _classes: new Set((a.class || "").split(/\s+/).filter(Boolean)),
    dataset: {},
    textContent: a.textContent || "",
    disabled: false,
    hidden: false,
    parentNode: null,
    nextElementSibling: null,
    tagName: "BUTTON",
    getAttribute: function (k) { return this._attrs[k] != null ? this._attrs[k] : null; },
    setAttribute: function (k, v) { this._attrs[k] = String(v); },
    hasAttribute: function (k) { return this._attrs[k] != null; },
    closest: function (sel) {
      const m = /^\[([^=\]]+)(?:="([^"]+)")?\]$/.exec(sel);
      if (!m) return null;
      const name = m[1];
      const val  = m[2];
      if (this._attrs[name] == null) return null;
      if (val != null && this._attrs[name] !== val) return null;
      return this;
    },
    classList: {
      add: function (c) { btn._classes.add(c); },
      remove: function (c) { btn._classes.delete(c); },
      contains: function (c) { return btn._classes.has(c); },
      toggle: function (c, on) {
        if (on) btn._classes.add(c); else btn._classes.delete(c);
      }
    }
  };
  return btn;
}

test("_manejarClickAccion: botón copy copia comando al portapapeles", async () => {
  const btn = _fakeBtn({
    "data-bo-action": "copy",
    "data-bo-comando": "/crear-menu MARTA",
    textContent: "Crear menú"
  });
  const event = { target: btn, preventDefault: () => {} };
  const calls = [];
  const prev = BoUi.copiarComando;
  BoUi.copiarComando = (cmd, b) => { calls.push({ cmd, b }); return Promise.resolve(true); };
  try {
    await BoPaciente._manejarClickAccion(event);
  } finally {
    BoUi.copiarComando = prev;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "/crear-menu MARTA");
});

test("_manejarClickAccion: click fuera de un botón no hace nada", async () => {
  const event = {
    target: { closest: () => null },
    preventDefault: () => {}
  };
  const calls = [];
  const prev = BoUi.copiarComando;
  BoUi.copiarComando = (cmd) => { calls.push(cmd); return Promise.resolve(true); };
  try {
    await BoPaciente._manejarClickAccion(event);
  } finally {
    BoUi.copiarComando = prev;
  }
  assert.equal(calls.length, 0);
});

test("_manejarClickAccion: botón sin data-bo-comando no copia nada", async () => {
  const btn = _fakeBtn({ "data-bo-action": "copy" });
  const event = { target: btn, preventDefault: () => {} };
  const calls = [];
  const prev = BoUi.copiarComando;
  BoUi.copiarComando = (cmd) => { calls.push(cmd); return Promise.resolve(true); };
  try {
    await BoPaciente._manejarClickAccion(event);
  } finally {
    BoUi.copiarComando = prev;
  }
  assert.equal(calls.length, 0);
});

// -------------------------------------------------------------------
// Panel-path: _manejarClickAccion con action="panel" / "cerrar-panel"
// -------------------------------------------------------------------

// Fake DOM container para los tests de panel inline.
function _fakeCont(attrs) {
  const a = Object.assign({}, attrs || {});
  const cont = {
    _attrs: a,
    innerHTML: '',
    dataset: {},
    getAttribute: function (k) { return this._attrs[k] != null ? this._attrs[k] : null; },
    setAttribute: function (k, v) { this._attrs[k] = String(v); },
    removeAttribute: function (k) { delete this._attrs[k]; }
  };
  return cont;
}

test("_manejarClickAccion: botón panel abre el panel en #bo-panel-accion", async () => {
  const btn = _fakeBtn({
    "data-bo-action": "panel",
    "data-bo-panel": "agendar"
  });
  const cont = _fakeCont();
  const renderCalls = [];
  const conectarCalls = [];
  const prevRender = BoPaneles.renderPanelAccion;
  const prevConectar = BoPaneles.conectarPanel;
  BoPaneles.renderPanelAccion = function (accion, ctx) { renderCalls.push({ accion, ctx }); return '<form data-bo-form="' + accion + '"></form>'; };
  BoPaneles.conectarPanel = function (c, accion, deps) { conectarCalls.push({ c, accion, deps }); };
  const prevGetById = global.document && global.document.getElementById;
  global.document = global.document || {};
  global.document.getElementById = function (id) { if (id === 'bo-panel-accion') return cont; return null; };
  const ctxAccion = function () { return { nombre: 'MARTA', email: 'm@x.com' }; };
  const deps = { ctxAccion: ctxAccion, recargar: function () {} };
  const event = { target: btn, preventDefault: function () {} };
  try {
    await BoPaciente._manejarClickAccion(event, deps);
  } finally {
    BoPaneles.renderPanelAccion = prevRender;
    BoPaneles.conectarPanel = prevConectar;
    if (prevGetById) global.document.getElementById = prevGetById;
  }
  assert.equal(renderCalls.length, 1);
  assert.equal(renderCalls[0].accion, 'agendar');
  assert.equal(cont.getAttribute('data-bo-abierto'), 'agendar');
  assert.equal(conectarCalls.length, 1);
  assert.equal(conectarCalls[0].accion, 'agendar');
});

test("_manejarClickAccion: segundo click en el mismo panel lo cierra (toggle)", async () => {
  const btn = _fakeBtn({
    "data-bo-action": "panel",
    "data-bo-panel": "agendar"
  });
  const cont = _fakeCont({ 'data-bo-abierto': 'agendar' });
  cont.innerHTML = '<form></form>';
  const prevRender = BoPaneles.renderPanelAccion;
  const prevConectar = BoPaneles.conectarPanel;
  BoPaneles.renderPanelAccion = function () { return '<form></form>'; };
  BoPaneles.conectarPanel = function () {};
  global.document = global.document || {};
  global.document.getElementById = function (id) { if (id === 'bo-panel-accion') return cont; return null; };
  const deps = { ctxAccion: function () { return {}; }, recargar: function () {} };
  const event = { target: btn, preventDefault: function () {} };
  try {
    await BoPaciente._manejarClickAccion(event, deps);
  } finally {
    BoPaneles.renderPanelAccion = prevRender;
    BoPaneles.conectarPanel = prevConectar;
  }
  // Panel debería haberse cerrado (toggle)
  assert.equal(cont.innerHTML, '');
  assert.equal(cont.getAttribute('data-bo-abierto'), null);
});

test("_manejarClickAccion: cerrar-panel limpia el contenedor", async () => {
  const btn = _fakeBtn({ "data-bo-action": "cerrar-panel" });
  const cont = _fakeCont({ 'data-bo-abierto': 'agendar' });
  cont.innerHTML = '<form></form>';
  global.document = global.document || {};
  global.document.getElementById = function (id) { if (id === 'bo-panel-accion') return cont; return null; };
  const event = { target: btn, preventDefault: function () {} };
  await BoPaciente._manejarClickAccion(event, {});
  assert.equal(cont.innerHTML, '');
  assert.equal(cont.getAttribute('data-bo-abierto'), null);
});

// -------------------------------------------------------------------
// Build: la vista detalle despliega los scripts esperados
// -------------------------------------------------------------------

before(() => {
  if (fs.existsSync(path.join(SITE, "backoffice", "index.html"))) return;
  execFileSync("npx", ["eleventy"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
});

test("build: /backoffice/paciente/ no hardcodea botones (se pintan en runtime)", () => {
  const html = fs.readFileSync(path.join(SITE, "backoffice", "paciente", "index.html"), "utf8");
  assert.match(html, /src="\/backoffice\/backoffice-paciente\.js"/);
});

test("build: backoffice-paciente.js desplegado tiene copy + panel, no backend directo", () => {
  const js = fs.readFileSync(path.join(SITE, "backoffice", "backoffice-paciente.js"), "utf8");
  // Copy sigue vivo (crear-menu, seguimiento-paciente, borrar-paciente-rgpd).
  assert.match(js, /data-bo-action="copy"/);
  assert.match(js, /data-bo-comando/);
  // Panel inline también presente (tarea 16).
  assert.match(js, /data-bo-action="panel"/);
  assert.match(js, /data-bo-panel/);
  // No hay backend directo en el detalle.
  assert.ok(!/data-bo-action="backend"/.test(js),
    "el detalle ya no debe emitir botones backend");
  assert.ok(!/data-bo-function=/.test(js),
    "el detalle ya no debe emitir data-bo-function");
});
