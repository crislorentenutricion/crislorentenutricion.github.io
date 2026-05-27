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
  buildCalendarCells,
  getRevisionCtaState,
  formatFechaRelativa,
  visibleMeals,
  detectPlatform,
  detectInAppBrowser,
  nombreAppEmbebida,
  esErrorTransitorio,
  primerNombre,
  primerNombreDesdeEmail,
  saludoPorHora,
  slugifyItem,
  compraStorageKey,
  totalItemsCompra,
  displayCat,
  normalizeEmail,
  validateLoginForm,
  validateOtpCode,
  resolveInitialLogin,
  shouldShowInstallHint,
  shouldRehydrateOnVisibility,
  resolveInitialView,
  shouldCelebrarMilestone,
  WEEKDAY_KEYS_JSON,
  computeDayView,
  computeTodayView,
  buildCompraModel,
  computeCompraMeta,
  withCompraToggle,
  applyCheckinOptimistic,
  revertCheckin,
  buildRevisionCtaCopy,
  shouldMostrarRevisionModal,
  shouldMostrarMenuNuevoModal,
  hydrateDashboard,
  mealValueToOptions,
  opcionStorageKey,
  mealChoiceKey,
  applyMealChoice,
  menuTieneOpciones,
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

// ---------------------------- buildCalendarCells ---------------------

test("buildCalendarCells: abril 2026 (empieza miércoles, 30 días) → 2 empty + 30 day + 3 empty = 35", () => {
  const cells = buildCalendarCells(2026, 3, new Map(), "2026-04-17");
  assert.equal(cells.length, 35);
  assert.equal(cells.length % 7, 0, "total múltiplo de 7");
  const empties = cells.filter(c => c.type === "empty");
  const days = cells.filter(c => c.type === "day");
  assert.equal(days.length, 30);
  assert.equal(empties.length, 5);
  // Primeras 2 y últimas 3 son empty
  assert.deepEqual(cells.slice(0, 2).map(c => c.type), ["empty", "empty"]);
  assert.deepEqual(cells.slice(-3).map(c => c.type), ["empty", "empty", "empty"]);
});

test("buildCalendarCells: febrero 2026 (empieza domingo, 28 días) → 6 empty + 28 + 1 empty", () => {
  const cells = buildCalendarCells(2026, 1, new Map(), "2026-02-15");
  assert.equal(cells.length, 35);
  assert.equal(cells.slice(0, 6).every(c => c.type === "empty"), true);
  assert.equal(cells[6].type, "day");
  assert.equal(cells[6].day, 1);
  assert.equal(cells.at(-1).type, "empty");
});

test("buildCalendarCells: junio 2026 (empieza lunes) → offset=0 (sin empties delante)", () => {
  const cells = buildCalendarCells(2026, 5, new Map(), "2026-06-01");
  assert.equal(cells[0].type, "day");
  assert.equal(cells[0].day, 1);
});

test("buildCalendarCells: iso está bien formateado con ceros y cada día secuencial", () => {
  const cells = buildCalendarCells(2026, 3, new Map(), "2026-04-17");
  const days = cells.filter(c => c.type === "day");
  assert.equal(days[0].iso, "2026-04-01");
  assert.equal(days[8].iso, "2026-04-09");
  assert.equal(days.at(-1).iso, "2026-04-30");
});

test("buildCalendarCells: mapea estado de checkinsMap a cada celda", () => {
  const map = new Map([
    ["2026-04-16", "seguido"],
    ["2026-04-15", "parcial"],
    ["2026-04-14", "no"],
  ]);
  const cells = buildCalendarCells(2026, 3, map, "2026-04-17");
  const byIso = Object.fromEntries(cells.filter(c => c.type === "day").map(c => [c.iso, c]));
  assert.equal(byIso["2026-04-16"].estado, "seguido");
  assert.equal(byIso["2026-04-15"].estado, "parcial");
  assert.equal(byIso["2026-04-14"].estado, "no");
  assert.equal(byIso["2026-04-10"].estado, null, "días sin checkin → estado null");
});

test("buildCalendarCells: marca isToday solo en el día que coincide con todayISO", () => {
  const cells = buildCalendarCells(2026, 3, new Map(), "2026-04-17");
  const todos = cells.filter(c => c.type === "day" && c.isToday);
  assert.equal(todos.length, 1);
  assert.equal(todos[0].iso, "2026-04-17");
});

test("buildCalendarCells: si todayISO no pertenece al mes, ninguna celda tiene isToday", () => {
  const cells = buildCalendarCells(2026, 3, new Map(), "2026-05-02");
  const todos = cells.filter(c => c.type === "day" && c.isToday);
  assert.equal(todos.length, 0);
});

test("buildCalendarCells: mes que encaja exacto en semanas no añade trailing (enero 2026)", () => {
  // Ene 2026 empieza jueves (getDay=4 → offset=3); 31 días; 3+31=34; (7-34%7)%7 = 1.
  // Caso donde encaja justo es raro; probamos que el invariante (total % 7 === 0) siempre se cumple.
  for (let m = 0; m < 12; m++) {
    const cells = buildCalendarCells(2026, m, new Map(), "2026-01-01");
    assert.equal(cells.length % 7, 0, `mes ${m + 1} no múltiplo de 7: ${cells.length}`);
  }
});

test("buildCalendarCells: año bisiesto — febrero 2024 tiene 29 días", () => {
  const cells = buildCalendarCells(2024, 1, new Map(), "2024-02-15");
  const days = cells.filter(c => c.type === "day");
  assert.equal(days.length, 29);
  assert.equal(days.at(-1).iso, "2024-02-29");
});

// ------------------------- getRevisionCtaState -------------------------

test("getRevisionCtaState: sin próxima sesión devuelve 'hidden'", () => {
  const now = new Date(2026, 4, 1, 10, 0);
  assert.equal(getRevisionCtaState({ proximaSesion: null, revisionEnviada: false, now }), 'hidden');
  assert.equal(getRevisionCtaState({ now }), 'hidden');
});

// La ventana del CTA está alineada con el cron Apps Script: se abre el día
// (sesión − 2 días civiles) a las 09:00 locales (hora de envío del email).

test("getRevisionCtaState: sesión dentro de 3 días completos sin revisión → 'hidden'", () => {
  // Sesión el día 5 a las 14:00; now es el día 2 a las 10:00 (email aún no enviado).
  const now = new Date(2026, 4, 2, 10, 0);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 5, 14, 0) };
  assert.equal(getRevisionCtaState({ proximaSesion: proxima, revisionEnviada: false, now }), 'hidden');
});

test("getRevisionCtaState: mismo día de envío del email a las 08:59 → 'hidden' (un minuto antes)", () => {
  // Sesión el día 5; email se envía el día 3 a las 09:00. now = día 3 a las 08:59.
  const now = new Date(2026, 4, 3, 8, 59);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 5, 14, 0) };
  assert.equal(getRevisionCtaState({ proximaSesion: proxima, revisionEnviada: false, now }), 'hidden');
});

test("getRevisionCtaState: mismo día de envío del email a las 09:00 → 'urgent' (ya se envió)", () => {
  const now = new Date(2026, 4, 3, 9, 0);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 5, 14, 0) };
  assert.equal(getRevisionCtaState({ proximaSesion: proxima, revisionEnviada: false, now }), 'urgent');
});

test("getRevisionCtaState: sesión mañana a cualquier hora → 'urgent'", () => {
  const now = new Date(2026, 4, 4, 20, 0);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 5, 14, 0) };
  assert.equal(getRevisionCtaState({ proximaSesion: proxima, revisionEnviada: false, now }), 'urgent');
});

test("getRevisionCtaState: sesión hoy a la misma hora → 'urgent'", () => {
  const now = new Date(2026, 4, 5, 10, 0);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 5, 14, 0) };
  assert.equal(getRevisionCtaState({ proximaSesion: proxima, revisionEnviada: false, now }), 'urgent');
});

test("getRevisionCtaState: revisión enviada dentro de la ventana → 'done'", () => {
  const now = new Date(2026, 4, 4, 10, 0);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 5, 14, 0) };
  assert.equal(getRevisionCtaState({ proximaSesion: proxima, revisionEnviada: true, now }), 'done');
});

test("getRevisionCtaState: revisión enviada pero sesión lejana → 'hidden' (CTA oculto fuera de la ventana)", () => {
  const now = new Date(2026, 4, 1, 10, 0);
  const proximaLejana = { id: 's2', fecha: new Date(2026, 4, 10, 10, 0) }; // +9 días
  assert.equal(getRevisionCtaState({ proximaSesion: proximaLejana, revisionEnviada: true, now }), 'hidden');
});

test("getRevisionCtaState: sesión en el pasado sin revisión → 'hidden' (ya pasó)", () => {
  const now = new Date(2026, 4, 5, 10, 0);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 3, 10, 0) };
  assert.equal(getRevisionCtaState({ proximaSesion: proxima, revisionEnviada: false, now }), 'hidden');
});

test("getRevisionCtaState: acepta fecha como string ISO", () => {
  const now = new Date(2026, 4, 1, 10, 0);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 2, 10, 0).toISOString() };
  assert.equal(getRevisionCtaState({ proximaSesion: proxima, revisionEnviada: false, now }), 'urgent');
});

test("getRevisionCtaState: fecha inválida → 'hidden' (no rompe)", () => {
  const now = new Date(2026, 4, 1, 10, 0);
  const proxima = { id: 's1', fecha: 'no-es-una-fecha' };
  assert.equal(getRevisionCtaState({ proximaSesion: proxima, revisionEnviada: false, now }), 'hidden');
});

// --------------------------- formatFechaRelativa -----------------------

test("formatFechaRelativa: mismo día civil → 'hoy a las HH:MM'", () => {
  const now = new Date(2026, 4, 1, 9, 0);  // viernes 1 mayo 2026, 09:00
  const sesion = new Date(2026, 4, 1, 17, 30);
  assert.equal(formatFechaRelativa(sesion, now), 'hoy a las 17:30');
});

test("formatFechaRelativa: día civil +1 → 'mañana a las HH:MM'", () => {
  const now = new Date(2026, 4, 1, 20, 0);
  const sesion = new Date(2026, 4, 2, 9, 5);
  assert.equal(formatFechaRelativa(sesion, now), 'mañana a las 09:05');
});

test("formatFechaRelativa: día civil +2 → 'el [dia_semana] a las HH:MM'", () => {
  const now = new Date(2026, 4, 1, 10, 0);   // viernes 1 mayo 2026
  const sesion = new Date(2026, 4, 3, 18, 0); // domingo 3 mayo
  assert.equal(formatFechaRelativa(sesion, now), 'el domingo a las 18:00');
});

test("formatFechaRelativa: rellena ceros a la izquierda en la hora", () => {
  const now = new Date(2026, 4, 1, 7, 0);
  const sesion = new Date(2026, 4, 1, 8, 5);
  assert.equal(formatFechaRelativa(sesion, now), 'hoy a las 08:05');
});

test("formatFechaRelativa: atraviesa cambio de mes sin romper", () => {
  const now = new Date(2026, 3, 30, 10, 0);  // jueves 30 abril
  const sesion = new Date(2026, 4, 1, 17, 0); // viernes 1 mayo → +1 día civil
  assert.equal(formatFechaRelativa(sesion, now), 'mañana a las 17:00');
});

test("formatFechaRelativa: acepta strings ISO", () => {
  const now = new Date(2026, 4, 1, 10, 0);
  const sesion = new Date(2026, 4, 2, 15, 0).toISOString();
  assert.equal(formatFechaRelativa(sesion, now), 'mañana a las 15:00');
});

// ------------------------- visibleMeals ------------------------------

const COMIDAS_5 = [
  ['desayuno', 'Desayuno'],
  ['almuerzo', 'Almuerzo'],
  ['comida',   'Comida'],
  ['merienda', 'Merienda'],
  ['cena',     'Cena'],
];

test("visibleMeals: devuelve las 5 tomas cuando todas tienen contenido", () => {
  const dia = { desayuno: 'a', almuerzo: 'b', comida: 'c', merienda: 'd', cena: 'e' };
  const r = visibleMeals(dia, COMIDAS_5);
  assert.equal(r.length, 5);
  assert.deepEqual(r.map(x => x.key), ['desayuno','almuerzo','comida','merienda','cena']);
});

test("visibleMeals: filtra las tomas con string vacío (ej. pacientes de 4 tomas)", () => {
  const dia = { desayuno: 'a', almuerzo: '', comida: 'c', merienda: 'd', cena: 'e' };
  const r = visibleMeals(dia, COMIDAS_5);
  assert.deepEqual(r.map(x => x.key), ['desayuno','comida','merienda','cena']);
});

test("visibleMeals: filtra también strings solo con espacios y valores nulos", () => {
  const dia = { desayuno: '   ', almuerzo: null, comida: 'c', merienda: undefined, cena: 'e' };
  const r = visibleMeals(dia, COMIDAS_5);
  assert.deepEqual(r.map(x => x.key), ['comida','cena']);
});

test("visibleMeals: dia nulo o comidas no-array → array vacío", () => {
  assert.deepEqual(visibleMeals(null, COMIDAS_5), []);
  assert.deepEqual(visibleMeals({}, null), []);
});

test("visibleMeals: comida-lista → opciones array + text = primera por defecto", () => {
  const dia = { desayuno: 'Tostada', comida: ['Lentejas', 'Garbanzos', 'Macarrones'], cena: 'Crema' };
  const r = visibleMeals(dia, COMIDAS_5);
  const comida = r.find(x => x.key === 'comida');
  assert.deepEqual(comida.opciones, ['Lentejas', 'Garbanzos', 'Macarrones']);
  assert.equal(comida.text, 'Lentejas');
  assert.equal(comida.elegida, 0);
});

test("visibleMeals: comida-texto → opciones=null (igual que hoy)", () => {
  const dia = { desayuno: 'Tostada', comida: 'Lentejas', cena: 'Crema' };
  const r = visibleMeals(dia, COMIDAS_5);
  assert.equal(r.find(x => x.key === 'comida').opciones, null);
  assert.equal(r.find(x => x.key === 'comida').text, 'Lentejas');
});

test("visibleMeals: lista de 1 sola opción → opciones=null (no intercambiable)", () => {
  const dia = { comida: ['Solo una'] };
  const r = visibleMeals(dia, COMIDAS_5);
  assert.equal(r[0].opciones, null);
  assert.equal(r[0].text, 'Solo una');
});

test("visibleMeals: choicesMap + diaKey → text = opción elegida", () => {
  const dia = { comida: ['Lentejas', 'Garbanzos', 'Macarrones'] };
  const choices = new Map([['lunes:comida', 1]]);
  const r = visibleMeals(dia, COMIDAS_5, choices, 'lunes');
  assert.equal(r[0].text, 'Garbanzos');
  assert.equal(r[0].elegida, 1);
});

test("visibleMeals: índice fuera de rango en choicesMap → cae a 0 (clamp)", () => {
  const dia = { comida: ['Lentejas', 'Garbanzos'] };
  const choices = new Map([['lunes:comida', 9]]);
  const r = visibleMeals(dia, COMIDAS_5, choices, 'lunes');
  assert.equal(r[0].elegida, 0);
  assert.equal(r[0].text, 'Lentejas');
});

test("visibleMeals: índice negativo en choicesMap → cae a 0 (clamp)", () => {
  const dia = { comida: ['Lentejas', 'Garbanzos'] };
  const choices = new Map([['lunes:comida', -1]]);
  const r = visibleMeals(dia, COMIDAS_5, choices, 'lunes');
  assert.equal(r[0].elegida, 0);
  assert.equal(r[0].text, 'Lentejas');
});

// ------------------------------ detectPlatform -----------------------------

test("detectPlatform: iPhone UA → 'ios'", () => {
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
  assert.equal(detectPlatform({ ua, maxTouchPoints: 5 }), 'ios');
});

test("detectPlatform: iPad UA → 'ios'", () => {
  const ua = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)';
  assert.equal(detectPlatform({ ua, maxTouchPoints: 5 }), 'ios');
});

test("detectPlatform: iPadOS 13+ se anuncia como Macintosh con touch → 'ios'", () => {
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
  assert.equal(detectPlatform({ ua, maxTouchPoints: 5 }), 'ios');
});

test("detectPlatform: Mac sin touch points → 'other' (no confundir con iPad)", () => {
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
  assert.equal(detectPlatform({ ua, maxTouchPoints: 0 }), 'other');
});

test("detectPlatform: Android UA → 'android'", () => {
  const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36';
  assert.equal(detectPlatform({ ua, maxTouchPoints: 5 }), 'android');
});

test("detectPlatform: escritorio Windows → 'other'", () => {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120';
  assert.equal(detectPlatform({ ua, maxTouchPoints: 0 }), 'other');
});

test("detectPlatform: sin args / ua vacío → 'other'", () => {
  assert.equal(detectPlatform(), 'other');
  assert.equal(detectPlatform({}), 'other');
  assert.equal(detectPlatform({ ua: '' }), 'other');
});

// --------------------------- detectInAppBrowser ----------------------------

test("detectInAppBrowser: Instagram UA", () => {
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Instagram 300.0.0.22.111';
  assert.equal(detectInAppBrowser(ua), 'instagram');
});

test("detectInAppBrowser: Facebook (FBAN/FBAV)", () => {
  assert.equal(detectInAppBrowser('Mozilla/5.0 (iPhone) FBAN/FBIOS;FBAV/450.0'), 'facebook');
  assert.equal(detectInAppBrowser('Mozilla/5.0 FB_IAB/FB4A'), 'facebook');
});

test("detectInAppBrowser: TikTok UA (musical_ly / Bytedance)", () => {
  assert.equal(detectInAppBrowser('Mozilla/5.0 musical_ly_31.1.0 JsSdk/2.0'), 'tiktok');
  assert.equal(detectInAppBrowser('Mozilla/5.0 BytedanceWebview/1.0'), 'tiktok');
});

test("detectInAppBrowser: LinkedIn, Snapchat, Line", () => {
  assert.equal(detectInAppBrowser('Mozilla/5.0 LinkedInApp'), 'linkedin');
  assert.equal(detectInAppBrowser('Mozilla/5.0 Snapchat/12'), 'snapchat');
  assert.equal(detectInAppBrowser('Mozilla/5.0 Line/13.0.0'), 'line');
});

test("detectInAppBrowser: WebView Android genérica ('; wv)')", () => {
  const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36';
  assert.equal(detectInAppBrowser(ua), 'webview');
});

test("detectInAppBrowser: Safari/Chrome normal → null (no es embebido)", () => {
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile Safari';
  const chrome = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari';
  assert.equal(detectInAppBrowser(safari), null);
  assert.equal(detectInAppBrowser(chrome), null);
});

test("detectInAppBrowser: ua vacío o null → null", () => {
  assert.equal(detectInAppBrowser(''), null);
  assert.equal(detectInAppBrowser(null), null);
  assert.equal(detectInAppBrowser(undefined), null);
});

// ---------------------------- nombreAppEmbebida ----------------------------

test("nombreAppEmbebida: mapea kinds conocidos a label humano", () => {
  assert.equal(nombreAppEmbebida('instagram'), 'Instagram');
  assert.equal(nombreAppEmbebida('facebook'), 'Facebook');
  assert.equal(nombreAppEmbebida('tiktok'), 'TikTok');
  assert.equal(nombreAppEmbebida('linkedin'), 'LinkedIn');
  assert.equal(nombreAppEmbebida('snapchat'), 'Snapchat');
  assert.equal(nombreAppEmbebida('line'), 'Line');
  assert.equal(nombreAppEmbebida('webview'), 'una app');
});

test("nombreAppEmbebida: kind desconocido → 'una app' (fallback)", () => {
  assert.equal(nombreAppEmbebida('marcianos'), 'una app');
  assert.equal(nombreAppEmbebida(null), 'una app');
  assert.equal(nombreAppEmbebida(undefined), 'una app');
});

// --------------------------- esErrorTransitorio ----------------------------

test("esErrorTransitorio: TypeError ('Failed to fetch') → true", () => {
  assert.equal(esErrorTransitorio(new TypeError('Failed to fetch')), true);
  assert.equal(esErrorTransitorio(new TypeError('Load failed')), true);
});

test("esErrorTransitorio: status 500/502/503/504 → true", () => {
  assert.equal(esErrorTransitorio({ status: 500 }), true);
  assert.equal(esErrorTransitorio({ status: 502 }), true);
  assert.equal(esErrorTransitorio({ status: 503 }), true);
  assert.equal(esErrorTransitorio({ status: 504 }), true);
});

test("esErrorTransitorio: status 4xx (auth, payload) → false (NO reintentar)", () => {
  assert.equal(esErrorTransitorio({ status: 400 }), false);
  assert.equal(esErrorTransitorio({ status: 401 }), false);
  assert.equal(esErrorTransitorio({ status: 403 }), false);
  assert.equal(esErrorTransitorio({ status: 404 }), false);
  assert.equal(esErrorTransitorio({ status: 429 }), false);
});

test("esErrorTransitorio: Supabase error shape con context.status", () => {
  const err5xx = { context: { status: 503 } };
  const err4xx = { context: { status: 401 } };
  assert.equal(esErrorTransitorio(err5xx), true);
  assert.equal(esErrorTransitorio(err4xx), false);
});

test("esErrorTransitorio: error sin status con mensaje de red → true", () => {
  assert.equal(esErrorTransitorio(new Error('network timeout')), true);
  assert.equal(esErrorTransitorio(new Error('Failed to fetch')), true);
  assert.equal(esErrorTransitorio(new Error('Load failed')), true);
  assert.equal(esErrorTransitorio({ message: 'fetch aborted' }), true);
});

test("esErrorTransitorio: Error genérico sin rastro de red → false", () => {
  assert.equal(esErrorTransitorio(new Error('boom')), false);
  assert.equal(esErrorTransitorio({ message: 'algo raro' }), false);
});

test("esErrorTransitorio: null / undefined → false (no hay nada que reintentar)", () => {
  assert.equal(esErrorTransitorio(null), false);
  assert.equal(esErrorTransitorio(undefined), false);
});

// ------------------------------- primerNombre ------------------------------

test("primerNombre: NOMBRE EN MAYÚSCULAS → Title Case del primer nombre", () => {
  assert.equal(primerNombre('ANA MARIA LOPEZ'), 'Ana');
  assert.equal(primerNombre('MARIA'), 'Maria');
});

test("primerNombre: ya en Title Case → se conserva (solo capitaliza la inicial)", () => {
  assert.equal(primerNombre('Ana Lopez'), 'Ana');
});

test("primerNombre: espacios al principio, múltiples nombres → primer token", () => {
  assert.equal(primerNombre('  ANA MARIA '), 'Ana');
  assert.equal(primerNombre('Ana   Maria  Lopez'), 'Ana');
});

test("primerNombre: vacío / null / undefined → ''", () => {
  assert.equal(primerNombre(''), '');
  assert.equal(primerNombre(null), '');
  assert.equal(primerNombre(undefined), '');
});

test("primerNombre: solo espacios → ''", () => {
  assert.equal(primerNombre('   '), '');
});

// ------------------------------- saludoPorHora -----------------------------

test("saludoPorHora: 6-12h → 'Buenos días'", () => {
  assert.equal(saludoPorHora(6), 'Buenos días');
  assert.equal(saludoPorHora(9), 'Buenos días');
  assert.equal(saludoPorHora(11), 'Buenos días');
});

test("saludoPorHora: 12-21h → 'Buenas tardes'", () => {
  assert.equal(saludoPorHora(12), 'Buenas tardes');
  assert.equal(saludoPorHora(15), 'Buenas tardes');
  assert.equal(saludoPorHora(20), 'Buenas tardes');
});

test("saludoPorHora: 21-6h → 'Buenas noches'", () => {
  assert.equal(saludoPorHora(21), 'Buenas noches');
  assert.equal(saludoPorHora(23), 'Buenas noches');
  assert.equal(saludoPorHora(0), 'Buenas noches');
  assert.equal(saludoPorHora(3), 'Buenas noches');
  assert.equal(saludoPorHora(5), 'Buenas noches');
});

test("saludoPorHora: hora inválida (NaN, null, undefined) → 'Hola' (fallback neutro)", () => {
  assert.equal(saludoPorHora(NaN), 'Hola');
  assert.equal(saludoPorHora(null), 'Hola');
  assert.equal(saludoPorHora(undefined), 'Hola');
});

// -------------------------- primerNombreDesdeEmail -------------------------

test("primerNombreDesdeEmail: prefijo simple → Title Case", () => {
  assert.equal(primerNombreDesdeEmail('ana@example.com'), 'Ana');
  assert.equal(primerNombreDesdeEmail('MARIA@example.com'), 'Maria');
});

test("primerNombreDesdeEmail: separadores '.', '_', '-', '+' → solo primer token", () => {
  assert.equal(primerNombreDesdeEmail('maria.garcia@example.com'), 'Maria');
  assert.equal(primerNombreDesdeEmail('maria_garcia@example.com'), 'Maria');
  assert.equal(primerNombreDesdeEmail('maria-garcia@example.com'), 'Maria');
  assert.equal(primerNombreDesdeEmail('maria+promos@example.com'), 'Maria');
});

test("primerNombreDesdeEmail: email vacío / null / undefined → 'de nuevo'", () => {
  assert.equal(primerNombreDesdeEmail(''), 'de nuevo');
  assert.equal(primerNombreDesdeEmail(null), 'de nuevo');
  assert.equal(primerNombreDesdeEmail(undefined), 'de nuevo');
});

test("primerNombreDesdeEmail: prefijo vacío ('@gmail.com' o '.@...') → 'de nuevo'", () => {
  assert.equal(primerNombreDesdeEmail('@gmail.com'), 'de nuevo');
  assert.equal(primerNombreDesdeEmail('.maria@gmail.com'), 'de nuevo');
});

// ------------------------------- slugifyItem -------------------------------

test("slugifyItem: categoría+texto con acentos → slug sin diacríticos", () => {
  assert.equal(slugifyItem('LÁCTEOS', 'Yogur natural'), 'lacteos-yogur-natural');
  assert.equal(slugifyItem('CARNES', 'Pollo al ajillo'), 'carnes-pollo-al-ajillo');
});

test("slugifyItem: quita caracteres no alfanuméricos", () => {
  assert.equal(slugifyItem('Frutas', 'Manzana (Fuji)'), 'frutas-manzana-fuji');
  assert.equal(slugifyItem('Varios', 'Aceite / vinagre'), 'varios-aceite-vinagre');
});

test("slugifyItem: mismos inputs → misma key (estable)", () => {
  const a = slugifyItem('FRUTAS', 'Plátano');
  const b = slugifyItem('FRUTAS', 'Plátano');
  assert.equal(a, b);
});

test("slugifyItem: inputs distintos → keys distintas (sin colisiones obvias)", () => {
  assert.notEqual(
    slugifyItem('FRUTAS', 'Manzana'),
    slugifyItem('VERDURAS', 'Manzana')
  );
});

test("slugifyItem: texto editado → pierde el check (aceptado, sin historial)", () => {
  // Documenta la decisión: si Cristina cambia el texto, la key cambia.
  assert.notEqual(
    slugifyItem('FRUTAS', 'Manzana'),
    slugifyItem('FRUTAS', 'Manzana Fuji')
  );
});

// ----------------------------- compraStorageKey ----------------------------

test("compraStorageKey: menu con id → 'ms-compra-<id>'", () => {
  assert.equal(compraStorageKey({ id: 'abc-123' }), 'ms-compra-abc-123');
});

test("compraStorageKey: menu sin id o null → null (no persiste)", () => {
  assert.equal(compraStorageKey(null), null);
  assert.equal(compraStorageKey(undefined), null);
  assert.equal(compraStorageKey({}), null);
  assert.equal(compraStorageKey({ id: '' }), null);
});

test("compraStorageKey: ids distintos → keys distintas (cada menú su lista)", () => {
  assert.notEqual(compraStorageKey({ id: 'uno' }), compraStorageKey({ id: 'dos' }));
});

// ----------------------------- totalItemsCompra ----------------------------

test("totalItemsCompra: suma items de todas las claves del JSON", () => {
  const lista = {
    'Carne': ['Pollo', 'Merluza'],
    'Fruta y verdura': ['Manzana', 'Pera', 'Kiwi']
  };
  assert.equal(totalItemsCompra(lista), 5);
});

test("totalItemsCompra: cuenta cualquier clave del JSON (sin lista cerrada)", () => {
  const lista = {
    'Fruta y verdura': ['Manzana'],
    'Categoría inventada': ['x', 'y', 'z']
  };
  assert.equal(totalItemsCompra(lista), 4);
});

test("totalItemsCompra: categoría no-array → ignorada (sin crash)", () => {
  const lista = {
    'Fruta y verdura': ['Manzana'],
    'Carne': null,
    'Marisco y pescado': 'string raro'
  };
  assert.equal(totalItemsCompra(lista), 1);
});

test("totalItemsCompra: lista vacía → 0", () => {
  assert.equal(totalItemsCompra({}), 0);
});

test("totalItemsCompra: lista null/undefined → 0 (no revienta)", () => {
  assert.equal(totalItemsCompra(null), 0);
  assert.equal(totalItemsCompra(undefined), 0);
});

// -------------------------------- displayCat ------------------------------

test("displayCat: categoría toda en MAYÚSCULAS → sentence-case (compat menús viejos)", () => {
  assert.equal(displayCat('CARNES Y PESCADOS'), 'Carnes y pescados');
  assert.equal(displayCat('FRUTAS'), 'Frutas');
  assert.equal(displayCat('FRUTOS SECOS Y VARIOS'), 'Frutos secos y varios');
});

test("displayCat: categoría en Title Case → tal cual (taxonomía nueva)", () => {
  assert.equal(displayCat('Fruta y verdura'), 'Fruta y verdura');
  assert.equal(displayCat('Marisco y pescado'), 'Marisco y pescado');
  assert.equal(displayCat('Aceite, especias y salsas'), 'Aceite, especias y salsas');
});

test("displayCat: vacío / no-string → ''", () => {
  assert.equal(displayCat(''), '');
  assert.equal(displayCat(null), '');
  assert.equal(displayCat(undefined), '');
  assert.equal(displayCat(42), '');
});

// ------------------------- normalizeEmail / validateLoginForm --------------

test("normalizeEmail: trim + lowercase", () => {
  assert.equal(normalizeEmail("  Maria@Example.com  "), "maria@example.com");
  assert.equal(normalizeEmail("ANA@X.com"), "ana@x.com");
});

test("normalizeEmail: null / undefined / vacío → ''", () => {
  assert.equal(normalizeEmail(null), "");
  assert.equal(normalizeEmail(undefined), "");
  assert.equal(normalizeEmail(""), "");
});

test("validateLoginForm: email válido + consent → ok", () => {
  const r = validateLoginForm({ email: "Maria@Example.com", consent: true });
  assert.deepEqual(r, { ok: true, email: "maria@example.com" });
});

test("validateLoginForm: email vacío → error 'empty'", () => {
  assert.deepEqual(validateLoginForm({ email: "", consent: true }), { ok: false, error: "empty" });
  assert.deepEqual(validateLoginForm({ email: "   ", consent: true }), { ok: false, error: "empty" });
  assert.deepEqual(validateLoginForm({ consent: true }), { ok: false, error: "empty" });
});

test("validateLoginForm: email sin arroba o sin dominio → error 'invalid'", () => {
  assert.deepEqual(validateLoginForm({ email: "no-arroba", consent: true }), { ok: false, error: "invalid" });
  assert.deepEqual(validateLoginForm({ email: "maria@", consent: true }), { ok: false, error: "invalid" });
  assert.deepEqual(validateLoginForm({ email: "maria@nada", consent: true }), { ok: false, error: "invalid" });
});

test("validateLoginForm: consent en false → error 'no-consent' (aunque el email esté OK)", () => {
  assert.deepEqual(
    validateLoginForm({ email: "maria@example.com", consent: false }),
    { ok: false, error: "no-consent" }
  );
});

// ------------------------------- validateOtpCode --------------------------

test("validateOtpCode: 6 dígitos → ok con código trimeado", () => {
  assert.deepEqual(validateOtpCode("123456"), { ok: true, code: "123456" });
  assert.deepEqual(validateOtpCode(" 654321 "), { ok: true, code: "654321" });
});

test("validateOtpCode: menos de 6 dígitos, más, letras o vacío → error", () => {
  assert.deepEqual(validateOtpCode("12345"), { ok: false, error: "invalid" });
  assert.deepEqual(validateOtpCode("1234567"), { ok: false, error: "invalid" });
  assert.deepEqual(validateOtpCode("12345a"), { ok: false, error: "invalid" });
  assert.deepEqual(validateOtpCode(""), { ok: false, error: "invalid" });
  assert.deepEqual(validateOtpCode(null), { ok: false, error: "invalid" });
});

// ------------------------------- resolveInitialLogin ---------------------

test("resolveInitialLogin: query coincide con last → 'welcome-back'", () => {
  assert.deepEqual(
    resolveInitialLogin({ queryEmail: "maria@x.com", lastEmail: "Maria@X.com" }),
    { email: "maria@x.com", mode: "welcome-back" }
  );
});

test("resolveInitialLogin: query sin last → 'query' con prefill", () => {
  assert.deepEqual(
    resolveInitialLogin({ queryEmail: "NEW@x.com" }),
    { email: "new@x.com", mode: "query" }
  );
});

test("resolveInitialLogin: query distinta al last → 'query' (prefill, sin saludo)", () => {
  assert.deepEqual(
    resolveInitialLogin({ queryEmail: "otra@x.com", lastEmail: "maria@x.com" }),
    { email: "otra@x.com", mode: "query" }
  );
});

test("resolveInitialLogin: solo lastEmail → 'welcome-back'", () => {
  assert.deepEqual(
    resolveInitialLogin({ lastEmail: "maria@x.com" }),
    { email: "maria@x.com", mode: "welcome-back" }
  );
});

test("resolveInitialLogin: sin query ni last → 'fresh'", () => {
  assert.deepEqual(resolveInitialLogin({}), { email: "", mode: "fresh" });
  assert.deepEqual(resolveInitialLogin(), { email: "", mode: "fresh" });
});

// ------------------------------- shouldShowInstallHint --------------------

test("shouldShowInstallHint: standalone → 'none' (ya instalada)", () => {
  assert.deepEqual(shouldShowInstallHint({ standalone: true, platform: "ios" }), { kind: "none" });
});

test("shouldShowInstallHint: tutorialSeen → 'none' (no acosar)", () => {
  assert.deepEqual(shouldShowInstallHint({ tutorialSeen: true, platform: "ios" }), { kind: "none" });
});

test("shouldShowInstallHint: dentro de Instagram → 'inapp' (prioritario sobre install)", () => {
  const r = shouldShowInstallHint({ inAppBrowser: "instagram", platform: "ios" });
  assert.deepEqual(r, { kind: "inapp", inApp: "instagram" });
});

test("shouldShowInstallHint: iOS Safari no instalado → 'install' con plat='ios'", () => {
  assert.deepEqual(shouldShowInstallHint({ platform: "ios" }), { kind: "install", plat: "ios" });
});

test("shouldShowInstallHint: Android Chrome no instalado → 'install' con plat='android'", () => {
  assert.deepEqual(shouldShowInstallHint({ platform: "android" }), { kind: "install", plat: "android" });
});

test("shouldShowInstallHint: escritorio → 'none' (no invitar a instalar)", () => {
  assert.deepEqual(shouldShowInstallHint({ platform: "other" }), { kind: "none" });
});

// ---------------------------- shouldRehydrateOnVisibility -----------------

test("shouldRehydrateOnVisibility: no visible → 'ignore'", () => {
  assert.equal(
    shouldRehydrateOnVisibility({ visibilityState: "hidden", hasSession: true, authedVisible: true, hasPaciente: true }),
    "ignore"
  );
});

test("shouldRehydrateOnVisibility: debounce (<2s desde último refresh) → 'ignore'", () => {
  const now = 10_000;
  assert.equal(
    shouldRehydrateOnVisibility({ visibilityState: "visible", now, lastRefreshAt: 9_500, hasSession: true, authedVisible: true, hasPaciente: true }),
    "ignore"
  );
});

test("shouldRehydrateOnVisibility: sin sesión → 'go-login'", () => {
  assert.equal(
    shouldRehydrateOnVisibility({ visibilityState: "visible", now: 10_000, lastRefreshAt: 0, hasSession: false }),
    "go-login"
  );
});

test("shouldRehydrateOnVisibility: sesión OK + vista autenticada + paciente → 'rehydrate'", () => {
  assert.equal(
    shouldRehydrateOnVisibility({ visibilityState: "visible", now: 10_000, lastRefreshAt: 0, hasSession: true, authedVisible: true, hasPaciente: true }),
    "rehydrate"
  );
});

test("shouldRehydrateOnVisibility: sesión OK pero no estamos en la vista authed → 'noop'", () => {
  assert.equal(
    shouldRehydrateOnVisibility({ visibilityState: "visible", now: 10_000, lastRefreshAt: 0, hasSession: true, authedVisible: false, hasPaciente: true }),
    "noop"
  );
});

// ---------------------------- resolveInitialView -------------------------
// Decide qué vista mostrar al hidratar (boot o re-hidratación tras desbloqueo
// del móvil). El hash en la URL persiste la vista activa, así la PWA "recuerda"
// dónde estaba la paciente cuando la pantalla del móvil se bloquea/desbloquea
// o cuando iOS/Android matan la pestaña en background.

test("resolveInitialView: hash vacío → 'today' (vista por defecto)", () => {
  assert.equal(resolveInitialView({ hash: "", isLocked: false }), "today");
  assert.equal(resolveInitialView({ hash: null, isLocked: false }), "today");
  assert.equal(resolveInitialView({ hash: undefined, isLocked: false }), "today");
});

test("resolveInitialView: hash '#compra' → 'compra' (paciente estaba en la lista)", () => {
  assert.equal(resolveInitialView({ hash: "#compra", isLocked: false }), "compra");
});

test("resolveInitialView: hash sin '#' inicial también vale (tolerante)", () => {
  // Algunos entornos devuelven el hash sin el '#'; aceptamos ambos.
  assert.equal(resolveInitialView({ hash: "compra", isLocked: false }), "compra");
});

test("resolveInitialView: hash desconocido → 'today' (no abrimos vista que no existe)", () => {
  assert.equal(resolveInitialView({ hash: "#dia=2026-05-04", isLocked: false }), "today");
  assert.equal(resolveInitialView({ hash: "#cualquier-cosa", isLocked: false }), "today");
});

test("resolveInitialView: isLocked=true ignora el hash y fuerza 'today'", () => {
  // Sin menú vigente la vista compra está oculta; no podemos restaurarla
  // aunque el hash diga lo contrario.
  assert.equal(resolveInitialView({ hash: "#compra", isLocked: true }), "today");
});

test("resolveInitialView: hash vacío + lastView='compra' → 'compra' (fallback localStorage)", () => {
  // iOS PWA: tras kill+relaunch el hash se pierde porque arranca desde el
  // start_url del manifest. localStorage es el cinturón de seguridad.
  assert.equal(resolveInitialView({ hash: "", lastView: "compra", isLocked: false }), "compra");
});

test("resolveInitialView: hash gana sobre lastView (más reciente)", () => {
  // Si el usuario está navegando, location.hash refleja la intención actual;
  // localStorage puede ser más antiguo. El hash manda.
  assert.equal(resolveInitialView({ hash: "#compra", lastView: "today", isLocked: false }), "compra");
});

test("resolveInitialView: lastView desconocido o ausente → 'today'", () => {
  assert.equal(resolveInitialView({ hash: "", lastView: "today", isLocked: false }), "today");
  assert.equal(resolveInitialView({ hash: "", lastView: null, isLocked: false }), "today");
});

test("resolveInitialView: lastView='compra' pero isLocked=true → 'today' (gate sigue mandando)", () => {
  assert.equal(resolveInitialView({ hash: "", lastView: "compra", isLocked: true }), "today");
});

// ---------------------------- shouldCelebrarMilestone --------------------

test("shouldCelebrarMilestone: onboarding aún no visto → null (no apilar modales)", () => {
  assert.equal(shouldCelebrarMilestone({ racha: 30, vistos: [], onboarding: false }), null);
});

test("shouldCelebrarMilestone: onboarding visto + racha cruza hito → devuelve el hito", () => {
  assert.equal(shouldCelebrarMilestone({ racha: 7, vistos: [], onboarding: true }), 7);
  assert.equal(shouldCelebrarMilestone({ racha: 30, vistos: [7, 14], onboarding: true }), 30);
});

test("shouldCelebrarMilestone: onboarding visto pero racha no cruza ningún hito → null", () => {
  assert.equal(shouldCelebrarMilestone({ racha: 6, vistos: [], onboarding: true }), null);
});

test("shouldCelebrarMilestone: racha no es número → null", () => {
  assert.equal(shouldCelebrarMilestone({ racha: null, vistos: [], onboarding: true }), null);
  assert.equal(shouldCelebrarMilestone({ onboarding: true }), null);
});

// ---------------------------- computeDayView -----------------------------

const COMIDAS_CFG = [
  ['desayuno', 'Desayuno'],
  ['almuerzo', 'Almuerzo'],
  ['comida',   'Comida'],
  ['merienda', 'Merienda'],
  ['cena',     'Cena'],
];

const MENU_VIGENTE = {
  id: 'm1',
  contenido: {
    dias: {
      lunes:     { desayuno: 'D-L', almuerzo: 'A-L', comida: 'C-L', merienda: 'M-L', cena: 'N-L' },
      martes:    { desayuno: 'D-M', almuerzo: '',    comida: 'C-M', merienda: 'M-M', cena: 'N-M' },
      miercoles: { desayuno: 'D-X', almuerzo: 'A-X', comida: 'C-X', merienda: 'M-X', cena: 'N-X' },
      jueves:    { desayuno: 'D-J', almuerzo: 'A-J', comida: 'C-J', merienda: 'M-J', cena: 'N-J' },
      viernes:   { desayuno: 'D-V', almuerzo: 'A-V', comida: 'C-V', merienda: 'M-V', cena: 'N-V' },
      sabado:    { desayuno: 'D-S', almuerzo: 'A-S', comida: 'C-S', merienda: 'M-S', cena: 'N-S' },
      domingo:   { desayuno: 'D-D', almuerzo: 'A-D', comida: 'C-D', merienda: 'M-D', cena: 'N-D' }
    }
  }
};

test("WEEKDAY_KEYS_JSON expone las claves canónicas del JSON del menú", () => {
  assert.deepEqual(
    WEEKDAY_KEYS_JSON,
    ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
  );
});

test("computeDayView: día pasado con checkin 'seguido' → status marked con copy de «Lo seguí»", () => {
  const now = new Date(2026, 3, 17); // viernes 17 abr 2026
  const map = new Map([["2026-04-15", "seguido"]]); // miércoles
  const r = computeDayView({ iso: "2026-04-15", menu: MENU_VIGENTE, checkinsMap: map, now, comidas: COMIDAS_CFG });
  assert.equal(r.weekday, "miercoles");
  assert.equal(r.status.kind, "marked");
  assert.equal(r.status.cls, "is-ok");
  assert.equal(r.status.label, "«Lo seguí»");
  assert.match(r.status.msg, /cuidándote/);
  assert.equal(r.meals.length, 5);
  assert.equal(r.meals[0].text, "D-X");
});

test("computeDayView: día pasado con checkin 'parcial' → «A medias» con msg motivador", () => {
  const now = new Date(2026, 3, 17);
  const map = new Map([["2026-04-15", "parcial"]]);
  const r = computeDayView({ iso: "2026-04-15", menu: MENU_VIGENTE, checkinsMap: map, now, comidas: COMIDAS_CFG });
  assert.equal(r.status.label, "«A medias»");
  assert.equal(r.status.cls, "is-mid");
});

test("computeDayView: día pasado con checkin 'no' → «Hoy no» con msg suave", () => {
  const now = new Date(2026, 3, 17);
  const map = new Map([["2026-04-15", "no"]]);
  const r = computeDayView({ iso: "2026-04-15", menu: MENU_VIGENTE, checkinsMap: map, now, comidas: COMIDAS_CFG });
  assert.equal(r.status.label, "«Hoy no»");
  assert.equal(r.status.cls, "is-no");
});

test("computeDayView: día pasado sin marcar → unmarked con copy 'este día no lo marcaste'", () => {
  const now = new Date(2026, 3, 17);
  const r = computeDayView({ iso: "2026-04-10", menu: MENU_VIGENTE, checkinsMap: new Map(), now, comidas: COMIDAS_CFG });
  assert.equal(r.status.kind, "unmarked");
  assert.match(r.status.msg, /no lo marcaste/);
});

test("computeDayView: día hoy sin marcar → unmarked con copy 'aún no has marcado hoy'", () => {
  const now = new Date(2026, 3, 17);
  const r = computeDayView({ iso: "2026-04-17", menu: MENU_VIGENTE, checkinsMap: new Map(), now, comidas: COMIDAS_CFG });
  assert.equal(r.status.kind, "unmarked");
  assert.match(r.status.msg, /Aún no has marcado hoy/);
});

test("computeDayView: día futuro → unmarked con copy 'aún está por llegar'", () => {
  const now = new Date(2026, 3, 17);
  const r = computeDayView({ iso: "2026-04-25", menu: MENU_VIGENTE, checkinsMap: new Map(), now, comidas: COMIDAS_CFG });
  assert.equal(r.status.kind, "unmarked");
  assert.match(r.status.msg, /por llegar/);
});

test("computeDayView: slot vacío en el menú → visibleMeals filtra (pacientes con 4 tomas)", () => {
  const now = new Date(2026, 3, 17);
  const r = computeDayView({ iso: "2026-04-14", menu: MENU_VIGENTE, checkinsMap: new Map(), now, comidas: COMIDAS_CFG });
  // Martes tiene almuerzo: '' → se filtra.
  assert.equal(r.weekday, "martes");
  assert.equal(r.meals.length, 4);
  assert.ok(r.meals.every(m => m.key !== "almuerzo"));
});

test("computeDayView: menu null → meals vacío, status según checkin", () => {
  const now = new Date(2026, 3, 17);
  const map = new Map([["2026-04-15", "seguido"]]);
  const r = computeDayView({ iso: "2026-04-15", menu: null, checkinsMap: map, now, comidas: COMIDAS_CFG });
  assert.deepEqual(r.meals, []);
  assert.equal(r.status.kind, "marked");
});

test("computeDayView: choicesMap → meals.text refleja la opción elegida", () => {
  const iso = "2026-04-15";
  const wd = WEEKDAY_KEYS_JSON[new Date(2026, 3, 15).getDay()];
  const menu = { id: 'm1', contenido: { dias: { [wd]: { comida: ['Lentejas', 'Garbanzos', 'Macarrones'] } } } };
  const r = computeDayView({
    iso, menu, checkinsMap: new Map(), now: new Date(2026, 3, 17),
    comidas: [['comida', 'Comida']],
    choicesMap: new Map([[wd + ':comida', 1]])
  });
  assert.equal(r.meals[0].text, 'Garbanzos');
  assert.equal(r.meals[0].elegida, 1);
});

// ---------------------------- computeTodayView ---------------------------

test("computeTodayView: viernes con menú → devuelve 5 comidas del viernes + activeCheck='seguido'", () => {
  const now = new Date(2026, 3, 17, 10, 0); // viernes
  const map = new Map([["2026-04-17", "seguido"]]);
  const r = computeTodayView({ menu: MENU_VIGENTE, checkinsMap: map, now, comidas: COMIDAS_CFG });
  assert.equal(r.weekday, "viernes");
  assert.equal(r.todayISO, "2026-04-17");
  assert.equal(r.activeCheck, "seguido");
  assert.equal(r.meals.length, 5);
  assert.equal(r.meals[2].text, "C-V");
});

test("computeTodayView: martes con almuerzo vacío → 4 comidas", () => {
  const now = new Date(2026, 3, 14, 10, 0); // martes
  const r = computeTodayView({ menu: MENU_VIGENTE, checkinsMap: new Map(), now, comidas: COMIDAS_CFG });
  assert.equal(r.weekday, "martes");
  assert.equal(r.meals.length, 4);
  assert.equal(r.activeCheck, null);
});

test("computeTodayView: menu null → meals vacío", () => {
  const now = new Date(2026, 3, 17, 10, 0);
  const r = computeTodayView({ menu: null, checkinsMap: new Map(), now, comidas: COMIDAS_CFG });
  assert.deepEqual(r.meals, []);
  assert.equal(r.activeCheck, null);
});

// ---------------------------- buildCompraModel ---------------------------

const MENU_COMPRA = {
  id: 'm1',
  contenido: {
    lista_compra: {
      'Fruta y verdura': ['Manzana', 'Pera'],
      'Carne': ['Pollo'],
      'Marisco y pescado': []  // vacía → se filtra
    }
  }
};

test("buildCompraModel: lista vacía → empty:true", () => {
  const r = buildCompraModel({ menu: { id: 'x', contenido: { lista_compra: {} } }, estadoSet: new Set() });
  assert.equal(r.empty, true);
  assert.equal(r.total, 0);
  assert.equal(r.cats.length, 0);
});

test("buildCompraModel: filtra categorías sin items y respeta orden del JSON", () => {
  const r = buildCompraModel({ menu: MENU_COMPRA, estadoSet: new Set() });
  assert.equal(r.empty, false);
  assert.equal(r.total, 3);
  assert.equal(r.cats.length, 2);
  assert.equal(r.cats[0].cat, 'Fruta y verdura'); // primero en el JSON
  assert.equal(r.cats[1].cat, 'Carne');
});

test("buildCompraModel: convive con menús viejos (claves MAYÚSCULAS)", () => {
  const menuViejo = {
    id: 'mv',
    contenido: { lista_compra: { 'CARNES Y PESCADOS': ['Pollo'], 'FRUTAS': ['Pera'] } }
  };
  const r = buildCompraModel({ menu: menuViejo, estadoSet: new Set() });
  assert.equal(r.empty, false);
  assert.equal(r.cats.length, 2);
  assert.equal(r.cats[0].cat, 'CARNES Y PESCADOS');
  assert.equal(r.cats[1].cat, 'FRUTAS');
});

test("buildCompraModel: marca 'done' en items presentes en estadoSet", () => {
  const set = new Set([slugifyItem('Fruta y verdura', 'Manzana')]);
  const r = buildCompraModel({ menu: MENU_COMPRA, estadoSet: set });
  const fruta = r.cats.find(c => c.cat === 'Fruta y verdura');
  assert.equal(fruta.items[0].done, true);
  assert.equal(fruta.items[1].done, false);
  assert.equal(fruta.comprados, 1);
  assert.equal(fruta.total, 2);
  assert.equal(r.hechos, 1);
});

test("buildCompraModel: cada item tiene key estable (slugify)", () => {
  const r = buildCompraModel({ menu: MENU_COMPRA, estadoSet: new Set() });
  const fruta = r.cats.find(c => c.cat === 'Fruta y verdura');
  assert.equal(fruta.items[0].key, slugifyItem('Fruta y verdura', 'Manzana'));
});

test("buildCompraModel: estadoSet puede venir como array (convertible)", () => {
  const r = buildCompraModel({ menu: MENU_COMPRA, estadoSet: [slugifyItem('Fruta y verdura', 'Pera')] });
  const fruta = r.cats.find(c => c.cat === 'Fruta y verdura');
  assert.equal(fruta.items.find(i => i.text === 'Pera').done, true);
});

// ---------------------------- computeCompraMeta --------------------------

test("computeCompraMeta: total=0 → mensaje 'Disponible con tu próximo menú' + actions hidden", () => {
  const r = computeCompraMeta({ total: 0, hechos: 0 });
  assert.equal(r.metaText, 'Disponible con tu próximo menú');
  assert.equal(r.progressDone, false);
  assert.equal(r.actionsHidden, true);
});

test("computeCompraMeta: total>0 y hechos=0 → copy 'Semanal · N productos' y actions hidden (nada que reiniciar)", () => {
  const r = computeCompraMeta({ total: 10, hechos: 0 });
  assert.equal(r.metaText, 'Semanal · 10 productos');
  assert.equal(r.actionsHidden, true);
  assert.equal(r.progressDone, false);
});

test("computeCompraMeta: progreso parcial → copy 'X/Y comprados' + actions visibles", () => {
  const r = computeCompraMeta({ total: 10, hechos: 3 });
  assert.equal(r.metaText, 'Semanal · 3/10 comprados');
  assert.equal(r.progressText, '3 de 10 comprados esta semana');
  assert.equal(r.progressDone, false);
  assert.equal(r.actionsHidden, false);
});

test("computeCompraMeta: hechos=total → copy 'completa' + progressDone=true", () => {
  const r = computeCompraMeta({ total: 5, hechos: 5 });
  assert.equal(r.metaText, 'Semanal · 5/5 comprados');
  assert.equal(r.progressText, '¡Compra de la semana completa! Buen trabajo.');
  assert.equal(r.progressDone, true);
  assert.equal(r.actionsHidden, false);
});

// ---------------------------- withCompraToggle ---------------------------

test("withCompraToggle: key nueva → la añade y devuelve done=true", () => {
  const r = withCompraToggle(new Set(), 'frutas-manzana');
  assert.equal(r.done, true);
  assert.ok(r.set.has('frutas-manzana'));
});

test("withCompraToggle: key ya presente → la quita y devuelve done=false", () => {
  const r = withCompraToggle(new Set(['frutas-manzana', 'frutas-pera']), 'frutas-manzana');
  assert.equal(r.done, false);
  assert.ok(!r.set.has('frutas-manzana'));
  assert.ok(r.set.has('frutas-pera'));
});

test("withCompraToggle: no muta el Set original (inmutable)", () => {
  const orig = new Set(['a']);
  const r = withCompraToggle(orig, 'b');
  assert.deepEqual([...orig], ['a']);
  assert.deepEqual([...r.set].sort(), ['a', 'b']);
});

test("withCompraToggle: key vacía / null → devuelve set igual y done=false", () => {
  const r = withCompraToggle(new Set(['a']), '');
  assert.deepEqual([...r.set], ['a']);
  assert.equal(r.done, false);
});

// -------------------- applyCheckinOptimistic / revertCheckin --------------

test("applyCheckinOptimistic: no existía iso → prev=undefined, map tiene el estado nuevo", () => {
  const map = new Map();
  const prev = applyCheckinOptimistic(map, "2026-04-17", "seguido");
  assert.equal(prev, undefined);
  assert.equal(map.get("2026-04-17"), "seguido");
});

test("applyCheckinOptimistic: iso ya tenía estado → prev=estado previo, map pasa al nuevo", () => {
  const map = new Map([["2026-04-17", "parcial"]]);
  const prev = applyCheckinOptimistic(map, "2026-04-17", "seguido");
  assert.equal(prev, "parcial");
  assert.equal(map.get("2026-04-17"), "seguido");
});

test("revertCheckin: prev=undefined → borra la entrada del map", () => {
  const map = new Map([["2026-04-17", "seguido"]]);
  revertCheckin(map, "2026-04-17", undefined);
  assert.equal(map.has("2026-04-17"), false);
});

test("revertCheckin: prev definido → restaura el estado anterior", () => {
  const map = new Map([["2026-04-17", "seguido"]]);
  revertCheckin(map, "2026-04-17", "parcial");
  assert.equal(map.get("2026-04-17"), "parcial");
});

test("applyCheckinOptimistic + revertCheckin: ciclo completo deja el map como estaba", () => {
  const map = new Map([["2026-04-17", "parcial"]]);
  const prev = applyCheckinOptimistic(map, "2026-04-17", "seguido");
  revertCheckin(map, "2026-04-17", prev);
  assert.equal(map.get("2026-04-17"), "parcial");
});

test("applyCheckinOptimistic + revertCheckin sobre entrada nueva: revert la borra", () => {
  const map = new Map();
  const prev = applyCheckinOptimistic(map, "2026-04-17", "seguido");
  revertCheckin(map, "2026-04-17", prev);
  assert.equal(map.has("2026-04-17"), false);
});

// ---------------------------- buildRevisionCtaCopy ------------------------

test("buildRevisionCtaCopy: fuera de la ventana → hidden:true sin copy", () => {
  const now = new Date(2026, 4, 1, 10, 0);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 10, 14, 0) }; // lejana
  const r = buildRevisionCtaCopy({ proximaSesion: proxima, revisionEnviada: false, now });
  assert.equal(r.state, 'hidden');
  assert.equal(r.hidden, true);
});

test("buildRevisionCtaCopy: estado urgent → copy con fecha relativa + action 'Enviar revisión mensual'", () => {
  const now = new Date(2026, 4, 4, 10, 0);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 5, 14, 0) }; // mañana
  const r = buildRevisionCtaCopy({ proximaSesion: proxima, revisionEnviada: false, now });
  assert.equal(r.state, 'urgent');
  assert.equal(r.hidden, false);
  assert.match(r.msg, /mañana a las 14:00/);
  assert.equal(r.action.label, 'Enviar revisión mensual');
  assert.equal(r.action.href, '/mi-seguimiento/revision/');
});

test("buildRevisionCtaCopy: estado done → copy '✓ · nos vemos …' SIN botón", () => {
  const now = new Date(2026, 4, 4, 10, 0);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 5, 14, 0) };
  const r = buildRevisionCtaCopy({ proximaSesion: proxima, revisionEnviada: true, now });
  assert.equal(r.state, 'done');
  assert.match(r.msg, /Revisión enviada ✓/);
  assert.equal(r.action, null);
});

// ---------------------------- shouldMostrarRevisionModal -----------------

test("shouldMostrarRevisionModal: sin proximaSesion → show:false", () => {
  assert.deepEqual(shouldMostrarRevisionModal({ proximaSesion: null }), { show: false });
});

test("shouldMostrarRevisionModal: estado urgent + nunca visto → show:true con lsKey y body", () => {
  const now = new Date(2026, 4, 4, 10, 0);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 5, 14, 0) };
  const r = shouldMostrarRevisionModal({ proximaSesion: proxima, revisionEnviada: false, now, seenModalIds: [] });
  assert.equal(r.show, true);
  assert.equal(r.lsKey, 'rev-modal-shown:s1');
  assert.match(r.body, /Tenemos sesión mañana a las 14:00/);
});

test("shouldMostrarRevisionModal: ya visto esa sesión → show:false (one-shot)", () => {
  const now = new Date(2026, 4, 4, 10, 0);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 5, 14, 0) };
  const r = shouldMostrarRevisionModal({ proximaSesion: proxima, revisionEnviada: false, now, seenModalIds: ['s1'] });
  assert.equal(r.show, false);
});

test("shouldMostrarRevisionModal: estado done (ya enviada) → show:false", () => {
  const now = new Date(2026, 4, 4, 10, 0);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 5, 14, 0) };
  const r = shouldMostrarRevisionModal({ proximaSesion: proxima, revisionEnviada: true, now, seenModalIds: [] });
  assert.equal(r.show, false);
});

test("shouldMostrarRevisionModal: fuera de la ventana (hidden) → show:false", () => {
  const now = new Date(2026, 4, 1, 10, 0);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 10, 14, 0) };
  const r = shouldMostrarRevisionModal({ proximaSesion: proxima, revisionEnviada: false, now, seenModalIds: [] });
  assert.equal(r.show, false);
});

// ---------------------------- shouldMostrarMenuNuevoModal ----------------

test("shouldMostrarMenuNuevoModal: sin menu → show:false", () => {
  assert.deepEqual(shouldMostrarMenuNuevoModal({ menu: null }), { show: false });
});

test("shouldMostrarMenuNuevoModal: menú sin id → show:false", () => {
  assert.deepEqual(shouldMostrarMenuNuevoModal({ menu: { numero: 1 } }), { show: false });
});

test("shouldMostrarMenuNuevoModal: menú nuevo nunca visto → show:true con lsKey y numero", () => {
  const r = shouldMostrarMenuNuevoModal({ menu: { id: 'm1', numero: 2 }, seenMenuIds: [] });
  assert.equal(r.show, true);
  assert.equal(r.lsKey, 'menu-nuevo-shown:m1');
  assert.equal(r.numero, 2);
});

test("shouldMostrarMenuNuevoModal: menú ya visto en este device → show:false (one-shot)", () => {
  const r = shouldMostrarMenuNuevoModal({ menu: { id: 'm1', numero: 2 }, seenMenuIds: ['m1'] });
  assert.equal(r.show, false);
});

test("shouldMostrarMenuNuevoModal: revisión del mismo menú (id estable) no re-dispara", () => {
  // El UPSERT por (paciente_id, numero) preserva el id en revisiones.
  // Si el id ya está en seenMenuIds, no abre aunque cambie vigente_desde.
  const menu = { id: 'm1', numero: 2, vigente_desde: '2026-05-01' };
  const menuRevisado = { id: 'm1', numero: 2, vigente_desde: '2026-05-08' };
  assert.equal(shouldMostrarMenuNuevoModal({ menu, seenMenuIds: ['m1'] }).show, false);
  assert.equal(shouldMostrarMenuNuevoModal({ menu: menuRevisado, seenMenuIds: ['m1'] }).show, false);
});

test("shouldMostrarMenuNuevoModal: menú con numero distinto → show:true (id distinto)", () => {
  const r = shouldMostrarMenuNuevoModal({ menu: { id: 'm2', numero: 3 }, seenMenuIds: ['m1'] });
  assert.equal(r.show, true);
  assert.equal(r.lsKey, 'menu-nuevo-shown:m2');
});

// ------------------------------- hydrateDashboard ------------------------

// Driver mockeable que cuenta llamadas y devuelve datos configurables.
function makeSupaStub({ menu, checkins, proxima, revisionEnviada, onProxima }) {
  const calls = { loadMenuVigente: 0, loadCheckins: 0, loadProximaSesion: 0, loadRevisionEnviadaParaSesion: 0 };
  return {
    calls,
    async loadMenuVigente(today) { calls.loadMenuVigente++; this.lastToday = today; return menu; },
    async loadCheckins(from) { calls.loadCheckins++; this.lastFrom = from; return checkins || []; },
    async loadProximaSesion(pid) {
      calls.loadProximaSesion++;
      if (onProxima) return onProxima(pid);
      return proxima;
    },
    async loadRevisionEnviadaParaSesion(sid) { calls.loadRevisionEnviadaParaSesion++; return !!revisionEnviada; }
  };
}

test("hydrateDashboard: sin paciente → view:'sin-paciente' y no llama a supa", async () => {
  const supa = makeSupaStub({});
  const r = await hydrateDashboard({ supa, paciente: null, now: new Date(2026, 3, 17) });
  assert.equal(r.view, 'sin-paciente');
  assert.equal(supa.calls.loadMenuVigente, 0);
});

test("hydrateDashboard: paciente sin anamnesis_completed_at → view:'redirect-empezar' (y no llama a supa)", async () => {
  const supa = makeSupaStub({});
  const r = await hydrateDashboard({
    supa,
    paciente: { id: 'p1', anamnesis_completed_at: null },
    now: new Date(2026, 3, 17)
  });
  assert.equal(r.view, 'redirect-empezar');
  assert.equal(supa.calls.loadMenuVigente, 0);
  assert.equal(supa.calls.loadCheckins, 0);
});

test("hydrateDashboard: sin menú vigente → view:'locked', no llama a sesiones/revisiones, revisionCta hidden", async () => {
  const supa = makeSupaStub({ menu: null, checkins: [] });
  const r = await hydrateDashboard({
    supa,
    paciente: { id: 'p1', anamnesis_completed_at: '2026-03-01' },
    now: new Date(2026, 3, 17)
  });
  assert.equal(r.view, 'locked');
  assert.equal(r.menu, null);
  assert.equal(r.rota, false);
  assert.equal(r.revisionCta.state, 'hidden');
  assert.equal(supa.calls.loadProximaSesion, 0, 'no debe llamar a sesiones si no hay menú');
  assert.equal(supa.calls.loadRevisionEnviadaParaSesion, 0);
});

test("hydrateDashboard: menú + racha → view:'normal' con streak correcto y calendario mapeado", async () => {
  const checkins = [
    { fecha: '2026-04-16', estado: 'seguido' },
    { fecha: '2026-04-15', estado: 'seguido' },
    { fecha: '2026-04-14', estado: 'seguido' },
  ];
  const supa = makeSupaStub({ menu: MENU_VIGENTE, checkins, proxima: null });
  const r = await hydrateDashboard({
    supa,
    paciente: { id: 'p1', anamnesis_completed_at: '2026-03-01' },
    now: new Date(2026, 3, 17) // jueves 17 abr
  });
  assert.equal(r.view, 'normal');
  assert.equal(r.streak, 3);
  assert.equal(r.rota, false);
  assert.equal(r.checkinsMap.get('2026-04-16'), 'seguido');
  assert.equal(r.revisionCta.state, 'hidden'); // proxima=null
  assert.equal(supa.calls.loadMenuVigente, 1);
  assert.equal(supa.calls.loadCheckins, 1);
  assert.equal(supa.calls.loadProximaSesion, 1);
});

test("hydrateDashboard: queries menú+checkins en paralelo (ambas con el mismo reloj)", async () => {
  const order = [];
  const supa = {
    async loadMenuVigente(today) { order.push('menu-start'); await new Promise(r => setTimeout(r, 5)); order.push('menu-end'); return MENU_VIGENTE; },
    async loadCheckins(from) { order.push('checkins-start'); await new Promise(r => setTimeout(r, 5)); order.push('checkins-end'); return []; },
    async loadProximaSesion() { return null; },
    async loadRevisionEnviadaParaSesion() { return false; }
  };
  await hydrateDashboard({
    supa,
    paciente: { id: 'p1', anamnesis_completed_at: '2026-03-01' },
    now: new Date(2026, 3, 17)
  });
  // Ambas deben empezar antes de que termine la otra (paralelas).
  assert.deepEqual(order.slice(0, 2).sort(), ['checkins-start', 'menu-start']);
});

test("hydrateDashboard: sesión próxima en ventana + sin revisión → revisionCta.state='urgent'", async () => {
  const now = new Date(2026, 4, 4, 10, 0);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 5, 14, 0).toISOString() };
  const supa = makeSupaStub({ menu: MENU_VIGENTE, checkins: [], proxima, revisionEnviada: false });
  const r = await hydrateDashboard({
    supa,
    paciente: { id: 'p1', anamnesis_completed_at: '2026-03-01' },
    now,
    seenModalIds: []
  });
  assert.equal(r.revisionCta.state, 'urgent');
  assert.equal(r.revisionModal.show, true);
});

test("hydrateDashboard: sesión próxima en ventana + revisión ya enviada → revisionCta.state='done'", async () => {
  const now = new Date(2026, 4, 4, 10, 0);
  const proxima = { id: 's1', fecha: new Date(2026, 4, 5, 14, 0).toISOString() };
  const supa = makeSupaStub({ menu: MENU_VIGENTE, checkins: [], proxima, revisionEnviada: true });
  const r = await hydrateDashboard({
    supa,
    paciente: { id: 'p1', anamnesis_completed_at: '2026-03-01' },
    now
  });
  assert.equal(r.revisionCta.state, 'done');
  assert.equal(r.revisionCta.action, null);
  assert.equal(r.revisionModal.show, false);
});

test("hydrateDashboard: error en loadProximaSesion → degrada a revisionCta hidden, no rompe hydrate", async () => {
  const supa = makeSupaStub({ menu: MENU_VIGENTE, checkins: [] });
  supa.loadProximaSesion = async () => { throw new Error('network'); };
  const r = await hydrateDashboard({
    supa,
    paciente: { id: 'p1', anamnesis_completed_at: '2026-03-01' },
    now: new Date(2026, 3, 17)
  });
  assert.equal(r.view, 'normal');
  assert.equal(r.revisionCta.state, 'hidden');
  assert.equal(r.revisionModal.show, false);
});

test("hydrateDashboard: ventana 'from' es hoy-60 días (carga checkins suficientes para calendar+streak)", async () => {
  const supa = makeSupaStub({ menu: MENU_VIGENTE, checkins: [] });
  const now = new Date(2026, 3, 17);
  await hydrateDashboard({
    supa,
    paciente: { id: 'p1', anamnesis_completed_at: '2026-03-01' },
    now
  });
  assert.equal(supa.lastToday, '2026-04-17');
  assert.match(supa.lastFrom, /^\d{4}-\d{2}-\d{2}$/);
  // 60 días fijos en ms; si la ventana cruza un cambio de horario (DST) en la
  // zona del navegador, la fecha civil puede quedar en "hoy-61" vs "hoy-60".
  // Aceptamos ambos: lo que importa es cargar ~2 meses de checkins.
  const diffDays = Math.round((Date.parse(supa.lastToday) - Date.parse(supa.lastFrom)) / 864e5);
  assert.ok(diffDays === 60 || diffDays === 61, `diff días esperado 60-61 (DST-tolerant), vino ${diffDays}`);
});

test("hydrateDashboard: racha rota (ayer sin marcar, pero checkin hace 3 días) → rota=true", async () => {
  const checkins = [
    { fecha: '2026-04-14', estado: 'seguido' } // hace 3 días
  ];
  const supa = makeSupaStub({ menu: MENU_VIGENTE, checkins, proxima: null });
  const r = await hydrateDashboard({
    supa,
    paciente: { id: 'p1', anamnesis_completed_at: '2026-03-01' },
    now: new Date(2026, 3, 17)
  });
  assert.equal(r.rota, true);
});

// ------------------------- mealValueToOptions ------------------------
test("mealValueToOptions: texto no vacío → [texto]", () => {
  assert.deepEqual(mealValueToOptions("Lentejas"), ["Lentejas"]);
});
test("mealValueToOptions: lista → filtra vacíos, nulos y espacios", () => {
  assert.deepEqual(mealValueToOptions(["a", "", "  ", null, "b"]), ["a", "b"]);
});
test("mealValueToOptions: vacío / null / undefined → []", () => {
  assert.deepEqual(mealValueToOptions(""), []);
  assert.deepEqual(mealValueToOptions("   "), []);
  assert.deepEqual(mealValueToOptions(null), []);
  assert.deepEqual(mealValueToOptions(undefined), []);
});

// ------------------------- opcionStorageKey --------------------------
test("opcionStorageKey: menu con id → 'ms-opcion-<id>'", () => {
  assert.equal(opcionStorageKey({ id: "abc-123" }), "ms-opcion-abc-123");
});
test("opcionStorageKey: sin id o null → null", () => {
  assert.equal(opcionStorageKey(null), null);
  assert.equal(opcionStorageKey({}), null);
  assert.equal(opcionStorageKey({ id: "" }), null);
});

// --------------------------- mealChoiceKey ---------------------------
test("mealChoiceKey: combina día y comida con ':'", () => {
  assert.equal(mealChoiceKey("lunes", "comida"), "lunes:comida");
});

test("mealChoiceKey: coerciona argumentos no-string a string", () => {
  assert.equal(mealChoiceKey(0, "desayuno"), "0:desayuno");
});

// --------------------------- applyMealChoice -------------------------
test("applyMealChoice: setea la elección en un Map nuevo", () => {
  const orig = new Map();
  const out = applyMealChoice(orig, "lunes", "comida", 2);
  assert.equal(out.get("lunes:comida"), 2);
});
test("applyMealChoice: no muta el Map original (inmutable)", () => {
  const orig = new Map([["lunes:cena", 0]]);
  const out = applyMealChoice(orig, "lunes", "comida", 1);
  assert.equal(orig.has("lunes:comida"), false);
  assert.equal(out.get("lunes:cena"), 0);
  assert.equal(out.get("lunes:comida"), 1);
});

test("menuTieneOpciones: true si alguna toma de algún día es lista >1", () => {
  const menu = { contenido: { dias: { lunes: { comida: ['a', 'b'], cena: 'c' } } } };
  assert.equal(menuTieneOpciones(menu), true);
});
test("menuTieneOpciones: false si todo es texto (menú clásico/grandfathered)", () => {
  const menu = { contenido: { dias: { lunes: { comida: 'a', cena: 'b' } } } };
  assert.equal(menuTieneOpciones(menu), false);
});
test("menuTieneOpciones: false sin menú o sin días", () => {
  assert.equal(menuTieneOpciones(null), false);
  assert.equal(menuTieneOpciones({ contenido: {} }), false);
});
test("menuTieneOpciones: false si todas las listas tienen solo 1 opción (no intercambiable)", () => {
  const menu = { contenido: { dias: { lunes: { comida: ['Unica opcion'] } } } };
  assert.equal(menuTieneOpciones(menu), false);
});
