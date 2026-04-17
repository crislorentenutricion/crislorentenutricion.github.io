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
