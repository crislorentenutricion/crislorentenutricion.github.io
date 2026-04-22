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
    el.classList.add('is-visible');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () {
      el.classList.remove('is-visible');
    }, 2800);
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
  // API pública
  // -----------------------------------------------------------------

  const api = {
    formatearFecha,
    formatearHora,
    titleCase,
    primerNombre,
    escapeHtml,
    copiarAlPortapapeles,
    copiarComando,
    toast
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.BoUi = api;
})();
