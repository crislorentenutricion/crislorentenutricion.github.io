// Capa DOM del bloque de captación del lead magnet (planificador semanal).
// Consume funciones puras expuestas por lead-magnet-logic.js.
//
// Flujo: usuario rellena nombre + email + consent → hCaptcha invisible →
// POST a la Edge Function `lead-magnet-alta` → muestra mensaje según
// respuesta. La Edge Function hace doble opt-in: el éxito aquí significa
// "te he mandado un correo para que confirmes".
//
// La URL del endpoint y la sitekey de hCaptcha se inyectan en el HTML como
// atributos data-* sobre el contenedor [data-lead-magnet]. Si la URL no está
// configurada (build sin SUPABASE_URL), el POST se omite y se muestra un
// mensaje genérico de error — el bloque no se rompe.

(function () {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const TIMEOUT_MS = 20000;

  function track(eventName, props) {
    try {
      if (typeof window !== 'undefined' && window.amplitude && typeof window.amplitude.track === 'function') {
        window.amplitude.track(eventName, props || {});
      }
    } catch (_) { /* telemetría nunca rompe UX */ }
  }

  // hCaptcha: render dedicado del bloque, sin chocar con booking.js.
  // No usamos `?onload=__onHcaptchaLoad` (esa global la usa booking.js):
  // sondeamos `window.hcaptcha` cuando toca y renderizamos nuestro propio
  // widget en su propio contenedor. Idempotente: si la lib ya está cargada
  // (porque booking.js la trajo), aprovechamos eso.
  function ensureHcaptchaScriptLoaded() {
    if (window.hcaptcha) return;
    // Booking.js marca su propio <script> con `data-hcaptcha`. Si está, lo
    // reusamos (sondeamos `window.hcaptcha` después). Si NO, inyectamos uno
    // con marker propio. No usamos `data-hcaptcha` aquí: ese marker indica
    // "tiene `?onload=__onHcaptchaLoad`", y mezclarlos haría que booking
    // saltara su propia inyección y no recibiera nunca su callback.
    if (document.querySelector('script[data-hcaptcha]') ||
        document.querySelector('script[data-hcaptcha-lead-magnet]') ||
        document.querySelector('script[src^="https://js.hcaptcha.com/1/api.js"]')) {
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://js.hcaptcha.com/1/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.setAttribute('data-hcaptcha-lead-magnet', '');
    document.head.appendChild(s);
  }

  function waitForHcaptchaApi(maxMs) {
    return new Promise(function (resolve) {
      const start = Date.now();
      (function poll() {
        if (window.hcaptcha && typeof window.hcaptcha.render === 'function') return resolve(true);
        if (Date.now() - start > maxMs) return resolve(false);
        setTimeout(poll, 100);
      })();
    });
  }

  function makeCaptchaController(siteKey) {
    let widgetId = null;
    let renderAttempted = false;

    async function ensureWidget() {
      if (!siteKey) return false;
      if (widgetId !== null) return true;
      if (renderAttempted) return false;
      renderAttempted = true;
      ensureHcaptchaScriptLoaded();
      const ready = await waitForHcaptchaApi(10000);
      if (!ready) return false;
      try {
        let container = document.getElementById('hcaptcha-lead-magnet-container');
        if (!container) {
          container = document.createElement('div');
          container.id = 'hcaptcha-lead-magnet-container';
          container.style.display = 'none';
          document.body.appendChild(container);
        }
        widgetId = window.hcaptcha.render('hcaptcha-lead-magnet-container', {
          sitekey: siteKey,
          size: 'invisible'
        });
        return true;
      } catch (_) {
        return false;
      }
    }

    async function getToken() {
      if (!siteKey) return '';
      const ok = await ensureWidget();
      if (!ok || widgetId === null) return '';
      try {
        const res = await window.hcaptcha.execute(widgetId, { async: true });
        return (res && res.response) || '';
      } catch (_) {
        return '';
      }
    }

    return { getToken: getToken };
  }

  async function postLead(endpointUrl, payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      let body = null;
      try { body = await response.json(); } catch (_) { /* respuesta sin JSON */ }
      return { status: response.status, body: body };
    } finally {
      clearTimeout(timer);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const root = document.querySelector('[data-lead-magnet]');
    if (!root) return;

    const endpointUrl = root.getAttribute('data-endpoint-url') || '';
    const hcaptchaSiteKey = root.getAttribute('data-hcaptcha-sitekey') || '';

    const form = root.querySelector('[data-lead-form]');
    const status = root.querySelector('[data-lead-status]');
    const nombreInput = root.querySelector('[data-lead-nombre]');
    const emailInput = root.querySelector('[data-lead-email]');
    const consentInput = root.querySelector('[data-lead-consent]');
    const submitBtn = root.querySelector('[data-lead-submit]');
    if (!form || !status || !nombreInput || !emailInput || !consentInput || !submitBtn) return;

    const captcha = makeCaptchaController(hcaptchaSiteKey);

    let submitting = false;
    const originalLabel = submitBtn.textContent.trim();

    function setStatus(kind, message) {
      status.textContent = message || '';
      status.classList.remove('is-success', 'is-error');
      if (kind === 'success') status.classList.add('is-success');
      if (kind === 'error') status.classList.add('is-error');
      status.hidden = !message;
    }

    function clearStatus() {
      setStatus(null, '');
    }

    function lockForm(isSubmitting) {
      submitting = isSubmitting;
      submitBtn.disabled = isSubmitting;
      submitBtn.textContent = isSubmitting ? 'Enviando…' : originalLabel;
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (submitting) return;
      clearStatus();

      const validation = window.LeadMagnetLogic.validateLeadForm({
        nombre: nombreInput.value,
        email: emailInput.value,
        consent: consentInput.checked
      });

      if (!validation.ok) {
        let msg = '';
        if (validation.errors.nombre) msg = 'Pon tu nombre, así te puedo saludar bien.';
        else if (validation.errors.email === 'email_required') msg = 'Necesito tu email para mandarte el planificador.';
        else if (validation.errors.email === 'email_invalid') msg = 'Ese email no me cuadra. Revísalo, por favor.';
        else if (validation.errors.consent) msg = 'Para mandarte el planificador necesito que aceptes la política de privacidad.';
        setStatus('error', msg);
        track('lead_magnet_validation_failed', validation.errors);
        return;
      }

      if (!endpointUrl) {
        // Build sin SUPABASE_URL: no hay backend al que pegar. Mensaje
        // genérico para no engañar al usuario.
        setStatus('error', 'Algo no fue bien, intenta de nuevo.');
        track('lead_magnet_failed', { reason: 'endpoint_not_configured' });
        return;
      }

      lockForm(true);
      track('lead_magnet_submitted', {});

      try {
        const captchaToken = await captcha.getToken();
        const payload = window.LeadMagnetLogic.buildLeadPayload(
          {
            nombre: nombreInput.value,
            email: emailInput.value,
            consent: consentInput.checked
          },
          captchaToken
        );
        const { status: httpStatus, body } = await postLead(endpointUrl, payload);
        const result = window.LeadMagnetLogic.mapLeadResponse(httpStatus, body);
        setStatus(result.kind, result.message);
        if (result.kind === 'success') {
          track('lead_magnet_confirmed', {});
          form.reset();
          // No restauramos el botón original — dejamos pista de éxito visible.
          submitBtn.disabled = true;
          submitBtn.textContent = 'Hecho — revisa tu correo';
        } else {
          track('lead_magnet_failed', { httpStatus: httpStatus });
        }
      } catch (err) {
        setStatus('error', 'Algo no fue bien, intenta de nuevo.');
        track('lead_magnet_failed', { reason: 'network_error' });
      } finally {
        if (!status.classList.contains('is-success')) {
          lockForm(false);
        } else {
          submitting = false;
        }
      }
    });

    // Limpia el mensaje de error en cuanto el usuario empieza a editar.
    [nombreInput, emailInput, consentInput].forEach(function (el) {
      el.addEventListener('input', function () {
        if (status.classList.contains('is-error')) clearStatus();
      });
      el.addEventListener('change', function () {
        if (status.classList.contains('is-error')) clearStatus();
      });
    });
  });
})();
