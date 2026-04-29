// Tests del handler _manejarDescartar de la vista Hoy del backoffice.
//
// "Descartar" en el bloque "Pendientes de resolver" es la única excepción al
// patrón copy-only del backoffice: confirma con confirm() y dispara DELETE
// directo en Supabase (RLS DELETE policy de la migración 0018). Este suite
// verifica el comportamiento sin DOM ni Supabase real, mockeando ambos.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const BoUi    = require("../src/backoffice/ui.js");
const BoLogic = require("../src/backoffice/logic.js");
global.window = global.window || {};
global.window.BoUi    = BoUi;
global.window.BoLogic = BoLogic;
const BoHoy = require("../src/backoffice/backoffice-hoy.js");

// -------------------------------------------------------------------
// Helpers de mock — botón fake con dataset/atributos estilo DOM
// -------------------------------------------------------------------

function _fakeBtn(attrs) {
  const a = Object.assign({}, attrs || {});
  const btn = {
    _attrs: a,
    disabled: false,
    parentNode: null,
    tagName: "BUTTON",
    getAttribute: function (k) { return this._attrs[k] != null ? this._attrs[k] : null; },
    setAttribute: function (k, v) { this._attrs[k] = String(v); },
    closest: function (sel) {
      const m = /^\[([^=\]]+)(?:="([^"]+)")?\]$/.exec(sel);
      if (!m) return null;
      const name = m[1];
      const val  = m[2];
      if (this._attrs[name] == null) return null;
      if (val != null && this._attrs[name] !== val) return null;
      return this;
    }
  };
  return btn;
}

function _fakeSupa(opts) {
  const o = opts || {};
  const calls = [];
  const supa = {
    _calls: calls,
    from: function (tabla) {
      const ctx = { tabla, op: null, id: null };
      return {
        delete: function () {
          ctx.op = "delete";
          return {
            eq: function (col, val) {
              ctx.col = col;
              ctx.id = val;
              calls.push({ ...ctx });
              if (o.error) return Promise.resolve({ error: o.error });
              if (o.lanza) return Promise.reject(o.lanza);
              return Promise.resolve({ error: null, data: null });
            }
          };
        }
      };
    }
  };
  return supa;
}

function _silenciarToast() {
  const prev = BoUi.toast;
  const calls = [];
  BoUi.toast = (msg) => { calls.push(String(msg)); };
  return {
    calls,
    restaurar: () => { BoUi.toast = prev; }
  };
}

// -------------------------------------------------------------------
// _manejarDescartar
// -------------------------------------------------------------------

test("_manejarDescartar: confirm=true ejecuta DELETE en valoraciones por id", async () => {
  const btn = _fakeBtn({
    "data-bo-action": "descartar-valoracion",
    "data-bo-valoracion-id": "uuid-1",
    "data-bo-valoracion-nombre": "JORGE NAVARRO"
  });
  const ev = { target: btn, preventDefault: () => {}, stopPropagation: () => {} };
  const supa = _fakeSupa();
  const recargas = [];
  const mensajesConfirm = [];
  const toastSpy = _silenciarToast();
  try {
    const ok = await BoHoy._manejarDescartar(ev, supa, {
      confirm: (msg) => { mensajesConfirm.push(msg); return true; },
      recargar: () => { recargas.push(1); return Promise.resolve(); }
    });
    assert.equal(ok, true);
  } finally {
    toastSpy.restaurar();
  }
  assert.equal(supa._calls.length, 1);
  assert.equal(supa._calls[0].tabla, "valoraciones");
  assert.equal(supa._calls[0].op, "delete");
  assert.equal(supa._calls[0].col, "id");
  assert.equal(supa._calls[0].id, "uuid-1");
  assert.equal(recargas.length, 1, "tras DELETE OK debe recargar el panel");
  assert.equal(toastSpy.calls.length, 1);
  assert.match(toastSpy.calls[0], /Valoración descartada/);
  // El mensaje de confirmación incluye el nombre Title Case e indica
  // irreversibilidad — Cristina debe entender qué va a pasar.
  assert.match(mensajesConfirm[0], /Jorge Navarro/);
  assert.match(mensajesConfirm[0], /irreversible/i);
});

test("_manejarDescartar: confirm=false aborta sin tocar Supabase", async () => {
  const btn = _fakeBtn({
    "data-bo-action": "descartar-valoracion",
    "data-bo-valoracion-id": "uuid-2",
    "data-bo-valoracion-nombre": "X"
  });
  const ev = { target: btn, preventDefault: () => {}, stopPropagation: () => {} };
  const supa = _fakeSupa();
  const ok = await BoHoy._manejarDescartar(ev, supa, {
    confirm: () => false,
    recargar: () => { throw new Error("no debería recargar"); }
  });
  assert.equal(ok, false);
  assert.equal(supa._calls.length, 0);
});

test("_manejarDescartar: error de Supabase muestra toast y NO recarga", async () => {
  const btn = _fakeBtn({
    "data-bo-action": "descartar-valoracion",
    "data-bo-valoracion-id": "uuid-3",
    "data-bo-valoracion-nombre": "X"
  });
  const ev = { target: btn, preventDefault: () => {}, stopPropagation: () => {} };
  const supa = _fakeSupa({ error: { message: "RLS" } });
  const recargas = [];
  const toastSpy = _silenciarToast();
  let ok;
  try {
    ok = await BoHoy._manejarDescartar(ev, supa, {
      confirm: () => true,
      recargar: () => { recargas.push(1); return Promise.resolve(); }
    });
  } finally {
    toastSpy.restaurar();
  }
  assert.equal(ok, false);
  assert.equal(recargas.length, 0);
  assert.match(toastSpy.calls[0], /No se pudo descartar/);
  assert.equal(btn.disabled, false, "tras error el botón debe rehabilitarse");
});

test("_manejarDescartar: click fuera de un botón descartar no hace nada", async () => {
  const ev = {
    target: { closest: () => null },
    preventDefault: () => {},
    stopPropagation: () => {}
  };
  const supa = _fakeSupa();
  const ok = await BoHoy._manejarDescartar(ev, supa, {
    confirm: () => { throw new Error("no debe preguntar"); },
    recargar: () => Promise.resolve()
  });
  assert.equal(ok, false);
  assert.equal(supa._calls.length, 0);
});

test("_manejarDescartar: botón sin data-bo-valoracion-id no llama a Supabase", async () => {
  const btn = _fakeBtn({
    "data-bo-action": "descartar-valoracion",
    "data-bo-valoracion-nombre": "X"
    // sin id
  });
  const ev = { target: btn, preventDefault: () => {}, stopPropagation: () => {} };
  const supa = _fakeSupa();
  const ok = await BoHoy._manejarDescartar(ev, supa, {
    confirm: () => true,
    recargar: () => Promise.resolve()
  });
  assert.equal(ok, false);
  assert.equal(supa._calls.length, 0);
});
