const fs = require("fs");
const path = require("path");

// Minificador CSS conservador: quita comentarios /* … */ (excepto /*! license */),
// colapsa whitespace, elimina espacios alrededor de { } ; , : y la coma final
// antes del cierre de bloque. No toca strings ni selectores complejos.
function minifyCss(css) {
  return css
    .replace(/\/\*(?!\!)[\s\S]*?\*\//g, "")   // comentarios no-bang
    .replace(/\s+/g, " ")                      // whitespace a 1 espacio
    .replace(/\s*([{}:;,>+~])\s*/g, "$1")     // quita espacios junto a delimitadores
    .replace(/;}/g, "}")                        // punto y coma antes de cierre
    .trim();
}

module.exports = function(eleventyConfig) {
  // CSS: minificar al copiar al output (source en src/ queda legible)
  eleventyConfig.on("eleventy.before", () => {
    const srcDir = path.join(__dirname, "src", "css");
    const outDir = path.join(__dirname, "_site", "css");
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of fs.readdirSync(srcDir)) {
      if (!f.endsWith(".css")) continue;
      const raw = fs.readFileSync(path.join(srcDir, f), "utf8");
      fs.writeFileSync(path.join(outDir, f), minifyCss(raw));
    }
  });
  eleventyConfig.addPassthroughCopy("src/js");
  eleventyConfig.addPassthroughCopy("src/img");
  eleventyConfig.addPassthroughCopy("src/robots.txt");
  eleventyConfig.addPassthroughCopy("src/llms.txt");
  eleventyConfig.addPassthroughCopy("src/humans.txt");
  eleventyConfig.addPassthroughCopy("src/a2ed8653990925208a58dc703ed7ed39.txt");
  eleventyConfig.addPassthroughCopy("src/CNAME");
  eleventyConfig.addPassthroughCopy("src/favicon.ico");
  eleventyConfig.addPassthroughCopy("src/favicon-32x32.png");
  eleventyConfig.addPassthroughCopy("src/favicon-16x16.png");
  eleventyConfig.addPassthroughCopy("src/apple-touch-icon.png");
  eleventyConfig.addPassthroughCopy("src/mi-seguimiento/manifest.webmanifest");
  eleventyConfig.addPassthroughCopy("src/mi-seguimiento/logic.js");
  // Backoffice interno — scripts del cliente (lógica pura + auth OTP).
  // El gate UX vive en auth.js; la barrera real está en las policies RLS
  // de Supabase (solo `auth.email() = cristinaEmail` puede leer pacientes).
  eleventyConfig.addPassthroughCopy("src/backoffice/logic.js");
  eleventyConfig.addPassthroughCopy("src/backoffice/auth.js");
  eleventyConfig.addPassthroughCopy("src/backoffice/ui.js");
  eleventyConfig.addPassthroughCopy("src/backoffice/backoffice-hoy.js");
  eleventyConfig.addPassthroughCopy("src/backoffice/backoffice-pacientes.js");
  eleventyConfig.addPassthroughCopy("src/backoffice/backoffice-paciente.js");

  // Filtro para formatear fechas en español
  eleventyConfig.addFilter("fechaEs", function(dateVal) {
    const meses = ["enero","febrero","marzo","abril","mayo","junio",
                   "julio","agosto","septiembre","octubre","noviembre","diciembre"];
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal + "T00:00:00");
    return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
  });

  // Filtro para fechas en formato ISO (JSON-LD / SEO)
  // Usa UTC para evitar desfase de timezone (11ty crea Date en UTC)
  eleventyConfig.addFilter("fechaISO", function(dateVal) {
    if (typeof dateVal === "string") return dateVal;
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    return d.toISOString().substring(0, 10);
  });

  // Filtro para ordenar posts por fecha descendente
  eleventyConfig.addFilter("ordenarPorFecha", function(posts) {
    return posts.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  });

  // Transform: añade id automático a h2/h3 dentro de .article-content
  // (deep linking, citabilidad por motores AI). Invisible al usuario.
  eleventyConfig.addTransform("addHeadingIds", function(content, outputPath) {
    if (!outputPath || !outputPath.endsWith(".html")) return content;
    if (!outputPath.includes("/blog/")) return content;
    // Localiza el bloque .article-content y procesa sus h2/h3
    const slugify = (s) => s
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    return content.replace(
      /(<div class="article-content">)([\s\S]*?)(<!--\/article-content-->)/,
      (m, pre, body, post) => {
        const used = new Set();
        const newBody = body.replace(
          /<(h2|h3)([^>]*)>([\s\S]*?)<\/\1>/g,
          (mm, tag, attrs, inner) => {
            if (/\sid\s*=/.test(attrs)) return mm;
            const text = inner.replace(/<[^>]+>/g, "").trim();
            let id = slugify(text);
            if (!id) return mm;
            let base = id, n = 2;
            while (used.has(id)) { id = `${base}-${n++}`; }
            used.add(id);
            return `<${tag}${attrs} id="${id}">${inner}</${tag}>`;
          }
        );
        return pre + newBody + post;
      }
    );
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data"
    },
    templateFormats: ["njk", "html", "md"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk"
  };
};

module.exports.minifyCss = minifyCss;
