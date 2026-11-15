// Lógica pura de tracking (consent + normalización + payloads).
// La capa DOM vive en tracking.js. Estas funciones son testables en Node
// — ver tests/tracking-logic.test.js.

var CONSENT_KEY = 'cln_consent_v1';
var CONSENT_ACCEPTED = 'accepted';
var CONSENT_REJECTED = 'rejected';

/* ============================================================
 * Consent (localStorage-backed, pero aquí se pasa el storage
 * como argumento para poder testear sin DOM).
 * ============================================================ */

function readConsent(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    var v = storage.getItem(CONSENT_KEY);
    if (v === CONSENT_ACCEPTED || v === CONSENT_REJECTED) return v;
    return null;
  } catch (_) {
    return null;
  }
}

function writeConsent(storage, value) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  if (value !== CONSENT_ACCEPTED && value !== CONSENT_REJECTED) return false;
  try {
    storage.setItem(CONSENT_KEY, value);
    return true;
  } catch (_) {
    return false;
  }
}

/* ============================================================
 * Evento Lead canónico (el que se manda a Amplitude).
 * ============================================================ */

function buildLeadEvent(input) {
  input = input || {};
  var value = 0;
  if (typeof input.value === 'number' && !isNaN(input.value)) value = input.value;
  return {
    plan: typeof input.plan === 'string' ? input.plan : '',
    value: value,
    currency: typeof input.currency === 'string' ? input.currency : 'EUR',
    eventId: typeof input.eventId === 'string' ? input.eventId : ''
  };
}

/* ============================================================
 * Helper: genera un eventId estable para el evento Lead.
 * Recibe `now` y `rand` como argumentos para poder testear.
 * ============================================================ */

function makeEventId(now, rand) {
  var n = typeof now === 'number' ? now : Date.now();
  var r = typeof rand === 'number' ? rand : Math.random();
  return 'cln_' + n + '_' + r.toString(36).slice(2, 8);
}

// Cookies que deja Amplitude.
// Se borran al retirar el consentimiento. Misma expresión que en tracking.js.
var MEASUREMENT_COOKIE_RE = /^AMP_/;

function isMeasurementCookie(name) {
  return typeof name === 'string' && MEASUREMENT_COOKIE_RE.test(name);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isMeasurementCookie: isMeasurementCookie,
    CONSENT_KEY: CONSENT_KEY,
    CONSENT_ACCEPTED: CONSENT_ACCEPTED,
    CONSENT_REJECTED: CONSENT_REJECTED,
    readConsent: readConsent,
    writeConsent: writeConsent,
    buildLeadEvent: buildLeadEvent,
    makeEventId: makeEventId
  };
}
