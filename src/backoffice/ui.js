// Helpers UI compartidos del backoffice CLN — DRY entre las vistas Hoy y
// Pacientes. Puros en lo posible (las únicas dependencias del DOM son
// `copiarAlPortapapeles` y `toast`, que son las funciones que interactúan con
// el clipboard y el contenedor de avisos visuales).
//
// Navegador: cargado desde /backoffice/ui.js, expone `window.BoUi`.
// Node tests: `require('./ui.js')` devuelve la misma API para las funciones
// puras (formatearFecha, formatearHora, titleCase, escapeHtml). Las funciones
// de DOM (copiarAlPortapapeles, toast) también se exportan pero solo se
// testean en integración navegador — en Node simplemente no las invocamos.

(function () {
  'use strict';

  // -----------------------------------------------------------------
  // Formateo (DD/MM/AAAA y HH:MM, según CLAUDE.md)
  // -----------------------------------------------------------------

  function _pad2(n) { return String(n).padStart(2, '0'); }

  // ISO 'YYYY-MM-DD' | Date | timestamptz → 'DD/MM/AAAA'. Entrada inválida → ''.
  function formatearFecha(input) {
    if (input == null || input === '') return '';
    const d = input instanceof Date ? input : new Date(String(input));
    if (isNaN(d.getTime())) return '';
    // Si la entrada es 'YYYY-MM-DD' puro, Date la parsea en UTC. Para evitar
    // saltar un día atrás en zonas horarias negativas, usamos getUTC* cuando
    // detectamos ese formato exacto.
    const esIsoPuro = typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input);
    const yyyy = esIsoPuro ? d.getUTCFullYear()  : d.getFullYear();
    const mm   = esIsoPuro ? d.getUTCMonth() + 1 : d.getMonth() + 1;
    const dd   = esIsoPuro ? d.getUTCDate()      : d.getDate();
    return _pad2(dd) + '/' + _pad2(mm) + '/' + yyyy;
  }

  // Date | timestamptz → 'HH:MM' (24h, hora local). Entrada inválida → ''.
  function formatearHora(input) {
    if (input == null || input === '') return '';
    const d = input instanceof Date ? input : new Date(String(input));
    if (isNaN(d.getTime())) return '';
    return _pad2(d.getHours()) + ':' + _pad2(d.getMinutes());
  }

  // Texto humano del estado de vencimiento de un pago. Se usa en el bloque
  // "Pagos pendientes" de la vista Tareas. Empareja con BoLogic.calcularProximoPago.
  //
  //   diasDiff =  0 → 'vence hoy (DD mmm)'
  //   diasDiff =  1 → 'vence mañana (DD mmm)'
  //   diasDiff >  1 → 'vence en N días (DD mmm)'   (suele ser ≤ UMBRAL_AVISO_DIAS=2)
  //   diasDiff < -0 → 'vencido hace N días (DD mmm)' / 'hace 1 día' singular
  //
  // Si la fecha no parsea, devuelve solo el texto sin paréntesis.
  // Si diasDiff es null/undefined, devuelve cadena vacía.
  const _MESES_ABREV_UI = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                           'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function _fechaCortaUI(input) {
    if (!input) return null;
    const d = input instanceof Date ? input : new Date(String(input));
    if (isNaN(d.getTime())) return null;
    return d.getDate() + ' ' + _MESES_ABREV_UI[d.getMonth()];
  }
  function formatearVencimiento(diasDiff, fechaEsperada) {
    if (diasDiff == null) return '';
    let texto;
    if (diasDiff === 0) texto = 'vence hoy';
    else if (diasDiff === 1) texto = 'vence mañana';
    else if (diasDiff > 1) texto = 'vence en ' + diasDiff + ' días';
    else if (diasDiff === -1) texto = 'vencido hace 1 día';
    else texto = 'vencido hace ' + Math.abs(diasDiff) + ' días';
    const corta = _fechaCortaUI(fechaEsperada);
    return corta ? (texto + ' (' + corta + ')') : texto;
  }

  // -----------------------------------------------------------------
  // Nombres: Title Case para copy visible (feedback memoria:
  // feedback_copy_saludos_title_case.md). Internamente guardamos MAYÚSCULAS,
  // pero en pantalla mostramos "Marta" no "MARTA".
  // -----------------------------------------------------------------

  // 'MARÍA JOSÉ' → 'María José'. Funciona bien con tildes, ñ y apóstrofes en
  // locale es-ES. Los separadores que conservan la siguiente mayúscula son
  // espacio, guion y apóstrofe (D'AMBROSIO → D'Ambrosio).
  function titleCase(nombre) {
    if (nombre == null) return '';
    const s = String(nombre).trim();
    if (!s) return '';
    return s.toLocaleLowerCase('es-ES').replace(
      /(^|[\s\-'’])([\p{L}])/gu,
      function (_m, sep, ch) { return sep + ch.toLocaleUpperCase('es-ES'); }
    );
  }

  // Devuelve solo el primer nombre en Title Case. 'MARÍA JOSÉ GARCÍA' → 'María'.
  function primerNombre(nombre) {
    const t = titleCase(nombre);
    if (!t) return '';
    return t.split(/\s+/)[0];
  }

  // -----------------------------------------------------------------
  // Escape HTML para interpolar en innerHTML sin riesgos de XSS
  // (los nombres y emails salen de Supabase y nunca son confiables 100%).
  // -----------------------------------------------------------------

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // -----------------------------------------------------------------
  // Clipboard + toast. navigator.clipboard necesita contexto seguro (HTTPS
  // o localhost). Fallback: textarea + execCommand('copy') — sigue
  // funcionando en Safari iOS y en páginas servidas por GitHub Pages.
  // -----------------------------------------------------------------

  async function copiarAlPortapapeles(texto) {
    const s = String(texto == null ? '' : texto);
    if (!s) return false;
    // Camino moderno: Clipboard API.
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(s);
        return true;
      } catch (_) {
        // cae al fallback
      }
    }
    // Fallback histórico: textarea fuera de pantalla + execCommand.
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    const selection = document.getSelection();
    const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    document.body.removeChild(ta);
    if (previous && selection) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
    return ok;
  }

  // Toast efímero (2.8s) en esquina inferior. Se reutiliza el nodo si ya
  // existe — múltiples clics seguidos actualizan el mensaje en lugar de
  // apilar nodos.
  let _toastTimer = null;
  function toast(mensaje) {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('bo-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bo-toast';
      el.className = 'bo-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = mensaje;
    // Limpia variantes de error/aviso previas para que un toast() simple tras
    // toastResultado('error') no herede el fondo rojo.
    el.classList.remove('bo-toast-error');
    el.classList.remove('bo-toast-aviso');
    el.classList.add('is-visible');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () {
      el.classList.remove('is-visible');
    }, 2800);
  }

  // Toast rico para resultados de acciones directas. tipo: 'ok'|'aviso'|'error'.
  // extras: [{etiqueta, texto}] → botones que copian `texto` al portapapeles.
  // Error: persiste hasta click (sin timer). Ok/aviso: 6s.
  // Como `toast`, es función de DOM: se valida en integración navegador, no en Node.
  function toastResultado(modelo) {
    if (typeof document === 'undefined') return;
    const m = modelo || {};
    let el = document.getElementById('bo-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bo-toast';
      el.className = 'bo-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.className = 'bo-toast is-visible' +
      (m.tipo === 'error' ? ' bo-toast-error' : m.tipo === 'aviso' ? ' bo-toast-aviso' : '');
    el.textContent = '';
    const p = document.createElement('div');
    p.textContent = m.mensaje || '';
    el.appendChild(p);
    (m.avisos || []).forEach(function (a) {
      const av = document.createElement('div');
      av.textContent = '⚠ ' + a;
      el.appendChild(av);
    });
    (m.extras || []).forEach(function (x) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bo-toast-extra';
      b.textContent = x.etiqueta;
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        copiarAlPortapapeles(x.texto).then(function () { b.textContent = 'Copiado'; });
      });
      el.appendChild(b);
    });
    if (_toastTimer) clearTimeout(_toastTimer);
    if (m.tipo === 'error') {
      el.addEventListener('click', function cerrar() {
        el.classList.remove('is-visible');
        el.removeEventListener('click', cerrar);
      });
    } else {
      _toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 6000);
    }
  }

  // Handler conveniente para el botón "Copiar comando".
  // Copia, muestra toast y opcionalmente mete un micro-feedback visual en el
  // propio botón (cambiando su texto temporalmente).
  async function copiarComando(comando, boton) {
    const ok = await copiarAlPortapapeles(comando);
    if (ok) {
      toast('Copiado: ' + comando + '. Pega en Claude Code y pulsa Enter.');
      if (boton) {
        const original = boton.textContent;
        boton.textContent = 'Copiado';
        boton.classList.add('is-copiado');
        setTimeout(function () {
          boton.textContent = original;
          boton.classList.remove('is-copiado');
        }, 1200);
      }
    } else {
      toast('No se pudo copiar. Copia manualmente: ' + comando);
    }
    return ok;
  }

  // -----------------------------------------------------------------
  // Puente a Edge Functions (supabase.functions.invoke)
  //
  // Devuelve siempre un objeto con la forma { ok, data?, error? } —
  // el caller no necesita try/catch.
  //
  // Convenciones:
  //   - ok=true solo si `supa.functions.invoke` no lanzó, no devolvió error,
  //     y el body tiene `ok !== false` (los contratos de las Edge Functions
  //     siempre devuelven {ok: true|false, ...}).
  //   - error.type ∈ {'network', 'http', 'app'} para que el caller pueda
  //     distinguir fallo de red de error controlado.
  //   - error.message es siempre string no vacío.
  //
  // opts (reservado para futuros headers/signal): actualmente no se usa,
  // pero lo aceptamos para que el call-site no cambie cuando añadamos
  // cancelación o tracing.
  // -----------------------------------------------------------------

  async function ejecutarEdgeFunction(supa, nombre, payload, _opts) {
    if (!supa || !supa.functions || typeof supa.functions.invoke !== 'function') {
      return {
        ok: false,
        error: { type: 'app', message: 'supa.functions.invoke no disponible' }
      };
    }
    if (!nombre || typeof nombre !== 'string') {
      return {
        ok: false,
        error: { type: 'app', message: 'nombre de función requerido' }
      };
    }
    let resp;
    try {
      resp = await supa.functions.invoke(nombre, { body: payload || {} });
    } catch (err) {
      return {
        ok: false,
        error: {
          type: 'network',
          message: (err && err.message) ? String(err.message) : 'fallo de red'
        }
      };
    }
    if (resp && resp.error) {
      return {
        ok: false,
        error: {
          type: 'http',
          message: (resp.error.message || String(resp.error)) +
            (resp.error.status ? ' (' + resp.error.status + ')' : '')
        }
      };
    }
    const data = resp && resp.data;
    if (data && data.ok === false) {
      return {
        ok: false,
        data: data,
        error: {
          type: 'app',
          message: data.error || data.message || 'error de aplicación'
        }
      };
    }
    return { ok: true, data: data || null };
  }

  // -----------------------------------------------------------------
  // API pública
  // -----------------------------------------------------------------

  const api = {
    formatearFecha,
    formatearHora,
    formatearVencimiento,
    titleCase,
    primerNombre,
    escapeHtml,
    copiarAlPortapapeles,
    copiarComando,
    toast,
    toastResultado,
    ejecutarEdgeFunction
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.BoUi = api;
})();
