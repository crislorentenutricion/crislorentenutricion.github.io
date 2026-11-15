// Test de integración (wiring) para el flujo de tracking Lead.
//
// No levanta un navegador — comprueba por lectura de ficheros que las piezas
// del puzzle están conectadas:
//   · booking.js llama a window.cln.trackLead(...) al confirmarse la reserva.
//   · main.js llama a window.cln.trackInitiateCheckout(...) en click de plan-btn.
//   · base.njk incluye consent-banner + tracking.js si hay alguna herramienta de medición configurada.
//   · Amplitude, Session Replay, Pixel y gtag solo se cargan desde tracking.js y tras «Aceptar».
//   · La reserva lleva al backend la elección del banner (el backend decide el envío a Meta).
//   · tracking.js expone window.cln.trackLead y window.cln.trackInitiateCheckout.
//   · tracking.js consume window.__CLN_TRACKING__ (configurado por base.njk).
//
// Existe porque sin estos cables, el evento Lead NUNCA se dispara aunque
// los IDs estén configurados. Es el "cable rojo + cable azul" del dashboard
// de Fase 1: si se cae, no nos enteramos hasta el primer euro gastado en ads.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const bookingJs = fs.readFileSync(path.join(root, 'src/js/booking.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(root, 'src/js/main.js'), 'utf8');
const trackingJs = fs.readFileSync(path.join(root, 'src/js/tracking.js'), 'utf8');
const baseNjk = fs.readFileSync(path.join(root, 'src/_includes/layouts/base.njk'), 'utf8');
const consentNjk = fs.readFileSync(path.join(root, 'src/_includes/consent-banner.njk'), 'utf8');
const envJs = fs.readFileSync(path.join(root, 'src/_data/env.js'), 'utf8');

test('booking.js llama a window.cln.trackLead tras confirmar reserva', () => {
  assert.match(
    bookingJs,
    /window\.cln\.trackLead\s*\(\s*\{[\s\S]*email[\s\S]*telefono[\s\S]*plan[\s\S]*value[\s\S]*eventId[\s\S]*\}\s*\)/,
    'booking.js debe invocar window.cln.trackLead con email, telefono, plan, value, eventId'
  );
  assert.match(
    bookingJs,
    /track\(['"]booking_confirmed['"]/,
    'booking.js debe seguir emitiendo evento Amplitude booking_confirmed (no tocar regresión)'
  );
});

test('main.js llama a window.cln.trackInitiateCheckout en click de plan-btn', () => {
  assert.match(
    mainJs,
    /window\.cln\.trackInitiateCheckout\s*\(/,
    'main.js debe invocar trackInitiateCheckout en el handler del plan-btn'
  );
});

test('tracking.js expone las funciones públicas esperadas', () => {
  assert.match(trackingJs, /window\.cln\.trackLead\s*=/, 'debe exponer trackLead');
  assert.match(trackingJs, /window\.cln\.trackInitiateCheckout\s*=/, 'debe exponer trackInitiateCheckout');
  assert.match(trackingJs, /window\.cln\.consent\s*=/, 'debe exponer API de consent');
});

test('tracking.js lee la configuración de window.__CLN_TRACKING__', () => {
  assert.match(
    trackingJs,
    /window\.__CLN_TRACKING__/,
    'tracking.js debe consumir la config inyectada por base.njk'
  );
  assert.match(trackingJs, /metaPixelId/, 'debe usar metaPixelId');
  assert.match(trackingJs, /googleAdsId/, 'debe usar googleAdsId');
  assert.match(trackingJs, /googleAdsConversionLabel/, 'debe usar googleAdsConversionLabel');
});

test('tracking.js carga Pixel + gtag solo tras consent aceptado', () => {
  // Rama consent === CONSENT_ACCEPTED debe disparar loadMarketingScripts.
  assert.match(trackingJs, /consent\s*===\s*CONSENT_ACCEPTED/);
  assert.match(trackingJs, /loadMarketingScripts/);
  // Y debe cargar fbevents.js + googletagmanager.
  assert.match(trackingJs, /connect\.facebook\.net\/en_US\/fbevents\.js/);
  assert.match(trackingJs, /googletagmanager\.com\/gtag\/js/);
});

test('base.njk incluye tracking.js + consent-banner.njk si hay alguna herramienta de medición', () => {
  // El bloque está gated por un {% if ... %}
  assert.match(
    baseNjk,
    /\{%\s*if\s+env\.amplitudeApiKey\s+or\s+env\.metaPixelId\s+or\s+env\.googleAdsId\s*%\}/,
    'base.njk debe gatear la inyección por env.amplitudeApiKey OR env.metaPixelId OR env.googleAdsId'
  );
  assert.match(
    baseNjk,
    /window\.__CLN_TRACKING__/,
    'base.njk debe inyectar la config global __CLN_TRACKING__'
  );
  assert.match(
    baseNjk,
    /\{%\s*include\s+"consent-banner\.njk"\s*%\}/,
    'base.njk debe incluir el banner de consent'
  );
  assert.match(
    baseNjk,
    /src="\/js\/tracking\.js"/,
    'base.njk debe cargar /js/tracking.js'
  );
});

test('consent-banner.njk tiene los hooks esperados para tracking.js', () => {
  assert.match(consentNjk, /id="cln-consent-banner"/);
  assert.match(consentNjk, /data-consent-accept/);
  assert.match(consentNjk, /data-consent-reject/);
  // Link a la política — requerimiento RGPD
  assert.match(consentNjk, /href="\/legal\/privacidad\/#cookies"/);
});

test('env.js expone metaPixelId, googleAdsId, googleAdsConversionLabel', () => {
  assert.match(envJs, /metaPixelId:\s*process\.env\.META_PIXEL_ID/);
  assert.match(envJs, /googleAdsId:\s*process\.env\.GOOGLE_ADS_ID/);
  assert.match(envJs, /googleAdsConversionLabel:\s*process\.env\.GOOGLE_ADS_CONVERSION_LABEL/);
});

/* ============================================================
 * Consentimiento: nada de medición sin «Aceptar»
 * ============================================================ */

const headMetaNjk = fs.readFileSync(path.join(root, 'src/_includes/head-meta.njk'), 'utf8');
const footerNjk = fs.readFileSync(path.join(root, 'src/_includes/footer.njk'), 'utf8');
const trackingLogic = require('../src/js/tracking-logic.js');

test('ninguna plantilla carga ni preconecta con Amplitude por su cuenta', () => {
  const layouts = fs.readdirSync(path.join(root, 'src/_includes/layouts'))
    .map((f) => fs.readFileSync(path.join(root, 'src/_includes/layouts', f), 'utf8'));
  for (const tpl of [...layouts, headMetaNjk]) {
    assert.doesNotMatch(tpl, /amplitude\.com/, 'Amplitude solo se carga desde tracking.js');
    assert.doesNotMatch(tpl, /amplitude\.init/);
  }
  assert.match(baseNjk, /amplitudeApiKey:\s*'\{\{ env\.amplitudeApiKey \}\}'/, 'la clave viaja en __CLN_TRACKING__');
});

// Carga tracking.js en un DOM mínimo y devuelve qué scripts inyecta.
function runTracking({ consent, cfg, cookies }) {
  const vm = require('node:vm');
  const store = new Map(consent ? [['cln_consent_v1', consent]] : []);
  const injected = [];
  const listeners = {};
  const mkEl = () => ({
    hidden: true, _l: {},
    addEventListener(ev, fn) { this._l[ev] = fn; },
    focus() {},
    querySelector(sel) { return this._children[sel] || null; },
  });
  const accept = mkEl(); const reject = mkEl(); const opener = mkEl();
  const banner = mkEl();
  banner._children = { '[data-consent-accept]': accept, '[data-consent-reject]': reject };
  const state = { cookie: cookies || '', written: [], reloaded: false };
  const document = {
    readyState: 'complete',
    head: { appendChild(s) { injected.push(s.src); } },
    createElement: () => ({}),
    getElementById: (id) => (id === 'cln-consent-banner' ? banner : null),
    getElementsByTagName: () => [{ parentNode: { insertBefore(s) { injected.push(s.src); } } }],
    querySelectorAll: (sel) => (sel === '[data-consent-open]' ? [opener] : []),
    addEventListener(ev, fn) { listeners[ev] = fn; },
    get cookie() { return state.cookie; },
    set cookie(v) { state.written.push(v); },
  };
  const window = {
    document,
    __CLN_TRACKING__: cfg,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      key: (i) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    },
    location: { hostname: 'www.crislorentenutricion.com', reload() { state.reloaded = true; } },
    addEventListener() {},
  };
  vm.runInNewContext(trackingJs, { window, document, Date, Math, encodeURIComponent });
  return { window, banner, accept, reject, opener, injected, store, state };
}

const CFG = { amplitudeApiKey: 'k', metaPixelId: '1', googleAdsId: 'AW-1', googleAdsConversionLabel: 'l' };

test('sin elección guardada: se muestra el banner y no se inyecta ningún script', () => {
  const r = runTracking({ consent: null, cfg: CFG });
  assert.equal(r.banner.hidden, false);
  assert.deepEqual(r.injected, []);
});

test('solo con Amplitude configurado también se pregunta', () => {
  const r = runTracking({ consent: null, cfg: { amplitudeApiKey: 'k', metaPixelId: '', googleAdsId: '' } });
  assert.equal(r.banner.hidden, false);
  assert.deepEqual(r.injected, []);
});

test('rechazado: no se inyecta ningún script ni se vuelve a preguntar', () => {
  const r = runTracking({ consent: 'rejected', cfg: CFG });
  assert.equal(r.banner.hidden, true);
  assert.deepEqual(r.injected, []);
  assert.equal(r.window.cln.consent.status(), 'rejected');
});

test('al pulsar «Aceptar» se cargan Amplitude, Pixel y gtag', () => {
  const r = runTracking({ consent: null, cfg: CFG });
  r.accept._l.click();
  assert.equal(r.store.get('cln_consent_v1'), 'accepted');
  assert.equal(r.banner.hidden, true);
  assert.ok(r.injected.some((s) => /cdn\.amplitude\.com\/libs\/analytics-browser/.test(s)));
  assert.ok(r.injected.some((s) => /connect\.facebook\.net/.test(s)));
  assert.ok(r.injected.some((s) => /googletagmanager\.com/.test(s)));
});

test('«Configurar cookies» reabre el banner y rechazar retira el consentimiento', () => {
  const r = runTracking({ consent: 'accepted', cfg: CFG, cookies: 'AMP_abc=1; _gcl_au=2; otra=3' });
  r.store.set('AMP_unsent_abc', '[]');
  assert.equal(r.banner.hidden, true);
  r.opener._l.click({ preventDefault() {} });
  assert.equal(r.banner.hidden, false);
  r.reject._l.click();
  assert.equal(r.store.get('cln_consent_v1'), 'rejected');
  assert.equal(r.store.has('AMP_unsent_abc'), false, 'se limpia el almacenamiento de Amplitude');
  assert.ok(r.state.written.some((c) => c.startsWith('AMP_abc=;')), 'se caduca la cookie de Amplitude');
  assert.ok(r.state.written.some((c) => c.startsWith('_gcl_au=;')), 'se caduca la cookie de Google Ads');
  assert.ok(!r.state.written.some((c) => c.startsWith('otra=')), 'no se tocan cookies ajenas');
  assert.equal(r.state.reloaded, true, 'se recarga para que los scripts dejen de ejecutarse');
});

test('isMeasurementCookie reconoce las cookies de medición y usa la misma expresión que tracking.js', () => {
  for (const n of ['AMP_abc123', 'AMP_MKTG_abc', '_fbp', '_fbc', '_gcl_au', '_ga', '_ga_XYZ']) {
    assert.equal(trackingLogic.isMeasurementCookie(n), true, n);
  }
  for (const n of ['cln_consent_v1', 'sb-access-token', '_fbpx', '', null]) {
    assert.equal(trackingLogic.isMeasurementCookie(n), false, String(n));
  }
  const re = /MEASUREMENT_COOKIE_RE = (\/.*\/);/;
  const logicSrc = fs.readFileSync(path.join(root, 'src/js/tracking-logic.js'), 'utf8');
  assert.equal(trackingJs.match(re)[1], logicSrc.match(re)[1]);
});

test('el banner ofrece aceptar y rechazar con el mismo peso visual y nombra a los terceros', () => {
  const btns = consentNjk.match(/<button[^>]*>/g);
  assert.equal(btns.length, 2);
  const cls = btns.map((b) => b.match(/class="([^"]*)"/)[1]);
  assert.equal(cls[0], cls[1], 'los dos botones comparten clase');
  assert.match(consentNjk, />Aceptar</);
  assert.match(consentNjk, />Rechazar</);
  for (const tercero of ['Amplitude', 'Google', 'Meta']) assert.match(consentNjk, new RegExp(tercero));
});

test('el pie enlaza «Configurar cookies» y la reserva envía la elección al backend', () => {
  assert.match(footerNjk, /data-consent-open[^>]*>Configurar cookies</);
  assert.match(bookingJs, /payload\.consent\s*=\s*window\.cln\.consent\.status\(\)/);
});
