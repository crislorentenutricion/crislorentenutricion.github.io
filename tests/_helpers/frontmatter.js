// Parser minimalista de frontmatter YAML para njk. Solo soporta pares clave: valor
// de una línea; devuelve strings salvo `true`/`false` que se convierten a bool.
// Números y fechas quedan como string (suficiente para validar posts).

const fs = require("fs");

function parseFrontmatter(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const block = m[1];
  const out = {};
  for (const line of block.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    let [, key, val] = kv;
    val = val.trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val === "true") val = true;
    else if (val === "false") val = false;
    out[key] = val;
  }
  return out;
}

module.exports = { parseFrontmatter };
