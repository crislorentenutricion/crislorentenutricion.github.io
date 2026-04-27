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
  // Caso especial: las valoraciones (primera consulta) no tienen paciente
  // todavía (son prospectos pre-pago) → la fila se renderiza sin <a>: queda
  // como bloque informativo. El badge a la derecha distingue el tipo.
  function _filaCuerpo(pacienteId, contenidoHtml, filaKey, badgeHtml) {
    const tag = badgeHtml || '';
    if (pacienteId) {
      const href = '/backoffice/paciente/?id=' + BoUi.escapeHtml(String(pacienteId));
      return '<li class="bo-fila" data-bo-fila="' + BoUi.escapeHtml(filaKey) + '">' +
        '<a class="bo-fila-link-row" href="' + href + '">' + contenidoHtml + '</a>' +
        tag +
      '</li>';
    }
    return '<li class="bo-fila" data-bo-fila="' + BoUi.escapeHtml(filaKey) + '">' +
      '<div class="bo-fila-link-row">' + contenidoHtml + '</div>' +
      tag +
    '</li>';
  }

  // Badge a la derecha del nombre/hora: identifica si la cita es seguimiento
  // mensual de paciente activa (verde) o primera consulta de prospecto (azul).
  // Pareja de feedback_copy_etiquetas_ui.md: el texto explícito hace el
  // trabajo, el color es solo refuerzo.
  function _renderBadgeTipo(tipo) {
    if (tipo === 'valoracion') {
      return '<span class="bo-fila-tag is-valoracion" data-bo-tag="valoracion">' +
        'Primera consulta</span>';
    }
    if (tipo === 'seguimiento') {
      return '<span class="bo-fila-tag is-seguimiento" data-bo-tag="seguimiento">' +
        'Seguimiento</span>';
    }
    return '';
  }

  function renderFilaSesion(item) {
    const nombre = BoUi.escapeHtml(BoUi.titleCase(item.nombre));
    const hora   = BoUi.escapeHtml(item.hora || '');
    const meta = '<div class="bo-fila-meta">' +
      '<span class="bo-fila-nombre">' + nombre + '</span>' +
      '<span class="bo-fila-hora">' + hora + '</span>' +
    '</div>';
    return _filaCuerpo(item.pacienteId, meta, 'sesion', _renderBadgeTipo(item.tipo));
  }

  // Fila del bloque "Próximos 7 días": día + hora juntos como detalle
  // (`Mañana · 10:30` o `Sáb 25 abr · 10:30`). Si hay paciente, enlaza al
  // detalle; si es valoración, se renderiza sin link.
  function renderFilaProximaSesion(item) {
    const nombre = BoUi.escapeHtml(BoUi.titleCase(item.nombre));
    const dia    = BoUi.escapeHtml(item.diaLabel || '');
    const hora   = BoUi.escapeHtml(item.hora || '');
    const detalle = dia && hora ? (dia + ' · ' + hora) : (dia || hora);
    const meta = '<div class="bo-fila-meta">' +
      '<span class="bo-fila-nombre">' + nombre + '</span>' +
      '<span class="bo-fila-detalle">' + detalle + '</span>' +
    '</div>';
    return _filaCuerpo(item.pacienteId, meta, 'proxima-sesion', _renderBadgeTipo(item.tipo));
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
    const href = item.pacienteId
      ? '/backoffice/paciente/?id=' + BoUi.escapeHtml(String(item.pacienteId))
      : '#';
    const link = '<a class="bo-fila-link-row" href="' + href + '">' +
      '<div class="bo-fila-meta">' +
        '<span class="bo-fila-nombre">' + nombre + '</span>' +
        '<span class="bo-fila-detalle">' + BoUi.escapeHtml(detalle) + '</span>' +
      '</div>' +
    '</a>';
    // Acción a la derecha: si la anamnesis está rellena, botón copy-command
    // para `/crear-menu`; si no, badge de aviso (no se puede crear menú sin
    // anamnesis). El botón frena la propagación para no navegar al detalle.
    let accion;
    if (item.anamnesisLista) {
      accion = '<button type="button" class="bo-btn bo-btn-copiar-sm" ' +
        'data-bo-comando="' + BoUi.escapeHtml(item.comando || '') + '">' +
        'Crear menú</button>';
    } else {
      accion = '<span class="bo-fila-warning" data-bo-warning="anamnesis-pendiente" ' +
        'title="La paciente no ha rellenado el formulario de anamnesis aún. ' +
        'No se puede crear menú hasta entonces.">' +
        'Anamnesis pendiente</span>';
    }
    return '<li class="bo-fila" data-bo-fila="menu-crear">' + link + accion + '</li>';
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
    return _filaCuerpo(item.pacienteId, meta, 'alerta', '');
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

  // Catálogo declarativo de los 4 bloques de la vista Hoy. Definido fuera
  // del flujo para que (a) `renderTodosLosBloques` pueda filtrar bloques
  // vacíos sin duplicar config, y (b) un test pueda inspeccionar el orden
  // canónico sin ejecutar render.
  function _bloquesConfig(agrupado) {
    return [
      {
        key: 'sesiones-hoy',
        titulo: 'Sesiones hoy',
        items: agrupado.sesionesHoy || [],
        renderFila: renderFilaSesion
      },
      {
        key: 'proximos-7-dias',
        titulo: 'Próximos 7 días',
        items: agrupado.proximos7Dias || [],
        renderFila: renderFilaProximaSesion
      },
      {
        key: 'menus-crear-semana',
        titulo: 'Menús a crear esta semana',
        items: agrupado.menusCrearSemana || [],
        renderFila: renderFilaMenuCrear
      },
      {
        key: 'alertas',
        titulo: 'Alertas (sin check-in)',
        items: agrupado.alertas || [],
        renderFila: renderFilaAlerta
      }
    ];
  }

  // Bloques vacíos no se renderizan (UX: panel limpio cuando no hay nada
  // que hacer en esa categoría). Si TODOS los bloques están vacíos pintamos
  // un único mensaje global. La tarjeta de métricas vive fuera de este
  // contenedor, así que sigue visible en cualquier caso.
  function renderTodosLosBloques(agrupado) {
    const config = _bloquesConfig(agrupado || {});
    const conItems = config.filter(function (c) { return c.items.length > 0; });
    if (conItems.length === 0) {
      return '<section class="bo-bloque" data-bo-block="vacio">' +
        '<p class="bo-vacio">Sin tareas pendientes. Día despejado.</p>' +
      '</section>';
    }
    return conItems.map(function (c) {
      return renderBloque({
        key: c.key,
        titulo: c.titulo,
        items: c.items,
        renderFila: c.renderFila,
        emptyMsg: '' // nunca se usa: filtrados antes
      });
    }).join('');
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

  // Wirea click handler en cualquier [data-bo-comando] dentro de `root`.
  // Marca el botón con `_boWired` para que un segundo arrancar (no debería
  // ocurrir, pero defensa) no apile listeners. Frena propagación para no
  // navegar al link padre cuando el botón vive dentro de una fila.
  function _conectarBotonesCopiar(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const botones = root.querySelectorAll('[data-bo-comando]');
    botones.forEach(function (btn) {
      if (btn._boWired) return;
      btn._boWired = true;
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const cmd = btn.getAttribute('data-bo-comando') || '';
        if (cmd) BoUi.copiarComando(cmd, btn);
      });
    });
  }

  async function cargarDatos(supa) {
    // 5 SELECT en paralelo. RLS se encarga de filtrar al email de Cristina.
    // `menus.created_at` lo usa `calcularMetricasHoy` para contar los del mes
    // natural actual. `valoraciones` mezcla primera consulta (prospectos) con
    // seguimientos en el bloque "Sesiones hoy" y "Próximos 7 días" — se
    // filtran solo las confirmadas para no listar canceladas/no-show.
    const results = await Promise.all([
      supa.from('pacientes').select('id, email, nombre, estado, alta, onboarding, anamnesis_completed_at'),
      supa.from('menus').select('id, paciente_id, numero, vigente_desde, pdf_url, created_at'),
      supa.from('sesiones').select('id, paciente_id, fecha, calendar_event_id'),
      supa.from('checkins').select('paciente_id, fecha, estado'),
      supa.from('valoraciones').select('id, nombre, email, telefono, fecha, calendar_event_id, status').eq('status', 'confirmed')
    ]);
    const [pac, menu, ses, ck, val] = results;
    const errores = results.map(r => r.error).filter(Boolean);
    if (errores.length) {
      const msg = errores.map(e => e.message || String(e)).join(' · ');
      throw new Error('Supabase: ' + msg);
    }
    return {
      pacientes: pac.data || [],
      menus: menu.data || [],
      sesiones: ses.data || [],
      checkins: ck.data || [],
      valoraciones: val.data || []
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
      // calcularMetricasHoy ignora `valoraciones`: las métricas siguen siendo
      // de pacientes activas, no de prospectos.
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
      // Excepción documentada al patrón "fila = link al detalle": el bloque
      // "Menús a crear esta semana" pinta un botón "Crear menú" (copy-command)
      // cuando la anamnesis ya está rellena, para acortar el gesto más
      // frecuente de Cristina.
      _conectarBotonesCopiar(root);
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
    renderFilaProximaSesion,
    renderFilaMenuCrear,
    renderFilaAlerta,
    renderBloque,
    renderTodosLosBloques,
    renderMetricas,
    arrancar
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.BoHoy = api;
})();
