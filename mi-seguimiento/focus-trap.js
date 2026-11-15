// Focus trap compartido de los modales de /mi-seguimiento/ (aria-modal="true").
// Navegador: `<script src="/mi-seguimiento/focus-trap.js">` expone `window.MsFocusTrap`.
// Node tests: `require('./focus-trap.js')` devuelve la misma API.
//
// Uso en las páginas: una sola llamada, `MsFocusTrap.autoTrapModals(selector)`.
// Cada modal sigue abriéndose y cerrándose a mano con `hidden`; el trap se
// activa al quitar `hidden` y se libera al ponerlo. Restaurar el foco previo al
// cerrar sigue siendo cosa de quien abre el modal.
(function () {
  'use strict';

  const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  // Pura. Dado el nº de enfocables y la posición del foco actual (-1 si el
  // foco no está en uno de ellos), decide a dónde llevar el foco al pulsar Tab:
  // `{ index }` (el -1 es el propio contenedor) o `null` si basta el navegador.
  function nextFocusStep(count, activeIndex, shiftKey) {
    if (count === 0) return { index: -1 };
    if (activeIndex === -1) return { index: shiftKey ? count - 1 : 0 };
    if (!shiftKey && activeIndex === count - 1) return { index: 0 };
    if (shiftKey && activeIndex === 0) return { index: count - 1 };
    return null;
  }

  function oculto(el, container, view) {
    if (view.getComputedStyle(el).visibility === 'hidden') return true;
    for (let n = el; n && n !== container.parentNode; n = n.parentElement) {
      if (n.hasAttribute('hidden') || view.getComputedStyle(n).display === 'none') return true;
    }
    return false;
  }

  // Enfocables visibles del contenedor, en orden de documento.
  function getFocusables(container) {
    const view = container.ownerDocument.defaultView;
    return Array.prototype.filter.call(
      container.querySelectorAll(FOCUSABLE),
      function (el) { return el.getAttribute('tabindex') !== '-1' && !oculto(el, container, view); }
    );
  }

  function focusContainer(modal) {
    if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
    modal.focus({ preventScroll: true });
  }

  // Trap activo por documento. El último en activarse manda (un modal abierto
  // encima de otro); un único listener de teclado por documento.
  const trapsPorDoc = new WeakMap();

  function onKeydown(e) {
    if (e.key !== 'Tab') return;
    const doc = e.currentTarget;
    const stack = trapsPorDoc.get(doc);
    // Un modal retirado del DOM sin pasar por `hidden` deja de mandar.
    while (stack && stack.length && !stack[stack.length - 1].isConnected) stack.pop();
    const modal = stack && stack[stack.length - 1];
    if (!modal) return;
    const focusables = getFocusables(modal);
    const step = nextFocusStep(focusables.length, focusables.indexOf(doc.activeElement), e.shiftKey);
    if (!step) return;
    e.preventDefault();
    if (step.index === -1) focusContainer(modal);
    else focusables[step.index].focus();
  }

  // Atrapa el foco dentro de `modal`. Devuelve la función que lo libera.
  function trapFocus(modal) {
    const doc = modal.ownerDocument;
    let stack = trapsPorDoc.get(doc);
    if (!stack) {
      stack = [];
      trapsPorDoc.set(doc, stack);
      doc.addEventListener('keydown', onKeydown);
    }
    stack.push(modal);
    return function release() {
      const i = stack.indexOf(modal);
      if (i === -1) return;
      stack.splice(i, 1);
      if (stack.length === 0) {
        doc.removeEventListener('keydown', onKeydown);
        trapsPorDoc.delete(doc);
      }
    };
  }

  // Engancha el trap a todos los elementos que casen con `selector`: se activa
  // cuando pierden `hidden` y se libera cuando lo recuperan. Si al abrir el
  // foco no está dentro, entra al primer enfocable. Devuelve una función que
  // desconecta todo.
  function autoTrapModals(selector, doc) {
    doc = doc || document;
    const win = doc.defaultView;
    const activos = new Map();

    function sync(modal) {
      if (!modal.hidden && !activos.has(modal)) {
        activos.set(modal, trapFocus(modal));
        if (!modal.contains(doc.activeElement)) {
          const f = getFocusables(modal)[0];
          if (f) f.focus({ preventScroll: true });
          else focusContainer(modal);
        }
      } else if (modal.hidden && activos.has(modal)) {
        activos.get(modal)();
        activos.delete(modal);
      }
    }

    const modales = Array.prototype.slice.call(doc.querySelectorAll(selector));
    const observer = new win.MutationObserver(function (records) {
      records.forEach(function (r) { sync(r.target); });
    });
    modales.forEach(function (m) {
      observer.observe(m, { attributes: true, attributeFilter: ['hidden'] });
      sync(m);
    });

    return function stop() {
      observer.disconnect();
      activos.forEach(function (release) { release(); });
      activos.clear();
    };
  }

  const api = { nextFocusStep, getFocusables, trapFocus, autoTrapModals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.MsFocusTrap = api;
})();
