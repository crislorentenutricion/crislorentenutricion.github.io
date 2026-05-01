const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const lm = require(path.join(__dirname, '..', 'src', 'js', 'lead-magnet-logic.js'));

/* ============================================================
 * Validación de email
 * ============================================================ */

test('normalizeEmail: trim + lowercase', () => {
  assert.equal(lm.normalizeEmail('  Ana@Example.COM  '), 'ana@example.com');
  assert.equal(lm.normalizeEmail('USUARIO@DOMINIO.ES'), 'usuario@dominio.es');
});

test('normalizeEmail: tolera tipos no string', () => {
  assert.equal(lm.normalizeEmail(null), '');
  assert.equal(lm.normalizeEmail(undefined), '');
  assert.equal(lm.normalizeEmail(123), '');
});

test('isValidEmail: emails típicos válidos', () => {
  assert.equal(lm.isValidEmail('ana@example.com'), true);
  assert.equal(lm.isValidEmail('usuario.con.puntos@dominio.es'), true);
  assert.equal(lm.isValidEmail('a@b.co'), true);
  assert.equal(lm.isValidEmail('  Ana@Example.com  '), true);
});

test('isValidEmail: emails inválidos', () => {
  assert.equal(lm.isValidEmail(''), false);
  assert.equal(lm.isValidEmail('sin-arroba.com'), false);
  assert.equal(lm.isValidEmail('sin@dominio'), false);
  assert.equal(lm.isValidEmail('@dominio.com'), false);
  assert.equal(lm.isValidEmail('con espacios@dominio.com'), false);
  assert.equal(lm.isValidEmail(null), false);
});

test('isValidEmail: rechaza emails > 254 caracteres', () => {
  const long = 'a'.repeat(250) + '@x.es';
  assert.equal(lm.isValidEmail(long), false);
});

/* ============================================================
 * Validación del formulario completo
 * ============================================================ */

test('validateLeadForm: caso feliz con nombre + email + consent', () => {
  const res = lm.validateLeadForm({
    nombre: 'Ana',
    email: 'ana@example.com',
    consent: true
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, {});
});

test('validateLeadForm: consent="on" (FormData de checkbox) cuenta como true', () => {
  const res = lm.validateLeadForm({
    nombre: 'Ana',
    email: 'ana@example.com',
    consent: 'on'
  });
  assert.equal(res.ok, true);
});

test('validateLeadForm: falta nombre', () => {
  const res = lm.validateLeadForm({
    nombre: '   ',
    email: 'ana@example.com',
    consent: true
  });
  assert.equal(res.ok, false);
  assert.equal(res.errors.nombre, 'nombre_required');
});

test('validateLeadForm: falta email', () => {
  const res = lm.validateLeadForm({ nombre: 'Ana', email: '', consent: true });
  assert.equal(res.ok, false);
  assert.equal(res.errors.email, 'email_required');
});

test('validateLeadForm: email inválido', () => {
  const res = lm.validateLeadForm({
    nombre: 'Ana',
    email: 'no-es-email',
    consent: true
  });
  assert.equal(res.ok, false);
  assert.equal(res.errors.email, 'email_invalid');
});

test('validateLeadForm: consent obligatorio (no preseleccionado)', () => {
  const res = lm.validateLeadForm({
    nombre: 'Ana',
    email: 'ana@example.com',
    consent: false
  });
  assert.equal(res.ok, false);
  assert.equal(res.errors.consent, 'consent_required');
});

test('validateLeadForm: input vacío → 3 errores', () => {
  const res = lm.validateLeadForm({});
  assert.equal(res.ok, false);
  assert.equal(res.errors.nombre, 'nombre_required');
  assert.equal(res.errors.email, 'email_required');
  assert.equal(res.errors.consent, 'consent_required');
});

test('validateLeadForm: input null no rompe', () => {
  const res = lm.validateLeadForm(null);
  assert.equal(res.ok, false);
  assert.equal(Object.keys(res.errors).length, 3);
});

/* ============================================================
 * Construcción del payload POST
 * ============================================================ */

const makeFormDataLike = () => {
  const map = new Map();
  map.set('nombre', '  Ana  ');
  map.set('email', '  Ana@Example.COM  ');
  map.set('consent', 'on');
  return { get: (k) => map.get(k) || '' };
};

test('buildLeadPayload: arma el JSON con los campos esperados', () => {
  const payload = lm.buildLeadPayload(makeFormDataLike(), 'token-xyz');
  assert.deepEqual(payload, {
    nombre: 'Ana',
    email: 'ana@example.com',
    consent: true,
    hcaptcha_token: 'token-xyz'
  });
});

test('buildLeadPayload: acepta plain object además de FormData', () => {
  const payload = lm.buildLeadPayload(
    { nombre: 'Ana', email: 'ana@b.es', consent: true },
    ''
  );
  assert.equal(payload.nombre, 'Ana');
  assert.equal(payload.email, 'ana@b.es');
  assert.equal(payload.consent, true);
  assert.equal(payload.hcaptcha_token, '');
});

test('buildLeadPayload: consent=false si el checkbox no viene', () => {
  const p = lm.buildLeadPayload({ nombre: 'Ana', email: 'a@b.c' }, '');
  assert.equal(p.consent, false);
});

test('buildLeadPayload: hcaptcha_token vacío por defecto', () => {
  const p = lm.buildLeadPayload({}, null);
  assert.equal(p.hcaptcha_token, '');
});

test('buildLeadPayload: normaliza email también si llega como plain object', () => {
  const p = lm.buildLeadPayload(
    { nombre: '  Ana ', email: 'Ana@Example.COM', consent: true },
    'tk'
  );
  assert.equal(p.email, 'ana@example.com');
  assert.equal(p.nombre, 'Ana');
});

test('buildLeadPayload: nombre con dobles espacios se colapsa', () => {
  const p = lm.buildLeadPayload(
    { nombre: 'Ana   María', email: 'a@b.c', consent: true },
    ''
  );
  assert.equal(p.nombre, 'Ana María');
});

/* ============================================================
 * Mapeo de respuesta del backend → mensaje UI
 * ============================================================ */

test('mapLeadResponse: 200 + ok=true → success con mensaje doble opt-in', () => {
  const res = lm.mapLeadResponse(200, { ok: true });
  assert.equal(res.kind, 'success');
  assert.match(res.message, /confirmar tu suscripción/i);
});

test('mapLeadResponse: 429 → mensaje rate-limit', () => {
  const res = lm.mapLeadResponse(429, null);
  assert.equal(res.kind, 'error');
  assert.match(res.message, /varios intentos/i);
});

test('mapLeadResponse: 500 → mensaje genérico', () => {
  const res = lm.mapLeadResponse(500, null);
  assert.equal(res.kind, 'error');
  assert.match(res.message, /no fue bien/i);
});

test('mapLeadResponse: 400 + ok=false → mensaje genérico', () => {
  const res = lm.mapLeadResponse(400, { ok: false, error: 'invalid_email' });
  assert.equal(res.kind, 'error');
});

test('mapLeadResponse: 200 sin ok=true → trata como error', () => {
  const res = lm.mapLeadResponse(200, { ok: false });
  assert.equal(res.kind, 'error');
});

test('mapLeadResponse: status 0 (network error) → mensaje genérico', () => {
  const res = lm.mapLeadResponse(0, null);
  assert.equal(res.kind, 'error');
  assert.match(res.message, /no fue bien/i);
});

test('mapLeadResponse: 200 + body undefined → tratar como error genérico', () => {
  const res = lm.mapLeadResponse(200, undefined);
  assert.equal(res.kind, 'error');
});
