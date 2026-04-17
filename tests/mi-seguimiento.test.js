const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  toISO,
  dayOfYear,
  MILESTONES,
  detectarMilestone,
  countStreak,
  detectarRachaRota,
  TIPS,
  tipDelDia,
} = require("../src/mi-seguimiento/logic.js");

// ------------------------------- toISO -------------------------------

test("toISO formatea en YYYY-MM-DD (fecha local, no UTC)", () => {
  // Nota: toISO usa componentes locales; esto es intencional porque los checkins
  // se guardan con la fecha civil del paciente, no con la UTC.
  const d = new Date(2026, 3, 17); // 17 abril 2026, 00:00 local
  assert.equal(toISO(d), "2026-04-17");
});

test("toISO rellena con ceros meses y días de un dígito", () => {
  assert.equal(toISO(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(toISO(new Date(2026, 8, 9)), "2026-09-09");
});

// ----------------------- detectarMilestone --------------------------

test("detectarMilestone devuelve null si la racha no alcanza ningún hito", () => {
  assert.equal(detectarMilestone(6, []), null);
  assert.equal(detectarMilestone(0, []), null);
});

test("detectarMilestone devuelve el hito al alcanzarlo justo", () => {
  assert.equal(detectarMilestone(7, []), 7);
  assert.equal(detectarMilestone(14, []), 14);
  assert.equal(detectarMilestone(28, []), 28);
  assert.equal(detectarMilestone(30, []), 30);
});

test("detectarMilestone devuelve el mayor hito alcanzado aún no celebrado", () => {
  // Racha de 30 días sin haber visto nada → celebra 30 (el mayor)
  assert.equal(detectarMilestone(30, []), 30);
  // Racha de 30 días pero ya ha visto 30 → 28 es el siguiente no visto
  assert.equal(detectarMilestone(30, [30]), 28);
  // Ya ha visto 30 y 28 → 14
  assert.equal(detectarMilestone(30, [28, 30]), 14);
  // Ha visto todos los alcanzados → null
  assert.equal(detectarMilestone(30, [7, 14, 28, 30]), null);
});

test("detectarMilestone acepta vistos=null/undefined sin romper", () => {
  assert.equal(detectarMilestone(7, null), 7);
  assert.equal(detectarMilestone(7, undefined), 7);
});

test("MILESTONES expone el contrato con la base de datos (columna milestones_vistos)", () => {
  // Si cambia el set, hay que migrar datos. Test guardián.
  assert.deepEqual(MILESTONES, [7, 14, 28, 30]);
});

// ---------------------------- countStreak ----------------------------

function mkMap(obj) {
  return new Map(Object.entries(obj));
}

test("countStreak es 0 si no hay checkins", () => {
  const hoy = new Date(2026, 3, 17); // jueves 17 abr 2026
  assert.equal(countStreak(new Map(), hoy), 0);
});

test("countStreak cuenta días 'seguido' consecutivos empezando en ayer", () => {
  const hoy = new Date(2026, 3, 17);
  const map = mkMap({
    "2026-04-16": "seguido",
    "2026-04-15": "seguido",
    "2026-04-14": "seguido",
  });
  assert.equal(countStreak(map, hoy), 3);
});

test("countStreak ignora el día de hoy (aún no cuenta hasta mañana)", () => {
  const hoy = new Date(2026, 3, 17);
  const map = mkMap({
    "2026-04-17": "seguido",  // hoy — no suma
    "2026-04-16": "seguido",
  });
  assert.equal(countStreak(map, hoy), 1);
});

test("countStreak: 'parcial' mantiene la racha pero no suma", () => {
  const hoy = new Date(2026, 3, 17);
  const map = mkMap({
    "2026-04-16": "seguido",
    "2026-04-15": "parcial",  // no suma, no rompe
    "2026-04-14": "seguido",
  });
  assert.equal(countStreak(map, hoy), 2);
});

test("countStreak: 'no' rompe la racha", () => {
  const hoy = new Date(2026, 3, 17);
  const map = mkMap({
    "2026-04-16": "seguido",
    "2026-04-15": "no",       // rompe
    "2026-04-14": "seguido",  // ya no se cuenta
  });
  assert.equal(countStreak(map, hoy), 1);
});

test("countStreak: día sin marcar rompe la racha", () => {
  const hoy = new Date(2026, 3, 17);
  const map = mkMap({
    "2026-04-16": "seguido",
    // "2026-04-15" falta → rompe
    "2026-04-14": "seguido",
  });
  assert.equal(countStreak(map, hoy), 1);
});

test("countStreak: 0 si ayer no está marcado como 'seguido' ni 'parcial'", () => {
  const hoy = new Date(2026, 3, 17);
  const map = mkMap({
    "2026-04-16": "no",
    "2026-04-15": "seguido",
  });
  assert.equal(countStreak(map, hoy), 0);
});

test("countStreak atraviesa correctamente el cambio de mes", () => {
  const hoy = new Date(2026, 4, 2); // 2 mayo 2026
  const map = mkMap({
    "2026-05-01": "seguido",
    "2026-04-30": "seguido",
    "2026-04-29": "seguido",
  });
  assert.equal(countStreak(map, hoy), 3);
});

// -------------------------- detectarRachaRota ------------------------

test("detectarRachaRota=false sin checkins (no hay racha que romper)", () => {
  const hoy = new Date(2026, 3, 17);
  assert.equal(detectarRachaRota(new Map(), hoy), false);
});

test("detectarRachaRota=false si el último checkin es ayer", () => {
  const hoy = new Date(2026, 3, 17);
  const map = mkMap({ "2026-04-16": "seguido" });
  assert.equal(detectarRachaRota(map, hoy), false);
});

test("detectarRachaRota=false si el único checkin es de hoy (sin ayer)", () => {
  // El bucle ignora iso === todayISO, así que lastISO sigue null → false.
  const hoy = new Date(2026, 3, 17);
  const map = mkMap({ "2026-04-17": "seguido" });
  assert.equal(detectarRachaRota(map, hoy), false);
});

test("detectarRachaRota=true si hay gap entre último checkin y ayer", () => {
  const hoy = new Date(2026, 3, 17);
  const map = mkMap({ "2026-04-14": "seguido" }); // hace 3 días
  assert.equal(detectarRachaRota(map, hoy), true);
});

test("detectarRachaRota usa SIEMPRE el más reciente < hoy aunque haya posteriores", () => {
  const hoy = new Date(2026, 3, 17);
  const map = mkMap({
    "2026-04-10": "seguido",
    "2026-04-16": "seguido",  // este manda → ayer → no rota
    "2026-04-17": "seguido",  // hoy, ignorado
  });
  assert.equal(detectarRachaRota(map, hoy), false);
});

// ------------------------------ TIPS / tipDelDia ----------------------

test("TIPS contiene al menos 14 frases (2 semanas sin repetir obvio)", () => {
  assert.ok(TIPS.length >= 14, `solo ${TIPS.length} tips`);
});

test("TIPS: ningún tip está vacío ni duplicado", () => {
  for (const t of TIPS) assert.ok(t && t.trim().length > 10, `tip insuficiente: ${t}`);
  assert.equal(new Set(TIPS).size, TIPS.length, "hay tips duplicados");
});

test("dayOfYear crece en 1 entre días consecutivos", () => {
  const a = new Date(2026, 3, 17);
  const b = new Date(2026, 3, 18);
  assert.equal(dayOfYear(b) - dayOfYear(a), 1);
});

test("tipDelDia es determinista: mismo día → mismo tip", () => {
  const hoy = new Date(2026, 3, 17);
  assert.equal(tipDelDia(hoy), tipDelDia(new Date(2026, 3, 17)));
});

test("tipDelDia rota: dos días consecutivos devuelven tips distintos (si len > 1)", () => {
  const a = new Date(2026, 3, 17);
  const b = new Date(2026, 3, 18);
  // Con TIPS.length > 1, dayOfYear(a) y dayOfYear(b) difieren en 1 y producen
  // índices distintos módulo TIPS.length (siempre que el salto no sea múltiplo).
  assert.notEqual(tipDelDia(a), tipDelDia(b));
});
