// Funciones puras del bloque de captación del lead magnet (planificador semanal).
// La capa DOM vive en lead-magnet.js. Estas funciones son testables en Node —
// ver tests/lead-magnet-logic.test.js.

/* ============================================================
 * Validación
 * ============================================================ */

// Email RFC 5322 simplificado. Igual que el patrón nativo de <input type="email">:
// permite local@dominio.tld, sin garantías de existencia real (eso lo valida
// el doble opt-in de la newsletter).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function isValidEmail(value) {
  const normalized = normalizeEmail(value);
  if (!normalized) return false;
  if (normalized.length > 254) return false;
  return EMAIL_RE.test(normalized);
}

function normalizeNombre(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

// Resultado de validación del formulario completo.
// Devuelve { ok, errors: { email?, nombre?, consent? } } — `errors` solo trae
// las claves de los campos con problema.
function validateLeadForm(input) {
  const errors = {};
  const nombre = normalizeNombre((input && input.nombre) || '');
  if (!nombre) errors.nombre = 'nombre_required';

  const email = normalizeEmail((input && input.email) || '');
  if (!email) {
    errors.email = 'email_required';
  } else if (!isValidEmail(email)) {
    errors.email = 'email_invalid';
  }

  const consent = (input && input.consent) === true ||
                  (input && input.consent) === 'on' ||
                  (input && input.consent) === 'true';
  if (!consent) errors.consent = 'consent_required';

  return {
    ok: Object.keys(errors).length === 0,
    errors: errors
  };
}

/* ============================================================
 * Construcción del payload POST a la Edge Function lead-magnet-alta
 * ============================================================ */

// `formData` puede ser FormData, Map o plain object.
// Devuelve el JSON exacto que espera la Edge Function `lead-magnet-alta`.
function buildLeadPayload(formData, captchaToken) {
  function get(k) {
    if (!formData) return '';
    if (typeof formData.get === 'function') return formData.get(k) || '';
    return formData[k] !== undefined && formData[k] !== null ? formData[k] : '';
  }
  const consentRaw = get('consent');
  return {
    nombre: normalizeNombre(String(get('nombre'))),
    email: normalizeEmail(String(get('email'))),
    consent: consentRaw === true || consentRaw === 'on' || consentRaw === 'true',
    hcaptcha_token: captchaToken || ''
  };
}

/* ============================================================
 * Mapeo de respuesta del backend → mensaje UI
 * ============================================================ */

// La Edge Function devuelve:
//   200 + { ok: true }            → suscripción registrada (doble opt-in)
//   429                            → rate limit
//   400/422 + { ok: false, ... }  → payload inválido
//   5xx / network error           → fallback genérico
//
// Devuelve { kind, message } donde kind ∈ 'success' | 'error'.
// Las cadenas son las que se renderizan al usuario en el bloque.
function mapLeadResponse(status, body) {
  if (status === 200 && body && body.ok === true) {
    return {
      kind: 'success',
      message: 'Casi listo. Te he mandado un correo para confirmar tu suscripción.'
    };
  }
  if (status === 429) {
    return {
      kind: 'error',
      message: 'Has hecho varios intentos en poco tiempo, prueba más tarde.'
    };
  }
  return {
    kind: 'error',
    message: 'Algo no fue bien, intenta de nuevo.'
  };
}

/* ============================================================
 * Exports — Node (CommonJS) para tests, window.* para navegador.
 * ============================================================ */
const __exports = {
  EMAIL_RE,
  normalizeEmail,
  isValidEmail,
  normalizeNombre,
  validateLeadForm,
  buildLeadPayload,
  mapLeadResponse
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
}
if (typeof window !== 'undefined') {
  window.LeadMagnetLogic = __exports;
}
