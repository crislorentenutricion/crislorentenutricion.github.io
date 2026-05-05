// Tests de build del backoffice interno (/backoffice/ y /backoffice/pacientes/).
// Verifica:
//   - HTML de ambas páginas se genera y lleva noindex,nofollow
//   - robots.txt desautoriza /backoffice/ para bots genéricos y AI
//   - Los assets JS (logic.js + auth.js) se copian al _site/
//   - El sitemap.xml NO incluye URLs del backoffice
//
// No hace ninguna llamada a Supabase — solo inspecciona ficheros en _site/.
// El build se dispara una vez en `before()` (reutilizado entre asserts).

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ROOT, SITE } = require("./_helpers/paths");

before(() => {
  // Si _site/ ya existe (build previo del workflow CI o de `npm run serve`),
  // no reconstruimos — evita race con otros ficheros de test que corren en
  // paralelo y podrían borrar/regenerar passthrough files a mitad de lectura.
  if (fs.existsSync(path.join(SITE, "backoffice", "index.html"))) return;
  execFileSync("npx", ["eleventy"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
});

test("backoffice: /backoffice/ existe con noindex,nofollow", () => {
  const file = path.join(SITE, "backoffice", "index.html");
  assert.ok(fs.existsSync(file), "falta _site/backoffice/index.html");
  const html = fs.readFileSync(file, "utf8");
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/, "falta noindex,nofollow");
});

test("backoffice: /backoffice/pacientes/ existe con noindex,nofollow", () => {
  const file = path.join(SITE, "backoffice", "pacientes", "index.html");
  assert.ok(fs.existsSync(file), "falta _site/backoffice/pacientes/index.html");
  const html = fs.readFileSync(file, "utf8");
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/, "falta noindex,nofollow en /pacientes/");
});

test("backoffice: ambas páginas cargan logic.js + auth.js y el SDK Supabase", () => {
  for (const rel of ["backoffice/index.html", "backoffice/pacientes/index.html"]) {
    const html = fs.readFileSync(path.join(SITE, rel), "utf8");
    assert.match(html, /src="\/backoffice\/logic\.js"/, `${rel} no carga backoffice/logic.js`);
    assert.match(html, /src="\/backoffice\/auth\.js"/, `${rel} no carga backoffice/auth.js`);
    assert.match(html, /@supabase\/supabase-js@2/, `${rel} no importa el SDK de Supabase`);
    assert.match(html, /window\.BoAuth\.iniciar/, `${rel} no invoca BoAuth.iniciar`);
  }
});

test("backoffice: robots.txt desautoriza /backoffice/ para todos los agentes relevantes", () => {
  const robots = fs.readFileSync(path.join(SITE, "robots.txt"), "utf8");
  // Debe haber al menos una línea Disallow: /backoffice/ (bots genéricos).
  assert.match(robots, /Disallow:\s*\/backoffice\//, "robots.txt no contiene Disallow: /backoffice/");
  // Cobertura mínima de bots AI explícitos.
  for (const ua of ["GPTBot", "ClaudeBot", "PerplexityBot"]) {
    const re = new RegExp(`User-agent:\\s*${ua}[\\s\\S]*?Disallow:\\s*/backoffice/`, "i");
    assert.match(robots, re, `robots.txt no bloquea /backoffice/ para ${ua}`);
  }
});

test("backoffice: logic.js y auth.js se copian al _site/backoffice/", () => {
  assert.ok(fs.existsSync(path.join(SITE, "backoffice", "logic.js")), "falta _site/backoffice/logic.js");
  assert.ok(fs.existsSync(path.join(SITE, "backoffice", "auth.js")), "falta _site/backoffice/auth.js");
});

test("backoffice: sitemap.xml NO incluye URLs del backoffice (eleventyExcludeFromCollections)", () => {
  const xml = fs.readFileSync(path.join(SITE, "sitemap.xml"), "utf8");
  assert.ok(!xml.includes("/backoffice/"), "sitemap.xml incluye /backoffice/ por error");
});

test("backoffice: auth.js expone API mínima (iniciar, registrarSupabase, cerrarSesion)", () => {
  // Sanity estática — no ejecuta el script, solo confirma que la API pública
  // esperada por los stubs y por futuros agentes está definida.
  const js = fs.readFileSync(path.join(SITE, "backoffice", "auth.js"), "utf8");
  assert.match(js, /window\.BoAuth\s*=/, "auth.js no asigna window.BoAuth");
  assert.match(js, /iniciar/, "auth.js no expone iniciar");
  assert.match(js, /registrarSupabase/, "auth.js no expone registrarSupabase");
  assert.match(js, /cerrarSesion/, "auth.js no expone cerrarSesion");
});

test("backoffice: auth.js es fail-closed cuando cristinaEmail está vacío", () => {
  // Si `env.cristinaEmail` cae (secret de CI no inyectado, build local sin la
  // var), el gate UX debe bloquear el acceso (render403) en vez de dejar pasar.
  // RLS sigue siendo la barrera dura, pero el cinturón UX también debe sostener.
  const js = fs.readFileSync(path.join(SITE, "backoffice", "auth.js"), "utf8");
  // Patrón: dentro de `if (!permitidoEmail) { ... }` debe haber render403.
  // Captura el bloque y verifica que llama a render403.
  const m = js.match(/if\s*\(\s*!permitidoEmail\s*\)\s*\{([\s\S]*?)\}/);
  assert.ok(m, "auth.js no tiene bloque if(!permitidoEmail)");
  assert.match(m[1], /render403\s*\(/, "rama !permitidoEmail no llama a render403 (gate abierto si falta el env)");
  assert.match(m[1], /mostrarNav\s*\(\s*false\s*\)/, "rama !permitidoEmail no oculta la nav");
});

test("backoffice: /backoffice/paciente/ contiene tablist con 5 tabs y 5 paneles", () => {
  const file = path.join(SITE, "backoffice", "paciente", "index.html");
  assert.ok(fs.existsSync(file), "falta _site/backoffice/paciente/index.html");
  const html = fs.readFileSync(file, "utf8");
  assert.match(html, /<div[^>]+id="tabs"[^>]+role="tablist"/, "falta el div#tabs role=tablist");
  for (const slug of ["anamnesis", "evolucion", "adherencia", "pagos", "timeline"]) {
    const reTab   = new RegExp(`data-bo-tab="${slug}"`);
    const rePanel = new RegExp(`data-bo-panel="${slug}"`);
    assert.match(html, reTab,   `falta el tab para ${slug}`);
    assert.match(html, rePanel, `falta el panel para ${slug}`);
  }
});
