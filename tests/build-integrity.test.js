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

test("sitemap.xml tiene declaración XML y urlset bien formados", () => {
  // Un fallo estructural (p.ej. whitespace al inicio) rompe ingesta en Google SC.
  const xml = fs.readFileSync(path.join(SITE, "sitemap.xml"), "utf8");
  assert.ok(xml.startsWith("<?xml"), "sitemap.xml no empieza por <?xml");
  assert.match(xml, /<urlset\s+xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
  assert.match(xml, /<\/urlset>\s*$/);
  // Cada <url> debe tener <loc>
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)];
  assert.ok(urls.length > 0, "sitemap sin entradas <url>");
  for (const [, body] of urls) {
    assert.match(body, /<loc>https:\/\/www\.crislorentenutricion\.com\//, "una entrada sin <loc> https válida");
  }
});

test("CSS fue minificado (sin múltiples espacios consecutivos)", () => {
  const css = fs.readFileSync(path.join(SITE, "css", "style.css"), "utf8");
  assert.ok(!/  +/.test(css), "CSS no parece minificado: contiene múltiples espacios");
});

test("posts con .article-content tienen ids automáticos en todos sus h2/h3", () => {
  // Recorre todos los posts; falla si algún h2/h3 dentro del wrapper queda sin id.
  // Exige que al menos un post tenga headings para que el test aporte señal real.
  let postsConHeadings = 0;
  for (const p of posts) {
    const html = fs.readFileSync(path.join(SITE, "blog", p.category, p.slug, "index.html"), "utf8");
    const articleMatch = html.match(/<div class="article-content">([\s\S]*?)<!--\/article-content-->/);
    if (!articleMatch) continue;
    const headings = articleMatch[1].match(/<h[23][^>]*>/g) || [];
    if (headings.length === 0) continue;
    postsConHeadings++;
    const sinId = headings.filter(h => !/\sid="/.test(h));
    assert.equal(sinId.length, 0, `${p.slug}: h2/h3 sin id auto → ${sinId.join(" | ")}`);
  }
  assert.ok(postsConHeadings > 0, "ningún post tiene h2/h3 dentro de .article-content: test sin valor");
});

test("home: picker de reservas montado en #formulario-contacto (fase 3.2)", () => {
  // Fase 3.2 del plan booking-v3: swap directo del form de Formspree por el picker.
  // La home debe cargar booking.css + los dos scripts y renderizar el shell.
  // El form legacy y la referencia a Formspree tienen que haber desaparecido.
  const file = path.join(SITE, "index.html");
  const html = fs.readFileSync(file, "utf8");
  assert.match(html, /id="formulario-contacto"/, "ancla #formulario-contacto rota");
  assert.match(html, /href="\/css\/booking\.css"/, "falta <link> a booking.css en la home");
  assert.match(html, /src="\/js\/booking-logic\.js"/, "falta <script> booking-logic.js en la home");
  assert.match(html, /src="\/js\/booking\.js"/, "falta <script> booking.js en la home");
  assert.match(html, /data-booking-mock/, "falta el shell del picker");
  assert.match(html, /id="plan-elegido"/, "falta el hidden input plan-elegido dentro del picker");
  assert.ok(!html.includes("formspree.io"), "la home todavía referencia formspree.io");
  assert.ok(!/<form[^>]*class="contact-form"/.test(html), "la home todavía tiene el form legacy .contact-form");
  assert.ok(fs.existsSync(path.join(SITE, "css", "booking.css")), "falta _site/css/booking.css");
  assert.ok(fs.existsSync(path.join(SITE, "js", "booking.js")), "falta _site/js/booking.js");
  assert.ok(fs.existsSync(path.join(SITE, "js", "booking-logic.js")), "falta _site/js/booking-logic.js");
  assert.ok(!fs.existsSync(path.join(SITE, "preview-booking", "index.html")), "/preview-booking/ debe haber sido eliminada");
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

test("ninguna página HTML del site contiene 'asesoría alimentaria' (marca es 'nutricional')", () => {
  // Regla de marca de CLAUDE.md. Scan completo del _site/ — no basta con páginas core,
  // el fallo de marca también puede aparecer en posts de blog o landings.
  const ofensores = [];
  (function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (entry.name.endsWith(".html")) {
        const html = fs.readFileSync(full, "utf8").toLowerCase();
        if (html.includes("asesoría alimentaria") || html.includes("asesoria alimentaria")) {
          ofensores.push(path.relative(SITE, full));
        }
      }
    }
  })(SITE);
  assert.deepEqual(ofensores, [], `"asesoría alimentaria" encontrado en: ${ofensores.join(", ")}`);
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
