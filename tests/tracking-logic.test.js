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

test('normalizeEmail limpia y pasa a lowercase', () => {
  assert.equal(t.normalizeEmail('  Foo@Bar.com  '), 'foo@bar.com');
  assert.equal(t.normalizeEmail('ALGO@ejemplo.ES'), 'algo@ejemplo.es');
});

test('normalizeEmail tolera tipos no string', () => {
  assert.equal(t.normalizeEmail(''), '');
  assert.equal(t.normalizeEmail(null), '');
  assert.equal(t.normalizeEmail(undefined), '');
  assert.equal(t.normalizeEmail(123), '');
  assert.equal(t.normalizeEmail({}), '');
});

test('normalizePhone estandariza número español a E.164', () => {
  assert.equal(t.normalizePhone('622 279 695'), '+34622279695');
  assert.equal(t.normalizePhone('622-279-695'), '+34622279695');
  assert.equal(t.normalizePhone('622.279.695'), '+34622279695');
  assert.equal(t.normalizePhone('+34622279695'), '+34622279695');
  assert.equal(t.normalizePhone('34622279695'), '+34622279695');
  assert.equal(t.normalizePhone(' 622279695 '), '+34622279695');
});

test('normalizePhone respeta prefijo + existente', () => {
  assert.equal(t.normalizePhone('+351934567890'), '+351934567890');
  assert.equal(t.normalizePhone('+15551234567'), '+15551234567');
});

test('normalizePhone devuelve vacío para input vacío o inválido', () => {
  assert.equal(t.normalizePhone(''), '');
  assert.equal(t.normalizePhone(null), '');
  assert.equal(t.normalizePhone(undefined), '');
  assert.equal(t.normalizePhone('   '), '');
  assert.equal(t.normalizePhone('abc'), '');
});

test('buildLeadEvent normaliza input y aplica defaults', () => {
  const ev = t.buildLeadEvent({
    email: ' Foo@BAR.com ',
    phone: '622 279 695',
    plan: 'Asesoría',
    value: 15
  });
  assert.equal(ev.email, 'foo@bar.com');
  assert.equal(ev.phone, '+34622279695');
  assert.equal(ev.plan, 'Asesoría');
  assert.equal(ev.value, 15);
  assert.equal(ev.currency, 'EUR');
  assert.equal(ev.eventId, '');
});

test('buildLeadEvent tolera input vacío', () => {
  const ev = t.buildLeadEvent({});
  assert.equal(ev.email, '');
  assert.equal(ev.phone, '');
  assert.equal(ev.plan, '');
  assert.equal(ev.value, 0);
  assert.equal(ev.currency, 'EUR');
  assert.equal(t.buildLeadEvent(null).email, '');
  assert.equal(t.buildLeadEvent(undefined).email, '');
});

test('buildLeadEvent ignora value no numérico', () => {
  assert.equal(t.buildLeadEvent({ value: '15' }).value, 0);
  assert.equal(t.buildLeadEvent({ value: NaN }).value, 0);
  assert.equal(t.buildLeadEvent({ value: 0 }).value, 0);
  assert.equal(t.buildLeadEvent({ value: 40 }).value, 40);
});

test('buildPixelLeadPayload genera lo que espera fbq track Lead', () => {
  const ev = t.buildLeadEvent({ email: 'a@b.com', phone: '622279695', plan: 'Pro', value: 15 });
  const p = t.buildPixelLeadPayload(ev);
  assert.equal(p.currency, 'EUR');
  assert.equal(p.value, 15);
  assert.equal(p.content_name, 'Pro');
});

test('buildGoogleAdsConversionPayload genera lo que espera gtag event conversion', () => {
  const ev = t.buildLeadEvent({ email: 'a@b.com', phone: '622279695', plan: 'X', value: 15, eventId: 'ev-1' });
  const p = t.buildGoogleAdsConversionPayload(ev, 'AW-123/abc');
  assert.equal(p.send_to, 'AW-123/abc');
  assert.equal(p.currency, 'EUR');
  assert.equal(p.value, 15);
  assert.equal(p.transaction_id, 'ev-1');
  assert.equal(p.user_data.email, 'a@b.com');
  assert.equal(p.user_data.phone_number, '+34622279695');
});

test('buildCapiLeadPayload mete todo lo que espera Meta Graph API', () => {
  const ev = t.buildLeadEvent({ email: 'a@b.com', phone: '622279695', plan: 'X', value: 15, eventId: 'ev-1' });
  const p = t.buildCapiLeadPayload(ev, 'https://www.crislorentenutricion.com/', 'UA/1.0', 'fbp.1', 'fbclid.1');
  assert.equal(p.event_name, 'Lead');
  assert.equal(p.event_id, 'ev-1');
  assert.equal(p.event_source_url, 'https://www.crislorentenutricion.com/');
  assert.equal(p.action_source, 'website');
  assert.equal(p.user_data.em, 'a@b.com');
  assert.equal(p.user_data.ph, '+34622279695');
  assert.equal(p.user_data.client_user_agent, 'UA/1.0');
  assert.equal(p.user_data.fbp, 'fbp.1');
  assert.equal(p.user_data.fbc, 'fbclid.1');
  assert.equal(p.custom_data.currency, 'EUR');
  assert.equal(p.custom_data.value, 15);
  assert.equal(p.custom_data.content_name, 'X');
  assert.equal(typeof p.event_time, 'number');
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
