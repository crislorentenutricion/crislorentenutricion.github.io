const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadEleventyConfig } = require("./_helpers/load-eleventy");

const { transforms } = loadEleventyConfig();
const addHeadingIds = transforms.addHeadingIds;

function wrap(inner) {
  return `<html><body><div class="article-content">${inner}<!--/article-content--></div></body></html>`;
}

test("addHeadingIds ignora outputPath no-html", () => {
  const html = wrap(`<h2>Hola</h2>`);
  assert.equal(addHeadingIds(html, "/blog/algo.xml"), html);
});

test("addHeadingIds ignora outputPath fuera de /blog/", () => {
  const html = wrap(`<h2>Hola</h2>`);
  assert.equal(addHeadingIds(html, "_site/sobre-mi/index.html"), html);
});

test("addHeadingIds añade id slugified a h2 y h3", () => {
  const html = wrap(`<h2>Pollo al Horno</h2><p>x</p><h3>Tiempo de Cocción</h3>`);
  const out = addHeadingIds(html, "_site/blog/receta/index.html");
  assert.match(out, /<h2 id="pollo-al-horno">/);
  assert.match(out, /<h3 id="tiempo-de-coccion">/);
});

test("addHeadingIds respeta id existente", () => {
  const html = wrap(`<h2 id="custom">Pollo</h2>`);
  const out = addHeadingIds(html, "_site/blog/x/index.html");
  assert.match(out, /<h2 id="custom">/);
  assert.ok(!out.includes(`id="pollo"`));
});

test("addHeadingIds deduplica ids repetidos con sufijo incremental", () => {
  const html = wrap(`<h2>Ingredientes</h2><h2>Ingredientes</h2><h3>Ingredientes</h3>`);
  const out = addHeadingIds(html, "_site/blog/x/index.html");
  assert.match(out, /<h2 id="ingredientes">/);
  assert.match(out, /<h2 id="ingredientes-2">/);
  assert.match(out, /<h3 id="ingredientes-3">/);
});

test("addHeadingIds no altera contenido fuera de .article-content", () => {
  const html = `<h2>Externo</h2>${wrap(`<h2>Interno</h2>`)}`;
  const out = addHeadingIds(html, "_site/blog/x/index.html");
  assert.match(out, /<h2>Externo<\/h2>/);
  assert.match(out, /<h2 id="interno">/);
});

test("addHeadingIds strips HTML en el texto del heading", () => {
  const html = wrap(`<h2><strong>Tip</strong> rápido</h2>`);
  const out = addHeadingIds(html, "_site/blog/x/index.html");
  assert.match(out, /<h2 id="tip-rapido">/);
});
