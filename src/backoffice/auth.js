// Gate de auth del backoffice CLN (OTP Supabase + email allowlist de Cristina).
//
// Flujo:
//   1. La página llama `BoAuth.iniciar({ onListo })`.
//   2. El layout carga el SDK ESM de Supabase e invoca
//      `BoAuth.registrarSupabase(createClient)` — ese paso desbloquea el flujo.
//   3. Comprueba sesión. Sin sesión → formulario OTP (email → código).
//   4. Con sesión → valida `user.email === env.cristinaEmail`. Si no coincide
//      → pantalla 403. Si coincide → llama `onListo(supa, session)`.
//
// Seguridad: este módulo es UX. La barrera real vive en las policies RLS de
// Supabase (`auth.email() = cristinaEmail`). Si alguien salta el gate del
// cliente, las queries devuelven vacío.
//
// Dev local: si `env.cristinaEmail` viene vacío, el gate se relaja con un
// warning en consola y deja pasar cualquier sesión válida. Sirve para probar
// UI sin ese env configurado en la máquina.
//
// Expone `window.BoAuth`.

(function () {
  'use strict';

  const env = (typeof window !== 'undefined' && window.__BO_ENV__) || {};
  let createClientRef = null;
  let pendingInit = null;      // { opts } a ejecutar cuando el SDK cargue

  function qs(sel, root) { return (root || document).querySelector(sel); }

  function mostrarNav(visible) {
    const nav = qs('[data-bo-nav]');
    if (nav) nav.hidden = !visible;
  }

  // Marca como activo el enlace que coincide con la pestaña actual.
  function resaltarNavActivo() {
    const path = window.location.pathname.replace(/\/+$/, '/');
    const map = { '/backoffice/': 'hoy', '/backoffice/pacientes/': 'pacientes' };
    const active = map[path];
    if (!active) return;
    document.querySelectorAll('[data-bo-link]').forEach(a => {
      a.classList.toggle('is-active', a.getAttribute('data-bo-link') === active);
    });
  }

  // Renderiza un "gate" (login / 403 / loading) dentro de <main.backoffice-main>.
  // No toca los bloques de contenido — solo los oculta. Cuando el gate resuelve
  // en OK, los restaura.
  function gateContainer() {
    const main = qs('.backoffice-main');
    if (!main) return null;
    let gate = qs('#bo-gate');
    if (!gate) {
      gate = document.createElement('section');
      gate.id = 'bo-gate';
      gate.className = 'bo-gate';
      main.prepend(gate);
    }
    return gate;
  }

  function ocultarContenidoPagina() {
    const main = qs('.backoffice-main');
    if (!main) return;
    Array.from(main.children).forEach(el => {
      if (el.id === 'bo-gate') return;
      el.classList.add('bo-hidden');
    });
  }

  function mostrarContenidoPagina() {
    const main = qs('.backoffice-main');
    if (!main) return;
    Array.from(main.children).forEach(el => el.classList.remove('bo-hidden'));
    const gate = qs('#bo-gate');
    if (gate) gate.remove();
  }

  function renderLoading() {
    const gate = gateContainer();
    if (!gate) return;
    gate.innerHTML = '<p>Cargando…</p>';
    ocultarContenidoPagina();
  }

  function renderLogin(onEnviar, onVerificar) {
    const gate = gateContainer();
    if (!gate) return;
    ocultarContenidoPagina();
    gate.innerHTML =
      '<h2>Backoffice</h2>' +
      '<p>Acceso interno. Te enviamos un código a tu correo.</p>' +
      '<form data-bo-email-form>' +
      '  <label for="bo-email">Correo</label>' +
      '  <input type="email" id="bo-email" required autocomplete="email">' +
      '  <button type="submit">Enviar código</button>' +
      '</form>' +
      '<form data-bo-otp-form hidden>' +
      '  <label for="bo-otp">Código de 6 dígitos</label>' +
      '  <input type="text" id="bo-otp" inputmode="numeric" maxlength="6" required>' +
      '  <button type="submit">Entrar</button>' +
      '</form>' +
      '<p class="bo-status" data-bo-status></p>';

    const emailForm = qs('[data-bo-email-form]', gate);
    const otpForm   = qs('[data-bo-otp-form]', gate);
    const status    = qs('[data-bo-status]', gate);
    let pendingEmail = '';

    emailForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = qs('#bo-email', gate).value.trim();
      if (!email) return;
      setStatus(status, 'Enviando…', null);
      const btn = qs('button[type=submit]', emailForm);
      btn.disabled = true;
      try {
        await onEnviar(email);
        pendingEmail = email;
        otpForm.hidden = false;
        setStatus(status, 'Código enviado a ' + email + '.', 'ok');
        qs('#bo-otp', gate).focus();
      } catch (err) {
        setStatus(status, 'No se pudo enviar el código: ' + (err.message || 'error'), 'error');
      } finally {
        btn.disabled = false;
      }
    });

    otpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = qs('#bo-otp', gate).value.replace(/\D/g, '');
      if (code.length !== 6 || !pendingEmail) {
        setStatus(status, 'Escribe el código de 6 dígitos.', 'error');
        return;
      }
      setStatus(status, 'Comprobando…', null);
      const btn = qs('button[type=submit]', otpForm);
      btn.disabled = true;
      try {
        await onVerificar(pendingEmail, code);
        // onAuthStateChange se encargará del resto.
      } catch (err) {
        setStatus(status, 'Código incorrecto o caducado: ' + (err.message || 'error'), 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  function render403(email) {
    const gate = gateContainer();
    if (!gate) return;
    ocultarContenidoPagina();
    gate.innerHTML =
      '<h2>Acceso restringido</h2>' +
      '<p>La cuenta <strong>' + escapeHtml(email || '') + '</strong> no tiene acceso al backoffice. Contacta con soporte.</p>' +
      '<button type="button" data-bo-signout-403>Cerrar sesión</button>';
    const btn = qs('[data-bo-signout-403]', gate);
    if (btn) btn.addEventListener('click', () => cerrarSesion());
  }

  function setStatus(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || '';
    el.classList.remove('is-ok', 'is-error');
    if (kind) el.classList.add('is-' + kind);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // --------- API pública ---------

  let supaClient = null;

  function registrarSupabase(createClient) {
    createClientRef = createClient;
    if (pendingInit) {
      const opts = pendingInit; pendingInit = null;
      arrancar(opts);
    }
  }

  async function iniciar(opts) {
    opts = opts || {};
    renderLoading();
    if (!createClientRef) {
      // El <script type="module"> del layout todavía no terminó de cargar
      // el SDK. Guardamos el intent y resolvemos cuando llegue.
      pendingInit = opts;
      return;
    }
    await arrancar(opts);
  }

  async function arrancar(opts) {
    if (!env.supabaseUrl || !env.supabasePublishableKey) {
      renderError('Falta configuración de Supabase (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY).');
      return;
    }
    supaClient = createClientRef(env.supabaseUrl, env.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage }
    });
    window.supa = supaClient; // conveniencia para debug / futuros agents

    // Botón de la nav → cerrar sesión.
    const signOutBtn = qs('[data-bo-signout]');
    if (signOutBtn && !signOutBtn.dataset.bound) {
      signOutBtn.addEventListener('click', () => cerrarSesion());
      signOutBtn.dataset.bound = '1';
    }

    supaClient.auth.onAuthStateChange((event, session) => {
      evaluar(session, opts);
    });

    const { data } = await supaClient.auth.getSession();
    evaluar(data.session, opts);
  }

  // Dedup de onListo: Supabase dispara onAuthStateChange(INITIAL_SESSION) y
  // además llamamos explícitamente getSession → evaluar. Ambas rutas son
  // legítimas (necesitamos ambas para casos distintos), pero no queremos que
  // onListo se ejecute 2 veces con la misma sesión — romperá renders
  // idempotentes (ej. outerHTML de #metricas).
  let lastListoKey = null;

  function evaluar(session, opts) {
    if (!session) {
      mostrarNav(false);
      renderLogin(enviarOtp, verificarOtp);
      return;
    }
    const sessionEmail = (session.user && session.user.email) || '';
    const permitidoEmail = (env.cristinaEmail || '').toLowerCase();
    const same = permitidoEmail && sessionEmail.toLowerCase() === permitidoEmail;

    if (!permitidoEmail) {
      console.warn('[BoAuth] env.cristinaEmail vacío — gate relajado (solo dev local).');
    } else if (!same) {
      mostrarNav(false);
      render403(sessionEmail);
      return;
    }

    mostrarNav(true);
    resaltarNavActivo();
    mostrarContenidoPagina();
    if (typeof opts.onListo === 'function') {
      const key = sessionEmail + '|' + (session.access_token || '');
      if (key === lastListoKey) return;
      lastListoKey = key;
      try { opts.onListo(supaClient, session); }
      catch (e) { console.error('[BoAuth] onListo lanzó:', e); }
    }
  }

  async function enviarOtp(email) {
    const { error } = await supaClient.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false }
    });
    if (error) throw error;
  }

  async function verificarOtp(email, code) {
    const { error } = await supaClient.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw error;
  }

  async function cerrarSesion() {
    if (!supaClient) { window.location.reload(); return; }
    try { await supaClient.auth.signOut(); } catch (e) { console.warn('signOut', e); }
    window.location.reload();
  }

  function renderError(msg) {
    const gate = gateContainer();
    if (!gate) return;
    ocultarContenidoPagina();
    gate.innerHTML = '<h2>Error</h2><p>' + escapeHtml(msg) + '</p>';
  }

  window.BoAuth = {
    iniciar,
    registrarSupabase,
    cerrarSesion
  };
})();
