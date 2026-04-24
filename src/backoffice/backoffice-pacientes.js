// Vista "Pacientes" del backoffice CLN — tabla filtrable.
//
// Flujo:
//   1. BoAuth.iniciar resuelve con (supa, session).
//   2. 4 SELECT simples en paralelo: pacientes, sesiones, checkins, menus.
//   3. BoLogic.priorizarPacientes(...) ordena (activas → próxima sesión).
//   4. Render tabla con cabeceras + filtro (Activas por defecto).
//   5. Cada fila enlaza a /backoffice/paciente/?id=...; las acciones
//      (Crear menú, Hacer seguimiento, etc.) viven en el detalle, no aquí.
//
// Funciones puras exportadas para Node tests: construirFila, renderTabla,
// decorarPaciente. Reciben datos ya cargados y devuelven HTML string.

(function () {
  'use strict';

  // Resolver las deps a call-time: el layout inyecta logic.js/ui.js DESPUÉS
  // de este script dentro del documento, así que fijarlas en load-time daría
  // undefined. Proxys transparentes para el resto del fichero.
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
  const BoUi = new Proxy({}, { get: (_t, prop) => _BoUi()[prop] });
  const BoLogic = new Proxy({}, { get: (_t, prop) => _BoLogic()[prop] });

  // -----------------------------------------------------------------
  // Cálculos derivados (decorador: combina paciente + auxiliares)
  // -----------------------------------------------------------------

  function _indexBy(arr, key) {
    const m = new Map();
    if (!Array.isArray(arr)) return m;
    for (const it of arr) {
      const k = it && it[key];
      if (k == null) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    return m;
  }

  function _ultimoCheckinFecha(checkinsPac) {
    if (!Array.isArray(checkinsPac) || checkinsPac.length === 0) return null;
    let max = null;
    for (const c of checkinsPac) {
      const t = c && c.fecha ? new Date(String(c.fecha)).getTime() : NaN;
      if (isNaN(t)) continue;
      if (max == null || t > max) max = t;
    }
    return max;
  }

  function _menuVigenteFlag(menusPac, hoy) {
    if (!Array.isArray(menusPac) || menusPac.length === 0) return false;
    const hoyT = hoy.getTime();
    for (const m of menusPac) {
      if (!m || !m.vigente_desde) continue;
      const t = new Date(String(m.vigente_desde)).getTime();
      if (!isNaN(t) && t <= hoyT) return true;
    }
    return false;
  }

  // Decora una entrada ya priorizada (de BoLogic.priorizarPacientes) con los
  // campos que la tabla necesita: diasSinCheckin, tieneMenuVigente.
  function decorarPaciente(priorizada, ctx) {
    const hoy = ctx && ctx.hoy instanceof Date ? ctx.hoy : new Date();
    const checkinsByPac = ctx && ctx.checkinsByPac;
    const menusByPac    = ctx && ctx.menusByPac;
    const ultimoT = checkinsByPac ? _ultimoCheckinFecha(checkinsByPac.get(priorizada.id) || []) : null;
    let diasSinCheckin = null;
    if (ultimoT != null) {
      diasSinCheckin = Math.max(
        0,
        Math.round((hoy.getTime() - ultimoT) / 86400000)
      );
    }
    const tieneMenuVigente = menusByPac
      ? _menuVigenteFlag(menusByPac.get(priorizada.id) || [], hoy)
      : false;
    return {
      id: priorizada.id,
      nombre: priorizada.nombre,
      email: priorizada.email,
      estado: priorizada.estado,
      proximaSesion: priorizada.proximaSesion,
      diasSinCheckin: diasSinCheckin,
      tieneMenuVigente: tieneMenuVigente
    };
  }

  // -----------------------------------------------------------------
  // Render (puro)
  // -----------------------------------------------------------------

  function _estadoLabel(estado) {
    if (!estado) return '';
    const map = {
      'activo': 'Activa',
      'activa': 'Activa',
      'cerrado': 'Cerrada',
      'cerrada': 'Cerrada',
      'pausa':   'En pausa',
      'pausado': 'En pausa',
      'pausada': 'En pausa'
    };
    const k = String(estado).toLowerCase();
    return map[k] || BoUi.titleCase(estado);
  }

  function _formateaProximaSesion(fecha) {
    if (!fecha) return '—';
    const fechaFmt = BoUi.formatearFecha(fecha);
    const horaFmt  = BoUi.formatearHora(fecha);
    if (!fechaFmt) return '—';
    return fechaFmt + (horaFmt ? (' · ' + horaFmt) : '');
  }

  function _formateaDiasSinCheckin(dias) {
    if (dias == null) return '—';
    if (dias === 0) return 'Hoy';
    return dias + ' ' + (dias === 1 ? 'día' : 'días');
  }

  function construirFila(p) {
    const nombreVisible = BoUi.escapeHtml(BoUi.titleCase(p.nombre));
    const estado  = _estadoLabel(p.estado);
    const prox    = _formateaProximaSesion(p.proximaSesion);
    const dias    = _formateaDiasSinCheckin(p.diasSinCheckin);
    const menu    = p.tieneMenuVigente ? 'Sí' : 'No';

    const detalleUrl = '/backoffice/paciente/?id=' + encodeURIComponent(p.id || '');
    const linkDetalle = '<a class="bo-fila-link" href="' + BoUi.escapeHtml(detalleUrl) + '">' +
      nombreVisible + '</a>';

    return '<tr data-bo-paciente-id="' + BoUi.escapeHtml(p.id || '') + '">' +
      '<td data-col="nombre">' + linkDetalle + '</td>' +
      '<td data-col="estado">' + BoUi.escapeHtml(estado) + '</td>' +
      '<td data-col="proxima-sesion">' + BoUi.escapeHtml(prox) + '</td>' +
      '<td data-col="dias-sin-checkin">' + BoUi.escapeHtml(dias) + '</td>' +
      '<td data-col="menu-vigente">' + menu + '</td>' +
    '</tr>';
  }

  function renderTabla(filas) {
    const cuerpo = filas.length
      ? filas.map(construirFila).join('')
      : '<tr class="bo-fila-vacia"><td colspan="5">No hay pacientes en este filtro.</td></tr>';
    return '<table class="bo-tabla" data-bo-tabla="pacientes">' +
      '<thead><tr>' +
        '<th scope="col">Nombre</th>' +
        '<th scope="col">Estado</th>' +
        '<th scope="col">Próxima sesión</th>' +
        '<th scope="col">Días desde último check-in</th>' +
        '<th scope="col">Menú vigente</th>' +
      '</tr></thead>' +
      '<tbody>' + cuerpo + '</tbody>' +
    '</table>';
  }

  function renderFiltro(estadoSel) {
    const opts = [
      { value: 'activas',  label: 'Activas' },
      { value: 'cerradas', label: 'Cerradas' },
      { value: 'todas',    label: 'Todas' }
    ];
    const options = opts.map(function (o) {
      const sel = o.value === estadoSel ? ' selected' : '';
      return '<option value="' + o.value + '"' + sel + '>' + o.label + '</option>';
    }).join('');
    return '<div class="bo-filtro" data-bo-filtro>' +
      '<label for="bo-filtro-estado">Estado:</label>' +
      '<select id="bo-filtro-estado" data-bo-filtro-estado>' + options + '</select>' +
    '</div>';
  }

  // -----------------------------------------------------------------
  // Wiring DOM
  // -----------------------------------------------------------------

  function conectarFiltro(root, onChange) {
    if (!root) return;
    const select = root.querySelector('[data-bo-filtro-estado]');
    if (!select) return;
    select.addEventListener('change', function () {
      onChange(select.value);
    });
  }

  async function cargarDatos(supa) {
    const results = await Promise.all([
      supa.from('pacientes').select('id, email, nombre, estado, alta'),
      supa.from('sesiones').select('id, paciente_id, fecha'),
      supa.from('checkins').select('paciente_id, fecha'),
      supa.from('menus').select('id, paciente_id, vigente_desde')
    ]);
    const [pac, ses, ck, menu] = results;
    const errores = results.map(r => r.error).filter(Boolean);
    if (errores.length) {
      throw new Error('Supabase: ' + errores.map(e => e.message || String(e)).join(' · '));
    }
    return {
      pacientes: pac.data || [],
      sesiones:  ses.data || [],
      checkins:  ck.data || [],
      menus:     menu.data || []
    };
  }

  function construirVista(datos, estadoSel) {
    const hoy = new Date();
    const priorizadas = BoLogic.priorizarPacientes(datos.pacientes, {
      estado: estadoSel,
      sesiones: datos.sesiones,
      hoy: hoy
    });
    const checkinsByPac = _indexBy(datos.checkins, 'paciente_id');
    const menusByPac    = _indexBy(datos.menus, 'paciente_id');
    const decoradas = priorizadas.map(function (p) {
      return decorarPaciente(p, { hoy: hoy, checkinsByPac: checkinsByPac, menusByPac: menusByPac });
    });
    return renderFiltro(estadoSel) + renderTabla(decoradas);
  }

  function mostrarError(msg) {
    if (typeof document === 'undefined') return;
    const root = document.getElementById('tabla-pacientes');
    if (!root) return;
    root.innerHTML = '<p class="bo-estado is-error">' + BoUi.escapeHtml(msg) + '</p>';
  }

  async function arrancar(supa) {
    if (typeof document === 'undefined') return;
    const root = document.getElementById('tabla-pacientes');
    if (!root) return;
    root.innerHTML = '<p class="bo-cargando">Cargando pacientes…</p>';
    let datos;
    try {
      datos = await cargarDatos(supa);
    } catch (err) {
      console.error('[backoffice/pacientes]', err);
      mostrarError('No se pudieron cargar los datos: ' + (err.message || 'error'));
      return;
    }
    let estadoSel = 'activas';
    function repintar() {
      root.innerHTML = construirVista(datos, estadoSel);
      conectarFiltro(root, function (nuevo) {
        estadoSel = nuevo;
        repintar();
      });
    }
    repintar();
  }

  // -----------------------------------------------------------------
  // API pública
  // -----------------------------------------------------------------

  const api = {
    construirFila,
    renderTabla,
    renderFiltro,
    decorarPaciente,
    construirVista,
    arrancar
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.BoPacientes = api;
})();
