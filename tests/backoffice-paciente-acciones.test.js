// Tests del wiring de acciones del detalle de paciente.
//
// Desde 2026-04-24 todas las acciones del detalle son copy-command: el click
// copia el prompt al portapapeles. No hay botones backend aquí. El helper
// BoUi.ejecutarEdgeFunction sigue vivo en ui.js (posibles futuros consumidores)
// y tiene su suite en backoffice-ui-edge.test.js.

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

test("build: backoffice-paciente.js desplegado renderiza acciones como copy-command", () => {
  const js = fs.readFileSync(path.join(SITE, "backoffice", "backoffice-paciente.js"), "utf8");
  // Sigue vivo el wiring de copy.
  assert.match(js, /data-bo-action="copy"/);
  assert.match(js, /data-bo-comando/);
  // Ya no hay backend en el detalle.
  assert.ok(!/data-bo-action="backend"/.test(js),
    "el detalle ya no debe emitir botones backend");
  assert.ok(!/data-bo-function=/.test(js),
    "el detalle ya no debe emitir data-bo-function");
  assert.ok(!/ejecutarEdgeFunction/.test(js),
    "el detalle ya no invoca Edge Functions directamente");
});
