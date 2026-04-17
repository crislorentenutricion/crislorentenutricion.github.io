const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { BLOG_JSON, POSTS_DIR, IMG_BLOG } = require("./_helpers/paths");

const posts = JSON.parse(fs.readFileSync(BLOG_JSON, "utf8"));

const CATEGORIAS_VALIDAS = new Set(["cristifood", "educacion", "bienestar"]);
const CAMPOS_REQUERIDOS = ["slug", "title", "description", "category", "categoryLabel", "date", "image", "imageAlt", "featured"];

test("blog.json contiene al menos un post", () => {
  assert.ok(Array.isArray(posts));
  assert.ok(posts.length > 0);
});

test("cada post tiene todos los campos requeridos", () => {
  for (const p of posts) {
    for (const campo of CAMPOS_REQUERIDOS) {
      assert.ok(campo in p, `post "${p.slug || "?"}" sin campo "${campo}"`);
    }
  }
});

test("cada post tiene slug único", () => {
  const slugs = posts.map(p => p.slug);
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  assert.deepEqual(dupes, [], `slugs duplicados: ${dupes.join(", ")}`);
});

test("slug usa kebab-case (solo a-z, 0-9, -)", () => {
  for (const p of posts) {
    assert.match(p.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `slug inválido: ${p.slug}`);
  }
});

test("category pertenece al set válido", () => {
  for (const p of posts) {
    assert.ok(CATEGORIAS_VALIDAS.has(p.category), `categoría inválida en ${p.slug}: ${p.category}`);
  }
});

test("date sigue formato YYYY-MM-DD y es parseable", () => {
  for (const p of posts) {
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/, `fecha mal formada en ${p.slug}`);
    const d = new Date(p.date + "T00:00:00Z");
    assert.ok(!isNaN(d.getTime()), `fecha inválida en ${p.slug}: ${p.date}`);
  }
});

test("featured es boolean", () => {
  for (const p of posts) {
    assert.equal(typeof p.featured, "boolean", `featured no booleano en ${p.slug}`);
  }
});

test("description tiene entre 70 y 200 caracteres (rango SEO razonable)", () => {
  for (const p of posts) {
    const n = p.description.length;
    assert.ok(n >= 70 && n <= 200, `description fuera de rango (${n} chars) en ${p.slug}`);
  }
});

test("imageAlt no está vacío ni es placeholder", () => {
  for (const p of posts) {
    assert.ok(p.imageAlt && p.imageAlt.trim().length > 10, `imageAlt insuficiente en ${p.slug}`);
  }
});

test("image existe como fichero en src/img/blog/", () => {
  for (const p of posts) {
    const file = path.join(IMG_BLOG, p.image);
    assert.ok(fs.existsSync(file), `falta imagen ${p.image} para ${p.slug}`);
  }
});

test("cada post en blog.json tiene .njk en src/blog/posts/", () => {
  for (const p of posts) {
    const file = path.join(POSTS_DIR, `${p.slug}.njk`);
    assert.ok(fs.existsSync(file), `falta post njk para ${p.slug}`);
  }
});

test("cada .njk en src/blog/posts/ está declarado en blog.json", () => {
  const slugsEnJson = new Set(posts.map(p => p.slug));
  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith(".njk"));
  for (const f of files) {
    const slug = f.replace(/\.njk$/, "");
    assert.ok(slugsEnJson.has(slug), `${f} no está en blog.json`);
  }
});
