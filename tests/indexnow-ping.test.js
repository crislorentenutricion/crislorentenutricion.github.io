const { test } = require("node:test");
const assert = require("node:assert/strict");
const { postUrlFromFile, resolveUrls, CORE_PAGES } = require("../scripts/indexnow-ping");

const BLOG_SAMPLE = [
  { slug: "pizza-casera", category: "cristifood" },
  { slug: "como-llegue-hasta-aqui", category: "educacion" },
];

test("postUrlFromFile devuelve null para ficheros fuera de posts/", () => {
  assert.equal(postUrlFromFile("src/index.njk", BLOG_SAMPLE), null);
});

test("postUrlFromFile mapea slug con categoría correcta", () => {
  const url = postUrlFromFile("src/blog/posts/pizza-casera.njk", BLOG_SAMPLE);
  assert.equal(url, "/blog/cristifood/pizza-casera/");
});

test("postUrlFromFile devuelve null si el slug no existe en blog.json", () => {
  const url = postUrlFromFile("src/blog/posts/post-fantasma.njk", BLOG_SAMPLE);
  assert.equal(url, null);
});

test("resolveUrls mapea páginas core conocidas", () => {
  // resolveUrls lee blog.json real; usamos ficheros que no dependen de él
  const urls = resolveUrls(["src/index.njk", "src/sobre-mi.njk"]);
  assert.deepEqual(urls.sort(), ["/", "/sobre-mi/"].sort());
});

test("resolveUrls trata cambios en _includes como cambio global", () => {
  const urls = resolveUrls(["src/_includes/header.njk"]);
  // Debe incluir todas las CORE_PAGES
  for (const core of CORE_PAGES) assert.ok(urls.includes(core), `falta ${core}`);
});

test("resolveUrls trata cambios en css/ como cambio global", () => {
  const urls = resolveUrls(["src/css/style.css"]);
  for (const core of CORE_PAGES) assert.ok(urls.includes(core), `falta ${core}`);
});

test("resolveUrls trata cambios en .eleventy.js como cambio global", () => {
  const urls = resolveUrls([".eleventy.js"]);
  for (const core of CORE_PAGES) assert.ok(urls.includes(core), `falta ${core}`);
});

test("resolveUrls ignora ficheros irrelevantes", () => {
  const urls = resolveUrls(["README.md", "package.json"]);
  assert.equal(urls.length, 0);
});

test("resolveUrls incluye /blog/ cuando cambia blog.json", () => {
  const urls = resolveUrls(["src/_data/blog.json"]);
  assert.ok(urls.includes("/blog/"));
});

test("resolveUrls limita a 50 URLs", () => {
  const many = Array.from({ length: 100 }, (_, i) => `src/blog/posts/ghost-${i}.njk`);
  const urls = resolveUrls(many);
  assert.ok(urls.length <= 50);
});

test("resolveUrls deduplica URLs", () => {
  const urls = resolveUrls(["src/index.njk", "src/index.njk"]);
  assert.equal(urls.length, 1);
});
