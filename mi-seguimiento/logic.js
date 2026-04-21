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

  const api = { toISO, dayOfYear, MILESTONES, detectarMilestone, countStreak, detectarRachaRota, TIPS, tipDelDia, buildCalendarCells, getRevisionCtaState, formatFechaRelativa, visibleMeals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.MsLogic = api;
})();
