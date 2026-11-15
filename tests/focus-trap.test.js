// Focus trap compartido de los modales de /mi-seguimiento/ (focus-trap.js).
// Sin jsdom (convención del proyecto: cero dependencias de test). Lógica pura
// (nextFocusStep) y trapFocus sobre una fachada mínima de documento y modal:
// Tab y Shift+Tab ciclan entre el primer y el último enfocable.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextFocusStep, trapFocus } = require('../src/mi-seguimiento/focus-trap.js');

// Fachada mínima: lo justo que consumen trapFocus y getFocusables.
function fachada(ids) {
  const listeners = [];
  const parent = {};
  const doc = {
    activeElement: null,
    defaultView: { getComputedStyle: () => ({ visibility: 'visible', display: 'block' }) },
    addEventListener(tipo, fn) { if (tipo === 'keydown') listeners.push(fn); },
    removeEventListener(tipo, fn) {
      const i = listeners.indexOf(fn);
      if (tipo === 'keydown' && i !== -1) listeners.splice(i, 1);
    },
  };
  const modal = {
    ownerDocument: doc, isConnected: true, parentNode: parent, parentElement: parent,
    hasAttribute: () => false, getAttribute: () => null,
  };
  const els = ids.map((id) => ({
    id, parentElement: modal,
    hasAttribute: () => false,
    getAttribute: () => null,
    focus() { doc.activeElement = this; },
  }));
  modal.querySelectorAll = () => els;
  const tab = (shiftKey) => {
    const ev = {
      key: 'Tab', shiftKey: !!shiftKey, currentTarget: doc, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    listeners.slice().forEach((fn) => fn(ev));
    return ev;
  };
  return { doc, modal, els, tab, listeners };
}

// ------------------------------ nextFocusStep ------------------------------

test('nextFocusStep: sin enfocables → se queda en el contenedor (index -1)', () => {
  assert.deepEqual(nextFocusStep(0, -1, false), { index: -1 });
  assert.deepEqual(nextFocusStep(0, -1, true), { index: -1 });
});

test('nextFocusStep: Tab desde el último vuelve al primero', () => {
  assert.deepEqual(nextFocusStep(3, 2, false), { index: 0 });
});

test('nextFocusStep: Shift+Tab desde el primero va al último', () => {
  assert.deepEqual(nextFocusStep(3, 0, true), { index: 2 });
});

test('nextFocusStep: en el medio deja actuar al navegador (null)', () => {
  assert.equal(nextFocusStep(3, 1, false), null);
  assert.equal(nextFocusStep(3, 1, true), null);
  assert.equal(nextFocusStep(3, 0, false), null);
  assert.equal(nextFocusStep(3, 2, true), null);
});

test('nextFocusStep: foco fuera del modal (-1) entra por el primero o el último', () => {
  assert.deepEqual(nextFocusStep(3, -1, false), { index: 0 });
  assert.deepEqual(nextFocusStep(3, -1, true), { index: 2 });
});

test('nextFocusStep: un solo enfocable se queda en él', () => {
  assert.deepEqual(nextFocusStep(1, 0, false), { index: 0 });
  assert.deepEqual(nextFocusStep(1, 0, true), { index: 0 });
});

// -------------------------------- trapFocus --------------------------------

test('trapFocus: Tab desde el último enfocable vuelve al primero', () => {
  const { modal, els, doc, tab } = fachada(['a', 'b', 'c']);
  trapFocus(modal);
  els[2].focus();
  assert.equal(tab(false).defaultPrevented, true);
  assert.equal(doc.activeElement.id, 'a');
});

test('trapFocus: Shift+Tab desde el primero va al último', () => {
  const { modal, els, doc, tab } = fachada(['a', 'b', 'c']);
  trapFocus(modal);
  els[0].focus();
  assert.equal(tab(true).defaultPrevented, true);
  assert.equal(doc.activeElement.id, 'c');
});

test('trapFocus: en el medio no intercepta (lo hace el navegador)', () => {
  const { modal, els, doc, tab } = fachada(['a', 'b', 'c']);
  trapFocus(modal);
  els[1].focus();
  assert.equal(tab(false).defaultPrevented, false);
  assert.equal(tab(true).defaultPrevented, false);
  assert.equal(doc.activeElement.id, 'b');
});

test('trapFocus: la función de liberación devuelve el Tab al navegador', () => {
  const { modal, els, tab, listeners } = fachada(['a', 'b']);
  const release = trapFocus(modal);
  els[1].focus();
  assert.equal(tab(false).defaultPrevented, true);
  els[1].focus();
  release();
  assert.equal(tab(false).defaultPrevented, false);
  assert.equal(listeners.length, 0);
  assert.doesNotThrow(release);
});
