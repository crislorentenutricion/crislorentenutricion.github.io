// Paneles inline de acciones directas del backoffice — renderers puros
// compartidos entre el detalle de paciente y la vista Tareas.
// El submit se conecta vía conectarPanel(cont, accion, deps).
(function () {
  'use strict';
  const BoUi    = (typeof module !== 'undefined' && module.exports) ? require('./ui.js')    : window.BoUi;
  const BoLogic = (typeof module !== 'undefined' && module.exports) ? require('./logic.js') : window.BoLogic;

  function _campo(html) { return '<div class="bo-panel-campo">' + html + '</div>'; }
  function _pie(etiquetaEjecutar) {
    return '<div class="bo-panel-pie">' +
      '<button type="submit" class="bo-btn bo-btn-directo">' + BoUi.escapeHtml(etiquetaEjecutar) + '</button>' +
      '<button type="button" class="bo-btn" data-bo-action="cerrar-panel">Cancelar</button>' +
    '</div>';
  }
  function _form(accion, titulo, cuerpo, etiquetaEjecutar) {
    return '<form class="bo-panel-accion" data-bo-form="' + accion + '">' +
      '<h3>' + BoUi.escapeHtml(titulo) + '</h3>' + cuerpo + _pie(etiquetaEjecutar) + '</form>';
  }

  // ctx posibles: pacienteId, prefill{nombre,email,importe}, sesionesFuturas[],
  // menus[], pagosPrevios (número), ultimoIntentoRepesca (ISO|null)
  function renderPanelAccion(accion, ctx) {
    const c = ctx || {};
    switch (accion) {
      case 'agendar':
        return _form('agendar', 'Agendar sesión',
          _campo('<label>Fecha y hora <input type="datetime-local" name="fecha" required></label>') +
          _campo('<label>Duración (min) <input type="number" name="duracion" value="30" min="15" max="120"></label>') +
          _campo('<label>Notas <input type="text" name="notas" placeholder="opcional"></label>'),
          'Agendar');
      case 'reagendar': {
        const sesiones = c.sesionesFuturas || [];
        const opts = sesiones.map(function (s, i) {
          return '<option value="' + BoUi.escapeHtml(s.calendar_event_id || '') + '"' + (i === 0 ? ' selected' : '') + '>' +
            BoUi.escapeHtml(BoUi.formatearFecha(s.fecha) + ' · ' + BoUi.formatearHora(s.fecha)) + '</option>';
        }).join('');
        return _form('reagendar', 'Reagendar sesión',
          _campo('<label>Sesión <select name="calendar_event_id">' + opts + '</select></label>') +
          _campo('<label>Nueva fecha y hora <input type="datetime-local" name="fecha" required></label>') +
          '<p class="bo-panel-aviso">Calendar avisa a la paciente del cambio.</p>',
          'Reagendar');
      }
      case 'alta': {
        const pre = c.prefill || {};
        return _form('alta', 'Dar de alta',
          _campo('<label>Nombre (MAYÚSCULAS) <input type="text" name="nombre" value="' + BoUi.escapeHtml(pre.nombre || '') + '" required></label>') +
          _campo('<label>Email <input type="email" name="email" value="' + BoUi.escapeHtml(pre.email || '') + '" required></label>'),
          'Dar de alta');
      }
      case 'reactivar':
        return _form('reactivar', 'Reactivar paciente',
          _campo('<label><input type="checkbox" name="crear_borrador" checked> Crear borrador de bienvenida de vuelta</label>'),
          'Reactivar');
      case 'cerrar': {
        const n = (c.sesionesFuturas || []).length;
        return _form('cerrar', 'Cerrar paciente',
          _campo('<label>Motivo <select name="motivo" data-bo-motivo>' +
            '<option value="objetivo_cumplido">Objetivo cumplido</option>' +
            '<option value="abandono">Abandono</option>' +
            '<option value="baja_voluntaria">Baja voluntaria</option>' +
            '<option value="fin_de_prueba">Fin de prueba/regalo</option>' +
          '</select></label>') +
          _campo('<label data-bo-nota-personal>Nota personal para la despedida (opcional)' +
            '<textarea name="nota_personal" maxlength="2000"></textarea></label>') +
          '<p class="bo-panel-aviso">Se cancelarán ' + n + ' sesiones futuras en Calendar.</p>' +
          _campo('<label><input type="checkbox" name="confirmar" required> Confirmo el cierre</label>'),
          'Cerrar paciente');
      }
      case 'repescar': {
        let aviso = '';
        if (c.ultimoIntentoRepesca) {
          const dias = Math.floor((Date.now() - new Date(c.ultimoIntentoRepesca).getTime()) / 864e5);
          if (dias < 7) {
            aviso = '<p class="bo-panel-aviso">Último intento hace ' + dias + ' días.</p>' +
              _campo('<label><input type="checkbox" name="force"> Repescar de todos modos</label>');
          }
        }
        return _form('repescar', 'Repescar paciente',
          '<p>Crea un borrador de repesca en Gmail y registra el intento.</p>' + aviso,
          'Repescar');
      }
      case 'registrar-pago': {
        const auto = (c.pagosPrevios || 0) === 0 ? 'alta' : 'renovacion';
        const pre = c.prefill || {};
        return _form('registrar-pago', 'Registrar pago',
          _campo('<label>Importe (€) <input type="number" name="importe" value="' + BoUi.escapeHtml(String(pre.importe || 40)) + '" min="1" step="0.01" required></label>') +
          _campo('<label>Concepto <select name="concepto">' +
            '<option value="">' + auto + ' (detectado)</option>' +
            '<option value="alta">alta</option><option value="renovacion">renovacion</option><option value="otro">otro</option>' +
          '</select></label>') +
          _campo('<label>Método <select name="metodo" required>' +
            '<option value="">— elige —</option>' +
            '<option>Bizum</option><option>Transferencia</option><option>Efectivo</option><option>Otro</option>' +
          '</select></label>') +
          _campo('<label>Fecha <input type="date" name="fecha"></label>') +
          _campo('<label>Notas <input type="text" name="notas" placeholder="opcional"></label>'),
          'Registrar pago');
      }
      case 'enviar-menu': {
        const conPdf = (c.menus || []).filter(function (m) { return m && m.pdf_url; });
        conPdf.sort(function (a, b) { return (b.numero || 0) - (a.numero || 0); });
        const opts = conPdf.map(function (m, i) {
          return '<option value="' + BoUi.escapeHtml(m.id) + '"' + (i === 0 ? ' selected' : '') + '>MENÚ ' + BoUi.escapeHtml(String(m.numero)) + '</option>';
        }).join('');
        return _form('enviar-menu', 'Enviar menú',
          _campo('<label>Menú <select name="menu_id">' + opts + '</select></label>') +
          '<p class="bo-panel-aviso">Crea un borrador en Gmail con el PDF adjunto. Lo revisas allí antes de enviar.</p>',
          'Crear borrador');
      }
      default:
        return '';
    }
  }

  function conectarPanel(cont, accion, deps) {
    const form = cont.querySelector('[data-bo-form]');
    if (!form) return;
    const motivoSel = form.querySelector('[data-bo-motivo]');
    if (motivoSel) {
      const nota = form.querySelector('[data-bo-nota-personal]');
      const sync = function () { if (nota) nota.style.display = motivoSel.value === 'objetivo_cumplido' ? '' : 'none'; };
      motivoSel.addEventListener('change', sync);
      sync();
    }
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const valores = {};
      new FormData(form).forEach(function (v, k) { valores[k] = String(v); });
      const ctx = deps.ctxAccion();
      const r = BoLogic.construirPayload(accion, valores, ctx);
      if (!r.ok) { BoUi.toastResultado({ tipo: 'error', mensaje: r.error }); return; }
      const submitBtn = form.querySelector('[type="submit"]');
      submitBtn.disabled = true;
      const original = submitBtn.textContent;
      submitBtn.textContent = 'Ejecutando…';
      const res = await BoUi.ejecutarEdgeFunction(deps.supa, BoLogic.NOMBRE_EF[accion], r.payload);
      submitBtn.disabled = false;
      submitBtn.textContent = original;
      if (res.ok) {
        const modelo = BoLogic.resumenResultadoAccion(accion, res.data);
        modelo.tipo = (modelo.avisos && modelo.avisos.length) ? 'aviso' : 'ok';
        BoUi.toastResultado(modelo);
        cont.innerHTML = '';
        if (cont.removeAttribute) cont.removeAttribute('data-bo-abierto');
        if (typeof deps.recargar === 'function') deps.recargar(); // fire-and-forget: el toast ya está mostrado; el re-render llega cuando llega
      } else {
        BoUi.toastResultado({
          tipo: 'error',
          mensaje: 'No se pudo completar: ' + res.error.message,
          extras: [{ etiqueta: 'Copiar comando para Claude', texto: BoLogic.comandoRescate(accion, ctx.nombre, ctx.email) }]
        });
      }
    });
  }

  const api = { renderPanelAccion: renderPanelAccion, conectarPanel: conectarPanel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.BoPaneles = api;
})();
