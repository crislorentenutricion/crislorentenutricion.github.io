const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { BLOG_JSON, POSTS_DIR, IMG_BLOG } = require("./_helpers/paths");

const posts = JSON.parse(fs.readFileSync(BLOG_JSON, "utf8"));

const CATEGORIAS_VALIDAS = new Set(["cristifood", "educacion", "bienestar"]);
const CAMPOS_REQUERIDOS = ["slug", "title", "description", "category", "categoryLabel", "date", "image", "imageAlt", "featured"];

// ----------------------------------------------------------------
// Tests globales (forma de la colección)
// ----------------------------------------------------------------

test("blog.json contiene al menos un post", () => {
  assert.ok(Array.isArray(posts));
  assert.ok(posts.length > 0);
});

test("blog.json: todos los slugs son únicos", () => {
  const slugs = posts.map(p => p.slug);
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  assert.deepEqual(dupes, [], `slugs duplicados: ${dupes.join(", ")}`);
});

test("blog.json ↔ disco: cada .njk en src/blog/posts/ está declarado en blog.json", () => {
  const slugsEnJson = new Set(posts.map(p => p.slug));
  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith(".njk"));
  for (const f of files) {
    const slug = f.replace(/\.njk$/, "");
    assert.ok(slugsEnJson.has(slug), `${f} no está en blog.json`);
  }
});

// ----------------------------------------------------------------
// Tests por post (un test() por slug → al fallar uno, el resto sigue)
// ----------------------------------------------------------------

for (const p of posts) {
  const id = p.slug || "(sin slug)";

  test(`${id}: tiene todos los campos requeridos`, () => {
    for (const campo of CAMPOS_REQUERIDOS) {
      assert.ok(campo in p, `falta campo "${campo}"`);
    }
  });

  test(`${id}: slug en kebab-case`, () => {
    assert.match(p.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `slug inválido: ${p.slug}`);
  });

  test(`${id}: category pertenece al set válido`, () => {
    assert.ok(CATEGORIAS_VALIDAS.has(p.category), `categoría inválida: ${p.category}`);
  });

  test(`${id}: date YYYY-MM-DD y parseable`, () => {
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/, `fecha mal formada: ${p.date}`);
    const d = new Date(p.date + "T00:00:00Z");
    assert.ok(!isNaN(d.getTime()), `fecha inválida: ${p.date}`);
  });

  test(`${id}: featured es boolean`, () => {
    assert.equal(typeof p.featured, "boolean");
  });

  test(`${id}: description en rango SEO (70-200 chars)`, () => {
    const n = p.description.length;
    assert.ok(n >= 70 && n <= 200, `${n} chars (esperado 70-200)`);
  });

  test(`${id}: imageAlt no vacío ni placeholder (>10 chars)`, () => {
    assert.ok(p.imageAlt && p.imageAlt.trim().length > 10, `imageAlt insuficiente`);
  });

  test(`${id}: image existe en src/img/blog/`, () => {
    const file = path.join(IMG_BLOG, p.image);
    assert.ok(fs.existsSync(file), `falta imagen ${p.image}`);
  });

  test(`${id}: tiene .njk en src/blog/posts/`, () => {
    const file = path.join(POSTS_DIR, `${p.slug}.njk`);
    assert.ok(fs.existsSync(file), `falta ${p.slug}.njk`);
  });
}
