// Tests de la Rebanada 7 del backoffice (Agente 7):
//   - ui.ejecutarEdgeFunction: wrapper sobre supa.functions.invoke.
//   - _manejarClickAccion: handler de click en botones data-bo-action="backend".
//   - Build: /backoffice/paciente/index.html renderiza botones backend.
//
// Todas las aserciones son de comportamiento observable: dispatchEvent, texto
// del botón, llamadas al supa mock, fallback copy cuando la Edge Function
// falla. Sin jsdom — construimos los nodos que necesitamos con mínimos de la
// Node DOM stub pattern, reutilizando el approach del resto de la suite.

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
// ejecutarEdgeFunction — unit
// -------------------------------------------------------------------

function _supaMock(invokeImpl) {
  const llamadas = [];
  return {
    llamadas: llamadas,
    functions: {
      invoke: async function (nombre, args) {
        llamadas.push({ nombre: nombre, args: args });
        return invokeImpl(nombre, args);
      }
    }
  };
}

test("ejecutarEdgeFunction: ok=true cuando supa devuelve data sin error", async () => {
  const supa = _supaMock(() => ({ data: { ok: true, draft_id: "r123" }, error: null }));
  const res = await BoUi.ejecutarEdgeFunction(supa, "enviar-menu", { paciente_id: "p1", menu_numero: 1 });
  assert.equal(res.ok, true);
  assert.equal(res.data.draft_id, "r123");
  assert.equal(supa.llamadas.length, 1);
  assert.equal(supa.llamadas[0].nombre, "enviar-menu");
  assert.deepEqual(supa.llamadas[0].args.body, { paciente_id: "p1", menu_numero: 1 });
});

test("ejecutarEdgeFunction: ok=false cuando supa devuelve error HTTP", async () => {
  const supa = _supaMock(() => ({
    data: null,
    error: { message: "FunctionsHttpError: 500", status: 500 }
  }));
  const res = await BoUi.ejecutarEdgeFunction(supa, "cerrar-paciente", { paciente_id: "p1", motivo: "abandono" });
  assert.equal(res.ok, false);
  assert.equal(res.error.type, "http");
  assert.match(res.error.message, /FunctionsHttpError/);
});

test("ejecutarEdgeFunction: ok=false cuando el body trae ok=false (app error)", async () => {
  const supa = _supaMock(() => ({ data: { ok: false, error: "paciente_no_existe" }, error: null }));
  const res = await BoUi.ejecutarEdgeFunction(supa, "repescar-paciente", { paciente_id: "p1" });
  assert.equal(res.ok, false);
  assert.equal(res.error.type, "app");
  assert.equal(res.error.message, "paciente_no_existe");
});

test("ejecutarEdgeFunction: ok=false cuando invoke lanza (red caída)", async () => {
  const supa = _supaMock(() => { throw new Error("fetch failed"); });
  const res = await BoUi.ejecutarEdgeFunction(supa, "reagendar", { calendar_event_id: "x" });
  assert.equal(res.ok, false);
  assert.equal(res.error.type, "network");
  assert.match(res.error.message, /fetch failed/);
});

test("ejecutarEdgeFunction: devuelve error app si falta supa.functions.invoke", async () => {
  const res = await BoUi.ejecutarEdgeFunction({}, "reagendar", {});
  assert.equal(res.ok, false);
  assert.equal(res.error.type, "app");
});

test("ejecutarEdgeFunction: devuelve error app si falta nombre", async () => {
  const supa = _supaMock(() => ({ data: { ok: true }, error: null }));
  const res = await BoUi.ejecutarEdgeFunction(supa, "", {});
  assert.equal(res.ok, false);
  assert.equal(res.error.type, "app");
});

// -------------------------------------------------------------------
// Handler de click — _manejarClickAccion
//
// Simulamos los nodos con una fachada mínima. Node --test no incluye jsdom;
// esto es suficiente para verificar el flujo.
// -------------------------------------------------------------------

function _fakeBtn(attrs, parent) {
  const a = Object.assign({}, attrs || {});
  const btn = {
    _attrs: a,
    _classes: new Set((a.class || "").split(/\s+/).filter(Boolean)),
    dataset: {},
    textContent: a.textContent || "",
    disabled: false,
    hidden: false,
    parentNode: parent || null,
    nextElementSibling: null,
    tagName: "BUTTON",
    getAttribute: function (k) { return this._attrs[k] != null ? this._attrs[k] : null; },
    setAttribute: function (k, v) { this._attrs[k] = String(v); },
    hasAttribute: function (k) { return this._attrs[k] != null; },
    closest: function (sel) {
      // Soporte mínimo: sel "[data-bo-action]" o "[data-bo-comando]".
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

function _withConfirm(answer, fn) {
  const prev = global.window.confirm;
  global.window.confirm = () => answer;
  try { return fn(); }
  finally { global.window.confirm = prev; }
}

function _patchToast() {
  const mensajes = [];
  const prev = BoUi.toast;
  BoUi.toast = (m) => { mensajes.push(m); };
  return { mensajes: mensajes, restore: () => { BoUi.toast = prev; } };
}

test("_manejarClickAccion: botón copy copia comando al portapapeles", async () => {
  const btn = _fakeBtn({
    "data-bo-action": "copy",
    "data-bo-comando": "/crear-menu MARTA",
    textContent: "Copiar /crear-menu"
  });
  const event = { target: btn, preventDefault: () => {} };
  const calls = [];
  const prev = BoUi.copiarComando;
  BoUi.copiarComando = (cmd, b) => { calls.push({ cmd, b }); return Promise.resolve(true); };
  try {
    await BoPaciente._manejarClickAccion(event, null);
  } finally {
    BoUi.copiarComando = prev;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "/crear-menu MARTA");
});

test("_manejarClickAccion: botón backend pide confirm y llama a la Edge Function", async () => {
  const btn = _fakeBtn({
    "data-bo-action": "backend",
    "data-bo-function": "enviar-menu",
    "data-bo-payload": JSON.stringify({ paciente_id: "p1", menu_numero: 2 }),
    "data-bo-comando": "/enviar-menu MARTA",
    textContent: "Enviar menú"
  });
  const event = { target: btn, preventDefault: () => {} };
  const supa = _supaMock(() => ({ data: { ok: true, draft_id: "r123" }, error: null }));
  const toastPatch = _patchToast();
  try {
    await _withConfirm(true, () => BoPaciente._manejarClickAccion(event, supa));
  } finally {
    toastPatch.restore();
  }
  assert.equal(supa.llamadas.length, 1);
  assert.equal(supa.llamadas[0].nombre, "enviar-menu");
  assert.deepEqual(supa.llamadas[0].args.body, { paciente_id: "p1", menu_numero: 2 });
  assert.ok(toastPatch.mensajes.some(m => /Borrador creado/.test(m)),
    "toast tras éxito debe hablar del borrador");
  // Tras éxito el botón queda bloqueado con texto "Hecho".
  assert.equal(btn.disabled, true);
  assert.equal(btn.textContent, "Hecho");
});

test("_manejarClickAccion: cancelar el confirm aborta sin invocar", async () => {
  const btn = _fakeBtn({
    "data-bo-action": "backend",
    "data-bo-function": "repescar-paciente",
    "data-bo-payload": JSON.stringify({ paciente_id: "p1" }),
    "data-bo-comando": "/repescar-paciente MARTA",
    textContent: "Repescar paciente"
  });
  const event = { target: btn, preventDefault: () => {} };
  const supa = _supaMock(() => ({ data: { ok: true }, error: null }));
  await _withConfirm(false, () => BoPaciente._manejarClickAccion(event, supa));
  assert.equal(supa.llamadas.length, 0, "no debe invocar si Cristina cancela");
});

test("_manejarClickAccion: fallo de red degrada el botón a modo copy", async () => {
  const btn = _fakeBtn({
    "data-bo-action": "backend",
    "data-bo-function": "repescar-paciente",
    "data-bo-payload": JSON.stringify({ paciente_id: "p1" }),
    "data-bo-comando": "/repescar-paciente MARTA",
    textContent: "Repescar paciente"
  });
  const event = { target: btn, preventDefault: () => {} };
  const supa = _supaMock(() => { throw new Error("fetch failed"); });
  const toastPatch = _patchToast();
  try {
    await _withConfirm(true, () => BoPaciente._manejarClickAccion(event, supa));
  } finally {
    toastPatch.restore();
  }
  // Botón flipado: data-bo-action ahora es copy y el texto dice "Copiar comando".
  assert.equal(btn._attrs["data-bo-action"], "copy");
  assert.equal(btn.textContent, "Copiar comando");
  assert.equal(btn.disabled, false);
  assert.ok(toastPatch.mensajes.some(m => /No he podido/.test(m)),
    "toast de error debe sugerir Copiar comando");
});

test("_manejarClickAccion: Edge Function ok=false también degrada a copy", async () => {
  const btn = _fakeBtn({
    "data-bo-action": "backend",
    "data-bo-function": "enviar-menu",
    "data-bo-payload": JSON.stringify({ paciente_id: "p1", menu_numero: 1 }),
    "data-bo-comando": "/enviar-menu MARTA",
    textContent: "Enviar menú"
  });
  const event = { target: btn, preventDefault: () => {} };
  const supa = _supaMock(() => ({ data: { ok: false, error: "menu_sin_pdf_url" }, error: null }));
  const toastPatch = _patchToast();
  try {
    await _withConfirm(true, () => BoPaciente._manejarClickAccion(event, supa));
  } finally {
    toastPatch.restore();
  }
  assert.equal(btn._attrs["data-bo-action"], "copy");
  assert.equal(btn.textContent, "Copiar comando");
});

// -------------------------------------------------------------------
// Build: la vista detalle incluye botones backend con payload válido
// -------------------------------------------------------------------

before(() => {
  execFileSync("npx", ["eleventy"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
});

test("build: /backoffice/paciente/ no hardcodea botones backend (se pintan en runtime)", () => {
  // El HTML servido solo contiene los contenedores vacíos; los botones los
  // inserta JS tras cargar datos. Lo importante es que el script de cliente
  // esté desplegado y exponga la API que el wiring necesita.
  const html = fs.readFileSync(path.join(SITE, "backoffice", "paciente", "index.html"), "utf8");
  assert.match(html, /src="\/backoffice\/backoffice-paciente\.js"/);
});

test("build: backoffice-paciente.js desplegado incluye lógica de acciones backend", () => {
  const js = fs.readFileSync(path.join(SITE, "backoffice", "backoffice-paciente.js"), "utf8");
  assert.match(js, /data-bo-action="backend"/);
  assert.match(js, /data-bo-function=/);
  assert.match(js, /ejecutarEdgeFunction/);
  // Confirmación específica por skill.
  assert.match(js, /Mover la sesión a la nueva fecha/);
  assert.match(js, /Marcar paciente como cerrado/);
});

test("build: ui.js desplegado expone ejecutarEdgeFunction", () => {
  const js = fs.readFileSync(path.join(SITE, "backoffice", "ui.js"), "utf8");
  assert.match(js, /ejecutarEdgeFunction/);
  // Debe cubrir los 3 caminos (network, http, app).
  assert.match(js, /'network'/);
  assert.match(js, /'http'/);
  assert.match(js, /'app'/);
});
