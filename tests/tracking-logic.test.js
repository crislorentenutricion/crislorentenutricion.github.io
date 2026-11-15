const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const t = require(path.join(__dirname, '..', 'src', 'js', 'tracking-logic.js'));

function mockStorage(initial) {
  const store = Object.assign({}, initial);
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
}

test('readConsent devuelve null cuando no hay nada guardado', () => {
  assert.equal(t.readConsent(mockStorage({})), null);
});

test('readConsent devuelve accepted/rejected cuando coincide', () => {
  assert.equal(t.readConsent(mockStorage({ [t.CONSENT_KEY]: 'accepted' })), 'accepted');
  assert.equal(t.readConsent(mockStorage({ [t.CONSENT_KEY]: 'rejected' })), 'rejected');
});

test('readConsent ignora valores inválidos', () => {
  assert.equal(t.readConsent(mockStorage({ [t.CONSENT_KEY]: 'maybe' })), null);
  assert.equal(t.readConsent(mockStorage({ [t.CONSENT_KEY]: '' })), null);
});

test('readConsent sobrevive a storage roto o ausente', () => {
  const broken = { getItem: () => { throw new Error('boom'); } };
  assert.equal(t.readConsent(broken), null);
  assert.equal(t.readConsent(null), null);
  assert.equal(t.readConsent(undefined), null);
  assert.equal(t.readConsent({}), null); // no tiene getItem
});

test('writeConsent solo persiste valores válidos', () => {
  const storage = mockStorage({});
  assert.equal(t.writeConsent(storage, 'accepted'), true);
  assert.equal(storage.getItem(t.CONSENT_KEY), 'accepted');
  assert.equal(t.writeConsent(storage, 'rejected'), true);
  assert.equal(storage.getItem(t.CONSENT_KEY), 'rejected');
  assert.equal(t.writeConsent(storage, 'other'), false);
  assert.equal(storage.getItem(t.CONSENT_KEY), 'rejected'); // no cambia
  assert.equal(t.writeConsent(null, 'accepted'), false);
});

test('buildLeadEvent normaliza input y aplica defaults', () => {
  const ev = t.buildLeadEvent({
    email: 'foo@bar.com',
    phone: '622 279 695',
    plan: 'Asesoría',
    value: 40
  });
  assert.equal(ev.email, undefined, 'el evento no lleva datos personales');
  assert.equal(ev.phone, undefined, 'el evento no lleva datos personales');
  assert.equal(ev.plan, 'Asesoría');
  assert.equal(ev.value, 40);
  assert.equal(ev.currency, 'EUR');
  assert.equal(ev.eventId, '');
});

test('buildLeadEvent tolera input vacío', () => {
  const ev = t.buildLeadEvent({});
  assert.equal(ev.plan, '');
  assert.equal(ev.value, 0);
  assert.equal(ev.currency, 'EUR');
  assert.equal(t.buildLeadEvent(null).plan, '');
  assert.equal(t.buildLeadEvent(undefined).plan, '');
});

test('buildLeadEvent ignora value no numérico', () => {
  assert.equal(t.buildLeadEvent({ value: '15' }).value, 0);
  assert.equal(t.buildLeadEvent({ value: NaN }).value, 0);
  assert.equal(t.buildLeadEvent({ value: 0 }).value, 0);
  assert.equal(t.buildLeadEvent({ value: 40 }).value, 40);
});

test('makeEventId es determinista con now y rand fijos', () => {
  const a = t.makeEventId(1700000000000, 0.123456);
  const b = t.makeEventId(1700000000000, 0.123456);
  assert.equal(a, b);
  assert.match(a, /^cln_1700000000000_[a-z0-9]+$/);
  // Mismo now, rand distinto → sufijo distinto
  assert.notEqual(
    t.makeEventId(1700000000000, 0.1),
    t.makeEventId(1700000000000, 0.9)
  );
});

test('makeEventId usa defaults cuando no se pasan argumentos', () => {
  const a = t.makeEventId();
  const b = t.makeEventId();
  assert.match(a, /^cln_\d+_[a-z0-9]{6}$/);
  assert.match(b, /^cln_\d+_[a-z0-9]{6}$/);
  // Dos llamadas seguidas deberían dar ids distintos (casi seguro por Math.random)
  assert.notEqual(a, b);
});

test('isMeasurementCookie solo reconoce las cookies de Amplitude', () => {
  assert.equal(t.isMeasurementCookie('AMP_abc123'), true);
  assert.equal(t.isMeasurementCookie('_fbp'), false);
  assert.equal(t.isMeasurementCookie('_gcl_au'), false);
  assert.equal(t.isMeasurementCookie('_ga'), false);
  assert.equal(t.isMeasurementCookie(null), false);
});
