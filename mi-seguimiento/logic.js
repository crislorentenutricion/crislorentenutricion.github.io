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

  const api = { toISO, dayOfYear, MILESTONES, detectarMilestone, countStreak, detectarRachaRota, TIPS, tipDelDia };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.MsLogic = api;
})();
