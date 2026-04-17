const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { BLOG_JSON, POSTS_DIR } = require("./_helpers/paths");
const { parseFrontmatter } = require("./_helpers/frontmatter");

const posts = JSON.parse(fs.readFileSync(BLOG_JSON, "utf8"));

for (const p of posts) {
  const file = path.join(POSTS_DIR, `${p.slug}.njk`);
  const fm = fs.existsSync(file) ? parseFrontmatter(file) : null;

  test(`frontmatter válido en ${p.slug}`, () => {
    assert.ok(fm, `no se pudo parsear frontmatter de ${p.slug}`);
    assert.equal(fm.layout, "layouts/post.njk");
    assert.equal(fm.category, p.category, "category debe coincidir con blog.json");
    assert.equal(fm.categoryLabel, p.categoryLabel, "categoryLabel debe coincidir");
    assert.equal(fm.title, p.title, "title debe coincidir");
    assert.equal(fm.navActive, "blog");
  });

  test(`permalink coherente en ${p.slug}`, () => {
    assert.ok(fm, "frontmatter parseado");
    const esperado = `/blog/${p.category}/${p.slug}/`;
    assert.equal(fm.permalink, esperado, `permalink debe ser ${esperado}`);
  });

  test(`date en frontmatter coincide con blog.json en ${p.slug}`, () => {
    assert.ok(fm, "frontmatter parseado");
    // fm.date puede venir como string "2026-04-17" tras YAML parseo líneal
    const fmDate = String(fm.date).slice(0, 10);
    assert.equal(fmDate, p.date);
  });

  test(`ogImage apunta a /img/blog/ en ${p.slug}`, () => {
    assert.ok(fm, "frontmatter parseado");
    assert.match(fm.ogImage, /^\/img\/blog\//, `ogImage inesperado: ${fm.ogImage}`);
  });
}
