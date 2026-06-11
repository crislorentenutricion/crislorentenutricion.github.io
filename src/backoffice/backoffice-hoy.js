// Vista "Tareas" del backoffice CLN — orquestación Supabase + render + handlers.
//
// Flujo:
//   1. BoAuth.iniciar resuelve con (supa, session).
//   2. 4 SELECT simples en paralelo: pacientes, menus, sesiones, checkins.
//   3. BoLogic.agruparHoy(...) calcula los 4 bloques.
//   4. Se pintan en #bloques con atributos data-bo-block="..." para tests.
//   5. Los botones "Copiar comando" delegan en BoUi.copiarComando.
//
// Funciones puras exportadas para Node tests: renderFilaSesion,
// renderFilaMenuCrear, renderFilaMenuEnviar, renderBloque.
// Devuelven HTML string — un render funcional simple, sin dependencias del
// DOM. El wiring (listeners) vive en `conectarBotonesCopiar`.

(function () {
  'use strict';

  // Los módulos BoUi, BoLogic y BoPaneles pueden cargar después de este script
  // en la página (el layout carga logic.js/ui.js/paneles.js al final, este
  // fichero se carga antes dentro de <main>). Usamos getters en vez de
  // constantes fijadas a load-time para que la primera llamada a las funciones
  // encuentre las dependencias ya registradas en window.
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
  function _BoPaneles() {
    if (typeof window !== 'undefined' && window.BoPaneles) return window.BoPaneles;
    if (typeof require === 'function') return require('./paneles.js');
    return null;
  }
  // Shortcuts para las funciones puras — se resuelven en cada llamada.
  const BoUi    = new Proxy({}, { get: (_t, prop) => _BoUi()[prop] });
  const BoLogic = new Proxy({}, { get: (_t, prop) => _BoLogic()[prop] });
  const BoPaneles = new Proxy({}, { get: (_t, prop) => _BoPaneles()[prop] });

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

  // Fila del bloque "Pendientes de resolver". Surge cuando una valoración
  // (primera consulta) ya pasó su slot (+30 min desde el inicio) y no se ha
  // resuelto: ni dada de alta (no existe paciente con ese email + alta
  // posterior) ni descartada (no se ha borrado). Persiste hasta que Cristina
  // pulse uno de los dos botones — no se autopurga al día siguiente.
  //
  // Layout:
  //   - Bloque izquierdo (informativo): nombre + hora (con prefijo de día si
  //     es de un día anterior, p.ej. "Ayer · 13:30" o "Mar 27 abr · 13:30").
  //     Sin link al detalle: la valoración no tiene paciente todavía.
  //   - Bloque derecho (acciones): dos botones.
  //       · "Dar de alta": copy-command `/alta-paciente NOMBRE EMAIL` (mismo
  //         patrón que el resto de botones del backoffice).
  //       · "Descartar": acción directa con confirm() → DELETE en valoraciones.
  //         Excepción documentada al patrón copy-only — ver convenciones/
  //         negocio/backoffice.md.
  function renderFilaPendiente(item) {
    const nombre = BoUi.escapeHtml(BoUi.titleCase(item.nombre));
    const hora   = BoUi.escapeHtml(item.hora || '');
    const diaLabel = item.esHoy ? '' : BoUi.escapeHtml(item.diaLabel || '');
    const detalle = diaLabel && hora ? (diaLabel + ' · ' + hora) : (hora || diaLabel);
    const meta = '<div class="bo-fila-meta">' +
      '<span class="bo-fila-nombre">' + nombre + '</span>' +
      '<span class="bo-fila-hora">' + BoUi.escapeHtml(detalle) + '</span>' +
    '</div>';
    const cuerpo = '<div class="bo-fila-link-row">' + meta + '</div>';

    const valoracionId    = BoUi.escapeHtml(String(item.valoracionId || ''));
    const nombreInternoEs = BoUi.escapeHtml(String(item.nombre || ''));
    const prefillEmail    = BoUi.escapeHtml(String(item.email || ''));

    const btnAlta = '<button type="button" class="bo-btn bo-btn-directo bo-btn-copiar-sm" ' +
      'data-bo-action="panel-fila" ' +
      'data-bo-panel="alta" ' +
      'data-bo-prefill-nombre="' + nombreInternoEs + '" ' +
      'data-bo-prefill-email="' + prefillEmail + '">' +
      'Dar de alta</button>';
    const btnDescartar = '<button type="button" class="bo-btn bo-btn-secundario-sm" ' +
      'data-bo-action="descartar-valoracion" ' +
      'data-bo-valoracion-id="' + valoracionId + '" ' +
      'data-bo-valoracion-nombre="' + nombreInternoEs + '">' +
      'Descartar</button>';
    const acciones = '<div class="bo-fila-acciones">' + btnAlta + btnDescartar + '</div>';

    return '<li class="bo-fila bo-fila-pendiente" data-bo-fila="pendiente">' +
      cuerpo + acciones + '</li>';
  }

  // Fila del bloque "Pagos pendientes": indica un paciente cuyo próximo pago
  // está vencido o a punto de vencer (≤ UMBRAL_AVISO_DIAS días). Patrón
  // idéntico a renderFilaMenuCrear: link al detalle a la izquierda + botón
  // copy-command "Registrar pago" a la derecha. La clase del badge codifica
  // el estado (vencido o aviso) para que el CSS coloree el indicador.
  //
  // Item esperado: { pacienteId, nombre, fechaEsperada, estado, diasDiff }.
  function renderFilaPagoPendiente(item) {
    const nombre = BoUi.escapeHtml(BoUi.titleCase(item.nombre));
    const claseEstado = item.estado === 'vencido' ? 'bo-pago-vencido' : 'bo-pago-aviso';
    const detalleTexto = BoUi.formatearVencimiento(item.diasDiff, item.fechaEsperada);
    const href = item.pacienteId
      ? '/backoffice/paciente/?id=' + BoUi.escapeHtml(String(item.pacienteId))
      : '#';
    const link = '<a class="bo-fila-link-row" href="' + href + '">' +
      '<div class="bo-fila-meta">' +
        '<span class="bo-fila-nombre">' + nombre + '</span>' +
        '<span class="bo-fila-detalle ' + claseEstado + '">' +
          BoUi.escapeHtml(detalleTexto) +
        '</span>' +
      '</div>' +
    '</a>';
    const prefillNombre = BoUi.escapeHtml(String(item.nombre || ''));
    const pacId = BoUi.escapeHtml(String(item.pacienteId || ''));
    const accion = '<button type="button" class="bo-btn bo-btn-directo bo-btn-copiar-sm" ' +
      'data-bo-action="panel-fila" ' +
      'data-bo-panel="registrar-pago" ' +
      'data-bo-paciente-id="' + pacId + '" ' +
      'data-bo-prefill-nombre="' + prefillNombre + '">' +
      'Registrar pago</button>';
    return '<li class="bo-fila" data-bo-fila="pago-pendiente">' +
      link + accion +
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

  // Catálogo declarativo de los bloques de la vista Tareas. Definido fuera
  // del flujo para que (a) `renderTodosLosBloques` pueda filtrar bloques
  // vacíos sin duplicar config, y (b) un test pueda inspeccionar el orden
  // canónico sin ejecutar render.
  //
  // Orden por urgencia decreciente:
  //   1. Pendientes de resolver — valoraciones atascadas, exigen decisión.
  //   2. Sesiones hoy — pasan en horas, requieren preparación inmediata.
  //   3. Menús a crear esta semana — deadline semanal con margen.
  //   4. Próximos 7 días — vista anticipada, informativa.
  function _bloquesConfig(agrupado) {
    return [
      {
        key: 'pendientes',
        titulo: 'Pendientes de resolver',
        items: agrupado.pendientes || [],
        renderFila: renderFilaPendiente
      },
      {
        key: 'sesiones-hoy',
        titulo: 'Sesiones hoy',
        items: agrupado.sesionesHoy || [],
        renderFila: renderFilaSesion
      },
      {
        key: 'pagos-pendientes',
        titulo: 'Pagos pendientes',
        items: agrupado.pagosPendientes || [],
        renderFila: renderFilaPagoPendiente
      },
      {
        key: 'menus-crear-semana',
        titulo: 'Menús a crear esta semana',
        items: agrupado.menusCrearSemana || [],
        renderFila: renderFilaMenuCrear
      },
      {
        key: 'proximos-7-dias',
        titulo: 'Próximos 7 días',
        items: agrupado.proximos7Dias || [],
        renderFila: renderFilaProximaSesion
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

  // -----------------------------------------------------------------
  // Descartar valoración — única excepción al patrón copy-only del backoffice
  //
  // Por qué excepción aquí: la acción es trivial (DELETE de una fila por id),
  // no orquesta nada y no merece una skill nueva. La regla dura del backoffice
  // sigue vigente para todos los demás botones — ver convenciones/negocio/
  // backoffice.md sección "Acciones del detalle".
  //
  // Flujo:
  //   1. confirm() bloqueante (sin reversibilidad por decisión de producto).
  //   2. supa.from('valoraciones').delete().eq('id', x). RLS DELETE policy
  //      (migración 0018) permite a Cristina; cualquier otro email recibe 0
  //      filas afectadas (RLS silenciosa, no error).
  //   3. Si OK → recargar el panel (vuelve a calcular bloques sin la fila).
  //   4. Si error → toast con el mensaje, mantener la fila visible.
  //
  // _manejarDescartar es la función testeable. Recibe `opts.confirm` y
  // `opts.recargar` para inyectar fakes en tests sin DOM ni Supabase real.
  // -----------------------------------------------------------------

  async function _manejarDescartar(ev, supa, opts) {
    const t = ev && ev.target;
    const btn = t && t.closest && t.closest('[data-bo-action="descartar-valoracion"]');
    if (!btn) return false;
    if (typeof ev.preventDefault === 'function') ev.preventDefault();
    if (typeof ev.stopPropagation === 'function') ev.stopPropagation();

    const id = btn.getAttribute('data-bo-valoracion-id') || '';
    const nombreInterno = btn.getAttribute('data-bo-valoracion-nombre') || '';
    if (!id) return false;

    const o = opts || {};
    const confirmar = o.confirm
      || (typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm.bind(window)
            : function () { return true; });
    const nombreUI = BoUi.titleCase(nombreInterno) || 'esta valoración';
    const ok = confirmar('¿Descartar la valoración de ' + nombreUI +
      '?\n\nEsta acción es irreversible.');
    if (!ok) return false;

    if (btn.disabled !== undefined) btn.disabled = true;
    try {
      const resp = await supa.from('valoraciones').delete().eq('id', id);
      if (resp && resp.error) {
        BoUi.toast('No se pudo descartar: ' + (resp.error.message || 'error'));
        if (btn.disabled !== undefined) btn.disabled = false;
        return false;
      }
      BoUi.toast('Valoración descartada');
      const recargar = o.recargar || function () { return arrancar(supa); };
      await recargar();
      return true;
    } catch (err) {
      BoUi.toast('Error al descartar: ' + ((err && err.message) || String(err)));
      if (btn.disabled !== undefined) btn.disabled = false;
      return false;
    }
  }

  // Wirea el handler de descartar en cualquier [data-bo-action="descartar-valoracion"]
  // dentro de `root`. Igual que _conectarBotonesCopiar: marca el botón con
  // `_boWiredDescartar` para no apilar listeners en re-renders.
  function _conectarBotonesDescartar(root, supa) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const botones = root.querySelectorAll('[data-bo-action="descartar-valoracion"]');
    botones.forEach(function (btn) {
      if (btn._boWiredDescartar) return;
      btn._boWiredDescartar = true;
      btn.addEventListener('click', function (ev) {
        _manejarDescartar(ev, supa);
      });
    });
  }

  async function cargarDatos(supa) {
    // 5 SELECT core + pagos en paralelo. RLS se encarga de filtrar al email
    // de Cristina. `pagos` se separa con un .then de tolerancia: si la query
    // falla (RLS, 4xx), tratamos pagos como [] para no romper el resto de
    // la vista — mismo patrón que la vista Detalle.
    const corePromise = Promise.all([
      supa.from('pacientes').select('id, email, nombre, estado, alta, onboarding, anamnesis_completed_at'),
      supa.from('menus').select('id, paciente_id, numero, vigente_desde, pdf_url, created_at'),
      supa.from('sesiones').select('id, paciente_id, fecha, calendar_event_id'),
      supa.from('checkins').select('paciente_id, fecha, estado'),
      supa.from('valoraciones').select('id, nombre, email, telefono, fecha, calendar_event_id, status').eq('status', 'confirmed')
    ]);
    const pagosPromise = supa
      .from('pagos')
      .select('id, paciente_id, fecha, concepto')
      .then(r => r, () => ({ data: [], error: null }));

    const [results, pagosRes] = await Promise.all([corePromise, pagosPromise]);
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
      valoraciones: val.data || [],
      pagos: (pagosRes && pagosRes.data) || []
    };
  }

  // _panelAbiertoHoy almacena el nodo .bo-panel-fila actualmente abierto en
  // la vista Tareas. Solo uno puede estar abierto a la vez.
  let _panelAbiertoHoy = null;

  // Wirea el handler de [data-bo-action="panel-fila"] dentro de `root`.
  // Al hacer click: cierra el panel anterior si lo hay, crea un .bo-panel-fila
  // insertado DESPUÉS del <li> de la fila, renderiza el formulario e inicia
  // el wiring de envío. Un segundo click sobre el mismo botón (cuando el panel
  // ya está abierto) lo cierra — comportamiento toggle.
  function _conectarBotonesPanelFila(root, supa, recargar) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const botones = root.querySelectorAll('[data-bo-action="panel-fila"]');
    botones.forEach(function (btn) {
      if (btn._boWiredPanelFila) return;
      btn._boWiredPanelFila = true;
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();

        // Toggle: si el panel ya abierto pertenece a este botón, lo cerramos.
        if (_panelAbiertoHoy && _panelAbiertoHoy._boBtn === btn) {
          _panelAbiertoHoy.remove();
          _panelAbiertoHoy = null;
          return;
        }
        // Cerrar cualquier panel anterior.
        if (_panelAbiertoHoy) {
          _panelAbiertoHoy.remove();
          _panelAbiertoHoy = null;
        }

        const accion = btn.getAttribute('data-bo-panel') || '';
        const fila   = btn.closest('li') || btn.parentElement;
        const cont   = document.createElement('li');
        cont.className = 'bo-panel-fila';
        cont._boBtn = btn;
        fila.after(cont);
        _panelAbiertoHoy = cont;

        // Construir ctx según la acción.
        let ctx;
        if (accion === 'alta') {
          ctx = {
            prefill: {
              nombre: btn.getAttribute('data-bo-prefill-nombre') || '',
              email:  btn.getAttribute('data-bo-prefill-email')  || ''
            }
          };
        } else {
          // registrar-pago: siempre renovación vencida en esta vista.
          ctx = {
            pagosPrevios: 1,
            prefill: { nombre: btn.getAttribute('data-bo-prefill-nombre') || '' }
          };
        }

        cont.innerHTML = BoPaneles.renderPanelAccion(accion, ctx);

        // Botón Cancelar del panel.
        const btnCancelar = cont.querySelector('[data-bo-action="cerrar-panel"]');
        if (btnCancelar) {
          btnCancelar.addEventListener('click', function () {
            cont.remove();
            if (_panelAbiertoHoy === cont) _panelAbiertoHoy = null;
          });
        }

        BoPaneles.conectarPanel(cont, accion, {
          supa: supa,
          ctxAccion: function () {
            if (accion === 'alta') {
              return {
                nombre: btn.getAttribute('data-bo-prefill-nombre') || '',
                email:  btn.getAttribute('data-bo-prefill-email')  || ''
              };
            }
            return {
              pacienteId: btn.getAttribute('data-bo-paciente-id') || '',
              nombre:     btn.getAttribute('data-bo-prefill-nombre') || ''
            };
          },
          recargar: function () {
            if (_panelAbiertoHoy === cont) _panelAbiertoHoy = null;
            return recargar();
          }
        });
      });
    });
  }

  // Carga datos + renderiza bloques y métricas en el DOM. Extraída de
  // arrancar() para poder llamarla desde recargar() sin reinicializar auth.
  async function _cargar(supa) {
    const root = document.getElementById('bloques');
    if (!root) return;
    root.innerHTML = '<p class="bo-cargando">Cargando datos…</p>';
    let metricasRoot = document.getElementById('metricas');
    if (!metricasRoot && root.parentNode) {
      metricasRoot = document.createElement('div');
      metricasRoot.id = 'metricas-wrap';
      root.parentNode.insertBefore(metricasRoot, root);
    }
    const datos = await cargarDatos(supa);
    const hoy = new Date();
    const agrupado = BoLogic.agruparHoy({ ...datos, opts: {} }, hoy);
    agrupado.pagosPendientes = BoLogic.recordatoriosPago(datos.pacientes, datos.pagos, hoy);
    const metricas = BoLogic.calcularMetricasHoy(datos, hoy);
    if (metricasRoot && metricasRoot.parentNode) {
      metricasRoot.outerHTML = renderMetricas(metricas);
    } else if (metricasRoot) {
      const vivo = document.getElementById('metricas');
      if (vivo && vivo.parentNode) vivo.outerHTML = renderMetricas(metricas);
    }
    // Limpiar panel abierto antes de re-render (el nodo desaparecerá con
    // root.innerHTML =, pero limpiamos la referencia modular también).
    _panelAbiertoHoy = null;
    root.innerHTML = renderTodosLosBloques(agrupado);
    // Conectar handlers: copy-commands (menús), descartar, y paneles directos.
    _conectarBotonesCopiar(root);
    _conectarBotonesDescartar(root, supa);
    _conectarBotonesPanelFila(root, supa, function () { return _cargar(supa); });
  }

  async function arrancar(supa) {
    if (typeof document === 'undefined') return;
    try {
      await _cargar(supa);
    } catch (err) {
      console.error('[backoffice/hoy]', err);
      const root = document.getElementById('bloques');
      if (root) root.innerHTML = '';
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
    renderFilaPendiente,
    renderFilaPagoPendiente,
    renderBloque,
    renderTodosLosBloques,
    renderMetricas,
    arrancar,
    _manejarDescartar: _manejarDescartar
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.BoHoy = api;
})();
