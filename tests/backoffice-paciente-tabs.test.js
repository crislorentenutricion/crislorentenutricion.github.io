// Tests del wiring de tabs en la ficha de paciente del backoffice.
//
// Sin jsdom (convención del proyecto: cero dependencias nuevas). Stubs
// mínimos al estilo backoffice-paciente-acciones.test.js: objetos planos
// que implementan exactamente lo que las funciones bajo test consumen
// (dataset, setAttribute, addEventListener, querySelectorAll filtrado).

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const BoUi    = require('../src/backoffice/ui.js');
const BoLogic = require('../src/backoffice/logic.js');
global.window = global.window || {};
global.window.BoUi    = BoUi;
global.window.BoLogic = BoLogic;
const BoPaciente = require('../src/backoffice/backoffice-paciente.js');

// -------------------------------------------------------------------
// Stubs DOM
// -------------------------------------------------------------------

function _tab(slug) {
  const attrs = {
    role: 'tab',
    'data-bo-tab': slug,
    'aria-selected': 'false',
    tabindex: '-1'
  };
  return {
    _attrs: attrs,
    dataset: { boTab: slug },
    _focused: false,
    _scrolled: null,
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; },
    focus() { this._focused = true; },
    scrollIntoView(opts) { this._scrolled = opts || true; }
  };
}

function _panel(slug) {
  return {
    _attrs: { role: 'tabpanel', 'data-bo-panel': slug },
    dataset: { boPanel: slug },
    hidden: true,
    setAttribute(k, v) { this._attrs[k] = String(v); }
  };
}

function _setupDoc(slugs) {
  const tabs = slugs.map(_tab);
  const panels = slugs.map(_panel);
  global.document = {
    querySelectorAll(sel) {
      if (sel === '[role="tab"]')      return tabs.slice();
      if (sel === '[role="tabpanel"]') return panels.slice();
      return [];
    }
  };
  return { tabs, panels };
}

function _setupHistorySpy() {
  const calls = [];
  global.history = {
    replaceState(state, title, url) { calls.push({ state, title, url }); }
  };
  global.location = { search: '?id=abc' };
  return calls;
}

beforeEach(() => {
  delete global.document;
  delete global.history;
  delete global.location;
});

// -------------------------------------------------------------------
// _activarTab
// -------------------------------------------------------------------

test('_activarTab: marca aria-selected="true" solo en el tab activo', () => {
  const { tabs } = _setupDoc(BoPaciente._TAB_SLUGS);
  _setupHistorySpy();
  BoPaciente._activarTab('pagos');
  for (const t of tabs) {
    const esperado = t.dataset.boTab === 'pagos' ? 'true' : 'false';
    assert.equal(t._attrs['aria-selected'], esperado);
  }
});

test('_activarTab: pone tabindex="0" solo en el tab activo', () => {
  const { tabs } = _setupDoc(BoPaciente._TAB_SLUGS);
  _setupHistorySpy();
  BoPaciente._activarTab('adherencia');
  for (const t of tabs) {
    const esperado = t.dataset.boTab === 'adherencia' ? '0' : '-1';
    assert.equal(t._attrs.tabindex, esperado);
  }
});

test('_activarTab: oculta paneles excepto el activo', () => {
  const { panels } = _setupDoc(BoPaciente._TAB_SLUGS);
  _setupHistorySpy();
  BoPaciente._activarTab('timeline');
  for (const p of panels) {
    const ocultoEsperado = p.dataset.boPanel !== 'timeline';
    assert.equal(p.hidden, ocultoEsperado);
  }
});

test('_activarTab: hace scrollIntoView del tab activo', () => {
  const { tabs } = _setupDoc(BoPaciente._TAB_SLUGS);
  _setupHistorySpy();
  BoPaciente._activarTab('evolucion');
  const activo = tabs.find(t => t.dataset.boTab === 'evolucion');
  assert.ok(activo._scrolled, 'el tab activo debe haber recibido scrollIntoView');
});

test('_activarTab: replaceState con la URL nueva conservando id', () => {
  _setupDoc(BoPaciente._TAB_SLUGS);
  const calls = _setupHistorySpy();
  BoPaciente._activarTab('pagos');
  assert.equal(calls.length, 1);
  // urlConTab devuelve "?id=abc&tab=pagos" (con '?' inicial). Por eso el
  // separador antes de un parámetro puede ser '?' o '&'. Usamos [?&] en
  // vez de (^|&) para que el regex reconozca el '?' inicial.
  assert.match(calls[0].url, /[?&]id=abc(&|$)/);
  assert.match(calls[0].url, /[?&]tab=pagos(&|$)/);
});

test('_activarTab: slug inválido es no-op (no toca DOM ni history)', () => {
  const { tabs, panels } = _setupDoc(BoPaciente._TAB_SLUGS);
  const calls = _setupHistorySpy();
  BoPaciente._activarTab('fantasma');
  assert.equal(calls.length, 0);
  for (const t of tabs) assert.equal(t._attrs['aria-selected'], 'false');
  for (const p of panels) assert.equal(p.hidden, true);
});

// -------------------------------------------------------------------
// _conectarTabs (idempotencia)
// -------------------------------------------------------------------

function _tablistStub(slugs) {
  const handlers = { click: [], keydown: [] };
  const tabs = slugs.map(_tab);
  return {
    _handlers: handlers,
    dataset: {},
    addEventListener(ev, fn) { (handlers[ev] || (handlers[ev] = [])).push(fn); },
    contains(node) { return tabs.indexOf(node) >= 0; },
    querySelector(sel) {
      if (sel === '[role="tab"][aria-selected="true"]') {
        return tabs.find(t => t._attrs['aria-selected'] === 'true') || null;
      }
      const m = /\[data-bo-tab="([^"]+)"\]/.exec(sel);
      if (m) return tabs.find(t => t.dataset.boTab === m[1]) || null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '[role="tab"]') return tabs.slice();
      return [];
    },
    _tabs: tabs
  };
}

test('_conectarTabs: idempotente — segunda llamada no duplica handlers', () => {
  const tablist = _tablistStub(BoPaciente._TAB_SLUGS);
  global.document = {
    getElementById(id) { return id === 'tabs' ? tablist : null; }
  };
  BoPaciente._conectarTabs(global.document);
  const click1 = tablist._handlers.click.length;
  const keys1  = tablist._handlers.keydown.length;
  BoPaciente._conectarTabs(global.document);
  assert.equal(tablist._handlers.click.length, click1, 'no debe añadir más handlers click');
  assert.equal(tablist._handlers.keydown.length, keys1, 'no debe añadir más handlers keydown');
  assert.equal(tablist.dataset.boTabsBound, '1');
});

test('_conectarTabs: tablist ausente es no-op', () => {
  global.document = { getElementById() { return null; } };
  // No debe lanzar.
  BoPaciente._conectarTabs(global.document);
});
