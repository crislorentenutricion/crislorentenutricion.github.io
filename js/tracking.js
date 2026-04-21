// Capa DOM de tracking: consent banner + disparo de eventos Lead a Meta Pixel,
// Google Ads y Amplitude. Duplica funciones mínimas de tracking-logic.js
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

  function normalizeEmail(email) {
    if (typeof email !== 'string') return '';
    return email.trim().toLowerCase();
  }

  function normalizePhone(phone) {
    if (typeof phone !== 'string') return '';
    var cleaned = phone.replace(/[^\d+]/g, '');
    if (!cleaned) return '';
    if (cleaned.charAt(0) === '+') return cleaned;
    if (cleaned.length === 9) return '+34' + cleaned;
    if (cleaned.length === 11 && cleaned.indexOf('34') === 0) return '+' + cleaned;
    return cleaned;
  }

  function makeEventId() {
    return 'cln_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function safe(fn) {
    try { fn(); } catch (_) {}
  }

  /* ============================================================
   * Carga dinámica de Pixel y Google Ads (solo con consent aceptado)
   * ============================================================ */

  var pixelLoaded = false;
  var googleAdsLoaded = false;

  function loadMetaPixel(pixelId) {
    if (pixelLoaded || !pixelId) return;
    safe(function () {
      // Snippet oficial de Meta, reescrito en forma expandida para legibilidad.
      var f = window, b = document;
      if (f.fbq) { pixelLoaded = true; return; }
      var n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
      var t = b.createElement('script');
      t.async = true;
      t.src = 'https://connect.facebook.net/en_US/fbevents.js';
      var s = b.getElementsByTagName('script')[0];
      s.parentNode.insertBefore(t, s);
      window.fbq('init', pixelId);
      window.fbq('track', 'PageView');
      pixelLoaded = true;
    });
  }

  function loadGoogleAds(googleAdsId) {
    if (googleAdsLoaded || !googleAdsId) return;
    safe(function () {
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(googleAdsId);
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', googleAdsId, { allow_enhanced_conversions: true });
      googleAdsLoaded = true;
    });
  }

  function loadMarketingScripts(cfg) {
    loadMetaPixel(cfg.metaPixelId);
    loadGoogleAds(cfg.googleAdsId);
  }

  /* ============================================================
   * Consent banner
   * ============================================================ */

  function showBanner(cfg) {
    var banner = document.getElementById('cln-consent-banner');
    if (!banner) return;
    banner.hidden = false;
    var accept = banner.querySelector('[data-consent-accept]');
    var reject = banner.querySelector('[data-consent-reject]');
    if (accept) accept.addEventListener('click', function () {
      writeConsent(CONSENT_ACCEPTED);
      banner.hidden = true;
      loadMarketingScripts(cfg);
    });
    if (reject) reject.addEventListener('click', function () {
      writeConsent(CONSENT_REJECTED);
      banner.hidden = true;
    });
  }

  function init() {
    var cfg = window.__CLN_TRACKING__ || {};
    var consent = readConsent();
    if (consent === CONSENT_ACCEPTED) {
      loadMarketingScripts(cfg);
    } else if (consent === null) {
      // Si no hay IDs de marketing configurados, no hay razón para mostrar el banner.
      if (cfg.metaPixelId || cfg.googleAdsId) showBanner(cfg);
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

  function trackPixelLead(leadEvent) {
    safe(function () {
      if (typeof window.fbq !== 'function') return;
      window.fbq('track', 'Lead', {
        currency: leadEvent.currency || 'EUR',
        value: leadEvent.value || 0,
        content_name: leadEvent.plan || ''
      }, { eventID: leadEvent.eventId || undefined });
    });
  }

  function trackGoogleAdsConversion(leadEvent) {
    safe(function () {
      var cfg = window.__CLN_TRACKING__ || {};
      if (!cfg.googleAdsId || !cfg.googleAdsConversionLabel) return;
      if (typeof window.gtag !== 'function') return;
      if (leadEvent.email || leadEvent.phone) {
        window.gtag('set', 'user_data', {
          email: leadEvent.email || undefined,
          phone_number: leadEvent.phone || undefined
        });
      }
      window.gtag('event', 'conversion', {
        send_to: cfg.googleAdsId + '/' + cfg.googleAdsConversionLabel,
        currency: leadEvent.currency || 'EUR',
        value: leadEvent.value || 0,
        transaction_id: leadEvent.eventId || ''
      });
    });
  }

  /* ============================================================
   * API pública: window.cln.trackLead(), window.cln.trackInitiateCheckout()
   * ============================================================ */

  function trackLead(input) {
    input = input || {};
    var ev = {
      email: normalizeEmail(input.email),
      phone: normalizePhone(input.phone),
      plan: typeof input.plan === 'string' ? input.plan : '',
      value: typeof input.value === 'number' ? input.value : 0,
      currency: typeof input.currency === 'string' ? input.currency : 'EUR',
      eventId: (typeof input.eventId === 'string' && input.eventId) ? input.eventId : makeEventId()
    };
    // Amplitude SIEMPRE (primera-party, ya enmascarado por privacyConfig en base.njk).
    trackAmplitude('valoracion_solicitada', {
      plan: ev.plan,
      value: ev.value,
      currency: ev.currency,
      event_id: ev.eventId
    });
    // Pixel + Google Ads solo con consent aceptado.
    if (readConsent() === CONSENT_ACCEPTED) {
      trackPixelLead(ev);
      trackGoogleAdsConversion(ev);
    }
    return ev;
  }

  function trackInitiateCheckout(plan) {
    trackAmplitude('plan_seleccionado', { plan: plan || '' });
    if (readConsent() === CONSENT_ACCEPTED && typeof window.fbq === 'function') {
      safe(function () {
        window.fbq('track', 'InitiateCheckout', { content_name: plan || '' });
      });
    }
  }

  window.cln = window.cln || {};
  window.cln.trackLead = trackLead;
  window.cln.trackInitiateCheckout = trackInitiateCheckout;
  window.cln.consent = {
    status: readConsent,
    accept: function () {
      writeConsent(CONSENT_ACCEPTED);
      var cfg = window.__CLN_TRACKING__ || {};
      loadMarketingScripts(cfg);
    },
    reject: function () { writeConsent(CONSENT_REJECTED); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
