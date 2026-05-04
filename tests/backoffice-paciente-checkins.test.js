const { test } = require('node:test');
const assert = require('node:assert/strict');

const BoPaciente = require('../src/backoffice/backoffice-paciente.js');

// ===================================================================
// _resolverFechaAlta — cascada
// ===================================================================

const HOY = new Date(2026, 4, 4); // 4 de mayo de 2026

test('_resolverFechaAlta: usa paciente.alta cuando existe', () => {
  const r = BoPaciente._resolverFechaAlta(
    { alta: '2026-01-10', anamnesis_completed_at: '2026-01-15T10:00:00Z', created_at: '2026-01-05T08:00:00Z' },
    HOY
  );
  assert.equal(r, '2026-01-10');
});

test('_resolverFechaAlta: cae a anamnesis_completed_at (truncando timestamp ISO)', () => {
  const r = BoPaciente._resolverFechaAlta(
    { alta: null, anamnesis_completed_at: '2026-01-15T10:00:00Z', created_at: '2026-01-05T08:00:00Z' },
    HOY
  );
  assert.equal(r, '2026-01-15');
});

test('_resolverFechaAlta: cae a created_at (truncando timestamp ISO)', () => {
  const r = BoPaciente._resolverFechaAlta(
    { alta: null, anamnesis_completed_at: null, created_at: '2026-01-05T08:00:00Z' },
    HOY
  );
  assert.equal(r, '2026-01-05');
});

test('_resolverFechaAlta: red de seguridad — todos null → hoy menos 30 días', () => {
  const r = BoPaciente._resolverFechaAlta(
    { alta: null, anamnesis_completed_at: null, created_at: null },
    HOY
  );
  assert.equal(r, '2026-04-04');
});

test('_resolverFechaAlta: paciente null → red de seguridad', () => {
  const r = BoPaciente._resolverFechaAlta(null, HOY);
  assert.equal(r, '2026-04-04');
});
