// Lógica pura del curso «Aprender» — sin DOM ni Supabase.
// La comparten la app de la paciente (/mi-seguimiento) y la pestaña Curso del
// backoffice, para que ambas calculen exactamente el mismo estado.
// Ritmo automático: la fase f se abre a los (f-1) meses del alta y, dentro de
// la fase, 1 lección por semana; además es secuencial (se completa en orden).
// Los overrides manuales de Cristina (curso_overrides) ganan siempre.
(function () {
  'use strict';

  var FASES = [
    { key: 'cimientos', titulo: 'Cimientos', sub: 'comprar', guia: { titulo: 'Guía de la compra', path: 'guia-de-la-compra.pdf' } },
    { key: 'construccion', titulo: 'Construcción', sub: 'montar', guia: { titulo: 'Tu recetario base', path: 'tu-recetario-base.pdf' } },
    { key: 'integracion', titulo: 'Integración', sub: 'seguir sola', guia: { titulo: 'Tu método en una página', path: 'tu-metodo-en-una-pagina.pdf' } }
  ];

  var TOTAL_LECCIONES = 10;

  // Mediodía local: aritmética de días/meses inmune a DST y al corte UTC.
  function parseISODate(iso) {
    var p = String(iso).slice(0, 10).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2], 12, 0, 0);
  }

  // Suma meses calendario con clamp de fin de mes (31 ene + 1 mes → 28/29 feb).
  function addMonths(date, n) {
    var d = new Date(date.getTime());
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    var ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, ultimo));
    return d;
  }

  // Fecha en la que el ritmo automático abre la lección `ordenEnFase` (1-based)
  // de la fase `faseIndex` (0-based) para un alta dada.
  function fechaDesbloqueo(altaISO, faseIndex, ordenEnFase) {
    var d = addMonths(parseISODate(altaISO), faseIndex);
    d.setDate(d.getDate() + (ordenEnFase - 1) * 7);
    return d;
  }

  var api = { FASES: FASES, TOTAL_LECCIONES: TOTAL_LECCIONES, parseISODate: parseISODate, addMonths: addMonths, fechaDesbloqueo: fechaDesbloqueo };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.AprenderLogic = api;
})();
