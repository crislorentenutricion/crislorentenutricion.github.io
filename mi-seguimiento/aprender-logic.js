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

  function toISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Estado completo del curso para una paciente.
  //   lecciones: filas de curso_lecciones (slug, fase, orden, titulo, contenido)
  //   progreso:  filas de curso_progreso de ESA paciente
  //   overrides: filas de curso_overrides de ESA paciente (tipo, target, modo)
  //   altaISO / hoyISO: fechas YYYY-MM-DD
  // Estados por lección: done | now (se puede abrir) | wait (anterior hecha,
  // fecha no alcanzada — muestra abreElISO) | lock.
  function estadoCurso(params) {
    var hoy = parseISODate(params.hoyISO);
    var orden = params.lecciones.slice().sort(function (a, b) { return a.orden - b.orden; });
    var porSlug = {};
    (params.progreso || []).forEach(function (p) { porSlug[p.leccion_slug] = p; });
    var ovLeccion = {}, ovFase = {};
    (params.overrides || []).forEach(function (o) {
      if (o.tipo === 'leccion') ovLeccion[o.target] = o.modo; else ovFase[o.target] = o.modo;
    });

    var anteriorCompletada = true; // la primera lección no tiene anterior
    var lecciones = orden.map(function (l) {
      var faseIndex = FASES.findIndex(function (f) { return f.key === l.fase; });
      var ordenEnFase = Number(l.slug.split('-')[1]);
      var abreEl = fechaDesbloqueo(params.altaISO, faseIndex, ordenEnFase);
      var done = !!porSlug[l.slug];
      var modo = ovLeccion[l.slug] || ovFase[l.fase] || null;

      var estado;
      if (done) estado = 'done';
      else if (modo === 'bloquear') estado = 'lock';
      else if (modo === 'desbloquear') estado = 'now';
      else if (!anteriorCompletada) estado = 'lock';
      else if (hoy < abreEl) estado = 'wait';
      else estado = 'now';

      anteriorCompletada = done;
      return {
        slug: l.slug, fase: l.fase, titulo: l.titulo, min: (l.contenido && l.contenido.min) || 4,
        estado: estado, abreElISO: toISO(abreEl), forzada: modo !== null && !done,
      };
    });

    var guias = FASES.map(function (f) {
      var deLaFase = lecciones.filter(function (l) { return l.fase === f.key; });
      var completa = deLaFase.length > 0 && deLaFase.every(function (l) { return l.estado === 'done'; });
      return { fase: f.key, titulo: f.guia.titulo, path: f.guia.path, desbloqueada: completa };
    });

    var completadas = (params.progreso || []).slice().sort(function (a, b) {
      return String(a.completada_at).localeCompare(String(b.completada_at));
    });
    var ultima = completadas[completadas.length - 1];
    var retoActivo = null;
    if (ultima) {
      var lec = orden.find(function (x) { return x.slug === ultima.leccion_slug; });
      if (lec) {
        retoActivo = {
          slug: lec.slug, leccion: lec.titulo, reto: lec.contenido.reto,
          hecho: !!ultima.reto_hecho, nota: ultima.reto_nota || '',
        };
      }
    }

    return {
      lecciones: lecciones,
      guias: guias,
      contadores: {
        lecciones: lecciones.filter(function (l) { return l.estado === 'done'; }).length,
        guias: guias.filter(function (g) { return g.desbloqueada; }).length,
      },
      retoActivo: retoActivo,
    };
  }

  var api = { FASES: FASES, TOTAL_LECCIONES: TOTAL_LECCIONES, parseISODate: parseISODate, addMonths: addMonths, fechaDesbloqueo: fechaDesbloqueo, estadoCurso: estadoCurso, toISO: toISO };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.AprenderLogic = api;
})();
