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
