// Capa DOM del picker de valoración gratuita.
// Consume funciones puras expuestas por booking-logic.js.
//
// Fase 2.3: conectado al backend real vía fetch. Con `USE_REAL_BACKEND=false`
// cae a los datos mock de Fase 2.2 (útil para trabajar offline).

(function () {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const CONFIG = {
    USE_REAL_BACKEND: true,
    DEV_API_URL: 'https://script.google.com/macros/s/AKfycbyRxyJLvzxjdn1NGjVH4Iewk2twA7Ch4KSgCRwOfHtEytutGo_ARFkVfsMu23BZn7vIFQ/exec',
    PROD_API_URL: null, // se definirá en Fase 3.1
    TIMEOUT_MS: 10000
  };

  function currentApiUrl() {
    return apiUrlFor(window.location.hostname, CONFIG.DEV_API_URL, CONFIG.PROD_API_URL);
  }

  async function fetchMonth(year, month, signal) {
    const { from, to } = buildSlotsRange(year, month);
    const url = currentApiUrl() + '?action=slots&from=' + from + '&to=' + to;
    const response = await fetch(url, { method: 'GET', signal: signal });
    if (!response.ok) {
      throw new Error('HTTP_' + response.status);
    }
    const json = await response.json();
    const parsed = parseApiResponse(json);
    if (!parsed.ok) throw new Error('API_' + parsed.error);
    return parsed.availability;
  }

  async function fetchMonthWithTimeout(year, month) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, CONFIG.TIMEOUT_MS);
    try {
      return await fetchMonth(year, month, ctrl.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const root = document.querySelector('[data-booking-mock]');
    if (!root) return;

    const MONTH_NAMES = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    const DAY_HEADERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

    const today = new Date();
    const todayIso = toIsoDate(today.getFullYear(), today.getMonth(), today.getDate());

    // Cache de disponibilidad por mes. Clave "YYYY-MM" → Map<isoDate, slot[]>.
    const monthCache = new Map();
    // Estado de carga / error por mes.
    const monthStatus = new Map(); // "YYYY-MM" → 'loading' | 'ok' | 'error'

    const state = {
      viewYear: today.getFullYear(),
      viewMonth: today.getMonth(),
      selectedIso: null,
      selectedSlot: null,
      step: 'picker'
    };

    const els = {
      monthLabel: root.querySelector('[data-month-label]'),
      prevBtn: root.querySelector('[data-prev-month]'),
      nextBtn: root.querySelector('[data-next-month]'),
      grid: root.querySelector('[data-calendar-grid]'),
      slotsPanel: root.querySelector('[data-slots-panel]'),
      slotsList: root.querySelector('[data-slots-list]'),
      slotsHint: root.querySelector('[data-slots-hint]'),
      formPanel: root.querySelector('[data-form-panel]'),
      formSummary: root.querySelector('[data-form-summary]'),
      form: root.querySelector('[data-booking-form]'),
      formBack: root.querySelector('[data-form-back]'),
      confirmPanel: root.querySelector('[data-confirm-panel]'),
      confirmSummary: root.querySelector('[data-confirm-summary]'),
      confirmRestart: root.querySelector('[data-confirm-restart]')
    };

    function monthKey(year, month) {
      return year + '-' + String(month + 1).padStart(2, '0');
    }

    async function ensureMonthLoaded(year, month) {
      const key = monthKey(year, month);
      if (monthCache.has(key)) return;
      if (monthStatus.get(key) === 'loading') return;
      monthStatus.set(key, 'loading');
      render();
      try {
        let availability;
        if (CONFIG.USE_REAL_BACKEND) {
          availability = await fetchMonthWithTimeout(year, month);
        } else {
          availability = buildMockAvailabilityForMonth(year, month);
        }
        monthCache.set(key, indexAvailability(availability));
        monthStatus.set(key, 'ok');
      } catch (err) {
        monthStatus.set(key, 'error');
      }
      render();
    }

    function currentMonthSlots() {
      return monthCache.get(monthKey(state.viewYear, state.viewMonth));
    }

    function currentMonthStatus() {
      return monthStatus.get(monthKey(state.viewYear, state.viewMonth));
    }

    function render() {
      renderHeader();
      renderGrid();
      renderSlots();
      renderPanels();
    }

    function renderHeader() {
      els.monthLabel.textContent = MONTH_NAMES[state.viewMonth] + ' ' + state.viewYear;
      const atMinMonth =
        state.viewYear === today.getFullYear() && state.viewMonth === today.getMonth();
      els.prevBtn.disabled = atMinMonth;
    }

    function renderGrid() {
      els.grid.innerHTML = '';

      const status = currentMonthStatus();
      if (status === 'loading') {
        const skel = document.createElement('div');
        skel.className = 'booking-cal-loading';
        skel.setAttribute('role', 'status');
        skel.setAttribute('aria-live', 'polite');
        skel.textContent = 'Cargando disponibilidad…';
        els.grid.appendChild(skel);
        return;
      }
      if (status === 'error') {
        const err = document.createElement('div');
        err.className = 'booking-cal-error';
        err.setAttribute('role', 'alert');
        err.innerHTML =
          '<p>No he podido cargar la disponibilidad.</p>' +
          '<button type="button" class="booking-retry-btn">Reintentar</button>';
        err.querySelector('button').addEventListener('click', function () {
          const key = monthKey(state.viewYear, state.viewMonth);
          monthStatus.delete(key);
          monthCache.delete(key);
          ensureMonthLoaded(state.viewYear, state.viewMonth);
        });
        els.grid.appendChild(err);
        return;
      }

      DAY_HEADERS.forEach(function (h) {
        const th = document.createElement('div');
        th.className = 'booking-cal-header';
        th.textContent = h;
        els.grid.appendChild(th);
      });
      const availByDate = currentMonthSlots() || new Map();
      const weeks = buildMonthGrid(state.viewYear, state.viewMonth);
      weeks.forEach(function (week) {
        week.forEach(function (cell) {
          const el = document.createElement('button');
          el.type = 'button';
          el.className = 'booking-cal-cell';
          if (cell.day === null) {
            el.className += ' is-empty';
            el.disabled = true;
            el.setAttribute('aria-hidden', 'true');
          } else {
            el.textContent = String(cell.day);
            const hasSlots = availByDate.has(cell.iso);
            const isPast = cell.iso < todayIso;
            const available = hasSlots && !isPast;
            if (!available) {
              el.className += ' is-unavailable';
              el.disabled = true;
              el.setAttribute('aria-disabled', 'true');
              el.setAttribute('aria-label', cell.day + ' — sin huecos');
            } else {
              el.className += ' is-available';
              if (cell.iso === state.selectedIso) {
                el.className += ' is-selected';
                el.setAttribute('aria-current', 'date');
              }
              el.setAttribute('aria-label', cell.day + ' — huecos disponibles');
              el.addEventListener('click', function () {
                state.selectedIso = cell.iso;
                state.selectedSlot = null;
                state.step = 'picker';
                render();
              });
            }
          }
          els.grid.appendChild(el);
        });
      });
    }

    function renderSlots() {
      els.slotsList.innerHTML = '';
      if (!state.selectedIso) {
        els.slotsHint.textContent = 'Elige un día con hueco para ver los horarios disponibles.';
        els.slotsHint.hidden = false;
        return;
      }
      const availByDate = currentMonthSlots() || new Map();
      const slots = availByDate.get(state.selectedIso) || [];
      const prettyDate = new Date(state.selectedIso + 'T00:00:00')
        .toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      els.slotsHint.textContent = prettyDate.charAt(0).toUpperCase() + prettyDate.slice(1) +
        ' · hora peninsular (Madrid)';
      els.slotsHint.hidden = false;
      slots.forEach(function (slot) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'booking-slot-btn';
        btn.textContent = slot.start + ' – ' + slot.end;
        btn.addEventListener('click', function () {
          state.selectedSlot = slot;
          state.step = 'form';
          render();
          setTimeout(function () {
            const first = els.form.querySelector('input, textarea');
            if (first) first.focus();
          }, 80);
        });
        els.slotsList.appendChild(btn);
      });
    }

    function renderPanels() {
      const pickerVisible = state.step === 'picker';
      const formVisible = state.step === 'form';
      const confirmVisible = state.step === 'confirmed';

      els.slotsPanel.hidden = !pickerVisible;
      els.formPanel.hidden = !formVisible;
      els.confirmPanel.hidden = !confirmVisible;

      if (formVisible && state.selectedIso && state.selectedSlot) {
        els.formSummary.textContent = formatPrettyDateTime(state.selectedIso, state.selectedSlot);
      }
    }

    function formatPrettyDateTime(iso, slot) {
      const pretty = new Date(iso + 'T00:00:00').toLocaleDateString('es-ES', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
      return pretty.charAt(0).toUpperCase() + pretty.slice(1) +
        ' · ' + slot.start + '–' + slot.end;
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Fallback mock (si USE_REAL_BACKEND === false): genera availability[]
    // para el mes pedido basándose en WORKING_HOURS + buildMockBusyEvents.
    function buildMockAvailabilityForMonth(year, month) {
      const busy = buildMockBusyEvents(today);
      const { from, to } = buildSlotsRange(year, month);
      const out = [];
      const cursor = new Date(from + 'T00:00:00');
      const end = new Date(to + 'T00:00:00');
      while (cursor.getTime() <= end.getTime()) {
        const iso = toIsoDate(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
        const slots = computeAvailableSlots(iso, busy, SLOT_DURATION_MINUTES);
        if (slots.length > 0) out.push({ date: iso, slots: slots });
        cursor.setDate(cursor.getDate() + 1);
      }
      return out;
    }

    if (els.formBack) {
      els.formBack.addEventListener('click', function () {
        state.step = 'picker';
        state.selectedSlot = null;
        render();
      });
    }

    if (els.form) {
      els.form.addEventListener('submit', function (e) {
        e.preventDefault();
        const data = new FormData(els.form);
        els.confirmSummary.innerHTML =
          '<p><strong>' + escapeHtml(data.get('nombre') || '') + '</strong>, ' +
          'tu valoración gratuita ha quedado reservada para:</p>' +
          '<p class="booking-confirm-date">' +
          escapeHtml(formatPrettyDateTime(state.selectedIso, state.selectedSlot)) + '</p>' +
          '<p>Te hemos enviado un email con el enlace de Google Meet a ' +
          '<strong>' + escapeHtml(data.get('email') || '') + '</strong>.</p>' +
          '<p class="booking-confirm-disclaimer">⚠️ Esta es una demo. En Fase 2.4 este botón enviará la reserva al backend real.</p>';
        state.step = 'confirmed';
        render();
      });
    }

    if (els.confirmRestart) {
      els.confirmRestart.addEventListener('click', function () {
        state.step = 'picker';
        state.selectedIso = null;
        state.selectedSlot = null;
        if (els.form) els.form.reset();
        render();
      });
    }

    els.prevBtn.addEventListener('click', function () {
      if (state.viewYear === today.getFullYear() && state.viewMonth === today.getMonth()) return;
      state.viewMonth -= 1;
      if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear -= 1; }
      ensureMonthLoaded(state.viewYear, state.viewMonth);
      render();
    });

    els.nextBtn.addEventListener('click', function () {
      state.viewMonth += 1;
      if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear += 1; }
      ensureMonthLoaded(state.viewYear, state.viewMonth);
      render();
    });

    ensureMonthLoaded(state.viewYear, state.viewMonth);
    render();
  });
})();
