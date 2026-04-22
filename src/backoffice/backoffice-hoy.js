// Vista "Hoy" del backoffice CLN — orquestación Supabase + render + handlers.
//
// Flujo:
//   1. BoAuth.iniciar resuelve con (supa, session).
//   2. 4 SELECT simples en paralelo: pacientes, menus, sesiones, checkins.
//   3. BoLogic.agruparHoy(...) calcula los 4 bloques.
//   4. Se pintan en #bloques con atributos data-bo-block="..." para tests.
//   5. Los botones "Copiar comando" delegan en BoUi.copiarComando.
//
// Funciones puras exportadas para Node tests: renderFilaSesion,
// renderFilaMenuCrear, renderFilaMenuEnviar, renderFilaAlerta, renderBloque.
// Devuelven HTML string — un render funcional simple, sin dependencias del
// DOM. El wiring (listeners) vive en `conectarBotonesCopiar`.

(function () {
  'use strict';

  // Los módulos BoUi y BoLogic pueden cargar después de este script en la
  // página (el layout carga logic.js/ui.js al final, este fichero se carga
  // antes dentro de <main>). Usamos getters en vez de constantes fijadas a
  // load-time para que la primera llamada a las funciones encuentre las
  // dependencias ya registradas en window.
  function _BoUi() {
    if (typeof window !== 'undefined' && window.BoUi) return window.BoUi;
    if (typeof require === 'function') return require('./ui.js');
    return null;
  }
  function _BoLogic() {
    if (typeof window !== 'undefined' && window.BoLogic) return window.BoLogic;
    if (typeof require === 'function') return require('./logic.js');
    return null;
  }
  // Shortcuts para las funciones puras — se resuelven en cada llamada.
  const BoUi = new Proxy({}, { get: (_t, prop) => _BoUi()[prop] });
  const BoLogic = new Proxy({}, { get: (_t, prop) => _BoLogic()[prop] });

  // -----------------------------------------------------------------
  // Renderers puros (testeables sin DOM)
  // -----------------------------------------------------------------

  // Cada fila es un enlace al detalle del paciente. Las acciones (copiar
  // comandos) viven en el detalle — esta vista es un índice de "qué toca".
  function _filaLink(pacienteId, contenidoHtml, filaKey) {
    const href = pacienteId
      ? '/backoffice/paciente/?id=' + BoUi.escapeHtml(String(pacienteId))
      : '#';
    return '<li class="bo-fila" data-bo-fila="' + BoUi.escapeHtml(filaKey) + '">' +
      '<a class="bo-fila-link-row" href="' + href + '">' + contenidoHtml + '</a>' +
    '</li>';
  }

  function renderFilaSesion(item) {
    const nombre = BoUi.escapeHtml(BoUi.titleCase(item.nombre));
    const hora   = BoUi.escapeHtml(item.hora || '');
    const meta = '<div class="bo-fila-meta">' +
      '<span class="bo-fila-nombre">' + nombre + '</span>' +
      '<span class="bo-fila-hora">' + hora + '</span>' +
    '</div>';
    return _filaLink(item.pacienteId, meta, 'sesion');
  }

  function renderFilaMenuCrear(item) {
    const nombre = BoUi.escapeHtml(BoUi.titleCase(item.nombre));
    let detalle;
    if (item.diasParaCaducar == null) {
      detalle = 'Sin menú vigente';
    } else if (item.diasParaCaducar <= 0) {
      detalle = 'Caducado hace ' + Math.abs(item.diasParaCaducar) + ' ' +
        (Math.abs(item.diasParaCaducar) === 1 ? 'día' : 'días');
    } else {
      detalle = 'Caduca en ' + item.diasParaCaducar + ' ' +
        (item.diasParaCaducar === 1 ? 'día' : 'días');
    }
    const meta = '<div class="bo-fila-meta">' +
      '<span class="bo-fila-nombre">' + nombre + '</span>' +
      '<span class="bo-fila-detalle">' + BoUi.escapeHtml(detalle) + '</span>' +
    '</div>';
    return _filaLink(item.pacienteId, meta, 'menu-crear');
  }

  function renderFilaMenuEnviar(item) {
    const nombre = BoUi.escapeHtml(BoUi.titleCase(item.nombre));
    const num = item.numero != null ? ('Menú ' + item.numero) : 'Menú listo';
    const meta = '<div class="bo-fila-meta">' +
      '<span class="bo-fila-nombre">' + nombre + '</span>' +
      '<span class="bo-fila-detalle">' + BoUi.escapeHtml(num) + '</span>' +
    '</div>';
    return _filaLink(item.pacienteId, meta, 'menu-enviar');
  }

  function renderFilaAlerta(item) {
    const nombre = BoUi.escapeHtml(BoUi.titleCase(item.nombre));
    let detalle;
    if (item.diasSinCheckin == null) {
      detalle = 'Sin check-ins aún';
    } else {
      detalle = item.diasSinCheckin + ' ' +
        (item.diasSinCheckin === 1 ? 'día' : 'días') + ' sin check-in';
    }
    const meta = '<div class="bo-fila-meta">' +
      '<span class="bo-fila-nombre">' + nombre + '</span>' +
      '<span class="bo-fila-detalle">' + BoUi.escapeHtml(detalle) + '</span>' +
    '</div>';
    return _filaLink(item.pacienteId, meta, 'alerta');
  }

  function renderBloque(config) {
    // config = { key, titulo, items, renderFila, emptyMsg }
    const filas = config.items.map(config.renderFila).join('');
    const cuerpo = config.items.length
      ? '<ul class="bo-lista">' + filas + '</ul>'
      : '<p class="bo-vacio">' + BoUi.escapeHtml(config.emptyMsg) + '</p>';
    return '<section class="bo-bloque" data-bo-block="' + BoUi.escapeHtml(config.key) + '">' +
      '<h2 class="bo-bloque-titulo">' + BoUi.escapeHtml(config.titulo) + '</h2>' +
      cuerpo +
    '</section>';
  }

  // -----------------------------------------------------------------
  // Tarjeta de métricas (arriba de los bloques)
  // -----------------------------------------------------------------
  //
  // Tres celdas:
  //   1. Pacientes activas hoy — número.
  //   2. Menús creados este mes — número.
  //   3. Respuesta a repescas (últimos 90 días) — X/Y o "Sin datos suficientes".
  //
  // Etiquetas explícitas de cadencia (diario, mes, 90 días) siguiendo
  // feedback_copy_cadencia.md. Se identifican por texto, no por color
  // (feedback_copy_etiquetas_ui.md).

  function _celdaMetrica(key, valor, etiqueta) {
    return '<div class="bo-metrica" data-bo-metrica="' + BoUi.escapeHtml(key) + '">' +
      '<div class="bo-metrica-valor">' + BoUi.escapeHtml(valor) + '</div>' +
      '<div class="bo-metrica-etiqueta">' + BoUi.escapeHtml(etiqueta) + '</div>' +
    '</div>';
  }

  function renderMetricas(metricas) {
    const m = metricas || { activas: 0, menusEsteMes: 0, repescas: { numerador: 0, denominador: 0, label: 'Sin datos suficientes' } };
    const r = m.repescas || {};
    const sinDatos = r.label === 'Sin datos suficientes' || r.denominador === 0;
    const valorRepescas = sinDatos ? '—' : (r.numerador + '/' + r.denominador);
    const etiquetaRepescas = sinDatos
      ? 'Sin datos suficientes'
      : 'Respuesta a repescas (últimos 90 días)';
    return '<section id="metricas" class="bo-metricas" data-bo-block="metricas">' +
      _celdaMetrica('activas', String(m.activas || 0), 'Pacientes activas hoy') +
      _celdaMetrica('menus-mes', String(m.menusEsteMes || 0), 'Menús creados este mes') +
      _celdaMetrica('repescas', valorRepescas, etiquetaRepescas) +
    '</section>';
  }

  function renderTodosLosBloques(agrupado) {
    return [
      renderBloque({
        key: 'sesiones-hoy',
        titulo: 'Sesiones hoy',
        items: agrupado.sesionesHoy,
        renderFila: renderFilaSesion,
        emptyMsg: 'Hoy no hay sesiones agendadas.'
      }),
      renderBloque({
        key: 'menus-crear-semana',
        titulo: 'Menús a crear esta semana',
        items: agrupado.menusCrearSemana,
        renderFila: renderFilaMenuCrear,
        emptyMsg: 'Ningún menú vence esta semana.'
      }),
      renderBloque({
        key: 'menus-enviar',
        titulo: 'Enviar menú',
        items: agrupado.menusEnviar,
        renderFila: renderFilaMenuEnviar,
        emptyMsg: 'No hay menús pendientes de envío.'
      }),
      renderBloque({
        key: 'alertas',
        titulo: 'Alertas (sin check-in)',
        items: agrupado.alertas,
        renderFila: renderFilaAlerta,
        emptyMsg: 'Sin alertas: todas las pacientes al día.'
      })
    ].join('');
  }

  // -----------------------------------------------------------------
  // Wiring DOM (solo se ejecuta en navegador)
  // -----------------------------------------------------------------

  function mostrarError(msg) {
    if (typeof document === 'undefined') return;
    const estado = document.getElementById('estado-auth');
    if (!estado) return;
    estado.className = 'bo-estado is-error';
    estado.textContent = msg;
  }

  async function cargarDatos(supa) {
    // 4 SELECT en paralelo. RLS se encarga de filtrar al email de Cristina.
    // `menus.created_at` lo usa `calcularMetricasHoy` para contar los del mes
    // natural actual.
    const results = await Promise.all([
      supa.from('pacientes').select('id, email, nombre, estado, alta, onboarding'),
      supa.from('menus').select('id, paciente_id, numero, vigente_desde, pdf_url, created_at'),
      supa.from('sesiones').select('id, paciente_id, fecha, calendar_event_id'),
      supa.from('checkins').select('paciente_id, fecha, estado')
    ]);
    const [pac, menu, ses, ck] = results;
    const errores = results.map(r => r.error).filter(Boolean);
    if (errores.length) {
      const msg = errores.map(e => e.message || String(e)).join(' · ');
      throw new Error('Supabase: ' + msg);
    }
    return {
      pacientes: pac.data || [],
      menus: menu.data || [],
      sesiones: ses.data || [],
      checkins: ck.data || []
    };
  }

  async function arrancar(supa) {
    if (typeof document === 'undefined') return;
    const root = document.getElementById('bloques');
    if (!root) return;
    root.innerHTML = '<p class="bo-cargando">Cargando datos…</p>';
    // Contenedor de métricas (se pinta encima de #bloques). Si no existe, lo
    // creamos en el DOM justo antes del contenedor de bloques.
    let metricasRoot = document.getElementById('metricas');
    if (!metricasRoot && root.parentNode) {
      metricasRoot = document.createElement('div');
      metricasRoot.id = 'metricas-wrap';
      root.parentNode.insertBefore(metricasRoot, root);
    }
    try {
      const datos = await cargarDatos(supa);
      const hoy = new Date();
      const agrupado  = BoLogic.agruparHoy({ ...datos, opts: {} }, hoy);
      const metricas  = BoLogic.calcularMetricasHoy(datos, hoy);
      if (metricasRoot && metricasRoot.parentNode) {
        metricasRoot.outerHTML = renderMetricas(metricas);
      } else if (metricasRoot) {
        // Defensa: si por alguna razón ya no tiene parent (arrancar reentrante),
        // buscamos el sucesor por id en lugar de petar con NoModificationAllowedError.
        const vivo = document.getElementById('metricas');
        if (vivo && vivo.parentNode) vivo.outerHTML = renderMetricas(metricas);
      }
      root.innerHTML = renderTodosLosBloques(agrupado);
      // Sin botones de acción en esta vista: cada fila es un link al detalle
      // del paciente, y las acciones (copiar comandos, reagendar…) viven ahí.
    } catch (err) {
      console.error('[backoffice/hoy]', err);
      root.innerHTML = '';
      mostrarError('No se pudieron cargar los datos: ' + (err.message || 'error desconocido'));
    }
  }

  // -----------------------------------------------------------------
  // API pública
  // -----------------------------------------------------------------

  const api = {
    renderFilaSesion,
    renderFilaMenuCrear,
    renderFilaMenuEnviar,
    renderFilaAlerta,
    renderBloque,
    renderTodosLosBloques,
    renderMetricas,
    arrancar
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.BoHoy = api;
})();
