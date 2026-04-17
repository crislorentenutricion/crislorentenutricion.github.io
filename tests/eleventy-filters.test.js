const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadEleventyConfig } = require("./_helpers/load-eleventy");

const cfg = loadEleventyConfig();

test("fechaEs formatea fecha ISO en castellano humano", () => {
  const out = cfg.filters.fechaEs("2026-04-17");
  assert.equal(out, "17 de abril de 2026");
});

test("fechaEs acepta objeto Date", () => {
  const out = cfg.filters.fechaEs(new Date("2025-01-05T00:00:00Z"));
  // Depende de la TZ del runner pero el mes y año son estables
  assert.match(out, /enero de 2025/);
});

test("fechaISO devuelve string tal cual si ya es string", () => {
  assert.equal(cfg.filters.fechaISO("2026-04-17"), "2026-04-17");
});

test("fechaISO convierte Date a YYYY-MM-DD en UTC", () => {
  const d = new Date("2026-04-17T23:30:00Z");
  assert.equal(cfg.filters.fechaISO(d), "2026-04-17");
});

test("ordenarPorFecha devuelve posts descendente sin mutar input", () => {
  const input = [
    { slug: "a", date: "2025-01-01" },
    { slug: "b", date: "2026-06-01" },
    { slug: "c", date: "2025-12-31" },
  ];
  const frozen = JSON.stringify(input);
  const sorted = cfg.filters.ordenarPorFecha(input);
  assert.deepEqual(sorted.map(p => p.slug), ["b", "c", "a"]);
  assert.equal(JSON.stringify(input), frozen, "no debe mutar el array original");
});

test("minifyCss elimina comentarios normales pero preserva /*! license */", () => {
  const src = `/*! keep */ .a { color: red; } /* drop */ .b{}`;
  const out = cfg.minifyCss(src);
  assert.ok(out.includes("/*! keep */"));
  assert.ok(!out.includes("/* drop */"));
});

test("minifyCss colapsa whitespace y elimina espacios junto a delimitadores", () => {
  const out = cfg.minifyCss(".a  {  color  :  red ;  }");
  assert.equal(out, ".a{color:red}");
});

test("minifyCss quita punto y coma final antes de cierre", () => {
  assert.equal(cfg.minifyCss(".a{color:red;}"), ".a{color:red}");
});

test("minifyCss no destroza selectores combinados", () => {
  const out = cfg.minifyCss(".a > .b + .c ~ .d { color: red; }");
  assert.equal(out, ".a>.b+.c~.d{color:red}");
});
