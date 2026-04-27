// Tests de las funciones DOM de BoUi (ui.js):
//   - copiarAlPortapapeles: rama Clipboard API + fallback execCommand
//   - toast: reuso de nodo, aria, debounce
//   - copiarComando: orquesta copia + toast + feedback en botón
//
// Sin jsdom/happy-dom (convención del proyecto: cero dependencias nuevas).
// Stubs mínimos de navigator + document atados a globalThis. ui.js lee ambos
// vía `typeof X !== 'undefined'` en call-time, así que cambiar globalThis
// entre tests basta para forzar cada rama.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const BoUi = require('../src/backoffice/ui.js');

// -------------------------------------------------------------------
// Stubs mínimos
// -------------------------------------------------------------------

function _classListStub() {
  const set = new Set();
  return {
    _set: set,
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    contains(c) { return set.has(c); },
    toggle(c, on) { if (on) set.add(c); else set.delete(c); }
  };
}

function _nodeStub(tag) {
  const node = {
    tagName: (tag || 'DIV').toUpperCase(),
    children: [],
    parent: null,
    _attrs: {},
    _styles: {},
    textContent: '',
    value: '',
    classList: _classListStub(),
    appendChild(child) { child.parent = node; node.children.push(child); return child; },
    removeChild(child) {
      const idx = node.children.indexOf(child);
      if (idx >= 0) node.children.splice(idx, 1);
      child.parent = null;
      return child;
    },
    setAttribute(k, v) { node._attrs[k] = String(v); },
    getAttribute(k) { return k in node._attrs ? node._attrs[k] : null; },
    select() { node._selected = true; },
    get style() { return node._styles; }
  };
  return node;
}

function _docStub() {
  const body = _nodeStub('body');
  const _byId = new Map();
  return {
    body,
    _byId,
    createElement: (tag) => _nodeStub(tag),
    getElementById: (id) => _byId.get(id) || null,
    // Hook interno para que `toast` localice el nodo creado en el primer pase.
    _registerById(node) {
      if (node._attrs && node.id) _byId.set(node.id, node);
    },
    getSelection: () => ({ rangeCount: 0, removeAllRanges() {}, addRange() {}, getRangeAt() { return null; } }),
    execCommand(cmd) { return cmd === 'copy' ? this._execCopyResult !== false : false; },
    _execCopyResult: true
  };
}

// `toast` no llama _registerById (no existe en DOM real). Pero usa
// `document.getElementById('bo-toast')` para reutilizar. Lo emulamos
// interceptando appendChild en body para indexar por id.
function _patchBodyForGetElementById(doc) {
  const origAppend = doc.body.appendChild;
  doc.body.appendChild = function (child) {
    const r = origAppend.call(this, child);
    if (child._attrs && child._attrs.id) doc._byId.set(child._attrs.id, child);
    // El código de ui.js asigna el id vía setAttribute('id', ...) o vía .id
    return r;
  };
  // toast usa `el.id = 'bo-toast'` (asignación directa) tras createElement.
  // Indexamos cuando appendChild ve el nodo y este ya tiene .id.
  // Para cubrir la asignación previa al append, parcheamos cada nodo creado
  // para que actualice _byId al fijar .id.
  const origCreate = doc.createElement;
  doc.createElement = function (tag) {
    const n = origCreate.call(this, tag);
    let _id = '';
    Object.defineProperty(n, 'id', {
      get: () => _id,
      set: (v) => {
        _id = String(v);
        n._attrs.id = _id;
        if (n.parent) doc._byId.set(_id, n);
      }
    });
    return n;
  };
}

// En Node ≥21, `navigator` está expuesto como getter de globalThis sin setter.
// Asignación directa (`globalThis.navigator = …`) falla silenciosamente. Para
// poder estabilizar cada rama del módulo, eliminamos las globales en
// beforeEach y dejamos que cada test instale sus stubs con `delete` previo
// implícito. afterEach no necesita restaurar — Node las re-expone solo si el
// test no las dejó instaladas; las nuestras se borran al delete del siguiente
// beforeEach.

beforeEach(() => {
  delete globalThis.navigator;
  delete globalThis.document;
});

afterEach(() => {
  delete globalThis.navigator;
  delete globalThis.document;
});

// -------------------------------------------------------------------
// copiarAlPortapapeles
// -------------------------------------------------------------------

test('copiarAlPortapapeles: string vacío → false (no toca clipboard ni DOM)', async () => {
  let called = 0;
  globalThis.navigator = { clipboard: { writeText: () => { called++; return Promise.resolve(); } } };
  delete globalThis.document;
  for (const v of ['', null, undefined]) {
    assert.equal(await BoUi.copiarAlPortapapeles(v), false);
  }
  assert.equal(called, 0);
});

test('copiarAlPortapapeles: Clipboard API ok → true (sin tocar DOM fallback)', async () => {
  const writes = [];
  globalThis.navigator = { clipboard: { writeText: (s) => { writes.push(s); return Promise.resolve(); } } };
  // document presente pero no se usa: si el fallback se invocara,
  // crearía un textarea — verificamos que no lo hace.
  const doc = _docStub();
  globalThis.document = doc;
  const ok = await BoUi.copiarAlPortapapeles('hola');
  assert.equal(ok, true);
  assert.deepEqual(writes, ['hola']);
  assert.equal(doc.body.children.length, 0, 'el fallback no debió ejecutarse');
});

test('copiarAlPortapapeles: Clipboard API lanza → cae al fallback execCommand', async () => {
  globalThis.navigator = { clipboard: { writeText: () => Promise.reject(new Error('NotAllowed')) } };
  const doc = _docStub();
  doc._execCopyResult = true;
  globalThis.document = doc;
  const ok = await BoUi.copiarAlPortapapeles('texto-fallback');
  assert.equal(ok, true);
  // El fallback deja el textarea fuera tras copiar.
  assert.equal(doc.body.children.length, 0, 'textarea debe haber sido removido');
});

test('copiarAlPortapapeles: sin Clipboard API + execCommand=true → fallback ok', async () => {
  globalThis.navigator = {};
  const doc = _docStub();
  doc._execCopyResult = true;
  globalThis.document = doc;
  const ok = await BoUi.copiarAlPortapapeles('x');
  assert.equal(ok, true);
});

test('copiarAlPortapapeles: fallback con execCommand=false → false', async () => {
  delete globalThis.navigator;
  const doc = _docStub();
  doc._execCopyResult = false;
  globalThis.document = doc;
  assert.equal(await BoUi.copiarAlPortapapeles('x'), false);
});

test('copiarAlPortapapeles: fallback con execCommand lanzando → false (try/catch lo absorbe)', async () => {
  delete globalThis.navigator;
  const doc = _docStub();
  doc.execCommand = () => { throw new Error('legacy denied'); };
  globalThis.document = doc;
  assert.equal(await BoUi.copiarAlPortapapeles('x'), false);
  assert.equal(doc.body.children.length, 0, 'textarea debe haber sido removido tras catch');
});

test('copiarAlPortapapeles: sin Clipboard API y sin document → false', async () => {
  delete globalThis.navigator;
  delete globalThis.document;
  assert.equal(await BoUi.copiarAlPortapapeles('x'), false);
});

test('copiarAlPortapapeles: textarea queda off-screen y readonly mientras se copia', async () => {
  delete globalThis.navigator;
  const doc = _docStub();
  // Capturamos el textarea en el momento del execCommand para inspeccionarlo
  // antes del removeChild (después ya no estará en doc.body.children).
  let snapshot = null;
  const origExec = doc.execCommand.bind(doc);
  doc.execCommand = function (cmd) {
    const ta = doc.body.children[doc.body.children.length - 1];
    snapshot = {
      tag: ta.tagName,
      readonly: ta.getAttribute('readonly'),
      left: ta.style.left,
      position: ta.style.position,
      value: ta.value,
      selected: ta._selected === true
    };
    return origExec(cmd);
  };
  globalThis.document = doc;
  await BoUi.copiarAlPortapapeles('xyz');
  assert.equal(snapshot.tag, 'TEXTAREA');
  assert.equal(snapshot.readonly, '');
  assert.equal(snapshot.position, 'absolute');
  assert.equal(snapshot.left, '-9999px');
  assert.equal(snapshot.value, 'xyz');
  assert.equal(snapshot.selected, true);
});

test('copiarAlPortapapeles: restaura selección previa si existía', async () => {
  delete globalThis.navigator;
  const doc = _docStub();
  const range = { _id: 'r1' };
  let removed = 0;
  const added = [];
  doc.getSelection = () => ({
    rangeCount: 1,
    getRangeAt: () => range,
    removeAllRanges() { removed++; },
    addRange(r) { added.push(r); }
  });
  globalThis.document = doc;
  await BoUi.copiarAlPortapapeles('x');
  assert.equal(removed, 1);
  assert.deepEqual(added, [range]);
});

// -------------------------------------------------------------------
// toast
// -------------------------------------------------------------------

test('toast: sin document → no rompe (return silencioso)', () => {
  delete globalThis.document;
  // No debe lanzar.
  BoUi.toast('algo');
});

test('toast: primera llamada crea el nodo con id, role y aria-live', () => {
  const doc = _docStub();
  _patchBodyForGetElementById(doc);
  globalThis.document = doc;
  BoUi.toast('hola');
  const el = doc.getElementById('bo-toast');
  assert.ok(el, 'debe existir el nodo bo-toast');
  assert.equal(el.tagName, 'DIV');
  assert.equal(el.getAttribute('role'), 'status');
  assert.equal(el.getAttribute('aria-live'), 'polite');
  assert.equal(el.textContent, 'hola');
  assert.ok(el.classList.contains('is-visible'));
});

test('toast: segunda llamada reutiliza el mismo nodo y actualiza el mensaje', () => {
  const doc = _docStub();
  _patchBodyForGetElementById(doc);
  globalThis.document = doc;
  BoUi.toast('uno');
  const before = doc.body.children.length;
  BoUi.toast('dos');
  const after = doc.body.children.length;
  assert.equal(after, before, 'no debe apilar nodos');
  const el = doc.getElementById('bo-toast');
  assert.equal(el.textContent, 'dos');
});

// -------------------------------------------------------------------
// copiarComando
// -------------------------------------------------------------------

test('copiarComando: ok=true → toast con copy de éxito y feedback en el botón', async () => {
  globalThis.navigator = { clipboard: { writeText: () => Promise.resolve() } };
  const doc = _docStub();
  _patchBodyForGetElementById(doc);
  globalThis.document = doc;
  const boton = _nodeStub('button');
  boton.textContent = 'Crear menú';
  const ok = await BoUi.copiarComando('/crear-menu MARTA', boton);
  assert.equal(ok, true);
  // Toast con el copy esperado.
  const toast = doc.getElementById('bo-toast');
  assert.match(toast.textContent, /Copiado: \/crear-menu MARTA\. Pega en Claude Code/);
  // Feedback inmediato en el botón.
  assert.equal(boton.textContent, 'Copiado');
  assert.ok(boton.classList.contains('is-copiado'));
});

test('copiarComando: ok=false (clipboard y fallback fallan) → toast con copy manual', async () => {
  delete globalThis.navigator;
  const doc = _docStub();
  doc._execCopyResult = false;
  _patchBodyForGetElementById(doc);
  globalThis.document = doc;
  const ok = await BoUi.copiarComando('/x', null);
  assert.equal(ok, false);
  const toast = doc.getElementById('bo-toast');
  assert.match(toast.textContent, /No se pudo copiar\. Copia manualmente: \/x/);
});

test('copiarComando: sin botón → no rompe (boton es opcional)', async () => {
  globalThis.navigator = { clipboard: { writeText: () => Promise.resolve() } };
  const doc = _docStub();
  _patchBodyForGetElementById(doc);
  globalThis.document = doc;
  const ok = await BoUi.copiarComando('/y');
  assert.equal(ok, true);
});
