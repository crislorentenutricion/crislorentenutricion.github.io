// Test de integración (wiring) para el flujo de tracking Lead.
//
// No levanta un navegador — comprueba por lectura de ficheros que las piezas
// del puzzle están conectadas:
//   · booking.js llama a window.cln.trackLead(...) al confirmarse la reserva.
//   · main.js llama a window.cln.trackInitiateCheckout(...) en click de plan-btn.
//   · base.njk incluye consent-banner + tracking.js (gated por env.metaPixelId / env.googleAdsId).
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

test('base.njk incluye tracking.js + consent-banner.njk solo con env.metaPixelId o env.googleAdsId', () => {
  // El bloque está gated por un {% if ... %}
  assert.match(
    baseNjk,
    /\{%\s*if\s+env\.metaPixelId\s+or\s+env\.googleAdsId\s*%\}/,
    'base.njk debe gatear la inyección por env.metaPixelId OR env.googleAdsId'
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
  assert.match(consentNjk, /href="\/legal\/privacidad\/"/);
});

test('env.js expone metaPixelId, googleAdsId, googleAdsConversionLabel', () => {
  assert.match(envJs, /metaPixelId:\s*process\.env\.META_PIXEL_ID/);
  assert.match(envJs, /googleAdsId:\s*process\.env\.GOOGLE_ADS_ID/);
  assert.match(envJs, /googleAdsConversionLabel:\s*process\.env\.GOOGLE_ADS_CONVERSION_LABEL/);
});

test('amplitude sigue gated por env.amplitudeApiKey (no regresión)', () => {
  assert.match(baseNjk, /\{%\s*if\s+env\.amplitudeApiKey\s*%\}/);
  assert.match(baseNjk, /cdn\.amplitude\.com/);
});
