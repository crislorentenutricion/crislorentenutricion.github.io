// /mi-seguimiento/ — cableado DOM + Supabase del dashboard de la PWA (ES module).
// Config de Supabase en window.__MS_ENV__ (layouts/app.njk). Lógica pura en logic.js.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
// Lógica pura (ver src/mi-seguimiento/logic.js y tests/mi-seguimiento.test.js).
const {
  toISO, detectarMilestone, countStreak, detectarRachaRota,
  tipDelDia, buildCalendarCells, getRevisionCtaState, formatFechaRelativa,
  detectPlatform, detectInAppBrowser, nombreAppEmbebida,
  esErrorTransitorio, primerNombre, primerNombreDesdeEmail, saludoPorHora,
  slugifyItem, compraStorageKey, totalItemsCompra, displayCat,
  mealValueToOptions, opcionStorageKey, mealChoiceKey, applyMealChoice, menuTieneOpciones,
  validateLoginForm, validateOtpCode, resolveInitialLogin,
  shouldShowInstallHint, shouldRehydrateOnVisibility, resolveInitialView, activeTabForView, shouldCelebrarMilestone,
  esAyerEditable, computeDayView, computeTodayView,
  buildCompraModel, computeCompraMeta,
  applyCheckinOptimistic, revertCheckin,
  buildRevisionCtaCopy, shouldMostrarRevisionModal, shouldMostrarMenuNuevoModal,
  hydrateDashboard
} = window.MsLogic;

const SUPABASE_URL = window.__MS_ENV__.supabaseUrl;
const SUPABASE_KEY = window.__MS_ENV__.supabasePublishableKey;

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const loadingView = $('#ms-loading');
const loginView   = $('#ms-login');
const authedView  = $('#ms-authed');
const statusEl    = $('#ms-status');
const form        = $('#ms-login-form');
const emailInput  = $('#ms-email');
const submitBtn   = $('#ms-login-submit');
const otpForm     = $('#ms-otp-form');
const otpInput    = $('#ms-otp-code');
const otpSubmit   = $('#ms-otp-submit');
let pendingOtpEmail = '';
let firstRenderDone = false;
let handlersReady   = false;

function resetOtpUi() {
  pendingOtpEmail = '';
  otpForm.hidden = true;
  otpInput.value = '';
}

// Cambia solo la etiqueta del botón (deja intacto el spinner SVG).
function setSubmitLabel(btn, text) {
  if (!btn) return;
  const label = btn.querySelector('.ms-submit-label');
  if (label) label.textContent = text;
  else btn.textContent = text;
}

// Boot loader: rota los mensajes editoriales cada 1.8s mientras esté visible.
// Si el boot resuelve rápido (<1.8s) el primer mensaje es el único que se ve.
let bootMsgTimer = null;
(function startBootMessages() {
  const msgs = loadingView ? loadingView.querySelectorAll('.ms-loading-msg') : [];
  if (!msgs || msgs.length <= 1) return;
  let idx = 0;
  bootMsgTimer = setInterval(() => {
    if (loadingView.hidden) return;
    msgs.forEach(m => m.classList.remove('is-visible'));
    idx = (idx + 1) % msgs.length;
    msgs[idx].classList.add('is-visible');
  }, 1800);
})();
function stopBootMessages() {
  if (bootMsgTimer) { clearInterval(bootMsgTimer); bootMsgTimer = null; }
}

// Safety net + guard se registran ANTES de createClient para sobrevivir
// a un throw síncrono (env vars vacías en dev local rompen la URL del
// cliente y truncarían el resto del script).
setTimeout(() => {
  if (firstRenderDone) return;
  loadingView.hidden = true;
  stopBootMessages();
  loginView.hidden = false;
}, 4000);

document.addEventListener('submit', (e) => {
  const t = e.target;
  if (t && (t.id === 'ms-login-form' || t.id === 'ms-otp-form') && !handlersReady) {
    e.preventDefault();
    showStatus('No hemos podido conectar con el servidor. Refresca la página y vuelve a intentarlo.', 'error');
  }
}, true);

if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env vars vacías');
const supa = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: window.localStorage
  }
});
window.supa = supa;

// Marker de sesión-tab: sessionStorage sobrevive a lock/unlock-resume y a
// recargas, pero MUERE cuando iOS/Android matan la PWA (kill+relaunch) y
// cuando la paciente cierra la pestaña/app. Si no existe al arrancar, este
// es un arranque "frío" → limpiamos la vista activa persistida para que la
// PWA aterrice en 'today', no en la lista de la compra. En cambio, en un
// resume (visibility change sin kill) este script no se vuelve a ejecutar,
// así que el marker permanece y conservamos la vista.
try {
  if (!sessionStorage.getItem('ms-tab-session')) {
    sessionStorage.setItem('ms-tab-session', String(Date.now()));
    localStorage.removeItem('ms-active-view');
  }
} catch (e) { /* noop: storage bloqueado en modo privado */ }

const DIAS_JS = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
const COMIDAS = [['desayuno','Desayuno'],['almuerzo','Almuerzo'],['comida','Comida'],['merienda','Merienda'],['cena','Cena']];

let paciente = null;
let checkinsMap = new Map();
// Fecha a la que escriben los botones de check-in: hoy en vista "today";
// el ISO de ayer cuando la vista de día está en modo editable.
let checkinTargetISO = null;
let menuVigente = null;
let opcionChoices = new Map();

// -------- utils --------
const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function showStatus(msg, kind) {
  statusEl.hidden = false;
  statusEl.textContent = msg;
  statusEl.classList.remove('is-ok', 'is-error');
  if (kind) statusEl.classList.add('is-' + kind);
}

function renderDate() {
  const d = new Date();
  $('#ms-date').textContent  = capitalize(d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
  $('#ms-month').textContent = d.toLocaleDateString('es-ES', { month: 'long' });
  const g = $('#ms-greeting-word'); if (g) g.textContent = saludoPorHora(d.getHours());
}

// -------- platform + in-app detection (A3/A4) --------
// detectPlatform / detectInAppBrowser / nombreAppEmbebida viven en logic.js.
// isStandalone depende del DOM (matchMedia) → se queda aquí.
function detectPlatformLocal() {
  return detectPlatform({ ua: navigator.userAgent || '', maxTouchPoints: navigator.maxTouchPoints || 0 });
}
function detectInAppBrowserLocal() {
  return detectInAppBrowser(navigator.userAgent || '');
}
function isStandalone() {
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.navigator.standalone === true) return true; // iOS Safari legacy
  } catch (e) { /* noop */ }
  return false;
}

// -------- retry con backoff (B5) --------
// Reintenta fn() una vez tras `delay` ms si el error parece transitorio
// (red caída, 5xx). No reintenta errores de auth (401/403) ni 4xx.
// esErrorTransitorio vive en logic.js (pura, testada).
async function withRetry(fn, opts) {
  const { retries = 1, delay = 700 } = opts || {};
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!esErrorTransitorio(err) || i === retries) throw err;
      console.warn('ms-retry', i + 1, err);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// -------- data loaders --------
async function loadPaciente() {
  // Scope explícito por el email de la sesión: no basta con confiar en RLS,
  // porque la cuenta admin (backoffice) tiene policy que ve TODOS los
  // pacientes → un .limit(1) sin filtro devolvería una fila ajena.
  const { data: { session } } = await supa.auth.getSession();
  const email = session && session.user && session.user.email;
  if (!email) return null;
  const { data, error } = await supa.from('pacientes').select('*').eq('email', email).limit(1).maybeSingle();
  if (error) { console.error('pacientes', error); return null; }
  return data;
}

async function loadMenuVigente(todayISO, pacienteId) {
  // Filtrar SIEMPRE por paciente_id además del RLS: la cuenta admin ve todos
  // los menús por policy de backoffice, así que sin este .eq() cogería el
  // menú vigente más reciente de otra paciente.
  if (!pacienteId) return null;
  const { data, error } = await supa.from('menus')
    .select('*')
    .eq('paciente_id', pacienteId)
    .lte('vigente_desde', todayISO)
    .order('vigente_desde', { ascending: false })
    .limit(1);
  if (error) { console.error('menus', error); return null; }
  return (data && data[0]) || null;
}

async function loadCheckins(fromISO, pacienteId) {
  if (!pacienteId) return [];
  return withRetry(async () => {
    const { data, error } = await supa.from('checkins')
      .select('fecha, estado')
      .eq('paciente_id', pacienteId)
      .gte('fecha', fromISO)
      .order('fecha', { ascending: false });
    if (error) throw error;
    return data || [];
  }, { retries: 1, delay: 700 });
}

// ---- Curso «Aprender» ----
let cursoLecciones = [], cursoProgreso = [], cursoOverrides = [];

// curso_lecciones es contenido común (sin datos de paciente): no lleva filtro.
// curso_progreso y curso_overrides SÍ filtran por paciente_id — RLS es el
// suelo, no el único filtro (cuenta dual, ver mi-seguimiento-auth.md).
async function loadCurso(pacienteId) {
  const [lec, prog, ov] = await Promise.all([
    supa.from('curso_lecciones').select('slug, fase, orden, titulo, contenido').order('orden'),
    supa.from('curso_progreso').select('leccion_slug, completada_at, mini_accion, reto_hecho, reto_nota').eq('paciente_id', pacienteId),
    supa.from('curso_overrides').select('tipo, target, modo').eq('paciente_id', pacienteId),
  ]);
  if (lec.error || prog.error || ov.error) return false;
  cursoLecciones = lec.data || [];
  cursoProgreso = prog.data || [];
  cursoOverrides = ov.data || [];
  return true;
}

function estadoCursoActual() {
  return AprenderLogic.estadoCurso({
    lecciones: cursoLecciones, progreso: cursoProgreso, overrides: cursoOverrides,
    altaISO: paciente.alta, hoyISO: toISO(new Date()),
  });
}

function formatFechaDesbloqueo(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return capitalize(new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
}

function renderNodoLeccion(l) {
  const bola = l.estado === 'done' ? '✓' : l.estado === 'now' ? '▶' : '🔒';
  let sub = '';
  if (l.estado === 'now') sub = '<small>Siguiente lección · ' + l.min + ' min</small>';
  else if (l.estado === 'wait') sub = '<small>Se abre el ' + formatFechaDesbloqueo(l.abreElISO) + '</small>';
  const clickable = l.estado === 'now' || l.estado === 'done';
  return '<div class="ms-apr-node ' + l.estado + '"' + (clickable ? ' data-open="' + l.slug + '"' : '') + '>'
    + '<div class="ms-apr-bola">' + bola + '</div>'
    + '<div class="ms-apr-lbl">' + escapeHtml(l.titulo) + sub + '</div>'
    + '</div>';
}

function renderNodoGuia(g) {
  const bola = g.desbloqueada ? '📄' : '🔒';
  const dl = g.desbloqueada ? '<span class="ms-apr-dl">Descargar</span>' : '';
  return '<div class="ms-apr-node premio ' + (g.desbloqueada ? 'now' : 'lock') + '"' + (g.desbloqueada ? ' data-open-guia="' + g.fase + '"' : '') + '>'
    + '<div class="ms-apr-bola">' + bola + '</div>'
    + '<div class="ms-apr-lbl">📄 ' + escapeHtml(g.titulo) + dl + '</div>'
    + '</div>';
}

function renderMapaCurso(e) {
  const cont = $('#ms-apr-mapa');
  if (!cont) return;
  const html = AprenderLogic.FASES.map((fase) => {
    const deLaFase = e.lecciones.filter((l) => l.fase === fase.key);
    const completa = deLaFase.length > 0 && deLaFase.every((l) => l.estado === 'done');
    const enCurso = deLaFase.some((l) => l.estado === 'done' || l.estado === 'now');
    const estadoCls = completa ? 'ok' : enCurso ? 'now' : 'lock';
    const estadoLbl = completa ? 'Completada' : enCurso ? 'En curso' : 'Bloqueada';
    const guia = e.guias.find((g) => g.fase === fase.key);
    const nodos = deLaFase.map(renderNodoLeccion).join('') + (guia ? renderNodoGuia(guia) : '');
    return '<div class="ms-apr-fase">'
      + '<span class="ms-apr-fase-nombre">' + escapeHtml(fase.titulo) + '</span>'
      + '<span class="ms-apr-fase-sub">· ' + escapeHtml(fase.sub) + '</span>'
      + '<span class="ms-apr-fase-estado ' + estadoCls + '">' + estadoLbl + '</span>'
      + '</div>'
      + '<div class="ms-apr-path">' + nodos + '</div>';
  }).join('');
  cont.innerHTML = html;
}

// ---- Reto de la semana (Tarea 10) ----
// Sin juicio: si no lo hizo, la nota lo recoge — no textos de culpa.
function renderRetoActivo(retoActivo) {
  const cont = $('#ms-apr-reto');
  if (!cont) return;
  if (!retoActivo) { cont.hidden = true; cont.innerHTML = ''; return; }
  cont.hidden = false;
  cont.innerHTML =
    '<div class="ms-apr-reto-card">'
    + '<span class="ms-apr-reto-eyebrow">Tu reto de esta semana</span>'
    + '<p>' + escapeHtml(retoActivo.reto) + '</p>'
    + '<label class="ms-apr-reto-check"><input type="checkbox" id="ms-apr-reto-hecho"' + (retoActivo.hecho ? ' checked' : '') + '> Hecho</label>'
    + '<textarea id="ms-apr-reto-nota" placeholder="¿Cómo ha ido? (opcional, lo leo antes de tu sesión)">' + escapeHtml(retoActivo.nota || '') + '</textarea>'
    + '<button type="button" id="ms-apr-reto-guardar" class="ms-apr-reto-btn">Guardar</button>'
    + '</div>';
  $('#ms-apr-reto-guardar').addEventListener('click', () => guardarReto(retoActivo.slug));
}

async function guardarReto(slug) {
  const { data: { session } } = await supa.auth.getSession();
  if (!session) { showToast('Tu sesión ha caducado. Te llevamos a iniciar sesión.'); return; }
  const hecho = $('#ms-apr-reto-hecho').checked;
  const nota = $('#ms-apr-reto-nota').value.trim();
  const { error } = await supa.from('curso_progreso')
    .update({ reto_hecho: hecho, reto_nota: nota || null, reto_marcado_at: new Date().toISOString() })
    .eq('paciente_id', paciente.id).eq('leccion_slug', slug);
  if (error) { showToast('No se ha podido guardar.'); return; }
  const fila = cursoProgreso.find((p) => p.leccion_slug === slug);
  if (fila) { fila.reto_hecho = hecho; fila.reto_nota = nota || null; }
  showToast('Reto guardado 💪');
}

// ---- Reproductor de lección (Tarea 9) ----
// Port directo de mockup-app-mi-seguimiento-aprender.html (openLesson/
// showCard/updateNextEnabled/completeLesson, líneas 288-364): navegación
// solo con botones, "Siguiente" deshabilitado hasta responder la
// mini-acción, último botón "Completar módulo ✓", el ✕ cierra sin guardar.
let aprCur = null, aprCurSlug = null, aprIdx = 0, aprActionValue = false, aprGuiaActual = null;

function abrirLeccion(slug) {
  const l = cursoLecciones.find((x) => x.slug === slug);
  if (!l) return;
  aprCur = l.contenido;
  aprCurSlug = slug;
  aprIdx = 0;
  aprActionValue = false;
  const fase = AprenderLogic.FASES.find((f) => f.key === l.fase);
  const faseTitulo = fase ? fase.titulo : '';

  const total = aprCur.cards.length + 1;
  $('#ms-apr-segs').innerHTML = Array.from({ length: total }, () => '<div class="ms-apr-seg"><i></i></div>').join('');

  const body = $('#ms-apr-player-body');
  body.innerHTML = '';
  aprCur.cards.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'ms-apr-card';
    div.dataset.i = String(i);
    div.innerHTML = '<span class="ms-apr-eyebrow">' + escapeHtml(faseTitulo) + ' · ' + escapeHtml(l.titulo) + '</span><h2>' + escapeHtml(c.h) + '</h2>'
      + (c.img ? '<img class="ms-apr-card-img" src="' + escapeHtml(c.img) + '" alt="' + escapeHtml(c.imgAlt || '') + '">' : '')
      + (c.intro ? '<p>' + c.intro + '</p>' : '')
      + (c.list ? '<ul>' + c.list.map((x) => '<li>' + x + '</li>').join('') + '</ul>' : '<p>' + c.p + '</p>')
      + (c.foot ? '<p>' + c.foot + '</p>' : '');
    body.appendChild(div);
  });
  const a = aprCur.accion;
  const adiv = document.createElement('div');
  adiv.className = 'ms-apr-card';
  adiv.dataset.i = String(aprCur.cards.length);
  let inner = '<span class="ms-apr-eyebrow">' + escapeHtml(faseTitulo) + ' · ' + escapeHtml(l.titulo) + '</span><h2>Tu mini-acción</h2><p>' + a.p + '</p>';
  if (a.type === 'text') {
    inner += '<div class="ms-apr-action-box"><textarea id="ms-apr-action-input" placeholder="' + escapeHtml(a.placeholder) + '"></textarea></div>';
  } else {
    inner += '<div class="ms-apr-action-done" id="ms-apr-action-check"><span class="ms-apr-action-box-check"></span><span>' + escapeHtml(a.label) + '</span></div>';
  }
  adiv.innerHTML = inner;
  body.appendChild(adiv);

  $('#ms-apr-player').hidden = false;
  showCardLeccion(0);
}

function showCardLeccion(i) {
  aprIdx = i;
  const body = $('#ms-apr-player-body');
  Array.from(body.querySelectorAll('.ms-apr-card')).forEach((c) => c.classList.toggle('active', Number(c.dataset.i) === i));
  $$('.ms-apr-seg').forEach((s, si) => { s.classList.toggle('done', si < i); s.classList.toggle('now', si === i); });
  $('#ms-apr-btn-prev').style.visibility = i === 0 ? 'hidden' : 'visible';
  const isAction = i === aprCur.cards.length;
  $('#ms-apr-btn-next').textContent = isAction ? 'Completar módulo ✓' : 'Siguiente →';
  updateAprNextEnabled();
  if (isAction && aprCur.accion.type === 'check') {
    const chk = $('#ms-apr-action-check');
    chk.onclick = () => { aprActionValue = !aprActionValue; chk.classList.toggle('on', aprActionValue); updateAprNextEnabled(); };
  }
  if (isAction && aprCur.accion.type === 'text') {
    $('#ms-apr-action-input').oninput = updateAprNextEnabled;
  }
}

function updateAprNextEnabled() {
  const isAction = aprIdx === aprCur.cards.length;
  if (!isAction) { $('#ms-apr-btn-next').disabled = false; return; }
  if (aprCur.accion.type === 'check') { $('#ms-apr-btn-next').disabled = !aprActionValue; return; }
  const input = $('#ms-apr-action-input');
  const val = input ? input.value.trim() : '';
  $('#ms-apr-btn-next').disabled = val.length < 2;
}

function cerrarPlayer() {
  $('#ms-apr-player').hidden = true;
  aprCur = null;
  aprCurSlug = null;
}

function celebrar(mensaje) {
  $('#ms-apr-celebrate-sub').textContent = mensaje;
  $('#ms-apr-celebrate').hidden = false;
  setTimeout(() => { $('#ms-apr-celebrate').hidden = true; }, 1500);
}

// Población + apertura del modal de guía; la descarga (signed URL) vive en
// la Tarea 11 (descargarGuia), igual que el click sobre el nodo premio.
function mostrarGuiaModal(guia) {
  aprGuiaActual = guia;
  $('#ms-apr-pdf-titulo').textContent = guia.titulo;
  $('#ms-apr-pdf-texto').textContent = 'Tu guía está lista para descargar.';
  $('#ms-apr-pdf-modal').hidden = false;
}

// Mismo patrón que la descarga del menú (bucket privado + signed URL,
// ver el listener de #ms-pdf-link más abajo, incluido el comentario de Safari).
async function descargarGuia(path) {
  const { data, error } = await supa.storage
    .from('curso-guias')
    .createSignedUrl(path, 60, { download: path });
  if (error || !data) { showToast('No se ha podido descargar. Inténtalo de nuevo.'); return; }
  window.location.href = data.signedUrl;
}

async function completarLeccion() {
  if (!aprCur || !aprCurSlug) return;
  const { data: { session } } = await supa.auth.getSession();
  if (!session) { showToast('Tu sesión ha caducado. Te llevamos a iniciar sesión.'); return; }
  const accion = aprCur.accion;
  const miniAccion = accion.type === 'text' ? $('#ms-apr-action-input').value.trim() : null;
  const { error } = await supa.from('curso_progreso')
    .upsert({
      paciente_id: paciente.id,
      leccion_slug: aprCurSlug,
      mini_accion: miniAccion,
    }, { onConflict: 'paciente_id,leccion_slug' });
  if (error) { showToast('No se ha podido guardar. Inténtalo de nuevo.'); return; }
  const guiasAntes = estadoCursoActual().guias;
  cursoProgreso.push({
    leccion_slug: aprCurSlug, completada_at: new Date().toISOString(),
    mini_accion: miniAccion, reto_hecho: false, reto_nota: null,
  });
  cerrarPlayer();
  const eDespues = estadoCursoActual();
  const guiaNueva = eDespues.guias.find((g, i) => g.desbloqueada && !guiasAntes[i].desbloqueada);
  if (guiaNueva) {
    const faseInfo = AprenderLogic.FASES.find((f) => f.key === guiaNueva.fase);
    celebrar('¡Fase ' + (faseInfo ? faseInfo.titulo : '') + ' completada! Tu guía te espera.');
    setTimeout(() => mostrarGuiaModal(guiaNueva), 1600);
  } else {
    celebrar('Sigue así — siguiente lección desbloqueada.');
  }
  renderAprender();
}

function renderAprender() {
  if (!cursoLecciones.length) return;      // sin contenido sembrado: no se muestra nada
  const e = estadoCursoActual();
  $('#ms-tab-aprender').hidden = false;
  $('#ms-apr-stat-lecciones').textContent = e.contadores.lecciones + '/10';
  $('#ms-apr-stat-guias').textContent = e.contadores.guias + '/3';
  renderRetoActivo(e.retoActivo);
  renderMapaCurso(e);
}

// -------- próxima sesión + estado revisión mensual --------
// Lee la próxima sesión futura del paciente (tabla `sesiones`) y, si existe,
// comprueba si ya hay revisión (tabla `revisiones`) vinculada. Devuelve un
// objeto plano para pasarlo a getRevisionCtaState (lógica pura en logic.js).
async function loadProximaSesion(pacienteId) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supa.from('sesiones')
    .select('id, fecha')
    .eq('paciente_id', pacienteId)
    .gte('fecha', nowIso)
    .order('fecha', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) { console.warn('proxima sesion', error); return null; }
  return data || null;
}

async function loadRevisionEnviadaParaSesion(sesionId) {
  if (!sesionId) return false;
  const { data, error } = await supa.from('revisiones')
    .select('id')
    .eq('sesion_id', sesionId)
    .limit(1);
  if (error) { console.warn('revision sesion', error); return false; }
  return !!(data && data.length);
}

async function upsertCheckin(estado, fechaISO) {
  // B4: auto-refresh de sesión antes de escribir. Si el SDK no consigue
  // revalidar el token, devolvemos un sentinel para que el caller vuelva al login.
  const { data: { session } } = await supa.auth.getSession();
  if (!session) return { sessionExpired: true };

  const fecha = fechaISO || toISO(new Date());
  try {
    await withRetry(async () => {
      const { error } = await supa.from('checkins').upsert({
        paciente_id: paciente.id,
        fecha,
        estado
      }, { onConflict: 'paciente_id,fecha' });
      if (error) throw error;
    }, { retries: 1, delay: 700 });
    return { error: null };
  } catch (err) {
    return { error: err };
  }
}

// -------- renderers --------
function renderMeals(menu) {
  const container = $('#ms-meals');
  if (!menu || !menu.contenido) {
    container.innerHTML = `<li class="ms-meal is-skeleton"><span class="ms-meal-time">Aún no hay menú</span><p class="ms-meal-text">En cuanto Cristina lo suba aparecerá aquí.</p></li>`;
    return;
  }
  const hoy = DIAS_JS[new Date().getDay()];
  const dia = menu.contenido.dias && menu.contenido.dias[hoy];
  const tomas = window.MsLogic.visibleMeals(dia, COMIDAS, opcionChoices, hoy);
  if (!tomas.length) {
    container.innerHTML = `<li class="ms-meal is-skeleton"><span class="ms-meal-time">Hoy</span><p class="ms-meal-text">Hoy no hay comidas planificadas en este menú.</p></li>`;
    return;
  }
  container.innerHTML = tomas.map(m => {
    const swap = m.opciones
      ? `<button type="button" class="ms-meal-swap" data-dia="${escapeHtml(hoy)}" data-comida="${escapeHtml(m.key)}" aria-label="Cambiar ${escapeHtml(m.label.toLowerCase())}">Cambiar</button>`
      : '';
    const cls = m.opciones ? 'ms-meal ms-meal--swap' : 'ms-meal';
    return `<li class="${cls}"><span class="ms-meal-time">${m.label}</span><p class="ms-meal-text">${escapeHtml(m.text)}</p>${swap}</li>`;
  }).join('');
}

async function marcarMilestoneVisto(pacienteId, nuevo, actual) {
  const actualizado = [...(actual || []), nuevo];
  const { error } = await supa.from('pacientes')
    .update({ milestones_vistos: actualizado })
    .eq('id', pacienteId);
  if (error) console.error('milestones update', error);
  return actualizado;
}

// Render de la racha: delega el cálculo a countStreak (puro) y pinta el DOM.
function renderStreak(checkinsMap) {
  const n = countStreak(checkinsMap);
  $('#ms-streak-num').textContent = n;
  $('.ms-streak-label').textContent = n === 1 ? 'día' : 'días';
  return n;
}

// Mapa estado → clase CSS (presentacional, queda fuera de logic.js).
const ESTADO_CLASS = { seguido: 'is-ok', parcial: 'is-mid', no: 'is-no' };

function renderCalendar(checkinsMap) {
  const now = new Date();
  const cells = buildCalendarCells(now.getFullYear(), now.getMonth(), checkinsMap, toISO(now));
  const frag = document.createDocumentFragment();
  for (const cell of cells) {
    if (cell.type === 'empty') {
      const c = document.createElement('div');
      c.className = 'ms-cal-cell is-empty';
      frag.appendChild(c);
      continue;
    }
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'ms-cal-cell';
    c.dataset.iso = cell.iso;
    c.setAttribute('aria-label', `Ver el menú del día ${cell.day}`);
    c.textContent = String(cell.day);
    if (ESTADO_CLASS[cell.estado]) c.classList.add(ESTADO_CLASS[cell.estado]);
    if (cell.isToday) c.classList.add('is-today');
    if (cell.estado == null && esAyerEditable(cell.iso, now)) {
      c.classList.add('is-pendiente');
      c.setAttribute('aria-label', `Marcar el día de ayer (${cell.day})`);
    }
    frag.appendChild(c);
  }
  $('#ms-calendar-grid').replaceChildren(frag);
}

function setActiveCheck(estado) {
  $$('.ms-check-btn').forEach(b => b.classList.toggle('is-active', b.dataset.estado === estado));
}

// -------- day detail (read-only view from calendar tap) --------
// Datos puros (weekday, dia, meals, status) vienen de computeDayView/
// computeTodayView (logic.js). Aquí solo rendering. renderDayMealsDom usa
// `meals` (opción resuelta), no `dia`.

function renderDayMealsDom(meals) {
  if (!meals || !meals.length) {
    return `<li class="ms-meal is-skeleton"><span class="ms-meal-time">Sin menú</span><p class="ms-meal-text">No hay menú planificado para este día.</p></li>`;
  }
  return meals.map(m =>
    `<li class="ms-meal"><span class="ms-meal-time">${m.label}</span><p class="ms-meal-text">${escapeHtml(m.text)}</p></li>`
  ).join('');
}

function renderDayStatusDom(status) {
  if (status.kind === 'marked') {
    return `<span class="ms-day-badge ${status.cls}">${status.label}</span><p class="ms-day-msg">${status.msg}</p>`;
  }
  return `<p class="ms-day-msg is-soft">${status.msg}</p>`;
}

function mostrarDia(iso) {
  if (iso === toISO(new Date())) { mostrarHoy(); return; }
  const v = computeDayView({ iso, menu: menuVigente, checkinsMap, now: new Date(), comidas: COMIDAS, choicesMap: opcionChoices });
  const [y, m, d] = iso.split('-').map(Number);
  const fecha = new Date(y, m - 1, d);
  $('#ms-today-label').textContent = capitalize(
    fecha.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  );
  $('#ms-meals').innerHTML = renderDayMealsDom(v.meals);
  authedView.classList.toggle('is-day-editable', v.editable);
  if (v.editable) {
    // Ayer dentro del plazo: la vista se comporta como "hoy" (botones editables).
    checkinTargetISO = iso;
    $('#ms-check-label').textContent = '¿cómo te fue?';
    $('#ms-check-status').innerHTML = ''; // limpia la píldora de una visita read-only previa
    setActiveCheck(v.estado);
  } else {
    checkinTargetISO = null;
    $('#ms-check-label').textContent = 'ese día';
    $('#ms-check-status').innerHTML = renderDayStatusDom(v.status);
  }
  $('#ms-authed').dataset.view = 'day';
  $('#ms-authed').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function mostrarHoy() {
  $('#ms-today-label').textContent = 'hoy';
  $('#ms-check-label').textContent = '¿cómo ha ido hoy?';
  renderMeals(menuVigente);
  $('#ms-authed').dataset.view = 'today';
  const v = computeTodayView({ menu: menuVigente, checkinsMap, now: new Date(), comidas: COMIDAS, choicesMap: opcionChoices });
  setActiveCheck(v.activeCheck);
  authedView.classList.remove('is-day-editable');
  checkinTargetISO = toISO(new Date());
}

// Intercambiador (plan base): abre la hoja de opciones equivalentes de una
// toma. Persiste la elección en localStorage y repinta. Reutiliza el patrón
// de modal existente (.ms-modal-backdrop) con focus/Escape/backdrop como
// reiniciarCompra. Solo aplica a tomas con >1 opciones.
function abrirIntercambiador(diaKey, comidaKey) {
  const focoPrevio = document.activeElement;
  if (!menuVigente || !menuVigente.contenido || !menuVigente.contenido.dias) return;
  const dia = menuVigente.contenido.dias[diaKey];
  if (!dia) return;
  const opciones = mealValueToOptions(dia[comidaKey]);
  if (opciones.length < 2) return;

  const comidaLabel = (COMIDAS.find(c => c[0] === comidaKey) || [null, comidaKey])[1];
  const modal  = $('#ms-opcion-modal');
  const title  = $('#ms-opcion-title');
  const list   = $('#ms-opcion-list');
  const cxlBtn = $('#ms-opcion-cancel');
  if (!modal || !title || !list || !cxlBtn) return;

  title.textContent = 'Elige tu ' + comidaLabel.toLowerCase();
  const actual = opcionChoices.get(mealChoiceKey(diaKey, comidaKey));
  const elegida = (typeof actual === 'number' && actual >= 0 && actual < opciones.length) ? actual : 0;
  list.innerHTML = opciones.map((o, i) =>
    '<button type="button" class="ms-opcion-item' + (i === elegida ? ' is-current' : '') + '" data-idx="' + i + '">'
    + escapeHtml(o) + '<span class="tick" aria-hidden="true">✓</span></button>'
  ).join('');

  const cerrar = () => {
    modal.hidden = true;
    list.removeEventListener('click', onPick);
    cxlBtn.removeEventListener('click', cerrar);
    modal.removeEventListener('click', onBackdrop);
    document.removeEventListener('keydown', onKey);
    if (focoPrevio && focoPrevio.focus) focoPrevio.focus();
  };
  const onPick = (e) => {
    const item = e.target.closest('.ms-opcion-item');
    if (!item) return;
    const idx = Number(item.dataset.idx);
    opcionChoices = applyMealChoice(opcionChoices, diaKey, comidaKey, idx);
    saveOpcionState(menuVigente, opcionChoices);
    renderMeals(menuVigente);
    cerrar();
    showToast('✅ Comida actualizada · ¡buena elección!');
  };
  const onBackdrop = (e) => { if (e.target === modal) cerrar(); };
  const onKey = (e) => { if (e.key === 'Escape') cerrar(); };

  list.addEventListener('click', onPick);
  cxlBtn.addEventListener('click', cerrar);
  modal.addEventListener('click', onBackdrop);
  document.addEventListener('keydown', onKey);

  modal.hidden = false;
  requestAnimationFrame(() => { const f = list.querySelector('.ms-opcion-item'); if (f) f.focus(); });
}

// -------- lista de la compra (localStorage por menú) --------
// Estado local, sin servidor. Clave `ms-compra-<menu_id>` → al llegar un
// nuevo menú la clave cambia y la lista vuelve a empezar vacía.
// Las categorías las decide el JSON del menú (lo compone /crear-menu); aquí
// se renderizan en el orden en que vienen.

// slugifyItem / compraStorageKey viven en logic.js (puras, testadas).

function loadCompraState(menu) {
  const key = compraStorageKey(menu);
  if (!key) return new Set();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (e) { return new Set(); }
}

function saveCompraState(menu, set) {
  const key = compraStorageKey(menu);
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify([...set])); }
  catch (e) { /* modo privado o cuota llena: la UI ya está pintada */ }
}

// Elecciones del intercambiador (plan base). Espejo de loadCompraState pero
// con Map<'dia:comida', idx>. Clave ms-opcion-<menu_id> → reset por menú.
function loadOpcionState(menu) {
  const key = opcionStorageKey(menu);
  if (!key) return new Map();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Map();
    const arr = JSON.parse(raw);
    return new Map(Array.isArray(arr) ? arr : []);
  } catch (e) { return new Map(); }
}
function saveOpcionState(menu, map) {
  const key = opcionStorageKey(menu);
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify([...map])); }
  catch (e) { /* modo privado o cuota llena: la UI ya está pintada */ }
}

let compraState = new Set();
let compraTotal = 0;

function getListaCompra(menu) {
  return (menu && menu.contenido && menu.contenido.lista_compra) || {};
}

// totalItemsCompra vive en logic.js (pura, testada).
function totalItemsCompraLocal(lista) {
  return totalItemsCompra(lista);
}

function updateCompraMeta() {
  const prog = $('#ms-compra-progress');
  const actions = $('#ms-compra-actions');
  if (!prog) return;
  const cfg = computeCompraMeta({ total: compraTotal, hechos: compraState.size });
  prog.textContent = cfg.progressText;
  prog.classList.toggle('is-done', cfg.progressDone);
  if (actions) actions.hidden = cfg.actionsHidden;
}

function renderCompra(menu) {
  const container = $('#ms-compra-cats');
  if (!container) return;
  compraState = loadCompraState(menu);
  const model = buildCompraModel({ menu, estadoSet: compraState });
  compraTotal = model.total;

  if (model.empty) {
    container.innerHTML = '<p class="ms-compra-empty">Aún no hay lista de la compra semanal para este menú.<br>Aparecerá aquí en cuanto Cristina la prepare.</p>';
    updateCompraMeta();
    return;
  }

  const bloques = model.cats.map(c => {
    const countCls = c.comprados === c.total ? 'ms-compra-cat-count is-done' : 'ms-compra-cat-count';
    const itemsHtml = c.items.map(it =>
      '<li class="ms-compra-item' + (it.done ? ' is-done' : '') + '" data-key="' + escapeHtml(it.key) + '">'
      + '<label>'
      + '<input type="checkbox"' + (it.done ? ' checked' : '') + '>'
      + '<span class="ms-compra-item-text">' + escapeHtml(it.text) + '</span>'
      + '</label>'
      + '</li>'
    ).join('');
    return '<details class="ms-compra-cat" open>'
      + '<summary class="ms-compra-cat-head">'
      + '<span class="ms-compra-cat-name">' + escapeHtml(displayCat(c.cat)) + '</span>'
      + '<span class="' + countCls + '" data-cat-count>' + c.comprados + '/' + c.total + '</span>'
      + '<span class="ms-compra-cat-chevron" aria-hidden="true">▾</span>'
      + '</summary>'
      + '<ul class="ms-compra-items">' + itemsHtml + '</ul>'
      + '</details>';
  }).join('');
  container.innerHTML = bloques;
  updateCompraMeta();
}

function setCompraItem(li, done) {
  const key = li.dataset.key;
  if (!key) return;
  if (done) compraState.add(key); else compraState.delete(key);
  li.classList.toggle('is-done', done);
  saveCompraState(menuVigente, compraState);

  const cat = li.closest('.ms-compra-cat');
  if (cat) {
    const count = cat.querySelector('[data-cat-count]');
    const items = cat.querySelectorAll('.ms-compra-item');
    const doneN = cat.querySelectorAll('.ms-compra-item.is-done').length;
    if (count) {
      count.textContent = doneN + '/' + items.length;
      count.classList.toggle('is-done', doneN === items.length);
    }
  }
  updateCompraMeta();
}

function mostrarCompra() {
  // Salimos de cualquier modo editable de la vista de día: el estado de check-in
  // solo debe quedar vivo en las vistas "today"/"day".
  authedView.classList.remove('is-day-editable');
  checkinTargetISO = null;
  $('#ms-authed').dataset.view = 'compra';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function mostrarAprender() {
  authedView.classList.remove('is-day-editable');
  checkinTargetISO = null;
  $('#ms-authed').dataset.view = 'aprender';
  window.scrollTo(0, 0);
}

// Persistimos la vista activa en dos sitios — sólo cuando el cambio lo
// dispara una acción del usuario (clics en los botones):
//   1) location.hash — para bfcache, recargas normales y resumes "blandos".
//   2) localStorage 'ms-active-view' — backup imprescindible: iOS mata la
//      PWA standalone tras un rato bloqueada y la relanza desde start_url,
//      perdiendo el hash. localStorage sobrevive al relanzamiento.
// Mantenemos mostrarHoy/mostrarCompra como renderers puros: hydrate() las
// llama internamente sin tocar el hash ni el storage, así puede leerlos
// después para restaurar la vista que la paciente tenía al bloquear.
function setViewHash(viewName) {
  const target = viewName === 'compra' ? '#compra' : viewName === 'aprender' ? '#aprender' : '';
  if ((location.hash || '') !== target) {
    try {
      history.replaceState(null, '', location.pathname + location.search + target);
    } catch (e) { /* noop */ }
  }
  try {
    if (target === '#compra' || target === '#aprender') localStorage.setItem('ms-active-view', target.slice(1));
    else localStorage.removeItem('ms-active-view');
  } catch (e) { /* noop */ }
}

function reiniciarCompra() {
  if (compraState.size === 0) return;
  const modal  = $('#ms-compra-reset-modal');
  const intro  = $('#ms-compra-reset-intro');
  const okBtn  = $('#ms-compra-reset-ok');
  const cxlBtn = $('#ms-compra-reset-cancel');
  if (!modal || !okBtn || !cxlBtn) return;

  const n = compraState.size;
  if (intro) intro.textContent = n === 1
    ? 'Se desmarcará 1 producto. Podrás volver a marcarlo cuando quieras.'
    : 'Se desmarcarán ' + n + ' productos. Podrás volver a marcarlos cuando quieras.';

  // Guardamos qué elemento tenía el foco para devolverlo al cerrar
  const focoPrevio = document.activeElement;

  const cerrar = () => {
    modal.hidden = true;
    okBtn.removeEventListener('click', onOk);
    cxlBtn.removeEventListener('click', onCancel);
    modal.removeEventListener('click', onBackdrop);
    document.removeEventListener('keydown', onKey);
    if (focoPrevio && focoPrevio.focus) focoPrevio.focus();
  };
  const onOk = () => {
    compraState.clear();
    saveCompraState(menuVigente, compraState);
    renderCompra(menuVigente);
    cerrar();
  };
  const onCancel = () => cerrar();
  const onBackdrop = (e) => { if (e.target === modal) cerrar(); };
  const onKey = (e) => { if (e.key === 'Escape') cerrar(); };

  okBtn.addEventListener('click', onOk);
  cxlBtn.addEventListener('click', onCancel);
  modal.addEventListener('click', onBackdrop);
  document.addEventListener('keydown', onKey);

  modal.hidden = false;
  requestAnimationFrame(() => okBtn.focus());
}

// pdf_url guarda la ruta dentro del bucket privado (ej. "{uuid}/menu-1.pdf").
// Firmamos la URL al clic: URL fresca, sin enlaces caducables en el DOM.
let pdfPathActual = null;
function renderPdfLink(menu) {
  const link = $('#ms-pdf-link');
  pdfPathActual = (menu && menu.pdf_url) || null;
  link.hidden = !pdfPathActual;
}
$('#ms-pdf-link').addEventListener('click', async (e) => {
  if (!pdfPathActual) return;
  if (/^https?:\/\//i.test(pdfPathActual)) return; // ya es URL absoluta
  e.preventDefault();
  const filename = pdfPathActual.split('/').pop() || 'menu.pdf';
  const { data, error } = await supa.storage
    .from('menus-pdf')
    .createSignedUrl(pdfPathActual, 60, { download: filename });
  if (error || !data) { console.error('signed url', error); return; }
  // Supabase responde con Content-Disposition: attachment (gracias a { download }),
  // así que el navegador convierte la navegación en descarga y la paciente no sale
  // de la PWA. Usamos location.href en vez de window.open: Safari (iOS y macOS)
  // bloquea window.open tras un `await` porque la activación de usuario se
  // considera consumida — silenciosamente no pasa nada.
  window.location.href = data.signedUrl;
});

function renderTip() {
  const el = $('#ms-tip');
  el.textContent = menuTieneOpciones(menuVigente)
    ? 'Tu semana, a tu gusto. Toca «Cambiar» en una comida para elegir entre opciones equivalentes; las recetas se renuevan cada 15 días.'
    : tipDelDia(new Date());
  el.hidden = false;
}

const MILESTONE_MSGS = {
  7:  { emoji: '🔥', titulo: 'Una <em>semana</em> seguida', msg: 'Siete días cuidándote. Esto ya no es casualidad.' },
  14: { emoji: '🌱', titulo: 'Dos <em>semanas</em>', msg: 'Ya es un hábito incipiente. Sigue así, sin prisa.' },
  28: { emoji: '🏆', titulo: 'MENÚ 1 <em>completo</em>', msg: 'Cuatro semanas. Has recorrido tu primer menú entero.' },
  30: { emoji: '⭐', titulo: 'Un <em>mes</em> entero', msg: 'Un mes cuidándote cada día. Ahora viene mantenerlo.' }
};

function showMilestone(n) {
  const cfg = MILESTONE_MSGS[n];
  if (!cfg) return;
  $('#ms-milestone-emoji').textContent = cfg.emoji;
  $('#ms-milestone-title').innerHTML   = cfg.titulo;
  $('#ms-milestone-msg').textContent   = cfg.msg;
  const modal = $('#ms-milestone');
  modal.hidden = false;
  const ok = $('#ms-milestone-ok');
  ok.focus();
  const cerrar = async () => {
    modal.hidden = true;
    paciente.milestones_vistos = await marcarMilestoneVisto(
      paciente.id, n, paciente.milestones_vistos
    );
  };
  ok.addEventListener('click', cerrar, { once: true });
}

async function maybeCelebrarMilestone(racha) {
  if (!paciente) return;
  const m = shouldCelebrarMilestone({
    racha,
    vistos: paciente.milestones_vistos || [],
    onboarding: !!paciente.onboarding
  });
  if (!m) return;
  // Mismo gate diario que onboarding: evita reaperturas en kill+relaunch
  // de iOS si la paciente aún no ha pulsado OK (el self-gate de BD se
  // actualiza al cerrar el modal, no al abrirlo).
  if (shownToday('ms-milestone-shown:' + m)) return;
  showMilestone(m);
  markShownToday('ms-milestone-shown:' + m);
}

let toastTimer = null;
function showToast(msg) {
  const t = $('#ms-toast');
  t.textContent = msg;
  t.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

// Gate adicional "1/día" sobre el self-gate vía DB (paciente.onboarding):
// si iOS mata la PWA mientras el modal está abierto, al desbloquear se
// relanza y el modal volvería a aparecer hasta que la paciente lo cierre.
// Mostrarlo una vez al día evita el bombardeo; mañana vuelve si sigue sin
// marcar onboarding=true en BD.
function shownToday(key) {
  try { return localStorage.getItem(key + ':' + toISO(new Date())) === '1'; } catch (e) { return false; }
}
function markShownToday(key) {
  try { localStorage.setItem(key + ':' + toISO(new Date()), '1'); } catch (e) { /* noop */ }
}

async function maybeShowOnboarding() {
  if (!paciente || paciente.onboarding) return;
  if (shownToday('ms-onboarding-shown')) return;
  const modal = $('#ms-onboarding');
  modal.hidden = false;
  markShownToday('ms-onboarding-shown');
  $('#ms-modal-ok').addEventListener('click', async () => {
    modal.hidden = true;
    const { error } = await supa.from('pacientes')
      .update({ onboarding: true })
      .eq('id', paciente.id);
    if (error) console.error('onboarding update', error);
    else paciente.onboarding = true;
  }, { once: true });
}

// primerNombre vive en logic.js (pura, testada).

function showSinPaciente() {
  $('#ms-name').textContent = 'hola';
  $('#ms-meals').innerHTML = `<li class="ms-meal is-skeleton"><span class="ms-meal-time">Espera</span><p class="ms-meal-text">Tu espacio aún no está preparado. Cristina lo activa en cuanto subamos tu primer menú.</p></li>`;
  $$('.ms-check-btn').forEach(b => b.disabled = true);
  $('#ms-streak-num').textContent = '0';
}

// Paciente cerrada (estado='cerrado' en Supabase): expediente sin acceso.
// La fila sigue ahí para poder reactivar si vuelve, pero la PWA no debe
// permitirle operar. Mostramos mensaje + botón logout. No cargamos menú
// ni checkins — hydrateDashboard corta antes.
async function showExpedienteCerrado() {
  authedView.classList.add('is-cerrado');
  const nombre = paciente && paciente.nombre ? primerNombre(paciente.nombre) : '';
  const saludo = nombre ? 'Hola, ' + nombre + '.' : 'Hola.';
  $('#ms-name').textContent = nombre || 'hola';
  $('#ms-meals').innerHTML =
    '<li class="ms-meal is-skeleton">' +
      '<span class="ms-meal-time">Expediente cerrado</span>' +
      '<p class="ms-meal-text">' + saludo + ' Tu expediente está cerrado ahora mismo. ' +
      'Si quieres retomar la asesoría, escríbele a Cristina y te reactiva el acceso.</p>' +
    '</li>';
  $$('.ms-check-btn').forEach(b => b.disabled = true);
  $('#ms-streak-num').textContent = '0';
  const cta = $('#ms-revision-cta'); if (cta) cta.hidden = true;
  // Cerramos sesión con un pequeño delay para que la paciente lea el mensaje.
  try {
    await new Promise(r => setTimeout(r, 2500));
    await supa.auth.signOut();
  } catch (e) { console.warn('signOut cerrado', e); }
  window.location.replace('/mi-seguimiento/');
}

// -------- orchestration --------
async function hydrate() {
  renderDate();
  paciente = await loadPaciente();

  // Toda la decisión lógica (vista + queries en paralelo + CTA revisión)
  // vive en hydrateDashboard (logic.js, testado). Aquí solo pintamos.
  const supaDriver = {
    loadMenuVigente, loadCheckins, loadProximaSesion, loadRevisionEnviadaParaSesion
  };
  const result = await hydrateDashboard({ supa: supaDriver, paciente, now: new Date() });

  if (result.view === 'sin-paciente') { showSinPaciente(); return; }
  // Gate estado cerrado: expediente fuera de servicio. Mostramos mensaje
  // y hacemos signOut después de unos segundos. La fila sigue en Supabase
  // (modelo binario desde 0014) para poder reactivar con /reactivar-paciente.
  if (result.view === 'cerrado') { await showExpedienteCerrado(); return; }
  // Gate M1: sin anamnesis, la paciente no ve /mi-seguimiento/ — completa
  // /mi-seguimiento/empezar/ primero; al enviar, vuelve y pasa el gate.
  if (result.view === 'redirect-empezar') {
    window.location.replace('/mi-seguimiento/empezar/');
    return;
  }

  // view === 'locked' | 'normal'
  $('#ms-name').textContent = primerNombre(paciente.nombre);
  menuVigente = result.menu;
  opcionChoices = loadOpcionState(menuVigente);
  checkinsMap = result.checkinsMap;

  // Sin menú vigente, bloqueamos interacciones que dependen del menú
  // (check-in, calendario, compra, PDF, revisión). La paciente solo ve
  // la bienvenida + mensaje "aún no hay menú" + cerrar sesión.
  authedView.classList.toggle('is-locked', result.view === 'locked');

  mostrarHoy();
  renderPdfLink(result.menu);
  renderCompra(result.menu);
  renderTip();
  renderStreak(checkinsMap);
  renderCalendar(checkinsMap);

  // Restaura la vista que la paciente tenía activa antes del lock/unlock o
  // recarga del WebView. Doble fuente: location.hash (resumes "blandos") y
  // localStorage 'ms-active-view' (kill+relaunch de iOS, que pierde el hash).
  // Si el expediente está 'locked' (sin menú vigente), forzamos 'today': la
  // vista compra está oculta por CSS y restaurarla dejaría la pantalla en blanco.
  let lastViewLS = null;
  try { lastViewLS = localStorage.getItem('ms-active-view'); } catch (e) { /* noop */ }
  const initialView = resolveInitialView({
    hash: location.hash,
    lastView: lastViewLS,
    isLocked: result.view === 'locked'
  });
  if (initialView === 'compra' || initialView === 'aprender') {
    $('#ms-authed').dataset.view = initialView;
    // Si el hash se perdió (iOS relaunch), lo re-sincronizamos para que
    // bfcache y enlaces internos vean la vista correcta.
    const targetHash = '#' + initialView;
    if (location.hash !== targetHash) {
      try { history.replaceState(null, '', location.pathname + location.search + targetHash); } catch (e) { /* noop */ }
    }
  }

  if (result.view === 'locked') {
    // Ocultar también el CTA de revisión por si venía visible de un render previo.
    const cta = $('#ms-revision-cta');
    if (cta) cta.hidden = true;
    return { racha: result.streak, rota: false };
  }

  // normal: renderRevisionCta + maybeMostrarRevisionModal leen su copy/LS
  // por su cuenta (la decisión lógica ya está tomada en hydrateDashboard).
  renderRevisionCta({ proxima: result.proximaSesion, enviada: result.revisionEnviada });
  // Si el modal de "menú nuevo" se abre, no apilamos el de revisión encima:
  // ese vuelve la próxima carga si sigue en ventana urgent.
  const menuNuevoAbierto = maybeMostrarMenuNuevoModal(result.menu);
  if (!menuNuevoAbierto) {
    maybeMostrarRevisionModal({ proxima: result.proximaSesion, enviada: result.revisionEnviada });
  }

  if (await loadCurso(paciente.id)) renderAprender();

  return { racha: result.streak, rota: result.rota };
}

// -------- revision CTA + modal --------
// Copy y decisiones lógicas (state, show) vienen de logic.js. Aquí solo DOM.
function renderRevisionCta({ proxima, enviada }) {
  const cta = $('#ms-revision-cta');
  if (!cta) return;
  const cfg = buildRevisionCtaCopy({
    proximaSesion: proxima,
    revisionEnviada: enviada,
    now: new Date()
  });
  cta.dataset.state = cfg.state;
  if (cfg.hidden) { cta.hidden = true; return; }
  cta.hidden = false;
  const msg = $('#ms-revision-cta-msg');
  const action = $('#ms-revision-cta-action');
  if (msg) msg.textContent = cfg.msg;
  if (action) {
    if (cfg.action) {
      action.textContent = cfg.action.label;
      action.setAttribute('href', cfg.action.href);
      action.hidden = false;
    } else {
      // Sin botón en estado 'done': una vez enviada no se edita (evita
      // dobles submits y complejidad en backend).
      action.hidden = true;
    }
  }
}

// Modal "menú nuevo": se dispara la primera vez que la PWA hidrata con un
// menu.id desconocido en este dispositivo. Devuelve true si lo abrió, para
// que el caller no apile el modal de revisión encima.
function maybeMostrarMenuNuevoModal(menu) {
  let seen = [];
  if (menu && menu.id) {
    try { if (localStorage.getItem('menu-nuevo-shown:' + menu.id) === '1') seen = [menu.id]; } catch (e) {}
  }
  const cfg = shouldMostrarMenuNuevoModal({ menu, seenMenuIds: seen });
  if (!cfg.show) return false;
  // Gate diario adicional al self-gate (que se marca al cerrar): evita que
  // un kill+relaunch de iOS reabra el modal antes de que la paciente le
  // dé OK. Mañana vuelve si no ha llegado a cerrarlo.
  if (menu && menu.id && shownToday('ms-menu-nuevo-shown:' + menu.id)) return false;
  const modal = $('#ms-menu-nuevo-modal');
  if (!modal) return false;
  if (menu && menu.id) markShownToday('ms-menu-nuevo-shown:' + menu.id);
  if (cfg.numero) {
    const msg = $('#ms-menu-nuevo-msg');
    if (msg) msg.textContent = 'Cristina te ha preparado el Menú ' + cfg.numero + '. Aquí lo tienes para empezar hoy.';
  }
  modal.hidden = false;
  const ok = $('#ms-menu-nuevo-ok');
  if (ok) {
    ok.focus();
    ok.onclick = () => {
      try { localStorage.setItem(cfg.lsKey, '1'); } catch (e) {}
      modal.hidden = true;
    };
  }
  return true;
}

function maybeMostrarRevisionModal({ proxima, enviada }) {
  let seen = [];
  if (proxima && proxima.id) {
    try { if (localStorage.getItem('rev-modal-shown:' + proxima.id) === '1') seen = [proxima.id]; } catch (e) {}
  }
  const cfg = shouldMostrarRevisionModal({
    proximaSesion: proxima,
    revisionEnviada: enviada,
    now: new Date(),
    seenModalIds: seen
  });
  if (!cfg.show) return;
  const modal = $('#ms-revision-modal');
  if (!modal) return;
  const body = $('#ms-revision-modal-body');
  if (body) body.textContent = cfg.body;
  modal.hidden = false;
  const markSeen = () => { try { localStorage.setItem(cfg.lsKey, '1'); } catch (e) {} };
  const primary = $('#ms-revision-modal-go');
  const secondary = $('#ms-revision-modal-later');
  if (primary) {
    primary.onclick = () => {
      markSeen();
      window.location.href = '/mi-seguimiento/revision/';
    };
  }
  if (secondary) {
    secondary.onclick = () => {
      markSeen();
      modal.hidden = true;
    };
  }
}

// -------- known-patient (B2) --------
// Marca local de "paciente conocido". No es autenticación (la auth real
// vive en el refresh token de Supabase). Solo sirve para mostrar una
// pantalla amable cuando la sesión expira pero el navegador es el mismo.
const LAST_EMAIL_KEY = 'ms-last-email';
const LAST_SEEN_KEY  = 'ms-last-seen';

function recordarPaciente(email) {
  try {
    if (!email) return;
    localStorage.setItem(LAST_EMAIL_KEY, email.trim().toLowerCase());
    localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
  } catch (e) { /* modo privado, ignoramos */ }
}
function olvidarPaciente() {
  try {
    localStorage.removeItem(LAST_EMAIL_KEY);
    localStorage.removeItem(LAST_SEEN_KEY);
  } catch (e) { /* noop */ }
}
function pacienteConocido() {
  try { return localStorage.getItem(LAST_EMAIL_KEY) || null; }
  catch (e) { return null; }
}

// -------- welcome-back view (B3) --------
const welcomeBack = $('#ms-welcome-back');
const loginTitle  = $('#ms-login-title');
const loginIntro  = $('#ms-login-intro');
const welcomeName = $('#ms-welcome-back-name');
const forgetBtn   = $('#ms-welcome-back-forget');

function mostrarWelcomeBack(email) {
  // Variante del login: email prefilled, mensaje cálido, título/intro ocultos.
  welcomeName.textContent = primerNombreDesdeEmail(email);
  welcomeBack.hidden = false;
  loginTitle.hidden  = true;
  loginIntro.hidden  = true;
  emailInput.value = email;
  // Por UX: el consent ya fue aceptado en el registro previo. Lo marcamos
  // pre-check pero lo dejamos visible para que pueda desmarcarlo si quiere.
  const cb = $('#ms-consent');
  if (cb) cb.checked = true;
  // Foco directo en el botón de enviar código: un solo clic para pedirlo.
  requestAnimationFrame(() => submitBtn.focus());
}
function ocultarWelcomeBack() {
  welcomeBack.hidden = true;
  loginTitle.hidden  = false;
  loginIntro.hidden  = false;
  emailInput.value = '';
  const cb = $('#ms-consent');
  if (cb) cb.checked = false;
  requestAnimationFrame(() => emailInput.focus());
}

// primerNombreDesdeEmail vive en logic.js (pura, testada).

// -------- auth wiring --------
async function render(session) {
  firstRenderDone = true;
  loadingView.hidden = true;
  stopBootMessages();
  if (session) {
    loginView.hidden  = true;
    authedView.hidden = false;
    resetOtpUi();
    statusEl.hidden = true;
    authedView.classList.add('ms-fade-in');
    // B2: recuerda al paciente en este navegador.
    const sessionEmail = session.user && session.user.email;
    if (sessionEmail) recordarPaciente(sessionEmail);
    // Si estábamos en la variante "welcome back", la reseteamos para la próxima.
    welcomeBack.hidden = true;
    loginTitle.hidden  = false;
    loginIntro.hidden  = false;
    const result = await hydrate();
    // Toast de racha rota: una vez por día. iOS mata la PWA en cada bloqueo
    // y relanza disparando INITIAL_SESSION en cada desbloqueo, así que un
    // gate por evento auth no basta. La key incluye la fecha local para que
    // el aviso vuelva a salir si el día siguiente sigue sin checkin.
    if (result && result.rota) {
      const todayKey = 'ms-toast-rota:' + toISO(new Date());
      let yaMostrado = false;
      try { yaMostrado = localStorage.getItem(todayKey) === '1'; } catch (e) {}
      if (!yaMostrado) {
        showToast('Has perdido la racha. Empezamos de nuevo mañana 💪');
        try { localStorage.setItem(todayKey, '1'); } catch (e) {}
      }
    }
    // Onboarding y milestone se auto-gatean: el primero contra
    // paciente.onboarding (DB), el segundo contra paciente.milestones_vistos
    // (DB). Una vez disparados, la propia llamada los desactiva — no hace
    // falta gate por evento aquí.
    maybeShowOnboarding();
    if (result && typeof result.racha === 'number') {
      maybeCelebrarMilestone(result.racha);
    }
  } else {
    authedView.hidden = true;
    loginView.hidden  = false;
    // B3: sesión null + paciente conocido → pantalla de bienvenida cálida.
    const known = pacienteConocido();
    if (known) mostrarWelcomeBack(known);
    else ocultarWelcomeBack();
  }
}

const consentBox = $('#ms-consent');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = validateLoginForm({ email: emailInput.value, consent: consentBox.checked });
  if (!v.ok) {
    if (v.error === 'no-consent') {
      showStatus('Para recibir el código tienes que aceptar la política de privacidad.', 'error');
      consentBox.focus();
    } else if (v.error === 'invalid') {
      showStatus('Ese correo no parece válido. Revísalo y vuelve a enviar.', 'error');
      emailInput.focus();
    }
    // 'empty' → silencioso (UX: no regañar antes de que escriba)
    return;
  }
  const email = v.email;

  submitBtn.disabled = true;
  submitBtn.classList.add('is-loading');
  setSubmitLabel(submitBtn, 'Enviando…');
  statusEl.hidden = true;

  // shouldCreateUser:false → si el email no fue admitido vía /alta-paciente,
  // Supabase devuelve error en vez de disparar el template "Confirm signup"
  // (link a la home). Garantiza que solo pacientes admitidas reciben OTP.
  const { error } = await supa.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false }
  });

  submitBtn.disabled = false;
  submitBtn.classList.remove('is-loading');
  setSubmitLabel(submitBtn, 'Enviar código');

  if (error) {
    console.error('signInWithOtp error:', error);
    const notAllowed = /signups?\s+not\s+allowed|user\s+not\s+found/i.test(error.message || '');
    if (notAllowed) {
      showStatus('Este correo no está dado de alta. Si acabas de pagar, escríbeme por WhatsApp y lo reviso.', 'error');
    } else {
      const detail = error.message ? ' (' + error.message + ')' : '';
      showStatus('No hemos podido enviar el código' + detail + '. Prueba de nuevo en un minuto.', 'error');
    }
    return;
  }
  // Recordamos el email ya aquí: aunque la sesión real se crea al verificar
  // el código, dejar rastro permite que la próxima visita ofrezca la
  // pantalla de bienvenida aunque la pestaña se cierre antes de confirmar.
  recordarPaciente(email);
  pendingOtpEmail = email;
  showStatus('📬 Te hemos enviado un código a ' + email + '. Escríbelo abajo.', 'ok');
  otpForm.hidden = false;
  requestAnimationFrame(() => otpInput.focus());

  // A3/A4: tras enviar el código OTP, ofrece el mini-tutorial de instalación
  // (o, si está dentro de Instagram/FB/etc., el banner para abrir en Chrome/Safari).
  // Delay de ~2.6s para no solapar el toast verde del status.
  setTimeout(() => {
    try { maybeMostrarInstallFlow(); } catch (e) { console.warn('install flow', e); }
  }, 2600);
});

// -------- OTP submit (verifica el código de 6 dígitos) --------
otpForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = validateOtpCode(otpInput.value.replace(/\D/g, ''));
  if (!v.ok || !pendingOtpEmail) {
    showStatus('Escribe el código de 6 dígitos que te hemos enviado.', 'error');
    otpInput.focus();
    return;
  }
  const code = v.code;
  otpSubmit.disabled = true;
  otpSubmit.classList.add('is-loading');
  setSubmitLabel(otpSubmit, 'Entrando…');
  statusEl.hidden = true;

  const { error } = await supa.auth.verifyOtp({
    email: pendingOtpEmail,
    token: code,
    type: 'email'
  });

  otpSubmit.disabled = false;
  otpSubmit.classList.remove('is-loading');
  setSubmitLabel(otpSubmit, 'Entrar');

  if (error) {
    console.error('verifyOtp error:', error);
    const detail = error.message ? ' (' + error.message + ')' : '';
    showStatus('Código incorrecto o caducado' + detail + '. Pide otro pulsando «Enviar código».', 'error');
    otpInput.select();
    return;
  }
  // Éxito → onAuthStateChange dispara render(session) automáticamente.
  resetOtpUi();
});

handlersReady = true;

// -------- install flow (A3/A4) --------
const TUTORIAL_SEEN_KEY = 'ms-tutorial-seen';
const installModal   = $('#ms-install');
const installBody    = $('#ms-install-body');
const installIntro   = $('#ms-install-intro');
const installOk      = $('#ms-install-ok');
const inappModal     = $('#ms-inapp');
const inappAction    = $('#ms-inapp-action');
const inappDismiss   = $('#ms-inapp-dismiss');
const inappIntro     = $('#ms-inapp-intro');

function maybeMostrarInstallFlow() {
  let tutorialSeen = false;
  try { tutorialSeen = localStorage.getItem(TUTORIAL_SEEN_KEY) === '1'; } catch (e) { /* noop */ }
  const hint = shouldShowInstallHint({
    standalone: isStandalone(),
    tutorialSeen,
    inAppBrowser: detectInAppBrowserLocal(),
    platform: detectPlatformLocal()
  });
  if (hint.kind === 'inapp') mostrarInAppModal(hint.inApp);
  else if (hint.kind === 'install') mostrarInstallModal(hint.plat);
  // 'none' → no mostramos nada (ya instalada, tutorial visto, o escritorio normal).
}

function mostrarInstallModal(plat) {
  if (plat === 'ios') {
    installIntro.textContent = 'Ten este espacio siempre a mano en tu iPhone:';
    installBody.innerHTML = `
      <div class="ms-install-illu" aria-hidden="true">
        <span>Busca</span>
        <svg width="26" height="30" viewBox="0 0 26 30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M13 20V4"/>
          <path d="M7 10l6-6 6 6"/>
          <rect x="3" y="12" width="20" height="16" rx="2.5"/>
        </svg>
        <span>abajo</span>
      </div>
      <ol class="ms-install-steps">
        <li><span class="ms-install-step-n">1</span><span>Pulsa el icono <strong>Compartir</strong> (⬆️) en la barra de abajo.</span></li>
        <li><span class="ms-install-step-n">2</span><span>Desliza y elige <strong>Añadir a pantalla de inicio</strong>.</span></li>
        <li><span class="ms-install-step-n">3</span><span>Toca <strong>Añadir</strong> y listo: aparecerá como una app.</span></li>
      </ol>`;
  } else {
    installIntro.textContent = 'Ten este espacio siempre a mano en tu Android:';
    installBody.innerHTML = `
      <div class="ms-install-illu" aria-hidden="true">
        <span>Busca</span>
        <svg width="10" height="30" viewBox="0 0 10 30" fill="currentColor">
          <circle cx="5" cy="6" r="2"/><circle cx="5" cy="15" r="2"/><circle cx="5" cy="24" r="2"/>
        </svg>
        <span>arriba a la derecha</span>
      </div>
      <ol class="ms-install-steps">
        <li><span class="ms-install-step-n">1</span><span>Pulsa el menú <strong>⋮</strong> arriba a la derecha.</span></li>
        <li><span class="ms-install-step-n">2</span><span>Elige <strong>Añadir a pantalla de inicio</strong> (o <strong>Instalar app</strong>).</span></li>
        <li><span class="ms-install-step-n">3</span><span>Confirma y aparecerá como una app en tu móvil.</span></li>
      </ol>`;
  }
  installModal.hidden = false;
  requestAnimationFrame(() => installOk.focus());
}

installOk.addEventListener('click', () => {
  installModal.hidden = true;
  try { localStorage.setItem(TUTORIAL_SEEN_KEY, '1'); } catch (e) { /* noop */ }
});

function mostrarInAppModal(kind) {
  const plat = detectPlatformLocal();
  if (plat === 'android') {
    inappAction.textContent = 'Abrir en Chrome';
    inappAction.dataset.mode = 'android';
    inappIntro.textContent = 'Estás dentro de ' + nombreAppEmbebida(kind) + '. Para guardar esta página como app, ábrela en Chrome.';
  } else if (plat === 'ios') {
    inappAction.textContent = 'Copiar enlace';
    inappAction.dataset.mode = 'ios';
    inappIntro.textContent = 'Estás dentro de ' + nombreAppEmbebida(kind) + '. Copia el enlace y pégalo en Safari para guardar esta página como app.';
  } else {
    // escritorio dentro de webview es raro: damos copia de enlace.
    inappAction.textContent = 'Copiar enlace';
    inappAction.dataset.mode = 'ios';
    inappIntro.textContent = 'Para guardar esta página como app en tu móvil, ábrela en Safari o Chrome.';
  }
  inappModal.hidden = false;
  requestAnimationFrame(() => inappAction.focus());
}

// nombreAppEmbebida vive en logic.js (pura, testada).

inappAction.addEventListener('click', async () => {
  const mode = inappAction.dataset.mode;
  if (mode === 'android') {
    // Intent fuerza a abrir en Chrome si está instalado.
    const intent = 'intent://www.crislorentenutricion.com/mi-seguimiento/#Intent;scheme=https;package=com.android.chrome;end';
    window.location.href = intent;
    return;
  }
  // iOS o fallback: clipboard
  const url = 'https://www.crislorentenutricion.com/mi-seguimiento/';
  try {
    await navigator.clipboard.writeText(url);
    showToast('Enlace copiado. Ábrelo en Safari y pégalo allí.');
  } catch (e) {
    // fallback legacy
    try {
      const ta = document.createElement('textarea');
      ta.value = url; ta.setAttribute('readonly', '');
      ta.style.position = 'absolute'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Enlace copiado. Ábrelo en Safari y pégalo allí.');
    } catch (e2) {
      showToast('No hemos podido copiar. Copia la URL manualmente desde la barra.');
    }
  }
  inappModal.hidden = true;
});

inappDismiss.addEventListener('click', () => {
  inappModal.hidden = true;
});

$$('.ms-check-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!paciente) return;
    const estado = btn.dataset.estado;
    btn.classList.remove('ms-pulsing');
    void btn.offsetWidth; // reinicia la animación si se clica rápido dos veces
    btn.classList.add('ms-pulsing');
    btn.addEventListener('animationend', () => btn.classList.remove('ms-pulsing'), { once: true });
    setActiveCheck(estado);

    // Optimistic UI: pinta calendario y racha al instante con estado local.
    // Así el feedback es inmediato aunque la red o la sesión estén lentas
    // (p.ej. al volver de bloquear el móvil).
    const targetISO = checkinTargetISO || toISO(new Date());
    const estadoPrevio = applyCheckinOptimistic(checkinsMap, targetISO, estado);
    renderStreak(checkinsMap);
    renderCalendar(checkinsMap);

    const res = await upsertCheckin(estado, targetISO);
    if (res && (res.sessionExpired || res.error)) {
      revertCheckin(checkinsMap, targetISO, estadoPrevio);
      if (estadoPrevio) setActiveCheck(estadoPrevio);
      renderStreak(checkinsMap);
      renderCalendar(checkinsMap);
      if (res.sessionExpired) {
        // B4: sesión caducada → vuelta amable al login (welcome-back hará su magia).
        showToast('Tu sesión ha caducado. Te llevamos a iniciar sesión.');
        render(null);
      } else {
        console.error(res.error);
        showToast('No hemos podido guardarlo. Prueba otra vez en un momento.');
      }
      return;
    }
    // Re-fetch para sincronizar con servidor (silencioso si falla).
    try {
      const from = toISO(new Date(Date.now() - 60 * 864e5));
      const checkins = await loadCheckins(from, paciente.id);
      checkinsMap = new Map(checkins.map(c => [c.fecha, c.estado]));
      const racha = renderStreak(checkinsMap);
      renderCalendar(checkinsMap);
      maybeCelebrarMilestone(racha);
    } catch (e) { console.error('resync', e); }
  });
});

$('#ms-calendar-grid').addEventListener('click', (e) => {
  const iso = e.target.closest('.ms-cal-cell')?.dataset.iso;
  if (iso) mostrarDia(iso);
});
$('#ms-back-today').addEventListener('click', () => { mostrarHoy(); setViewHash('today'); });
// Barra de pestañas: un solo listener delegado; el data-tab del markup es el
// registro de pestañas (mismo valor que consume setViewHash).
const TAB_RENDERERS = { today: mostrarHoy, compra: mostrarCompra, aprender: mostrarAprender };
$('.ms-tabbar-inner').addEventListener('click', (e) => {
  const tab = e.target.closest('.ms-tab')?.dataset.tab;
  if (TAB_RENDERERS[tab]) { TAB_RENDERERS[tab](); setViewHash(tab); }
});

// El estilo de la pestaña activa lo resuelve el CSS con #ms-authed[data-view];
// aquí solo mantenemos aria-current sincronizado para lectores de pantalla.
// data-view cambia en varios puntos (tabs, calendario, restauración al
// hidratar), así que observamos el atributo en vez de repetir la llamada en
// cada uno.
function syncTabbarAria() {
  const active = activeTabForView(authedView.dataset.view);
  $$('.ms-tab').forEach((btn) => {
    if (btn.dataset.tab === active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}
new MutationObserver(syncTabbarAria).observe(authedView, { attributes: true, attributeFilter: ['data-view'] });
$('#ms-apr-mapa').addEventListener('click', (e) => {
  const slug = e.target.closest('[data-open]')?.dataset.open;
  if (slug) { abrirLeccion(slug); return; }
  const faseGuia = e.target.closest('[data-open-guia]')?.dataset.openGuia;
  if (faseGuia) {
    const guia = estadoCursoActual().guias.find((g) => g.fase === faseGuia);
    if (guia && guia.desbloqueada) mostrarGuiaModal(guia);
  }
});
$('#ms-apr-btn-next').addEventListener('click', () => {
  const isAction = aprIdx === aprCur.cards.length;
  if (isAction) { completarLeccion(); return; }
  showCardLeccion(aprIdx + 1);
});
$('#ms-apr-btn-prev').addEventListener('click', () => { if (aprIdx > 0) showCardLeccion(aprIdx - 1); });
$('#ms-apr-player-close').addEventListener('click', cerrarPlayer);
$('#ms-apr-pdf-close').addEventListener('click', () => { $('#ms-apr-pdf-modal').hidden = true; });
$('#ms-apr-pdf-dl').addEventListener('click', () => { if (aprGuiaActual) descargarGuia(aprGuiaActual.path); });
$('#ms-compra-reset').addEventListener('click', reiniciarCompra);
$('#ms-meals').addEventListener('click', (e) => {
  const btn = e.target.closest('.ms-meal-swap');
  if (!btn) return;
  abrirIntercambiador(btn.dataset.dia, btn.dataset.comida);
});
// El <label> nativo envuelve checkbox + texto, así que cualquier clic
// (ratón o teclado) togglea el checkbox y dispara 'change'. Un único handler.
$('#ms-compra-cats').addEventListener('change', (e) => {
  if (!e.target.matches('input[type="checkbox"]')) return;
  const li = e.target.closest('.ms-compra-item');
  if (li) setCompraItem(li, e.target.checked);
});

$('#ms-signout').addEventListener('click', async () => {
  // Cierre explícito: también olvidamos el "paciente conocido" local.
  olvidarPaciente();
  // Limpiamos la vista activa para que el próximo login (posiblemente otra
  // paciente en el mismo navegador) arranque en 'today', no en compra.
  try { localStorage.removeItem('ms-active-view'); } catch (e) {}
  await supa.auth.signOut();
});

forgetBtn.addEventListener('click', () => {
  // "No soy yo": limpia la marca local y vuelve al login normal.
  olvidarPaciente();
  ocultarWelcomeBack();
  resetOtpUi();
});

supa.auth.onAuthStateChange(async (event, session) => {
  // Al abrir la PWA desde el icono, el access_token cacheado puede estar
  // caducado y hydrate() se queda colgado con JWT viejo. Refrescamos antes
  // del primer render.
  if (event === 'INITIAL_SESSION' && session) {
    try {
      const { data } = await supa.auth.refreshSession();
      if (data.session) session = data.session;
    } catch (e) { console.warn('refresh on boot', e); }
  }
  render(session);
});

// Al volver del bloqueo del móvil o cambio de pestaña: re-valida la sesión
// y re-hidrata. Arregla el caso de Chromium en el que el token se queda
// stale mientras la pestaña está congelada.
let lastVisibilityRefresh = 0;
document.addEventListener('visibilitychange', async () => {
  // Pre-check barato: debounce sin tocar red.
  const preDecision = shouldRehydrateOnVisibility({
    visibilityState: document.visibilityState,
    now: Date.now(),
    lastRefreshAt: lastVisibilityRefresh,
    hasSession: true,  // todavía no lo sabemos; si no, lo corregimos abajo
    authedVisible: !authedView.hidden,
    hasPaciente: !!paciente
  });
  if (preDecision === 'ignore') return;
  lastVisibilityRefresh = Date.now();
  const { data } = await supa.auth.getSession();
  const decision = shouldRehydrateOnVisibility({
    visibilityState: document.visibilityState,
    now: Date.now(),
    lastRefreshAt: 0,  // ya actualizado, saltar debounce
    hasSession: !!data.session,
    authedVisible: !authedView.hidden,
    hasPaciente: !!paciente
  });
  if (decision === 'go-login') {
    // sesión caducada mientras el móvil estaba bloqueado
    authedView.hidden = true;
    loginView.hidden = false;
    return;
  }
  if (decision === 'rehydrate') {
    try { await hydrate(); } catch (e) { console.error('rehydrate', e); }
  }
});

// Prefill email from ?email= query param so coming from the menu email is ~1 click.
// Este param manda sobre la variante "welcome back": si Cristina envía un
// enlace con un email específico, confiamos en él.
(() => {
  const params = new URLSearchParams(window.location.search);
  const qEmail = params.get('email');
  if (!qEmail) return;
  const r = resolveInitialLogin({ queryEmail: qEmail, lastEmail: pacienteConocido() });
  emailInput.value = r.email;
  if (r.mode === 'query') {
    // Query distinto al paciente conocido → volvemos a la variante fresh
    // para no saludar con el nombre equivocado. Email queda prefilled.
    ocultarWelcomeBack();
    emailInput.value = r.email;
  }
  // Focus the submit button so the flow is: open email → click → click "Enviar código".
  requestAnimationFrame(() => submitBtn.focus());
})();

// Banner iOS: "Añadir a pantalla de inicio".
// iOS Safari no expone beforeinstallprompt, así que mostramos instrucciones
// manuales solo en iPhone/iPad cuando no está ya en modo standalone.
(function () {
  const hint = document.getElementById('ms-install-hint');
  if (!hint) return;
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const dismissed = localStorage.getItem('ms-install-hint-dismissed') === '1';
  if (isIOS && !isStandalone && !dismissed) {
    hint.classList.add('is-visible');
  }
  hint.querySelector('[data-ms-ih-close]').addEventListener('click', () => {
    hint.classList.remove('is-visible');
    localStorage.setItem('ms-install-hint-dismissed', '1');
  });
})();
