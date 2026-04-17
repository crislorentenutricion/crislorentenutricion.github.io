// Carga .eleventy.js en un config mock y expone filters/transforms/passthrough/events
// sin tener que arrancar eleventy. Permite testear cada filtro como función pura.

const path = require("path");

function loadEleventyConfig() {
  const registry = {
    filters: {},
    transforms: {},
    passthrough: [],
    events: {},
  };

  const mockConfig = {
    addFilter(name, fn) { registry.filters[name] = fn; },
    addTransform(name, fn) { registry.transforms[name] = fn; },
    addPassthroughCopy(p) { registry.passthrough.push(p); },
    on(event, fn) { registry.events[event] = fn; },
  };

  const configPath = path.join(__dirname, "..", "..", ".eleventy.js");
  delete require.cache[require.resolve(configPath)];
  const factory = require(configPath);
  const eleventyReturn = factory(mockConfig);
  registry.eleventyReturn = eleventyReturn;
  registry.minifyCss = factory.minifyCss;
  return registry;
}

module.exports = { loadEleventyConfig };
