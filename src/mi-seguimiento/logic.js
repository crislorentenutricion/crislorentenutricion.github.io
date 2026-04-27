// Lógica pura de la PWA /mi-seguimiento — aislada de DOM y Supabase.
// Navegador: `<script src="/mi-seguimiento/logic.js">` expone `window.MsLogic`.
// Node tests: `require('./logic.js')` devuelve la misma API.
(function () {
  'use strict';

  function toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function dayOfYear(d) {
    const start = new Date(d.getFullYear(), 0, 0);
    const diff = d - start + ((start.getTimezoneOffset() - d.getTimezoneOffset()) * 60 * 1000);
    return Math.floor(diff / 864e5);
  }

  // 28 = MENÚ 1 completo (4 semanas); 30 = mes calendario.
  const MILESTONES = [7, 14, 28, 30];

  function detectarMilestone(racha, vistos) {
    const set = new Set(vistos || []);
    let alcanzado = null;
    for (const m of MILESTONES) {
      if (racha >= m && !set.has(m)) alcanzado = m;
    }
    return alcanzado;
  }

  // Racha: cuenta desde ayer hacia atrás. 'seguido' suma, 'parcial' mantiene,
  // 'no' o ausencia rompe. `hoy` inyectable para tests.
  function countStreak(checkinsMap, hoy) {
    const d = new Date(hoy || new Date()); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 1);
    let n = 0;
    while (true) {
      const estado = checkinsMap.get(toISO(d));
      if (estado === 'seguido') n++;
      else if (estado === 'parcial') { /* mantiene, no suma */ }
      else break;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  // Gap entre el último checkin y ayer → racha rota.
  function detectarRachaRota(checkinsMap, hoy) {
    const now = new Date(hoy || new Date()); now.setHours(0, 0, 0, 0);
    const todayISO = toISO(now);
    const yesterdayISO = toISO(new Date(now.getTime() - 864e5));
    let lastISO = null;
    for (const [iso] of checkinsMap) {
      if (iso < todayISO && (!lastISO || iso > lastISO)) lastISO = iso;
    }
    return !!lastISO && lastISO < yesterdayISO;
  }

  const TIPS = [
    'Hidrátate antes de comer: medio vaso de agua 15 minutos antes ayuda a comer con más calma.',
    'Mastica sin prisa. La saciedad tarda unos 20 minutos en llegar al cerebro.',
    '«A medias» también cuenta. Progreso no es perfección.',
    'Come siempre sentada, sin pantalla delante. El cuerpo se entera mejor de lo que comes.',
    'Si tienes hambre entre horas, bebe agua primero. A veces es sed disfrazada.',
    'Verdura en comida y cena. Media ración como mínimo, cruda o cocinada.',
    'No te saltes el desayuno si tu cuerpo lo pide. Escúchalo, no lo fuerces.',
    'Compra con lista. Si no entra en casa, no se come.',
    'Un plato colorido suele ser un plato completo.',
    'El azúcar que no ves (salsas, panes, yogures) suma más que el que sí ves.',
    'Descansar bien es parte del plan. Dormir poco dispara el hambre del día siguiente.',
    'Si un día te desmadras, el siguiente no lo compenses: retoma con normalidad.',
    'Proteína en cada comida principal: huevo, pescado, legumbre, carne magra, tofu.',
    'La fruta entera sacia más que el zumo. Muerde antes de exprimir.',
    'Cocina de más: tener comida lista evita decisiones malas con hambre.',
    'Andar 20 minutos después de comer ayuda a la digestión y al ánimo.',
    'Grasas buenas sí: aguacate, frutos secos, aceite de oliva. No todas engordan igual.',
    'Pesarse cada día es ruido. Una vez por semana, mismo día, en ayunas, basta.',
    'La paciencia es parte del método. Los cambios reales son lentos y aburridos.',
    'Celebra lo que marcas, no sólo lo que pesas. La constancia también es resultado.'
  ];

  function tipDelDia(hoy) {
    return TIPS[dayOfYear(hoy) % TIPS.length];
  }

  // Calendario mensual: devuelve celdas lineales (offset + días + trailing) para
  // rellenar una grid de 7 columnas que empieza en lunes. El DOM rendering vive
  // en el njk; aquí solo forma/datos. Cada celda:
  //   { type: 'empty' }
  //   { type: 'day', day, iso, estado: 'seguido'|'parcial'|'no'|null, isToday }
  function buildCalendarCells(year, month, checkinsMap, todayISO) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    // Mon=0..Sun=6. JS getDay() devuelve Sun=0..Sat=6, por eso el +6 mod 7.
    const offset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = lastDay.getDate();
    const trailing = (7 - ((offset + daysInMonth) % 7)) % 7;
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push({ type: 'empty' });
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      const estado = checkinsMap.get(iso) || null;
      cells.push({ type: 'day', day, iso, estado, isToday: iso === todayISO });
    }
    for (let i = 0; i < trailing; i++) cells.push({ type: 'empty' });
    return cells;
  }

  // -----------------------------------------------------------------
  // Recordatorio de revisión mensual
  // -----------------------------------------------------------------

  // Estados del CTA "Enviar revisión" en la home de /mi-seguimiento/.
  // Entradas (todas opcionales salvo `now`):
  //   proximaSesion    : { id, fecha } | null — próxima sesión futura del paciente
  //   revisionEnviada  : boolean — true si ya hay revisión vinculada a esa sesión
  //   now              : Date — inyectable para tests
  //
  // Reglas (decisión Cristina 2026-04-20): la sección aparece EN EL
  // MISMO MOMENTO en que se envía el email de recordatorio por el cron
  // Apps Script — el día (sesión - 2 días civiles) a las 9:00 locales
  // (Europe/Madrid). Ver `scripts/apps-script/booking/reminders.js`:
  // `REVISION_REMINDER_DIAS_ANTES=2` + `REVISION_REMINDER_HOUR=9`. Si
  // se cambia uno, cambiar el otro.
  //
  //   - Sin próxima sesión o sesión pasada → 'hidden'.
  //   - Sesión futura pero aún antes de la hora de envío → 'hidden'.
  //   - Desde la hora de envío hasta la sesión, sin revisión → 'urgent'.
  //   - Desde la hora de envío hasta la sesión, con revisión → 'done'.
  const REV_REMINDER_DAYS_BEFORE = 2;
  const REV_REMINDER_HOUR = 9;

  function getRevisionCtaState(opts) {
    const o = opts || {};
    const proxima = o.proximaSesion;
    const revisionEnviada = !!o.revisionEnviada;
    const now = o.now instanceof Date ? o.now : new Date();
    if (!proxima || !proxima.fecha) return 'hidden';
    const sesion = proxima.fecha instanceof Date ? proxima.fecha : new Date(proxima.fecha);
    if (isNaN(sesion.getTime())) return 'hidden';
    if (sesion.getTime() - now.getTime() < 0) return 'hidden';
    // "Visible desde" = día civil de la sesión - N días, a las HH:00 locales.
    // Con componentes locales (getFullYear/getMonth/getDate) la Date resultante
    // también está en la zona horaria del navegador — la paciente está en España.
    const visibleFrom = new Date(
      sesion.getFullYear(),
      sesion.getMonth(),
      sesion.getDate() - REV_REMINDER_DAYS_BEFORE,
      REV_REMINDER_HOUR, 0, 0, 0
    );
    if (now.getTime() < visibleFrom.getTime()) return 'hidden';
    if (revisionEnviada) return 'done';
    return 'urgent';
  }

  // Formatea la fecha de la próxima sesión en el texto del modal:
  //   mismo día civil  → 'hoy a las HH:MM'
  //   día civil+1      → 'mañana a las HH:MM'
  //   día civil+2 o +  → 'el [lunes/martes/…] a las HH:MM'
  //
  // Usa la zona horaria del runtime (en producción: `es-ES` con Europe/Madrid
  // servido por el navegador de la paciente, que está en España). `now`
  // inyectable para tests.
  const DIAS_SEMANA_ES = [
    'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'
  ];

  function _pad2(n) { return String(n).padStart(2, '0'); }

  function formatFechaRelativa(fecha, now) {
    const f = fecha instanceof Date ? fecha : new Date(fecha);
    const n = now instanceof Date ? now : new Date();
    if (isNaN(f.getTime())) return '';
    const hora = _pad2(f.getHours()) + ':' + _pad2(f.getMinutes());
    const midnightNow = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    const midnightF = new Date(f.getFullYear(), f.getMonth(), f.getDate());
    const diffDays = Math.round((midnightF - midnightNow) / 86400000);
    if (diffDays === 0) return 'hoy a las ' + hora;
    if (diffDays === 1) return 'mañana a las ' + hora;
    return 'el ' + DIAS_SEMANA_ES[f.getDay()] + ' a las ' + hora;
  }

  // Pacientes con distinto nº de tomas (4 vs 5) → filtramos slots vacíos
  // para no mostrar "—" en la app. `dia` es el objeto { desayuno, almuerzo, ... }
  // del menú; `comidas` es el array [[key, label], ...].
  function visibleMeals(dia, comidas) {
    if (!dia || !Array.isArray(comidas)) return [];
    return comidas
      .map(function (c) { return { key: c[0], label: c[1], text: dia[c[0]] }; })
      .filter(function (m) { return m.text != null && String(m.text).trim() !== ''; });
  }

  // -----------------------------------------------------------------
  // Detección de plataforma y navegador embebido (install flow PWA)
  // -----------------------------------------------------------------

  // iPadOS 13+ se anuncia como Mac con touch → lo tratamos como iOS para
  // mostrar las instrucciones de "Añadir a pantalla de inicio" de Safari.
  function detectPlatform(opts) {
    const o = opts || {};
    const ua = String(o.ua || '').toLowerCase();
    const maxTouchPoints = Number(o.maxTouchPoints || 0);
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    if (/macintosh/.test(ua) && maxTouchPoints > 1) return 'ios';
    if (/android/.test(ua)) return 'android';
    return 'other';
  }

  // Detecta si la paciente está dentro del navegador embebido de una app
  // (Instagram, Facebook, TikTok…). En esos navegadores "Añadir a pantalla"
  // no instala como app estándar — la invitamos a abrir en Chrome/Safari.
  function detectInAppBrowser(ua) {
    const s = String(ua || '');
    if (/Instagram/i.test(s)) return 'instagram';
    if (/FBAN|FBAV|FB_IAB/i.test(s)) return 'facebook';
    if (/\bLine\//i.test(s)) return 'line';
    if (/musical_ly|Bytedance|TikTok/i.test(s)) return 'tiktok';
    if (/LinkedInApp/i.test(s)) return 'linkedin';
    if (/Snapchat/i.test(s)) return 'snapchat';
    if (/Android.*;\s*wv\)/i.test(s)) return 'webview';
    return null;
  }

  // Etiqueta humana del navegador embebido para el modal. Desconocido → "una app".
  const NOMBRES_APP_EMBEBIDA = {
    instagram: 'Instagram',
    facebook: 'Facebook',
    line: 'Line',
    tiktok: 'TikTok',
    linkedin: 'LinkedIn',
    snapchat: 'Snapchat',
    webview: 'una app'
  };
  function nombreAppEmbebida(kind) {
    return NOMBRES_APP_EMBEBIDA[kind] || 'una app';
  }

  // -----------------------------------------------------------------
  // Clasificación de errores para reintentar (retry con backoff)
  // -----------------------------------------------------------------

  // Reintenta solo errores transitorios: red caída o 5xx.
  // 4xx se considera permanente (auth expirada, payload inválido…).
  function esErrorTransitorio(err) {
    if (!err) return false;
    if (err instanceof TypeError) return true;
    const status = err.status || err.statusCode || (err.context && err.context.status);
    if (typeof status === 'number') {
      if (status >= 500 && status < 600) return true;
      return false;
    }
    const msg = String(err.message || err).toLowerCase();
    if (/network|fetch|timeout|failed to fetch|load failed/.test(msg)) return true;
    return false;
  }

  // -----------------------------------------------------------------
  // Nombres: primer nombre desde NOMBRE COMPLETO o desde email
  // -----------------------------------------------------------------

  // Nombre completo en MAYÚSCULAS → primer nombre con mayúscula inicial.
  // Saludos a pacientes se muestran así (p.ej. "Hola Ana").
  function primerNombre(nombre) {
    if (!nombre) return '';
    const first = String(nombre).trim().split(/\s+/)[0];
    if (!first) return '';
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }

  // Saludo según hora local: 6-12 mañana, 12-21 tarde, 21-6 noche.
  // `hora` es Number 0-23. null/undefined/NaN → "Hola" como fallback neutro.
  function saludoPorHora(hora) {
    if (hora === null || hora === undefined) return 'Hola';
    const h = Number(hora);
    if (!Number.isFinite(h)) return 'Hola';
    const n = ((h % 24) + 24) % 24;
    if (n >= 6 && n < 12) return 'Buenos días';
    if (n >= 12 && n < 21) return 'Buenas tardes';
    return 'Buenas noches';
  }

  // Fallback cuando solo tenemos email: "maria.garcia@…" → "Maria".
  // Si el prefijo está vacío o no hay email → "de nuevo".
  function primerNombreDesdeEmail(email) {
    if (!email) return 'de nuevo';
    const raw = String(email).split('@')[0] || '';
    const first = raw.split(/[._\-+]/)[0];
    if (!first) return 'de nuevo';
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }

  // -----------------------------------------------------------------
  // Lista de la compra: clave estable por item + totales
  // -----------------------------------------------------------------

  // Clave estable categoría+texto para persistir el check en localStorage.
  // Si Cristina reedita el texto de un item, se pierde el check — aceptado.
  function slugifyItem(categoria, texto) {
    return (String(categoria) + '::' + String(texto))
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Clave de localStorage: una por menú (ms-compra-<menu_id>).
  // Si no hay menú.id → null (no se persiste, evita pisar otros estados).
  function compraStorageKey(menu) {
    return (menu && menu.id) ? ('ms-compra-' + menu.id) : null;
  }

  // Nombre de categoría listo para pintar. Si llega en MAYÚSCULAS (menús
  // pre-2026-04-27 con la taxonomía vieja) lo normaliza a sentence-case
  // ('CARNES Y PESCADOS' → 'Carnes y pescados') para que conviva sin chillar
  // con la taxonomía nueva en Title Case ('Fruta y verdura', que se devuelve
  // tal cual).
  function displayCat(cat) {
    if (typeof cat !== 'string' || !cat) return '';
    const isAllUpper = cat === cat.toUpperCase() && cat !== cat.toLowerCase();
    if (!isAllUpper) return cat;
    return cat[0] + cat.slice(1).toLowerCase();
  }

  // Nº total de items en la lista de compra. Itera las claves del JSON tal cual
  // — la taxonomía la decide la skill /crear-menu, no el cliente.
  function totalItemsCompra(lista) {
    if (!lista || typeof lista !== 'object') return 0;
    let n = 0;
    for (const cat of Object.keys(lista)) {
      if (Array.isArray(lista[cat])) n += lista[cat].length;
    }
    return n;
  }

  // -----------------------------------------------------------------
  // Login / OTP: validación pura del formulario
  // -----------------------------------------------------------------

  function normalizeEmail(email) {
    return String(email == null ? '' : email).trim().toLowerCase();
  }

  // Devuelve { ok: true, email } o { ok: false, error: 'empty'|'invalid'|'no-consent' }.
  // El email se normaliza (trim + lowercase) antes de validar.
  function validateLoginForm(opts) {
    const o = opts || {};
    const email = normalizeEmail(o.email);
    const consent = !!o.consent;
    if (!email) return { ok: false, error: 'empty' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'invalid' };
    if (!consent) return { ok: false, error: 'no-consent' };
    return { ok: true, email };
  }

  // Valida el código OTP que la paciente teclea. Supabase emite 6 dígitos por
  // default; si se cambia allí, cambiar aquí también.
  function validateOtpCode(code) {
    const t = String(code == null ? '' : code).trim();
    if (!/^\d{6}$/.test(t)) return { ok: false, error: 'invalid' };
    return { ok: true, code: t };
  }

  // -----------------------------------------------------------------
  // Login inicial: prefill desde ?email= y welcome-back
  // -----------------------------------------------------------------

  // Decide con qué email arranca el form de login y en qué modo.
  //   - queryEmail (URL ?email=) gana siempre que esté presente.
  //   - Si coincide con el último paciente recordado → welcome-back.
  //   - Si difiere → modo 'query' (prefill pero sin saludo cálido).
  //   - Sin query pero con lastEmail → welcome-back.
  //   - Sin nada → 'fresh'.
  function resolveInitialLogin(opts) {
    const o = opts || {};
    const query = o.queryEmail ? normalizeEmail(o.queryEmail) : null;
    const last = o.lastEmail ? normalizeEmail(o.lastEmail) : null;
    if (query && last && query === last) return { email: query, mode: 'welcome-back' };
    if (query) return { email: query, mode: 'query' };
    if (last) return { email: last, mode: 'welcome-back' };
    return { email: '', mode: 'fresh' };
  }

  // -----------------------------------------------------------------
  // Install / in-app: qué banner mostrar
  // -----------------------------------------------------------------

  // Coordinator del install flow: dado el entorno (standalone?, navegador
  // embebido?, plataforma, tutorial ya visto?), decide si mostrar el modal
  // de "añadir a pantalla de inicio", el modal de "abre en Safari/Chrome"
  // o nada. En escritorio normal no mostramos nada.
  function shouldShowInstallHint(opts) {
    const o = opts || {};
    if (o.standalone) return { kind: 'none' };
    if (o.tutorialSeen) return { kind: 'none' };
    if (o.inAppBrowser) return { kind: 'inapp', inApp: o.inAppBrowser };
    const plat = o.platform;
    if (plat === 'ios' || plat === 'android') return { kind: 'install', plat };
    return { kind: 'none' };
  }

  // -----------------------------------------------------------------
  // visibilitychange: qué hacer al volver a la pestaña
  // -----------------------------------------------------------------

  // Debounce + branch: al recuperar visibilidad, decide 'ignore' (debounce o
  // no visible), 'go-login' (sin sesión tras bloqueo), 'rehydrate' (sesión
  // OK y estábamos autenticados) o 'noop' (sesión OK pero no estamos en la
  // vista autenticada).
  function shouldRehydrateOnVisibility(opts) {
    const o = opts || {};
    if (o.visibilityState && o.visibilityState !== 'visible') return 'ignore';
    const now = typeof o.now === 'number' ? o.now : Date.now();
    const last = typeof o.lastRefreshAt === 'number' ? o.lastRefreshAt : 0;
    if (now - last < 2000) return 'ignore';
    if (!o.hasSession) return 'go-login';
    if (o.authedVisible && o.hasPaciente) return 'rehydrate';
    return 'noop';
  }

  // -----------------------------------------------------------------
  // Milestone celebration: detectarMilestone + gate de onboarding
  // -----------------------------------------------------------------

  // Solo celebramos milestone si el onboarding ya se vio (evita apilar modales
  // encima del primer tour). Devuelve el número a celebrar o null.
  function shouldCelebrarMilestone(opts) {
    const o = opts || {};
    if (!o.onboarding) return null;
    if (typeof o.racha !== 'number') return null;
    return detectarMilestone(o.racha, o.vistos || []);
  }

  // -----------------------------------------------------------------
  // Vista día (tap celda calendario) y vista hoy
  // -----------------------------------------------------------------

  // Config de estados del detalle de día. Copys aprobados — hablar de
  // etiquetas, no de colores (accesibilidad + consistencia con la UI).
  const DAY_STATUS_LABELS = {
    seguido: { cls: 'is-ok',  label: '«Lo seguí»', msg: 'Un día más cuidándote. Cada uno cuenta.' },
    parcial: { cls: 'is-mid', label: '«A medias»', msg: 'Mantuviste la constancia. Seguir es ganar.' },
    no:      { cls: 'is-no',  label: '«Hoy no»',   msg: 'Un día suelto no te define. Mañana vuelves.' }
  };

  // Claves canónicas del JSON del menú (ver plan-nutricional-supabase.md).
  // Alineadas con Date.getDay(): 0 = domingo.
  const WEEKDAY_KEYS_JSON = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

  // Estado y copy del detalle de día abierto desde el calendario.
  // Entradas:
  //   iso          : 'YYYY-MM-DD' del día a mostrar
  //   menu         : menú vigente ({contenido: {dias: {lunes: {...}}}}) o null
  //   checkinsMap  : Map<iso,estado>
  //   now          : Date — inyectable, default new Date()
  //   comidas      : [[key, label], ...] — slots de comida a mostrar en orden
  //   weekdayKeys  : override de las claves del menú; default WEEKDAY_KEYS_JSON
  // Salida:
  //   weekday  : clave del día en el JSON (ej. 'miercoles')
  //   meals    : array de visibleMeals (puede ser [] si no hay menú ese día)
  //   status   : {kind: 'marked', cls, label, msg} si hay checkin;
  //              {kind: 'unmarked', msg} si no (copy depende de pasado/hoy/futuro).
  function computeDayView(opts) {
    const o = opts || {};
    const iso = o.iso;
    const menu = o.menu || null;
    const checkinsMap = o.checkinsMap instanceof Map ? o.checkinsMap : new Map();
    const now = o.now instanceof Date ? o.now : new Date();
    const comidas = Array.isArray(o.comidas) ? o.comidas : [];
    const weekdayKeys = Array.isArray(o.weekdayKeys) ? o.weekdayKeys : WEEKDAY_KEYS_JSON;

    const parts = String(iso || '').split('-').map(Number);
    const fecha = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
    const weekday = weekdayKeys[fecha.getDay()];
    const dia = menu && menu.contenido && menu.contenido.dias ? menu.contenido.dias[weekday] : null;
    const meals = visibleMeals(dia, comidas);
    const estado = checkinsMap.get(iso);
    const cfg = DAY_STATUS_LABELS[estado];
    let status;
    if (cfg) {
      status = { kind: 'marked', cls: cfg.cls, label: cfg.label, msg: cfg.msg };
    } else {
      const todayISO = toISO(now);
      let msg;
      if (iso > todayISO) msg = 'Aún está por llegar. Cuando sea, lo marcas.';
      else if (iso === todayISO) msg = 'Aún no has marcado hoy. Hazlo cuando termines el día.';
      else msg = 'Este día no lo marcaste. Sin drama, sigue tu camino.';
      status = { kind: 'unmarked', msg };
    }
    return { weekday, dia, meals, status };
  }

  // Vista "hoy": mismo shape que computeDayView pero simplificado.
  // No incluye status porque la vista hoy muestra los botones de check-in,
  // no la pastilla de estado.
  function computeTodayView(opts) {
    const o = opts || {};
    const menu = o.menu || null;
    const checkinsMap = o.checkinsMap instanceof Map ? o.checkinsMap : new Map();
    const now = o.now instanceof Date ? o.now : new Date();
    const comidas = Array.isArray(o.comidas) ? o.comidas : [];
    const weekdayKeys = Array.isArray(o.weekdayKeys) ? o.weekdayKeys : WEEKDAY_KEYS_JSON;

    const weekday = weekdayKeys[now.getDay()];
    const dia = menu && menu.contenido && menu.contenido.dias ? menu.contenido.dias[weekday] : null;
    const meals = visibleMeals(dia, comidas);
    const todayISO = toISO(now);
    const activeCheck = checkinsMap.get(todayISO) || null;
    return { weekday, dia, meals, activeCheck, todayISO };
  }

  // -----------------------------------------------------------------
  // Lista de la compra: modelo + meta + toggle inmutable
  // -----------------------------------------------------------------

  // Modelo renderizable de la lista de la compra:
  //   - empty: true si no hay items (muestra estado vacío).
  //   - cats: [{cat, comprados, total, items: [{text, key, done}]}]
  //   - total/hechos globales.
  // Itera las claves del JSON en el orden que vengan (lo decide /crear-menu).
  // Filtra categorías sin items para no emitir <details> vacíos.
  function buildCompraModel(opts) {
    const o = opts || {};
    const lista = (o.menu && o.menu.contenido && o.menu.contenido.lista_compra) || {};
    const estadoSet = o.estadoSet instanceof Set ? o.estadoSet : new Set(o.estadoSet || []);
    const total = totalItemsCompra(lista);
    const hechos = estadoSet.size;
    if (total === 0) return { empty: true, total: 0, hechos: 0, cats: [] };
    const cats = [];
    for (const cat of Object.keys(lista)) {
      const items = Array.isArray(lista[cat]) ? lista[cat] : null;
      if (!items || !items.length) continue;
      const itemsOut = items.map(function (text) {
        const key = slugifyItem(cat, text);
        return { text, key, done: estadoSet.has(key) };
      });
      const comprados = itemsOut.reduce(function (n, it) { return n + (it.done ? 1 : 0); }, 0);
      cats.push({ cat, comprados, total: items.length, items: itemsOut });
    }
    return { empty: false, total, hechos, cats };
  }

  // Meta de la entry card + barra de progreso. "Semanal" explícito en el copy
  // (feedback 2026-04-17: la paciente necesita saber la cadencia).
  function computeCompraMeta(opts) {
    const o = opts || {};
    const total = Number(o.total || 0);
    const hechos = Number(o.hechos || 0);
    if (total === 0) {
      return {
        metaText: 'Disponible con tu próximo menú',
        progressText: 'Aún no hay lista para esta semana.',
        progressDone: false,
        actionsHidden: true
      };
    }
    const metaText = hechos === 0
      ? 'Semanal · ' + total + ' productos'
      : 'Semanal · ' + hechos + '/' + total + ' comprados';
    if (hechos === total) {
      return {
        metaText,
        progressText: '¡Compra de la semana completa! Buen trabajo.',
        progressDone: true,
        actionsHidden: false
      };
    }
    return {
      metaText,
      progressText: hechos + ' de ' + total + ' comprados esta semana',
      progressDone: false,
      actionsHidden: hechos === 0
    };
  }

  // Toggle inmutable: devuelve un Set nuevo con el item añadido o quitado.
  // `done` refleja el estado final del item para que el caller pinte el CSS.
  // Si el Set original se comparte con otros consumers, no se muta.
  function withCompraToggle(estadoSet, key) {
    const s = new Set(estadoSet || []);
    if (!key) return { set: s, done: false };
    if (s.has(key)) { s.delete(key); return { set: s, done: false }; }
    s.add(key);
    return { set: s, done: true };
  }

  // -----------------------------------------------------------------
  // Check-in optimista: aplicar + revertir
  // -----------------------------------------------------------------

  // UI optimista: al clic, pintamos el nuevo estado inmediatamente y
  // persistimos prevEstado para poder revertir si el upsert falla. Muta el
  // Map por eficiencia (ya es un estado local del módulo).
  function applyCheckinOptimistic(checkinsMap, iso, estado) {
    const prev = checkinsMap.has(iso) ? checkinsMap.get(iso) : undefined;
    checkinsMap.set(iso, estado);
    return prev;
  }

  // Revert al estado previo tras fallo de red o sesión expirada.
  function revertCheckin(checkinsMap, iso, prev) {
    if (prev === undefined) checkinsMap.delete(iso);
    else checkinsMap.set(iso, prev);
  }

  // -----------------------------------------------------------------
  // Revisión mensual: copy del CTA + modal one-shot
  // -----------------------------------------------------------------

  // Copy del CTA de revisión según el estado actual. Separa la decisión
  // lógica (getRevisionCtaState) de la redacción.
  function buildRevisionCtaCopy(opts) {
    const o = opts || {};
    const proxima = o.proximaSesion;
    const now = o.now instanceof Date ? o.now : new Date();
    const state = getRevisionCtaState({
      proximaSesion: proxima,
      revisionEnviada: !!o.revisionEnviada,
      now
    });
    if (state === 'hidden') return { state, hidden: true };
    const when = proxima && proxima.fecha ? formatFechaRelativa(new Date(proxima.fecha), now) : '';
    if (state === 'urgent') {
      return {
        state, hidden: false,
        msg: 'Tienes sesión ' + (when || 'pronto') + '. Dedica 5 minutos a la revisión antes.',
        action: { label: 'Enviar revisión mensual', href: '/mi-seguimiento/revision/' }
      };
    }
    // done
    return {
      state, hidden: false,
      msg: 'Revisión enviada ✓ · nos vemos ' + when,
      action: null
    };
  }

  // Modal one-shot 2 días antes de la sesión. Se muestra solo si el estado
  // es 'urgent' y la sesión no está ya en `seenModalIds` (LS). Devuelve el
  // texto del body y la key de LS que el caller debe marcar al cerrar.
  function shouldMostrarRevisionModal(opts) {
    const o = opts || {};
    const proxima = o.proximaSesion;
    if (!proxima || !proxima.id) return { show: false };
    const now = o.now instanceof Date ? o.now : new Date();
    const state = getRevisionCtaState({
      proximaSesion: proxima,
      revisionEnviada: !!o.revisionEnviada,
      now
    });
    if (state !== 'urgent') return { show: false };
    const seen = Array.isArray(o.seenModalIds) ? o.seenModalIds : [];
    if (seen.indexOf(proxima.id) !== -1) return { show: false };
    const when = formatFechaRelativa(new Date(proxima.fecha), now);
    const body = 'Tenemos sesión ' + when + '. Antes de vernos, cuéntame en 5 minutos cómo ha ido este mes — los platos que han funcionado, los que no, tu energía, tu ánimo. Así afino bien tu próximo menú.';
    return { show: true, lsKey: 'rev-modal-shown:' + proxima.id, body };
  }

  // -----------------------------------------------------------------
  // Hydrate del dashboard: orquesta queries → estado renderizable
  // -----------------------------------------------------------------

  // Nudo central de la PWA autenticada. Recibe un "driver" supa con cuatro
  // métodos (loadMenuVigente, loadCheckins, loadProximaSesion,
  // loadRevisionEnviadaParaSesion) y devuelve el estado que el njk tiene que
  // pintar. El wrapper imperativo del njk solo se encarga del DOM.
  //
  // `view` decide el flujo:
  //   - 'sin-paciente'    : showSinPaciente().
  //   - 'cerrado'         : estado='cerrado' en Supabase → pantalla "expediente
  //                          cerrado" + logout. La fila sigue existiendo para
  //                          poder reactivarla, pero la paciente no puede
  //                          operar. Modelo binario desde 0014.
  //   - 'redirect-empezar': window.location.replace('/mi-seguimiento/empezar/').
  //   - 'locked'          : menú no disponible → .is-locked, oculta interacciones.
  //   - 'normal'          : render completo (meals, streak, calendar, compra, CTA revisión, PDF).
  //
  // Si la query de revisión falla (red inestable) degradamos a hidden: el
  // resto del hydrate no bloquea.
  async function hydrateDashboard(opts) {
    const o = opts || {};
    const supa = o.supa || {};
    const paciente = o.paciente;
    const now = o.now instanceof Date ? o.now : new Date();
    if (!paciente) return { view: 'sin-paciente' };
    // Cerrada: cortamos aquí antes de decidir nada más. No carga menú, no
    // carga checkins — nada. El index.njk muestra pantalla de cierre + logout.
    if (paciente.estado === 'cerrado') return { view: 'cerrado' };
    if (!paciente.anamnesis_completed_at) return { view: 'redirect-empezar' };

    const today = toISO(now);
    const from = toISO(new Date(now.getTime() - 60 * 864e5));
    const [menu, checkinsRaw] = await Promise.all([
      supa.loadMenuVigente(today),
      supa.loadCheckins(from)
    ]);
    const arr = Array.isArray(checkinsRaw) ? checkinsRaw : [];
    const checkinsMap = new Map(arr.map(function (c) { return [c.fecha, c.estado]; }));
    const streak = countStreak(checkinsMap, now);

    if (!menu) {
      return {
        view: 'locked',
        menu: null,
        checkinsMap,
        streak,
        rota: false,
        revisionCta: { state: 'hidden', hidden: true },
        revisionModal: { show: false }
      };
    }

    const rota = detectarRachaRota(checkinsMap, now);
    let proxima = null;
    let revisionEnviada = false;
    try {
      proxima = await supa.loadProximaSesion(paciente.id);
      if (proxima && proxima.id) {
        revisionEnviada = !!(await supa.loadRevisionEnviadaParaSesion(proxima.id));
      }
    } catch (e) {
      proxima = null;
      revisionEnviada = false;
    }
    const revisionCta = buildRevisionCtaCopy({ proximaSesion: proxima, revisionEnviada, now });
    const revisionModal = shouldMostrarRevisionModal({
      proximaSesion: proxima,
      revisionEnviada,
      now,
      seenModalIds: o.seenModalIds || []
    });
    return {
      view: 'normal',
      menu,
      checkinsMap,
      streak,
      rota,
      proximaSesion: proxima,
      revisionEnviada,
      revisionCta,
      revisionModal
    };
  }

  const api = { toISO, dayOfYear, MILESTONES, detectarMilestone, countStreak, detectarRachaRota, TIPS, tipDelDia, buildCalendarCells, getRevisionCtaState, formatFechaRelativa, visibleMeals, detectPlatform, detectInAppBrowser, nombreAppEmbebida, esErrorTransitorio, primerNombre, primerNombreDesdeEmail, saludoPorHora, slugifyItem, compraStorageKey, totalItemsCompra, displayCat, normalizeEmail, validateLoginForm, validateOtpCode, resolveInitialLogin, shouldShowInstallHint, shouldRehydrateOnVisibility, shouldCelebrarMilestone, WEEKDAY_KEYS_JSON, computeDayView, computeTodayView, buildCompraModel, computeCompraMeta, withCompraToggle, applyCheckinOptimistic, revertCheckin, buildRevisionCtaCopy, shouldMostrarRevisionModal, hydrateDashboard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.MsLogic = api;
})();
