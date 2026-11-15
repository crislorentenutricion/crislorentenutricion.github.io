// Capa DOM de tracking: consent banner + carga de Amplitude (no se carga sin
// «Aceptar») + disparo de eventos Lead. Duplica funciones mínimas de tracking-logic.js
// porque el sitio es estático sin bundler — los tests viven en Node y cargan
// tracking-logic.js directamente; el navegador carga este fichero vía <script>.

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var CONSENT_KEY = 'cln_consent_v1';
  var CONSENT_ACCEPTED = 'accepted';
  var CONSENT_REJECTED = 'rejected';

  function getStorage() {
    try { return window.localStorage; } catch (_) { return null; }
  }

  function readConsent() {
    var s = getStorage();
    if (!s) return null;
    try {
      var v = s.getItem(CONSENT_KEY);
      return (v === CONSENT_ACCEPTED || v === CONSENT_REJECTED) ? v : null;
    } catch (_) { return null; }
  }

  function writeConsent(v) {
    var s = getStorage();
    if (!s) return;
    try { s.setItem(CONSENT_KEY, v); } catch (_) {}
  }

  function makeEventId() {
    return 'cln_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function safe(fn) {
    try { fn(); } catch (_) {}
  }

  /* ============================================================
   * Carga dinámica de Amplitude (solo con consent aceptado)
   * ============================================================ */

  var amplitudeLoaded = false;

  var AMPLITUDE_SDK_URL = 'https://cdn.amplitude.com/libs/analytics-browser-2.11.1-min.js.gz';
  var AMPLITUDE_REPLAY_URL = 'https://cdn.amplitude.com/libs/plugin-session-replay-browser-1.8.2-min.js.gz';

  function loadScript(src, onload) {
    var s = document.createElement('script');
    s.async = true;
    s.src = src;
    if (onload) s.onload = onload;
    document.head.appendChild(s);
  }

  function afterWindowLoad(fn) {
    if (document.readyState === 'complete') fn();
    else window.addEventListener('load', fn);
  }

  function loadAmplitude(apiKey) {
    if (amplitudeLoaded || !apiKey) return;
    amplitudeLoaded = true;
    safe(function () {
      loadScript(AMPLITUDE_SDK_URL, function () {
        safe(function () {
          window.amplitude.init(apiKey, { autocapture: true });
        });
        // Session Replay (95 KB) tras load: no compite con el primer pintado en móvil.
        afterWindowLoad(function () {
          loadScript(AMPLITUDE_REPLAY_URL, function () {
            safe(function () {
              window.amplitude.add(window.sessionReplay.plugin({
                sampleRate: 0.1,
                privacyConfig: { defaultMaskLevel: 'medium', maskSelector: ['input', 'textarea', 'select', '.form-sensitive'] }
              }));
            });
          });
        });
      });
    });
  }

  function loadMeasurementScripts(cfg) {
    loadAmplitude(cfg.amplitudeApiKey);
  }

  /* ============================================================
   * Consent banner
   * ============================================================ */

  // Cookies y almacenamiento que deja Amplitude.
  // Misma expresión que isMeasurementCookie en tracking-logic.js.
  var MEASUREMENT_COOKIE_RE = /^AMP_/;

  function clearMeasurementData() {
    safe(function () {
      var host = window.location.hostname;
      var parts = host.split('.');
      var domains = ['', host, '.' + (parts.length > 2 ? parts.slice(-2).join('.') : host)];
      document.cookie.split(';').forEach(function (pair) {
        var name = pair.split('=')[0].trim();
        if (!MEASUREMENT_COOKIE_RE.test(name)) return;
        domains.forEach(function (d) {
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
        });
      });
    });
    safe(function () {
      var s = getStorage();
      if (!s) return;
      var keys = [];
      for (var i = 0; i < s.length; i++) {
        var k = s.key(i);
        if (k && k.indexOf('AMP_') === 0) keys.push(k);
      }
      keys.forEach(function (k) { s.removeItem(k); });
    });
  }

  function acceptConsent(cfg) {
    writeConsent(CONSENT_ACCEPTED);
    loadMeasurementScripts(cfg);
  }

  // Rechazar también es retirar: si antes se había aceptado, se borra lo que
  // dejaron las herramientas y se recarga para que dejen de ejecutarse.
  function rejectConsent() {
    var wasAccepted = readConsent() === CONSENT_ACCEPTED;
    writeConsent(CONSENT_REJECTED);
    if (!wasAccepted) return;
    safe(function () {
      if (window.amplitude && typeof window.amplitude.setOptOut === 'function') window.amplitude.setOptOut(true);
    });
    clearMeasurementData();
    safe(function () { window.location.reload(); });
  }

  function bindBanner(cfg) {
    var banner = document.getElementById('cln-consent-banner');
    if (!banner) return;
    var accept = banner.querySelector('[data-consent-accept]');
    var reject = banner.querySelector('[data-consent-reject]');
    if (accept) accept.addEventListener('click', function () {
      banner.hidden = true;
      acceptConsent(cfg);
    });
    if (reject) reject.addEventListener('click', function () {
      banner.hidden = true;
      rejectConsent();
    });
    // «Configurar cookies» (pie de página): reabre el banner para cambiar la elección.
    var openers = document.querySelectorAll('[data-consent-open]');
    for (var i = 0; i < openers.length; i++) {
      openers[i].addEventListener('click', function (e) {
        e.preventDefault();
        banner.hidden = false;
        if (accept) accept.focus();
      });
    }
  }

  function init() {
    var cfg = window.__CLN_TRACKING__ || {};
    // Sin herramienta configurada no hay nada que consentir.
    if (!cfg.amplitudeApiKey) return;
    bindBanner(cfg);
    var consent = readConsent();
    if (consent === CONSENT_ACCEPTED) {
      loadMeasurementScripts(cfg);
    } else if (consent === null) {
      var banner = document.getElementById('cln-consent-banner');
      if (banner) banner.hidden = false;
    }
  }

  /* ============================================================
   * Trackers
   * ============================================================ */

  function trackAmplitude(eventName, props) {
    safe(function () {
      if (window.amplitude && typeof window.amplitude.track === 'function') {
        window.amplitude.track(eventName, props || {});
      }
    });
  }

  /* ============================================================
   * API pública: window.cln.trackLead(), window.cln.trackInitiateCheckout()
   * ============================================================ */

  function trackLead(input) {
    input = input || {};
    var ev = {
      plan: typeof input.plan === 'string' ? input.plan : '',
      value: typeof input.value === 'number' ? input.value : 0,
      currency: typeof input.currency === 'string' ? input.currency : 'EUR',
      eventId: (typeof input.eventId === 'string' && input.eventId) ? input.eventId : makeEventId()
    };
    // Amplitude: no-op si no se ha cargado (solo se carga con consent aceptado).
    trackAmplitude('valoracion_solicitada', {
      plan: ev.plan,
      value: ev.value,
      currency: ev.currency,
      event_id: ev.eventId
    });
    return ev;
  }

  function trackInitiateCheckout(plan) {
    trackAmplitude('plan_seleccionado', { plan: plan || '' });
  }

  window.cln = window.cln || {};
  window.cln.trackLead = trackLead;
  window.cln.trackInitiateCheckout = trackInitiateCheckout;
  window.cln.consent = {
    status: readConsent,
    accept: function () { acceptConsent(window.__CLN_TRACKING__ || {}); },
    reject: rejectConsent
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
