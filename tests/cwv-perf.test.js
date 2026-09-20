// Tests de rendimiento móvil (Core Web Vitals, tarea SEO #27).
//
// A) El banner de cookies era el elemento LCP en móvil y aparecía tarde porque
//    lo mostraba tracking.js (defer). Un script inline justo tras el banner lo
//    muestra en el primer pintado si no hay consentimiento guardado. tracking.js
//    sigue gestionando botones y cierre.
// B) El plugin de Amplitude Session Replay (95 KB) se descargaba en todas las
//    visitas aunque solo graba el 10 %. Ahora se inyecta tras el evento load.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { CONSENT_KEY } = require('../src/js/tracking-logic.js');

const root = path.join(__dirname, '..');
const consentNjk = fs.readFileSync(path.join(root, 'src/_includes/consent-banner.njk'), 'utf8');
const baseNjk = fs.readFileSync(path.join(root, 'src/_includes/layouts/base.njk'), 'utf8');

function inlineBannerScript() {
  const m = consentNjk.match(/<\/div>\s*<script>([\s\S]*?)<\/script>\s*$/);
  assert.ok(m, 'consent-banner.njk debe terminar con un <script> inline tras el banner');
  return m[1];
}

function runBannerScript(storage) {
  const banner = { hidden: true };
  const context = {
    document: { getElementById: (id) => (id === 'cln-consent-banner' ? banner : null) },
    get localStorage() {
      if (storage === 'throws') throw new Error('SecurityError');
      return storage;
    },
  };
  context.window = context;
  vm.runInNewContext(inlineBannerScript(), context);
  return banner;
}

function fakeStorage(value) {
  return { getItem: (k) => (k === CONSENT_KEY ? value : null) };
}

test('banner: el markup sigue saliendo oculto (sin JS no se muestra)', () => {
  assert.match(consentNjk, /id="cln-consent-banner"[^>]*\bhidden\b/);
});

test('banner: sin consentimiento guardado se muestra en el primer pintado', () => {
  assert.equal(runBannerScript(fakeStorage(null)).hidden, false);
});

test('banner: con consentimiento aceptado o rechazado sigue oculto', () => {
  assert.equal(runBannerScript(fakeStorage('accepted')).hidden, true);
  assert.equal(runBannerScript(fakeStorage('rejected')).hidden, true);
});

test('banner: valor desconocido se trata como sin consentimiento (igual que readConsent)', () => {
  assert.equal(runBannerScript(fakeStorage('otra-cosa')).hidden, false);
});

test('banner: storage roto se trata como sin consentimiento (igual que tracking.js)', () => {
  assert.equal(runBannerScript('throws').hidden, false);
});

test('banner: el script inline usa la misma clave que tracking-logic', () => {
  assert.ok(inlineBannerScript().includes(`'${CONSENT_KEY}'`));
});

test('replay: el plugin de Session Replay no se carga con <script src> en el HTML', () => {
  assert.doesNotMatch(baseNjk, /<script[^>]+src="[^"]*plugin-session-replay[^"]*"/);
});

test('replay: el plugin se inyecta tras el evento load y se añade a amplitude', () => {
  assert.match(baseNjk, /addEventListener\('load'[\s\S]*plugin-session-replay-browser-[\d.]+-min\.js\.gz[\s\S]*amplitude\.add\(/);
});

test('replay: se conservan sampleRate 0.1 y el enmascarado de inputs', () => {
  assert.match(baseNjk, /sampleRate:\s*0\.1/);
  assert.match(baseNjk, /maskSelector:\s*\['input', 'textarea', 'select', '\.form-sensitive'\]/);
});

test('amplitude: init con autocapture sigue en DOMContentLoaded', () => {
  assert.match(baseNjk, /DOMContentLoaded[\s\S]*amplitude\.init\('\{\{ env\.amplitudeApiKey \}\}', \{ autocapture: true \}\)/);
});

// C) Fuentes autoalojadas: sin conexiones a Google Fonts en el camino crítico.

const headMeta = fs.readFileSync(path.join(root, 'src/_includes/head-meta.njk'), 'utf8');
const styleCss = fs.readFileSync(path.join(root, 'src/css/style.css'), 'utf8');
const eleventyJs = fs.readFileSync(path.join(root, '.eleventy.js'), 'utf8');

test('fuentes: ninguna plantilla carga Google Fonts', () => {
  assert.doesNotMatch(headMeta, /fonts\.(googleapis|gstatic)\.com/);
});

test('fuentes: @font-face para Cormorant Garamond (normal e itálica) y Jost con ficheros existentes', () => {
  const faces = [...styleCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const find = (family, style) => faces.find((f) => f.includes(`'${family}'`) && f.includes(`font-style: ${style}`));
  for (const [family, style] of [['Cormorant Garamond', 'normal'], ['Cormorant Garamond', 'italic'], ['Jost', 'normal']]) {
    const face = find(family, style);
    assert.ok(face, `falta @font-face ${family} ${style}`);
    assert.match(face, /font-display: swap/);
  }
  for (const face of faces) {
    const url = face.match(/url\('\/fonts\/([^']+\.woff2)'\)/);
    assert.ok(url, 'cada @font-face debe apuntar a /fonts/*.woff2');
    assert.ok(fs.existsSync(path.join(root, 'src/fonts', url[1])), `no existe src/fonts/${url[1]}`);
  }
});

test('fuentes: se copian al build y la de texto se precarga', () => {
  assert.match(eleventyJs, /addPassthroughCopy\("src\/fonts"\)/);
  assert.match(headMeta, /<link rel="preload" href="\/fonts\/jost[^"]*\.woff2" as="font" type="font\/woff2" crossorigin>/);
});
