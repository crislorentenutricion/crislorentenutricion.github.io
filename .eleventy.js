module.exports = function(eleventyConfig) {
  // Copiar assets estáticos tal cual al output
  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/js");
  eleventyConfig.addPassthroughCopy("src/img");
  eleventyConfig.addPassthroughCopy("src/robots.txt");
  eleventyConfig.addPassthroughCopy("src/sitemap.xml");
  eleventyConfig.addPassthroughCopy("src/CNAME");
  eleventyConfig.addPassthroughCopy("src/favicon.ico");
  eleventyConfig.addPassthroughCopy("src/favicon-32x32.png");
  eleventyConfig.addPassthroughCopy("src/favicon-16x16.png");
  eleventyConfig.addPassthroughCopy("src/apple-touch-icon.png");

  // Filtro para formatear fechas en español
  eleventyConfig.addFilter("fechaEs", function(dateVal) {
    const meses = ["enero","febrero","marzo","abril","mayo","junio",
                   "julio","agosto","septiembre","octubre","noviembre","diciembre"];
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal + "T00:00:00");
    return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
  });

  // Filtro para ordenar posts por fecha descendente
  eleventyConfig.addFilter("ordenarPorFecha", function(posts) {
    return posts.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
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
