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
 * Normalización de PII para matching server-side (CAPI / EC).
 * No hasheamos aquí — el hash SHA-256 lo hace el server-side
 * (Apps Script para CAPI, Google Ads Enhanced Conversions lo hace
 * su propio SDK).
 * ============================================================ */

function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function normalizePhone(phone) {
  if (typeof phone !== 'string') return '';
  var cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (cleaned.charAt(0) === '+') return cleaned;
  // España: 9 dígitos → +34XXXXXXXXX
  if (cleaned.length === 9) return '+34' + cleaned;
  // España: 11 dígitos que empiezan por 34
  if (cleaned.length === 11 && cleaned.indexOf('34') === 0) return '+' + cleaned;
  // Otros países: se devuelve tal cual (el usuario sabe lo que pone)
  return cleaned;
}

/* ============================================================
 * Evento Lead canónico.
 * Los adapters (Pixel, Google Ads, CAPI) consumen este objeto.
 * ============================================================ */

function buildLeadEvent(input) {
  input = input || {};
  var value = 0;
  if (typeof input.value === 'number' && !isNaN(input.value)) value = input.value;
  return {
    email: normalizeEmail(input.email),
    phone: normalizePhone(input.phone),
    plan: typeof input.plan === 'string' ? input.plan : '',
    value: value,
    currency: typeof input.currency === 'string' ? input.currency : 'EUR',
    eventId: typeof input.eventId === 'string' ? input.eventId : ''
  };
}

/* ============================================================
 * Adapters: toman el evento canónico y devuelven el payload
 * exacto que necesita cada plataforma. Puros para poder testarlos.
 * ============================================================ */

function buildPixelLeadPayload(leadEvent) {
  return {
    currency: leadEvent.currency || 'EUR',
    value: leadEvent.value || 0,
    content_name: leadEvent.plan || ''
  };
}

function buildGoogleAdsConversionPayload(leadEvent, sendTo) {
  return {
    send_to: sendTo || '',
    currency: leadEvent.currency || 'EUR',
    value: leadEvent.value || 0,
    transaction_id: leadEvent.eventId || '',
    user_data: {
      email: leadEvent.email || '',
      phone_number: leadEvent.phone || ''
    }
  };
}

// Payload para Meta CAPI (server-side, lo envía el Apps Script).
// Se envía sin hashear — el Apps Script hace SHA-256 y lo mete en user_data.
// eventId se reutiliza como event_id para deduplicar con el Pixel.
function buildCapiLeadPayload(leadEvent, sourceUrl, userAgent, fbp, fbc) {
  return {
    event_name: 'Lead',
    event_time: Math.floor(Date.now() / 1000),
    event_id: leadEvent.eventId || '',
    event_source_url: sourceUrl || '',
    action_source: 'website',
    user_data: {
      em: leadEvent.email || '',
      ph: leadEvent.phone || '',
      client_user_agent: userAgent || '',
      fbp: fbp || '',
      fbc: fbc || ''
    },
    custom_data: {
      currency: leadEvent.currency || 'EUR',
      value: leadEvent.value || 0,
      content_name: leadEvent.plan || ''
    }
  };
}

/* ============================================================
 * Helper: genera un eventId estable para deduplicar Pixel + CAPI.
 * Recibe `now` y `rand` como argumentos para poder testear.
 * ============================================================ */

function makeEventId(now, rand) {
  var n = typeof now === 'number' ? now : Date.now();
  var r = typeof rand === 'number' ? rand : Math.random();
  return 'cln_' + n + '_' + r.toString(36).slice(2, 8);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONSENT_KEY: CONSENT_KEY,
    CONSENT_ACCEPTED: CONSENT_ACCEPTED,
    CONSENT_REJECTED: CONSENT_REJECTED,
    readConsent: readConsent,
    writeConsent: writeConsent,
    normalizeEmail: normalizeEmail,
    normalizePhone: normalizePhone,
    buildLeadEvent: buildLeadEvent,
    buildPixelLeadPayload: buildPixelLeadPayload,
    buildGoogleAdsConversionPayload: buildGoogleAdsConversionPayload,
    buildCapiLeadPayload: buildCapiLeadPayload,
    makeEventId: makeEventId
  };
}
