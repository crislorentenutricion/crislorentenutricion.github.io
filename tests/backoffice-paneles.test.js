const test = require('node:test');
const assert = require('node:assert/strict');
const BoPaneles = require('../src/backoffice/paneles.js');

test('renderPanelAccion agendar: datetime-local + duración 30 + notas', () => {
  const html = BoPaneles.renderPanelAccion('agendar', {});
  assert.match(html, /data-bo-form="agendar"/);
  assert.match(html, /type="datetime-local"/);
  assert.match(html, /name="duracion"[^>]*value="30"/);
});

test('renderPanelAccion reagendar: selector con sesiones futuras', () => {
  const html = BoPaneles.renderPanelAccion('reagendar', {
    sesionesFuturas: [
      { calendar_event_id: 'ev1', fecha: '2026-07-01T15:00:00Z' },
      { calendar_event_id: 'ev2', fecha: '2026-07-15T15:00:00Z' }
    ]
  });
  assert.match(html, /value="ev1"/);
  assert.match(html, /value="ev2"/);
  assert.match(html, /Calendar avisa/);
});

test('renderPanelAccion cerrar: 4 motivos + checkbox + textarea condicional + nº sesiones', () => {
  const html = BoPaneles.renderPanelAccion('cerrar', { sesionesFuturas: [{}, {}] });
  assert.match(html, /objetivo_cumplido/);
  assert.match(html, /fin_de_prueba/);
  assert.match(html, /name="confirmar"/);
  assert.match(html, /name="nota_personal"/);
  assert.match(html, /2 sesiones futuras/);
});

test('renderPanelAccion alta: prefill de nombre y email', () => {
  const html = BoPaneles.renderPanelAccion('alta', { prefill: { nombre: 'MARTA RUIZ', email: 'a@b.c' } });
  assert.match(html, /value="MARTA RUIZ"/);
  assert.match(html, /value="a@b\.c"/);
});

test('renderPanelAccion enviar-menu: selector con menús con PDF, el más reciente preseleccionado', () => {
  const html = BoPaneles.renderPanelAccion('enviar-menu', {
    menus: [
      { id: 'm1', numero: 1, pdf_url: 'p/x1.pdf' },
      { id: 'm2', numero: 2, pdf_url: 'p/x2.pdf' },
      { id: 'm3', numero: 3, pdf_url: null }
    ]
  });
  assert.match(html, /value="m2"[^>]*selected/);
  assert.doesNotMatch(html, /value="m3"/);
});

test('renderPanelAccion repescar con intento reciente: aviso + checkbox force', () => {
  const hace2d = new Date(Date.now() - 2 * 864e5).toISOString();
  const html = BoPaneles.renderPanelAccion('repescar', { ultimoIntentoRepesca: hace2d });
  assert.match(html, /hace 2 días/);
  assert.match(html, /name="force"/);
});

test('renderPanelAccion registrar-pago: importe 40, concepto auto, método select', () => {
  const html = BoPaneles.renderPanelAccion('registrar-pago', { pagosPrevios: 0 });
  assert.match(html, /value="40"/);
  assert.match(html, /alta \(detectado\)/);
  assert.match(html, /name="metodo"/);
});

test('renderPanelAccion reactivar: checkbox crear_borrador checked por defecto', () => {
  const html = BoPaneles.renderPanelAccion('reactivar', {});
  assert.match(html, /name="crear_borrador"/);
  assert.match(html, /checked/);
});

test('renderPanelAccion repescar SIN intento reciente: no aviso, no checkbox force', () => {
  const html = BoPaneles.renderPanelAccion('repescar', {});
  assert.doesNotMatch(html, /hace \d+ días/);
  assert.doesNotMatch(html, /name="force"/);
});

test('renderPanelAccion registrar-pago con pagosPrevios:3 → renovacion (detectado)', () => {
  const html = BoPaneles.renderPanelAccion('registrar-pago', { pagosPrevios: 3 });
  assert.match(html, /renovacion \(detectado\)/);
});

test('todos los paneles incluyen botón submit y botón Cancelar con data-bo-action="cerrar-panel"', () => {
  const acciones = ['agendar', 'reagendar', 'cerrar', 'alta', 'reactivar', 'repescar', 'registrar-pago', 'enviar-menu'];
  for (const accion of acciones) {
    const ctx = accion === 'reagendar'
      ? { sesionesFuturas: [{ calendar_event_id: 'ev1', fecha: '2026-07-01T15:00:00Z' }] }
      : accion === 'enviar-menu'
      ? { menus: [{ id: 'm1', numero: 1, pdf_url: 'x.pdf' }] }
      : {};
    const html = BoPaneles.renderPanelAccion(accion, ctx);
    assert.match(html, /type="submit"/, `${accion}: falta botón submit`);
    assert.match(html, /data-bo-action="cerrar-panel"/, `${accion}: falta botón Cancelar`);
  }
});

test('renderPanelAccion alta: XSS spot-check — nombre <x> se escapa', () => {
  const html = BoPaneles.renderPanelAccion('alta', { prefill: { nombre: '<x>', email: 'a@b.c' } });
  assert.doesNotMatch(html, /<x>/);
  assert.match(html, /&lt;x&gt;/);
});

// -----------------------------------------------------------------
// conectarPanel — submit handler
// -----------------------------------------------------------------
//
// BoLogic es real (construirPayload / comandoRescate / resumenResultadoAccion
// se testean aquí con datos reales). BoUi se stubea porque sus funciones
// de DOM (toastResultado, ejecutarEdgeFunction) necesitan document/fetch.
//
// Estrategia Node globals:
//   - BoLogic y BoUi están capturados a nivel módulo en paneles.js vía
//     require('./logic.js') y require('./ui.js'). Node cachea los módulos,
//     así que mutar propiedades del objeto devuelto por require() aquí
//     es visible dentro del módulo ya cargado.
//   - global.FormData se monkey-patchea temporalmente con una clase fake
//     cuyo forEach(cb) itera sobre pares fijados por _fdEntries.
// -----------------------------------------------------------------

{
  // Cargamos BoUi desde caché — es el mismo objeto que paneles.js capturó.
  const BoUi = require('../src/backoffice/ui.js');

  // Clase FormData fake; las entradas se inyectan por test via _fdEntries.
  let _fdEntries = [];
  class FakeFormData {
    constructor() {}
    forEach(cb) { _fdEntries.forEach(function (e) { cb(e[1], e[0]); }); }
  }

  // Helpers para construir fakes de form/cont.
  function _makeForm(submitBtnStub) {
    let _handler = null;
    return {
      querySelector: function (sel) {
        if (sel === '[type="submit"]') return submitBtnStub || null;
        if (sel === '[data-bo-motivo]') return null;
        if (sel === '[data-bo-nota-personal]') return null;
        return null;
      },
      addEventListener: function (ev, fn) { if (ev === 'submit') _handler = fn; },
      _getHandler: function () { return _handler; }
    };
  }

  function _makeCont(form) {
    const spy = { removeAttributeCalls: [] };
    return {
      querySelector: function (sel) { return sel === '[data-bo-form]' ? form : null; },
      get innerHTML() { return ''; },
      set innerHTML(v) { spy.lastInnerHTML = v; },
      removeAttribute: function (attr) { spy.removeAttributeCalls.push(attr); },
      _spy: spy
    };
  }

  function _makeDeps(overrides) {
    return Object.assign({
      supa: {},
      ctxAccion: function () { return { pacienteId: 'p1', nombre: 'MARTA', email: 'a@b.c' }; },
      recargar: function () {}
    }, overrides || {});
  }

  test('conectarPanel agendar sin fecha: toastResultado tipo error, ejecutarEdgeFunction no llamado', async () => {
    const origFormData = global.FormData;
    global.FormData = FakeFormData;

    const toastLlamadas = [];
    const origToast = BoUi.toastResultado;
    BoUi.toastResultado = function (m) { toastLlamadas.push(m); };

    const efLlamadas = [];
    const origEF = BoUi.ejecutarEdgeFunction;
    BoUi.ejecutarEdgeFunction = async function () { efLlamadas.push(arguments); return { ok: true, data: {} }; };

    try {
      _fdEntries = [['fecha', '']]; // fecha vacía → inválida para 'agendar'
      const submitBtn = { disabled: false, textContent: 'Agendar' };
      const form = _makeForm(submitBtn);
      const cont = _makeCont(form);
      BoPaneles.conectarPanel(cont, 'agendar', _makeDeps());
      const handler = form._getHandler();
      await handler({ preventDefault: function () {} });

      assert.equal(toastLlamadas.length, 1, 'toastResultado debe llamarse una vez');
      assert.equal(toastLlamadas[0].tipo, 'error', 'tipo debe ser error');
      assert.equal(efLlamadas.length, 0, 'ejecutarEdgeFunction no debe llamarse');
    } finally {
      global.FormData = origFormData;
      BoUi.toastResultado = origToast;
      BoUi.ejecutarEdgeFunction = origEF;
    }
  });

  test('conectarPanel agendar happy path: toastResultado ok, cont vaciado, recargar llamado', async () => {
    const origFormData = global.FormData;
    global.FormData = FakeFormData;

    const toastLlamadas = [];
    const origToast = BoUi.toastResultado;
    BoUi.toastResultado = function (m) { toastLlamadas.push(m); };

    const origEF = BoUi.ejecutarEdgeFunction;
    BoUi.ejecutarEdgeFunction = async function () { return { ok: true, data: {} }; };

    let recargarLlamado = false;

    try {
      _fdEntries = [['fecha', '2026-08-01T10:00'], ['duracion', '30']];
      const submitBtn = { disabled: false, textContent: 'Agendar' };
      const form = _makeForm(submitBtn);
      const cont = _makeCont(form);
      const deps = _makeDeps({ recargar: function () { recargarLlamado = true; } });
      BoPaneles.conectarPanel(cont, 'agendar', deps);
      const handler = form._getHandler();
      await handler({ preventDefault: function () {} });

      assert.equal(toastLlamadas.length, 1, 'toastResultado debe llamarse');
      assert.equal(toastLlamadas[0].tipo, 'ok', 'tipo debe ser ok');
      assert.equal(cont._spy.lastInnerHTML, '', 'cont.innerHTML debe vaciarse');
      assert.deepEqual(cont._spy.removeAttributeCalls, ['data-bo-abierto'], 'removeAttribute data-bo-abierto');
      assert.equal(recargarLlamado, true, 'recargar debe llamarse');
      assert.equal(submitBtn.disabled, false, 'submit btn debe re-habilitarse');
    } finally {
      global.FormData = origFormData;
      BoUi.toastResultado = origToast;
      BoUi.ejecutarEdgeFunction = origEF;
    }
  });

  test('conectarPanel agendar EF error: toastResultado tipo error con comando rescate, recargar no llamado', async () => {
    const origFormData = global.FormData;
    global.FormData = FakeFormData;

    const toastLlamadas = [];
    const origToast = BoUi.toastResultado;
    BoUi.toastResultado = function (m) { toastLlamadas.push(m); };

    const origEF = BoUi.ejecutarEdgeFunction;
    BoUi.ejecutarEdgeFunction = async function () { return { ok: false, error: { message: 'boom' } }; };

    let recargarLlamado = false;

    try {
      _fdEntries = [['fecha', '2026-08-01T10:00'], ['duracion', '30']];
      const submitBtn = { disabled: false, textContent: 'Agendar' };
      const form = _makeForm(submitBtn);
      const cont = _makeCont(form);
      const deps = _makeDeps({ recargar: function () { recargarLlamado = true; } });
      BoPaneles.conectarPanel(cont, 'agendar', deps);
      const handler = form._getHandler();
      await handler({ preventDefault: function () {} });

      assert.equal(toastLlamadas.length, 1, 'toastResultado debe llamarse');
      assert.equal(toastLlamadas[0].tipo, 'error', 'tipo debe ser error');
      assert.ok(Array.isArray(toastLlamadas[0].extras) && toastLlamadas[0].extras.length > 0, 'debe tener extras');
      assert.equal(toastLlamadas[0].extras[0].texto, '/agendar MARTA', 'extras[0].texto es el comando rescate');
      assert.equal(recargarLlamado, false, 'recargar no debe llamarse en error');
    } finally {
      global.FormData = origFormData;
      BoUi.toastResultado = origToast;
      BoUi.ejecutarEdgeFunction = origEF;
    }
  });
}
