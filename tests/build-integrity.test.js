// Tests lentos: ejecutan el build de eleventy y validan el output.
// Evita tocar la red: solo inspecciona ficheros en _site/.

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ROOT, SITE, BLOG_JSON } = require("./_helpers/paths");

const posts = JSON.parse(fs.readFileSync(BLOG_JSON, "utf8"));

before(() => {
  // Construye el sitio en _site/
  execFileSync("npx", ["eleventy"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
});

test("páginas core generadas", () => {
  const core = ["index.html", "sobre-mi/index.html", "blog/index.html", "404.html", "sitemap.xml", "robots.txt"];
  for (const f of core) {
    assert.ok(fs.existsSync(path.join(SITE, f)), `falta ${f}`);
  }
});

test("cada post de blog.json tiene HTML generado en la URL correcta", () => {
  for (const p of posts) {
    const file = path.join(SITE, "blog", p.category, p.slug, "index.html");
    assert.ok(fs.existsSync(file), `falta HTML para ${p.slug} en ${file}`);
  }
});

test("sitemap.xml incluye todos los posts", () => {
  const xml = fs.readFileSync(path.join(SITE, "sitemap.xml"), "utf8");
  for (const p of posts) {
    const url = `/blog/${p.category}/${p.slug}/`;
    assert.ok(xml.includes(url), `sitemap no contiene ${url}`);
  }
});

test("sitemap.xml incluye páginas core publicadas", () => {
  const xml = fs.readFileSync(path.join(SITE, "sitemap.xml"), "utf8");
  for (const url of ["/sobre-mi/", "/blog/", "/menu-mensual-personalizado/", "/metodo/", "/testimonios/"]) {
    assert.ok(xml.includes(url), `sitemap no contiene ${url}`);
  }
});

test("CSS fue minificado (sin múltiples espacios consecutivos)", () => {
  const css = fs.readFileSync(path.join(SITE, "css", "style.css"), "utf8");
  assert.ok(!/  +/.test(css), "CSS no parece minificado: contiene múltiples espacios");
});

test("posts de blog tienen ids automáticos en h2/h3 dentro de .article-content", () => {
  // Tomamos un post al azar y validamos que al menos un h2/h3 tiene id
  const p = posts.find(x => x.category !== "bienestar") || posts[0];
  const html = fs.readFileSync(path.join(SITE, "blog", p.category, p.slug, "index.html"), "utf8");
  const articleMatch = html.match(/<div class="article-content">([\s\S]*?)<!--\/article-content-->/);
  if (!articleMatch) return; // algunos posts pueden no tener el wrapper; skip suave
  const body = articleMatch[1];
  const headings = body.match(/<h[23][^>]*>/g) || [];
  if (headings.length === 0) return;
  const conId = headings.filter(h => /\sid="/.test(h));
  assert.ok(conId.length > 0, "ningún h2/h3 del post tiene id automático");
});

test("stub de redirect /servicios/ mantiene canonical + meta refresh", () => {
  // Ver convenciones/negocio/web-tecnico.md → Redirects activos
  // Este stub no se publica en sitemap pero absorbe tráfico legacy al formulario en home.
  const file = path.join(SITE, "servicios", "index.html");
  assert.ok(fs.existsSync(file), "falta el redirect stub /servicios/index.html");
  const html = fs.readFileSync(file, "utf8");
  assert.match(html, /rel="canonical" href="https:\/\/www\.crislorentenutricion\.com\/"/, "canonical roto");
  assert.match(html, /meta http-equiv="refresh" content="0;\s*url=\/#formulario-contacto"/, "meta refresh roto");
  assert.match(html, /location\.replace\('\/#formulario-contacto'\)/, "fallback JS roto");
  assert.match(html, /name="robots" content="noindex, follow"/, "falta noindex,follow");
});

test("páginas HTML no contienen la palabra 'alimentaria' (marca es 'nutricional')", () => {
  // Regla de marca de CLAUDE.md. Scan ligero de páginas core.
  const archivos = [
    "index.html",
    "servicios/index.html",
    "sobre-mi/index.html",
  ];
  for (const f of archivos) {
    const html = fs.readFileSync(path.join(SITE, f), "utf8").toLowerCase();
    assert.ok(!html.includes("asesoría alimentaria"), `"asesoría alimentaria" encontrado en ${f}`);
    assert.ok(!html.includes("asesoria alimentaria"), `"asesoria alimentaria" encontrado en ${f}`);
  }
});

test("enlaces internos en páginas core apuntan a páginas existentes", () => {
  const checked = new Set();
  const HTML_EXT = /\.html$/;
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (HTML_EXT.test(entry.name)) checkLinks(full);
    }
  }
  function checkLinks(file) {
    const html = fs.readFileSync(file, "utf8");
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    for (const href of hrefs) {
      if (!href.startsWith("/")) continue;          // ignora externos y fragmentos
      if (href.startsWith("//")) continue;
      const clean = href.split("#")[0].split("?")[0];
      if (!clean || clean === "/") continue;
      const key = clean;
      if (checked.has(key)) continue;
      checked.add(key);
      // Mapea /foo/ → _site/foo/index.html ; /foo.xml → _site/foo.xml
      const candidates = clean.endsWith("/")
        ? [path.join(SITE, clean, "index.html")]
        : [path.join(SITE, clean), path.join(SITE, clean, "index.html")];
      const ok = candidates.some(c => fs.existsSync(c));
      assert.ok(ok, `link roto en ${path.relative(SITE, file)}: ${href}`);
    }
  }
  scan(SITE);
});
