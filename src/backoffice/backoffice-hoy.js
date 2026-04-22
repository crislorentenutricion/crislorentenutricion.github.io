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

  function _btnCopiar(comando, extra) {
    // data-bo-comando lo lee el handler global para evitar encodear el comando
    // dentro de un onclick (y sus problemas de escape).
    const clase = 'bo-btn bo-btn-copiar' + (extra ? ' ' + extra : '');
    return '<button type="button" class="' + clase + '" data-bo-comando="' +
      BoUi.escapeHtml(comando) + '">Copiar comando</button>';
  }

  function renderFilaSesion(item) {
    const nombre = BoUi.escapeHtml(BoUi.titleCase(item.nombre));
    const hora   = BoUi.escapeHtml(item.hora || '');
    return '<li class="bo-fila" data-bo-fila="sesion">' +
      '<div class="bo-fila-meta">' +
        '<span class="bo-fila-nombre">' + nombre + '</span>' +
        '<span class="bo-fila-hora">' + hora + '</span>' +
      '</div>' +
      _btnCopiar(item.comando) +
    '</li>';
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
    return '<li class="bo-fila" data-bo-fila="menu-crear">' +
      '<div class="bo-fila-meta">' +
        '<span class="bo-fila-nombre">' + nombre + '</span>' +
        '<span class="bo-fila-detalle">' + BoUi.escapeHtml(detalle) + '</span>' +
      '</div>' +
      _btnCopiar(item.comando) +
    '</li>';
  }

  function renderFilaMenuEnviar(item) {
    const nombre = BoUi.escapeHtml(BoUi.titleCase(item.nombre));
    const num = item.numero != null ? ('Menú ' + item.numero) : 'Menú listo';
    return '<li class="bo-fila" data-bo-fila="menu-enviar">' +
      '<div class="bo-fila-meta">' +
        '<span class="bo-fila-nombre">' + nombre + '</span>' +
        '<span class="bo-fila-detalle">' + BoUi.escapeHtml(num) + '</span>' +
      '</div>' +
      _btnCopiar(item.comando) +
    '</li>';
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
    return '<li class="bo-fila" data-bo-fila="alerta">' +
      '<div class="bo-fila-meta">' +
        '<span class="bo-fila-nombre">' + nombre + '</span>' +
        '<span class="bo-fila-detalle">' + BoUi.escapeHtml(detalle) + '</span>' +
      '</div>' +
      _btnCopiar(item.comando) +
    '</li>';
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

  function conectarBotonesCopiar(root) {
    if (!root || typeof root.addEventListener !== 'function') return;
    // Delegación en el contenedor: un solo listener soporta re-render.
    if (root.dataset && root.dataset.boBound === '1') return;
    root.addEventListener('click', function (ev) {
      const btn = ev.target && ev.target.closest && ev.target.closest('[data-bo-comando]');
      if (!btn) return;
      ev.preventDefault();
      const comando = btn.getAttribute('data-bo-comando');
      BoUi.copiarComando(comando, btn);
    });
    if (root.dataset) root.dataset.boBound = '1';
  }

  function mostrarError(msg) {
    if (typeof document === 'undefined') return;
    const estado = document.getElementById('estado-auth');
    if (!estado) return;
    estado.className = 'bo-estado is-error';
    estado.textContent = msg;
  }

  async function cargarDatos(supa) {
    // 4 SELECT en paralelo. RLS se encarga de filtrar al email de Cristina.
    const results = await Promise.all([
      supa.from('pacientes').select('id, email, nombre, estado, alta, onboarding'),
      supa.from('menus').select('id, paciente_id, numero, vigente_desde, pdf_url'),
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
    try {
      const datos = await cargarDatos(supa);
      const agrupado = BoLogic.agruparHoy(
        { ...datos, opts: {} },
        new Date()
      );
      root.innerHTML = renderTodosLosBloques(agrupado);
      conectarBotonesCopiar(root);
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
    arrancar
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.BoHoy = api;
})();
