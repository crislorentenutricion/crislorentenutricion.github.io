// Focus trap compartido de los modales de /mi-seguimiento/ (focus-trap.js).
// Lógica pura (nextFocusStep) + comportamiento sobre un DOM real con jsdom:
// Tab / Shift+Tab ciclan dentro del modal, y cada apertura (quitar `hidden`)
// activa el trap y cada cierre (poner `hidden`) lo libera.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { nextFocusStep, getFocusables, trapFocus, autoTrapModals } =
  require('../src/mi-seguimiento/focus-trap.js');

const MS_DIR = path.join(__dirname, '..', 'src', 'mi-seguimiento');

function dom(html) {
  const d = new JSDOM('<!doctype html><body>' + html + '</body>');
  const { window } = d;
  const { document } = window;
  const tab = (shiftKey) => {
    const ev = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: !!shiftKey, bubbles: true, cancelable: true });
    (document.activeElement || document.body).dispatchEvent(ev);
    return ev;
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { window, document, tab, tick, $: (sel) => document.querySelector(sel) };
}

const MODAL = '<button id="fuera">fuera</button>'
  + '<div id="m" role="dialog" aria-modal="true"><button id="a">a</button><input id="b"><button id="c">c</button></div>';

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

// ------------------------------- getFocusables -----------------------------

test('getFocusables: omite disabled, hidden, tabindex=-1, type=hidden y display:none', () => {
  const { $ } = dom('<div id="m">'
    + '<button id="ok">ok</button>'
    + '<button id="dis" disabled>x</button>'
    + '<button id="hid" hidden>x</button>'
    + '<div hidden><button id="nested">x</button></div>'
    + '<button id="neg" tabindex="-1">x</button>'
    + '<input id="th" type="hidden">'
    + '<div style="display:none"><button id="none">x</button></div>'
    + '<button id="inv" style="visibility:hidden">x</button>'
    + '<a id="link" href="/x">x</a>'
    + '<textarea id="ta"></textarea>'
    + '</div>');
  assert.deepEqual(getFocusables($('#m')).map((e) => e.id), ['ok', 'link', 'ta']);
});

// -------------------------------- trapFocus --------------------------------

test('trapFocus: Tab desde el último enfocable vuelve al primero', () => {
  const { $, tab } = dom(MODAL);
  trapFocus($('#m'));
  $('#c').focus();
  const ev = tab(false);
  assert.equal(ev.defaultPrevented, true);
  assert.equal($('#a').ownerDocument.activeElement.id, 'a');
});

test('trapFocus: Shift+Tab desde el primero va al último', () => {
  const { $, document, tab } = dom(MODAL);
  trapFocus($('#m'));
  $('#a').focus();
  const ev = tab(true);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(document.activeElement.id, 'c');
});

test('trapFocus: en el medio no intercepta (lo hace el navegador)', () => {
  const { $, document, tab } = dom(MODAL);
  trapFocus($('#m'));
  $('#b').focus();
  assert.equal(tab(false).defaultPrevented, false);
  assert.equal(tab(true).defaultPrevented, false);
  assert.equal(document.activeElement.id, 'b');
});

test('trapFocus: foco fuera del modal entra al primero (Tab) o al último (Shift+Tab)', () => {
  const { $, document, tab } = dom(MODAL);
  trapFocus($('#m'));
  $('#fuera').focus();
  assert.equal(tab(false).defaultPrevented, true);
  assert.equal(document.activeElement.id, 'a');
  $('#fuera').focus();
  assert.equal(tab(true).defaultPrevented, true);
  assert.equal(document.activeElement.id, 'c');
});

test('trapFocus: modal sin enfocables deja el foco en el propio modal', () => {
  const { $, document, tab } = dom('<button id="fuera">f</button><div id="m" role="dialog"><p>solo texto</p></div>');
  trapFocus($('#m'));
  $('#fuera').focus();
  const ev = tab(false);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(document.activeElement, $('#m'));
  assert.equal(tab(true).defaultPrevented, true);
  assert.equal(document.activeElement, $('#m'));
});

test('trapFocus: ignora otras teclas', () => {
  const { $, window, document } = dom(MODAL);
  trapFocus($('#m'));
  $('#c').focus();
  const ev = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  document.activeElement.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false);
  assert.equal(document.activeElement.id, 'c');
});

test('trapFocus: la función de liberación devuelve el Tab al navegador', () => {
  const { $, tab } = dom(MODAL);
  const release = trapFocus($('#m'));
  $('#c').focus();
  assert.equal(tab(false).defaultPrevented, true);
  $('#c').focus();
  release();
  assert.equal(tab(false).defaultPrevented, false);
});

test('trapFocus: liberar dos veces no rompe', () => {
  const { $ } = dom(MODAL);
  const release = trapFocus($('#m'));
  release();
  assert.doesNotThrow(release);
});

test('trapFocus: con dos modales abiertos solo manda el último', () => {
  const { $, document, tab } = dom('<div id="m1"><button id="a1">1</button><button id="b1">1</button></div>'
    + '<div id="m2"><button id="a2">2</button><button id="b2">2</button></div>');
  const rel1 = trapFocus($('#m1'));
  const rel2 = trapFocus($('#m2'));
  $('#b2').focus();
  assert.equal(tab(false).defaultPrevented, true);
  assert.equal(document.activeElement.id, 'a2');
  rel2();
  $('#b1').focus();
  assert.equal(tab(false).defaultPrevented, true);
  assert.equal(document.activeElement.id, 'a1');
  rel1();
});

test('trapFocus: un modal sacado del DOM sin liberar no intercepta Tab', () => {
  const { $, tab } = dom(MODAL);
  const modal = $('#m');
  trapFocus(modal);
  $('#c').focus();
  modal.remove();
  $('#fuera').focus();
  assert.equal(tab(false).defaultPrevented, false);
});

test('trapFocus: con el modal superior fuera del DOM manda el siguiente de la pila', () => {
  const { $, document, tab } = dom('<div id="m1"><button id="a1">1</button><button id="b1">1</button></div>'
    + '<div id="m2"><button id="a2">2</button><button id="b2">2</button></div>');
  trapFocus($('#m1'));
  trapFocus($('#m2'));
  $('#m2').remove();
  $('#b1').focus();
  assert.equal(tab(false).defaultPrevented, true);
  assert.equal(document.activeElement.id, 'a1');
});

// ------------------------------ autoTrapModals ------------------------------

const AUTO = '<button id="fuera">fuera</button>'
  + '<div id="m" role="dialog" aria-modal="true" hidden><button id="a">a</button><button id="c">c</button></div>';

test('autoTrapModals: abrir (quitar hidden) activa el trap y cerrar (poner hidden) lo libera', async () => {
  const { $, document, tab, tick } = dom(AUTO);
  autoTrapModals('[role="dialog"][aria-modal="true"]', document);

  // cerrado: no intercepta
  $('#fuera').focus();
  assert.equal(tab(false).defaultPrevented, false);

  $('#m').hidden = false;
  await tick();
  assert.equal(document.activeElement.id, 'a', 'al abrir, el foco entra al modal');
  $('#c').focus();
  assert.equal(tab(false).defaultPrevented, true);
  assert.equal(document.activeElement.id, 'a');

  $('#m').hidden = true;
  await tick();
  $('#fuera').focus();
  $('#c').focus();
  assert.equal(tab(false).defaultPrevented, false, 'cerrado: Tab vuelve al navegador');
});

test('autoTrapModals: al abrir no roba el foco si el opener ya lo puso dentro', async () => {
  const { $, document, tick } = dom(AUTO);
  autoTrapModals('[role="dialog"][aria-modal="true"]', document);
  $('#m').hidden = false;
  $('#c').focus(); // p. ej. showMilestone hace ok.focus() justo tras abrir
  await tick();
  assert.equal(document.activeElement.id, 'c');
});

test('autoTrapModals: un modal ya visible al iniciar queda atrapado', () => {
  const { $, document, tab } = dom(AUTO.replace(' hidden>', '>'));
  autoTrapModals('[role="dialog"][aria-modal="true"]', document);
  $('#c').focus();
  assert.equal(tab(false).defaultPrevented, true);
});

test('autoTrapModals: reabrir tras cerrar vuelve a atrapar', async () => {
  const { $, document, tab, tick } = dom(AUTO);
  autoTrapModals('[role="dialog"][aria-modal="true"]', document);
  for (let i = 0; i < 2; i++) {
    $('#m').hidden = false;
    await tick();
    $('#c').focus();
    assert.equal(tab(false).defaultPrevented, true, 'vuelta ' + i);
    $('#m').hidden = true;
    await tick();
  }
});

test('autoTrapModals: el selector puede ser el backdrop que lleva hidden (.onb-modal-backdrop)', async () => {
  const { $, document, tab, tick } = dom('<div class="onb-modal-backdrop" id="bd" hidden>'
    + '<div class="onb-modal" role="dialog" aria-modal="true"><button id="x" data-close-modal>x</button><button id="y">y</button></div></div>');
  autoTrapModals('.onb-modal-backdrop', document);
  $('#bd').hidden = false;
  await tick();
  assert.equal(document.activeElement.id, 'x');
  $('#y').focus();
  assert.equal(tab(false).defaultPrevented, true);
  assert.equal(document.activeElement.id, 'x');
  $('#x').focus();
  assert.equal(tab(true).defaultPrevented, true);
  assert.equal(document.activeElement.id, 'y');
});

test('autoTrapModals: devuelve una función que desconecta todo', async () => {
  const { $, document, tab, tick } = dom(AUTO);
  const stop = autoTrapModals('[role="dialog"][aria-modal="true"]', document);
  $('#m').hidden = false;
  await tick();
  stop();
  $('#c').focus();
  assert.equal(tab(false).defaultPrevented, false);
});

// ------------- DOM real de los modales de /mi-seguimiento/ (index.njk) -------------

const indexNjk = fs.readFileSync(path.join(MS_DIR, 'index.njk'), 'utf8')
  .replace(/\{#[\s\S]*?#\}/g, '');

const MODALES_MS = [
  'ms-onboarding', 'ms-milestone', 'ms-install', 'ms-inapp', 'ms-compra-reset-modal',
  'ms-opcion-modal', 'ms-menu-nuevo-modal', 'ms-revision-modal', 'ms-apr-player', 'ms-apr-pdf-modal',
];

test('index.njk: los 10 modales casan con el selector que usa app.js', () => {
  const { document } = dom(indexNjk);
  const ids = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].map((e) => e.id);
  assert.deepEqual(ids.sort(), [...MODALES_MS].sort());
});

for (const id of MODALES_MS) {
  test('index.njk #' + id + ': Tab y Shift+Tab ciclan dentro del modal abierto', async () => {
    const { $, document, tab, tick } = dom(indexNjk);
    autoTrapModals('[role="dialog"][aria-modal="true"]', document);
    const modal = $('#' + id);
    modal.hidden = false;
    await tick();
    const foc = getFocusables(modal);
    assert.ok(foc.length >= 1, id + ' debe tener al menos un enfocable');
    assert.ok(modal.contains(document.activeElement), 'el foco entra al modal al abrir');

    foc[foc.length - 1].focus();
    assert.equal(tab(false).defaultPrevented, true);
    assert.equal(document.activeElement, foc[0], 'Tab desde el último vuelve al primero');

    foc[0].focus();
    tab(true);
    assert.equal(document.activeElement, foc[foc.length - 1], 'Shift+Tab desde el primero va al último');
  });
}
