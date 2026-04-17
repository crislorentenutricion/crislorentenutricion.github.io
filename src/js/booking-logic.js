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
    buildMockBusyEvents
  };
}
