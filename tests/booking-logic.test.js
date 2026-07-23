const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const booking = require(path.join(__dirname, '..', 'src', 'js', 'booking-logic.js'));

test('parseTime / formatTime son inversos', () => {
  assert.equal(booking.parseTime('09:00'), 540);
  assert.equal(booking.parseTime('18:30'), 1110);
  assert.equal(booking.formatTime(540), '09:00');
  assert.equal(booking.formatTime(1110), '18:30');
});

test('toIsoDate formatea con ceros a la izquierda', () => {
  assert.equal(booking.toIsoDate(2026, 0, 5), '2026-01-05');
  assert.equal(booking.toIsoDate(2026, 11, 31), '2026-12-31');
});

test('getDayBaseSlots genera slots de 30 min en lunes laborable', () => {
  const slots = booking.getDayBaseSlots(1, 30);
  assert.equal(slots.length, 14);
  assert.deepEqual(slots[0], { start: '09:00', end: '09:30' });
  assert.deepEqual(slots[7], { start: '12:30', end: '13:00' });
  assert.deepEqual(slots[8], { start: '15:00', end: '15:30' });
  assert.deepEqual(slots[13], { start: '17:30', end: '18:00' });
});

test('getDayBaseSlots devuelve vacío en sábado y domingo', () => {
  assert.deepEqual(booking.getDayBaseSlots(0, 30), []);
  assert.deepEqual(booking.getDayBaseSlots(6, 30), []);
});

test('getDayBaseSlots en viernes da 10 slots (9-14)', () => {
  const slots = booking.getDayBaseSlots(5, 30);
  assert.equal(slots.length, 10);
  assert.deepEqual(slots[0], { start: '09:00', end: '09:30' });
  assert.deepEqual(slots[9], { start: '13:30', end: '14:00' });
});

test('intervalsOverlap detecta solapamiento correctamente', () => {
  assert.equal(booking.intervalsOverlap(540, 570, 555, 600), true);
  assert.equal(booking.intervalsOverlap(540, 570, 570, 600), false);
  assert.equal(booking.intervalsOverlap(540, 570, 600, 630), false);
  assert.equal(booking.intervalsOverlap(540, 600, 555, 570), true);
});

test('computeAvailableSlots quita slots ocupados', () => {
  const busy = [
    { date: '2026-04-20', start: '10:00', end: '10:30' },
    { date: '2026-04-20', start: '15:00', end: '16:00' }
  ];
  const slots = booking.computeAvailableSlots('2026-04-20', busy, 30);
  assert.equal(slots.length, 14 - 3);
  const starts = slots.map(s => s.start);
  assert.ok(!starts.includes('10:00'));
  assert.ok(!starts.includes('15:00'));
  assert.ok(!starts.includes('15:30'));
  assert.ok(starts.includes('09:00'));
  assert.ok(starts.includes('16:00'));
});

test('computeAvailableSlots ignora eventos de otras fechas', () => {
  const busy = [{ date: '2026-04-21', start: '10:00', end: '10:30' }];
  const slots = booking.computeAvailableSlots('2026-04-20', busy, 30);
  assert.equal(slots.length, 14);
});

test('buildMonthGrid de abril 2026 (miércoles 1) empieza con 2 huecos', () => {
  const weeks = booking.buildMonthGrid(2026, 3);
  assert.ok(weeks.length >= 5);
  const firstWeek = weeks[0];
  assert.equal(firstWeek.length, 7);
  assert.equal(firstWeek[0].day, null);
  assert.equal(firstWeek[1].day, null);
  assert.equal(firstWeek[2].day, 1);
  assert.equal(firstWeek[2].iso, '2026-04-01');
});

test('buildMonthGrid cubre todos los días del mes', () => {
  const weeks = booking.buildMonthGrid(2026, 1);
  const allDays = weeks.flat().filter(c => c.day !== null).map(c => c.day);
  assert.deepEqual(allDays, Array.from({ length: 28 }, (_, i) => i + 1));
});

test('buildMonthGrid siempre devuelve semanas de 7 celdas', () => {
  for (let m = 0; m < 12; m++) {
    const weeks = booking.buildMonthGrid(2026, m);
    for (const w of weeks) {
      assert.equal(w.length, 7, `mes ${m} tiene semana con longitud != 7`);
    }
  }
});

test('dayHasAvailability: lunes libre en el futuro tiene huecos', () => {
  assert.equal(booking.dayHasAvailability('2026-04-20', [], 30, '2026-04-15'), true);
});

test('dayHasAvailability: fechas pasadas no tienen disponibilidad', () => {
  assert.equal(booking.dayHasAvailability('2026-04-10', [], 30, '2026-04-15'), false);
});

test('dayHasAvailability: sábado no tiene disponibilidad aunque sea futuro', () => {
  assert.equal(booking.dayHasAvailability('2026-04-18', [], 30, '2026-04-15'), false);
});

test('dayHasAvailability: día con todos los slots bloqueados devuelve false', () => {
  const busy = [
    { date: '2026-04-20', start: '09:00', end: '13:00' },
    { date: '2026-04-20', start: '15:00', end: '18:00' }
  ];
  assert.equal(booking.dayHasAvailability('2026-04-20', busy, 30, '2026-04-15'), false);
});

test('buildMockBusyEvents genera fechas futuras consistentes', () => {
  const base = new Date('2026-04-15T00:00:00');
  const events = booking.buildMockBusyEvents(base);
  assert.ok(events.length > 0);
  for (const e of events) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(e.start, /^\d{2}:\d{2}$/);
    assert.match(e.end, /^\d{2}:\d{2}$/);
  }
});

/* ============================================================
 * Integración con backend real (Fase 2.3)
 * ============================================================ */

test('buildSlotsRange: abril 2026 devuelve 1 → 30', () => {
  assert.deepEqual(booking.buildSlotsRange(2026, 3), { from: '2026-04-01', to: '2026-04-30' });
});

test('buildSlotsRange: febrero 2026 (no bisiesto) termina en 28', () => {
  assert.deepEqual(booking.buildSlotsRange(2026, 1), { from: '2026-02-01', to: '2026-02-28' });
});

test('buildSlotsRange: febrero 2028 (bisiesto) termina en 29', () => {
  assert.deepEqual(booking.buildSlotsRange(2028, 1), { from: '2028-02-01', to: '2028-02-29' });
});

test('indexAvailability: construye Map<date, slot[]>', () => {
  const avail = [
    { date: '2026-04-20', slots: [{ start: '09:00', end: '09:30' }] },
    { date: '2026-04-21', slots: [] }
  ];
  const map = booking.indexAvailability(avail);
  assert.equal(map.size, 2);
  assert.equal(map.get('2026-04-20').length, 1);
  assert.deepEqual(map.get('2026-04-21'), []);
});

test('indexAvailability: input inválido → Map vacío', () => {
  assert.equal(booking.indexAvailability(null).size, 0);
  assert.equal(booking.indexAvailability(undefined).size, 0);
  assert.equal(booking.indexAvailability('no array').size, 0);
});

test('indexAvailability: ignora entradas sin date o slots', () => {
  const avail = [
    { date: '2026-04-20', slots: [{ start: '09:00', end: '09:30' }] },
    { date: null, slots: [] },
    { slots: [] },
    { date: '2026-04-22' } // sin slots
  ];
  const map = booking.indexAvailability(avail);
  assert.equal(map.size, 1);
  assert.ok(map.has('2026-04-20'));
});

test('parseApiResponse: respuesta válida', () => {
  const res = booking.parseApiResponse({
    ok: true,
    data: { busy: [{ date: '2026-04-20', start: '10:00', end: '10:30' }], availability: [{ date: '2026-04-20', slots: [] }] }
  });
  assert.equal(res.ok, true);
  assert.equal(res.availability.length, 1);
  assert.equal(res.busy.length, 1);
});

test('parseApiResponse: ok=false → error del backend', () => {
  const res = booking.parseApiResponse({ ok: false, error: 'missing from/to' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'missing from/to');
});

test('parseApiResponse: objeto vacío / null / no-objeto', () => {
  assert.equal(booking.parseApiResponse(null).ok, false);
  assert.equal(booking.parseApiResponse('string').ok, false);
  assert.equal(booking.parseApiResponse({}).ok, false);
});

test('parseApiResponse: data sin arrays → arrays vacíos', () => {
  const res = booking.parseApiResponse({ ok: true, data: {} });
  assert.equal(res.ok, true);
  assert.deepEqual(res.availability, []);
  assert.deepEqual(res.busy, []);
});

test('apiUrlFor: sin prodUrl → siempre devUrl', () => {
  assert.equal(booking.apiUrlFor('www.crislorentenutricion.com', '/dev', null), '/dev');
  assert.equal(booking.apiUrlFor('localhost', '/dev', null), '/dev');
});

test('apiUrlFor: localhost y 127.* usan dev', () => {
  assert.equal(booking.apiUrlFor('localhost', '/dev', '/prod'), '/dev');
  assert.equal(booking.apiUrlFor('127.0.0.1', '/dev', '/prod'), '/dev');
});

test('apiUrlFor: dominio público usa prod', () => {
  assert.equal(booking.apiUrlFor('www.crislorentenutricion.com', '/dev', '/prod'), '/prod');
  assert.equal(booking.apiUrlFor('crislorentenutricion.com', '/dev', '/prod'), '/prod');
});

test('apiUrlFor: hostname vacío → dev (conservador)', () => {
  assert.equal(booking.apiUrlFor('', '/dev', '/prod'), '/dev');
  assert.equal(booking.apiUrlFor(undefined, '/dev', '/prod'), '/dev');
});

/* ============================================================
 * POST book: buildBookingPayload / parseBookingResponse / bookingErrorMessage
 * ============================================================ */

const makeFormDataLike = () => {
  const map = new Map();
  map.set('nombre', '  Ana  ');
  map.set('email', 'ana@example.com');
  map.set('telefono', '612345678');
  map.set('objetivo', 'Organizarme mejor');
  map.set('plan', '');
  map.set('privacidad', 'on');
  return { get: (k) => map.get(k) || '' };
};

test('buildBookingPayload: arma el JSON con action=book y privacidad=true', () => {
  const payload = booking.buildBookingPayload(
    makeFormDataLike(),
    '2026-04-20',
    { start: '10:00', end: '10:30' }
  );
  assert.equal(payload.action, 'book');
  assert.equal(payload.nombre, 'Ana');
  assert.equal(payload.email, 'ana@example.com');
  assert.equal(payload.telefono, '612345678');
  assert.equal(payload.objetivo, 'Organizarme mejor');
  assert.equal(payload.plan, '');
  assert.equal(payload.privacidad, true);
  assert.deepEqual(payload.slot, { date: '2026-04-20', start: '10:00' });
});

test('buildBookingPayload: acepta plain object además de FormData', () => {
  const payload = booking.buildBookingPayload(
    { nombre: 'Ana', email: 'a@b.c', telefono: '', objetivo: 'Ok', plan: 'Premium', privacidad: true },
    '2026-04-20',
    { start: '10:00', end: '10:30' }
  );
  assert.equal(payload.nombre, 'Ana');
  assert.equal(payload.plan, 'Premium');
  assert.equal(payload.privacidad, true);
});

test('buildBookingPayload: privacidad=false si el checkbox no viene', () => {
  const p = booking.buildBookingPayload(
    { nombre: 'Ana', email: 'a@b.c', objetivo: 'Ok' },
    '2026-04-20',
    { start: '10:00', end: '10:30' }
  );
  assert.equal(p.privacidad, false);
});

test('parseBookingResponse: ok=true propaga meetLink y eventId', () => {
  const res = booking.parseBookingResponse({
    ok: true,
    meetLink: 'https://meet/abc',
    eventId: 'evt_1'
  });
  assert.equal(res.ok, true);
  assert.equal(res.meetLink, 'https://meet/abc');
  assert.equal(res.eventId, 'evt_1');
});

test('parseBookingResponse: ok=false con reason y errors', () => {
  const res = booking.parseBookingResponse({
    ok: false, reason: 'invalid_payload', errors: ['email_invalid']
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'invalid_payload');
  assert.deepEqual(res.errors, ['email_invalid']);
});

test('parseBookingResponse: ok=false sin reason → unknown', () => {
  const res = booking.parseBookingResponse({ ok: false });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unknown');
});

test('parseBookingResponse: null / string → invalid_shape', () => {
  assert.equal(booking.parseBookingResponse(null).reason, 'invalid_shape');
  assert.equal(booking.parseBookingResponse('nope').reason, 'invalid_shape');
});

test('bookingErrorMessage: reasons conocidos devuelven mensajes distintos', () => {
  const reasons = ['slot_taken', 'rate_limited', 'invalid_payload', 'calendar_error'];
  const messages = new Set(reasons.map(booking.bookingErrorMessage));
  assert.equal(messages.size, reasons.length, 'mensajes deben ser distintos');
  for (const m of messages) assert.ok(m.length > 10, 'mensajes no vacíos');
});

test('bookingErrorMessage: reason desconocido → fallback genérico', () => {
  const msg = booking.bookingErrorMessage('totally_new_reason');
  assert.ok(msg.length > 10);
});

/* ============================================================
 * Accesibilidad: navegación por teclado
 * ============================================================ */

test('addDaysToIso: suma y resta días correctamente', () => {
  assert.equal(booking.addDaysToIso('2026-04-20', 1), '2026-04-21');
  assert.equal(booking.addDaysToIso('2026-04-20', -1), '2026-04-19');
  assert.equal(booking.addDaysToIso('2026-04-20', 7), '2026-04-27');
  assert.equal(booking.addDaysToIso('2026-04-20', -7), '2026-04-13');
});

test('addDaysToIso: cruza mes', () => {
  assert.equal(booking.addDaysToIso('2026-04-30', 1), '2026-05-01');
  assert.equal(booking.addDaysToIso('2026-05-01', -1), '2026-04-30');
});

test('addDaysToIso: cruza año', () => {
  assert.equal(booking.addDaysToIso('2026-12-31', 1), '2027-01-01');
  assert.equal(booking.addDaysToIso('2027-01-01', -1), '2026-12-31');
});

test('findFocusableIso: siguiente día disponible salta los no disponibles', () => {
  const avail = new Map([
    ['2026-04-20', []], ['2026-04-22', []], ['2026-04-23', []]
  ]);
  // Desde 2026-04-20 con delta=+1, 2026-04-21 no existe → salta a 2026-04-22.
  const next = booking.findFocusableIso('2026-04-20', 1, avail, '2026-04-15', 2026, 3);
  assert.equal(next, '2026-04-22');
});

test('findFocusableIso: devuelve null si se sale del mes visible', () => {
  const avail = new Map([['2026-04-20', []]]);
  // Desde 2026-04-30 avanzando +1 → 2026-05-01 (fuera del mes) → null.
  const next = booking.findFocusableIso('2026-04-30', 1, avail, '2026-04-15', 2026, 3);
  assert.equal(next, null);
});

test('findFocusableIso: ignora fechas anteriores a hoy', () => {
  const avail = new Map([['2026-04-10', []], ['2026-04-20', []]]);
  // Desde 2026-04-19 con delta=-1, 2026-04-18 no existe y 2026-04-10 es pasado → null.
  const next = booking.findFocusableIso('2026-04-19', -1, avail, '2026-04-15', 2026, 3);
  assert.equal(next, null);
});

test('findFocusableIso: delta +7 sobre semana típica', () => {
  const avail = new Map([['2026-04-20', []], ['2026-04-27', []]]);
  const next = booking.findFocusableIso('2026-04-20', 7, avail, '2026-04-15', 2026, 3);
  assert.equal(next, '2026-04-27');
});

test('firstFocusableIsoInMonth: primer disponible dentro del mes visible', () => {
  const avail = new Map([
    ['2026-03-28', []], ['2026-04-02', []], ['2026-04-20', []], ['2026-05-01', []]
  ]);
  const first = booking.firstFocusableIsoInMonth(avail, '2026-04-15', 2026, 3);
  assert.equal(first, '2026-04-20'); // 04-02 es pasado, descarta
});

test('firstFocusableIsoInMonth: null si no hay ninguno', () => {
  const avail = new Map([['2026-05-01', []]]);
  const first = booking.firstFocusableIsoInMonth(avail, '2026-04-15', 2026, 3);
  assert.equal(first, null);
});
