const test = require('node:test');
const assert = require('node:assert/strict');
const AprenderLogic = require('../src/mi-seguimiento/aprender-logic.js');

test('fechaDesbloqueo: fase 1 (index 0), lección 1 abre el día del alta', () => {
  const d = AprenderLogic.fechaDesbloqueo('2026-07-01', 0, 1);
  assert.equal(d.toISOString().slice(0, 10), '2026-07-01');
});

test('fechaDesbloqueo: fase 1, lección 3 abre a las 2 semanas del alta', () => {
  const d = AprenderLogic.fechaDesbloqueo('2026-07-01', 0, 3);
  assert.equal(d.toISOString().slice(0, 10), '2026-07-15');
});

test('fechaDesbloqueo: fase 2 (index 1) abre al mes del alta', () => {
  const d = AprenderLogic.fechaDesbloqueo('2026-07-01', 1, 1);
  assert.equal(d.toISOString().slice(0, 10), '2026-08-01');
});

test('fechaDesbloqueo: clamp de fin de mes (alta 31 ene → fase 2 el 28 feb)', () => {
  const d = AprenderLogic.fechaDesbloqueo('2026-01-31', 1, 1);
  assert.equal(d.toISOString().slice(0, 10), '2026-02-28');
});
