// Funciones puras del picker de valoración gratuita.
// La capa DOM vive en booking.js (Fase 2.2). Estas funciones son testables
// en Node — ver tests/booking-logic.test.js.

/* ============================================================
 * Config por defecto (usada por el mock de Fase 2.2).
 * En producción el backend devuelve la disponibilidad ya calculada,
 * así que WORKING_HOURS y buildMockBusyEvents quedarán sin uso
 * en cuanto la Fase 2.3 conecte al backend real.
 * ============================================================ */

const WORKING_HOURS = {
  1: [['09:00', '13:00'], ['15:00', '18:00']],
  2: [['09:00', '13:00'], ['15:00', '18:00']],
  3: [['09:00', '13:00'], ['15:00', '18:00']],
  4: [['09:00', '13:00'], ['15:00', '18:00']],
  5: [['09:00', '14:00']],
  0: [],
  6: []
};

const SLOT_DURATION_MINUTES = 30;

function buildMockBusyEvents(today) {
  const base = today instanceof Date ? today : new Date(today);
  const iso = (d) => d.toISOString().slice(0, 10);
  const plus = (days) => { const d = new Date(base); d.setDate(d.getDate() + days); return d; };
  return [
    { date: iso(plus(1)), start: '10:00', end: '10:30' },
    { date: iso(plus(1)), start: '11:30', end: '12:00' },
    { date: iso(plus(2)), start: '09:00', end: '10:00' },
    { date: iso(plus(2)), start: '16:00', end: '17:00' },
    { date: iso(plus(3)), start: '12:00', end: '13:00' },
    { date: iso(plus(4)), start: '15:00', end: '16:30' },
    { date: iso(plus(7)), start: '09:30', end: '10:30' },
    { date: iso(plus(8)), start: '11:00', end: '11:30' },
    { date: iso(plus(10)), start: '15:00', end: '18:00' }
  ];
}

/* ============================================================
 * Tiempo: conversión minutos ↔ HH:MM
 * ============================================================ */

function parseTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function toIsoDate(year, month, day) {
  return String(year) + '-' +
    String(month + 1).padStart(2, '0') + '-' +
    String(day).padStart(2, '0');
}

/* ============================================================
 * Cálculo de slots (usado solo por el mock de Fase 2.2)
 * ============================================================ */

function getDayBaseSlots(dayOfWeek, duration) {
  const ranges = WORKING_HOURS[dayOfWeek] || [];
  const slots = [];
  for (const [startStr, endStr] of ranges) {
    const start = parseTime(startStr);
    const end = parseTime(endStr);
    for (let t = start; t + duration <= end; t += duration) {
      slots.push({ start: formatTime(t), end: formatTime(t + duration) });
    }
  }
  return slots;
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function computeAvailableSlots(isoDate, busyEvents, duration) {
  const date = new Date(isoDate + 'T00:00:00');
  const dayOfWeek = date.getDay();
  const base = getDayBaseSlots(dayOfWeek, duration);
  const busy = busyEvents.filter((e) => e.date === isoDate);
  return base.filter((slot) => {
    const sStart = parseTime(slot.start);
    const sEnd = parseTime(slot.end);
    return !busy.some((e) =>
      intervalsOverlap(sStart, sEnd, parseTime(e.start), parseTime(e.end))
    );
  });
}

/* ============================================================
 * Grid de mes (usado en producción: el calendario visual no depende
 * del backend, solo de qué días tienen huecos según `availability[]`)
 * ============================================================ */

function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (first.getDay() + 6) % 7; // week-start = lunes
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, iso: toIsoDate(year, month, d) });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null });
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function dayHasAvailability(isoDate, busyEvents, duration, todayIso) {
  if (isoDate < todayIso) return false;
  return computeAvailableSlots(isoDate, busyEvents, duration).length > 0;
}

/* ============================================================
 * CommonJS export para tests Node. En el navegador no aplica.
 * ============================================================ */

/* ============================================================
 * Integración con backend real (Fase 2.3)
 * ============================================================ */

// Rango [from, to] en ISO para consultar slots del mes dado (mes 0-index).
function buildSlotsRange(year, month) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return { from: toIsoDate(year, month, 1), to: toIsoDate(year, month, lastDay) };
}

// Convierte la respuesta del backend en un Map<isoDate, slot[]>.
// `availability` del backend ya son slots libres — sin recomputar en cliente.
function indexAvailability(availability) {
  const map = new Map();
  if (!Array.isArray(availability)) return map;
  for (const day of availability) {
    if (day && typeof day.date === 'string' && Array.isArray(day.slots)) {
      map.set(day.date, day.slots);
    }
  }
  return map;
}

// Normaliza la respuesta del endpoint GET ?action=slots.
// Devuelve { ok, availability, busy, error } con una forma estable.
function parseApiResponse(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'invalid_shape' };
  if (obj.ok !== true) return { ok: false, error: obj.error || obj.reason || 'backend_error' };
  const data = obj.data || {};
  return {
    ok: true,
    availability: Array.isArray(data.availability) ? data.availability : [],
    busy: Array.isArray(data.busy) ? data.busy : []
  };
}

// URL del backend según entorno. Si no hay prodUrl, siempre devUrl.
function apiUrlFor(hostname, devUrl, prodUrl) {
  if (!prodUrl) return devUrl;
  if (!hostname) return devUrl;
  if (hostname === 'localhost' || hostname.startsWith('127.') || hostname.endsWith('.local')) {
    return devUrl;
  }
  return prodUrl;
}

/* ============================================================
 * POST book: construcción del payload y parseo de la respuesta
 * ============================================================ */

// Payload que se envía al backend. `formData` puede ser FormData, Map o plain object
// con las claves del <form>. `slot` es `{ start, end }`.
function buildBookingPayload(formData, isoDate, slot, captchaToken) {
  function get(k) {
    if (!formData) return '';
    if (typeof formData.get === 'function') return formData.get(k) || '';
    return formData[k] !== undefined && formData[k] !== null ? formData[k] : '';
  }
  const privacidadRaw = get('privacidad');
  return {
    action: 'book',
    nombre: String(get('nombre')).trim(),
    email: String(get('email')).trim(),
    telefono: String(get('telefono')).trim(),
    objetivo: String(get('objetivo')).trim(),
    plan: String(get('plan') || '').trim(),
    privacidad: privacidadRaw === true || privacidadRaw === 'on' || privacidadRaw === 'true',
    slot: { date: isoDate, start: slot && slot.start ? slot.start : '' },
    captchaToken: captchaToken || ''
  };
}

// Normaliza la respuesta del POST /exec.
// Devuelve `{ ok, meetLink, reason, errors, errorCodes }` (reason según contrato GAS).
function parseBookingResponse(obj) {
  if (!obj || typeof obj !== 'object') {
    return { ok: false, reason: 'invalid_shape' };
  }
  if (obj.ok === true) {
    return { ok: true, meetLink: obj.meetLink || '', eventId: obj.eventId || '' };
  }
  return {
    ok: false,
    reason: obj.reason || 'unknown',
    errors: Array.isArray(obj.errors) ? obj.errors : [],
    errorCodes: Array.isArray(obj.errorCodes) ? obj.errorCodes : []
  };
}

/* ============================================================
 * Accesibilidad: navegación por teclado del calendario
 * ============================================================ */

// Suma `deltaDays` al ISO (YYYY-MM-DD) y devuelve el ISO resultante.
// Usa Date UTC para no sufrir saltos de DST.
function addDaysToIso(isoDate, deltaDays) {
  const parts = isoDate.split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// Busca la celda enfocable al aplicar `delta` repetidas veces desde `currentIso`.
// Enfocable = dentro del mes visible + día presente/futuro + con huecos.
// Devuelve el ISO encontrado o null si se sale del mes sin éxito tras maxSteps.
function findFocusableIso(currentIso, delta, availByDate, todayIso, viewYear, viewMonth, maxSteps) {
  const steps = maxSteps || 40;
  let candidate = addDaysToIso(currentIso, delta);
  for (let i = 0; i < steps; i++) {
    const parts = candidate.split('-').map(Number);
    const candYear = parts[0];
    const candMonth = parts[1] - 1;
    if (candYear !== viewYear || candMonth !== viewMonth) return null;
    if (candidate >= todayIso && availByDate.has(candidate)) return candidate;
    candidate = addDaysToIso(candidate, delta > 0 ? 1 : -1);
  }
  return null;
}

// Primer ISO enfocable dentro del mes visible (el más temprano disponible).
function firstFocusableIsoInMonth(availByDate, todayIso, viewYear, viewMonth) {
  const sorted = Array.from(availByDate.keys()).sort();
  for (const iso of sorted) {
    const parts = iso.split('-').map(Number);
    if (parts[0] === viewYear && parts[1] - 1 === viewMonth && iso >= todayIso) return iso;
  }
  return null;
}

// Traducción de `reason` del backend a mensaje legible para la UI.
function bookingErrorMessage(reason) {
  switch (reason) {
    case 'slot_taken':
      return 'Justo alguien acaba de reservar ese hueco. He refrescado la disponibilidad — elige otro.';
    case 'captcha_failed':
      return 'No se pudo verificar que no eres un bot. Refresca la página y vuelve a intentarlo.';
    case 'rate_limited':
      return 'Has reservado demasiadas veces desde este email en la última hora. Inténtalo más tarde.';
    case 'invalid_payload':
      return 'Faltan datos obligatorios. Revisa el formulario.';
    case 'calendar_error':
      return 'Hubo un problema al crear la cita en el calendario. Inténtalo en unos minutos.';
    case 'invalid_json':
    case 'invalid_shape':
    case 'unknown_action':
      return 'El servidor devolvió una respuesta inesperada. Inténtalo de nuevo.';
    default:
      return 'No hemos podido confirmar la reserva. Inténtalo de nuevo en unos minutos.';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseTime,
    formatTime,
    toIsoDate,
    getDayBaseSlots,
    intervalsOverlap,
    computeAvailableSlots,
    buildMonthGrid,
    dayHasAvailability,
    WORKING_HOURS,
    SLOT_DURATION_MINUTES,
    buildMockBusyEvents,
    buildSlotsRange,
    indexAvailability,
    parseApiResponse,
    apiUrlFor,
    buildBookingPayload,
    parseBookingResponse,
    bookingErrorMessage,
    addDaysToIso,
    findFocusableIso,
    firstFocusableIsoInMonth
  };
}
