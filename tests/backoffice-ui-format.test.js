const { test } = require("node:test");
const assert = require("node:assert/strict");
const { formatearVencimiento } = require("../src/backoffice/ui.js");

test("formatearVencimiento: diasDiff=0 → 'vence hoy (DD mmm)'", () => {
  const txt = formatearVencimiento(0, "2026-05-01");
  assert.equal(txt, "vence hoy (1 may)");
});

test("formatearVencimiento: diasDiff=1 → 'vence mañana (DD mmm)'", () => {
  const txt = formatearVencimiento(1, "2026-05-02");
  assert.equal(txt, "vence mañana (2 may)");
});

test("formatearVencimiento: diasDiff=2 → 'vence en 2 días (DD mmm)'", () => {
  const txt = formatearVencimiento(2, "2026-05-03");
  assert.equal(txt, "vence en 2 días (3 may)");
});

test("formatearVencimiento: diasDiff=-1 → 'vencido hace 1 día (DD mmm)'", () => {
  const txt = formatearVencimiento(-1, "2026-04-30");
  assert.equal(txt, "vencido hace 1 día (30 abr)");
});

test("formatearVencimiento: diasDiff=-3 → 'vencido hace 3 días (DD mmm)'", () => {
  const txt = formatearVencimiento(-3, "2026-04-28");
  assert.equal(txt, "vencido hace 3 días (28 abr)");
});

test("formatearVencimiento: diasDiff positivo grande → 'vence en N días'", () => {
  const txt = formatearVencimiento(15, "2026-05-16");
  assert.equal(txt, "vence en 15 días (16 may)");
});

test("formatearVencimiento: fecha inválida → solo el texto sin paréntesis", () => {
  const txt = formatearVencimiento(0, "not-a-date");
  assert.equal(txt, "vence hoy");
});

test("formatearVencimiento: null/undefined → cadena vacía defensiva", () => {
  assert.equal(formatearVencimiento(null, "2026-05-01"), "");
  assert.equal(formatearVencimiento(undefined, "2026-05-01"), "");
});
