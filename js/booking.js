// Capa DOM del picker de valoración gratuita.
// Consume funciones puras expuestas por booking-logic.js (cargado antes en la página).
// Fase 2.2: datos mock. Fase 2.3 cambiará `busyEvents` y `dayHasAvailability`
// por datos del backend real.

(function () {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

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
    const busyEvents = buildMockBusyEvents(today);

    const state = {
      viewYear: today.getFullYear(),
      viewMonth: today.getMonth(),
      selectedIso: null,
      selectedSlot: null,
      step: 'picker' // 'picker' | 'form' | 'confirmed'
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
      DAY_HEADERS.forEach(function (h) {
        const th = document.createElement('div');
        th.className = 'booking-cal-header';
        th.textContent = h;
        els.grid.appendChild(th);
      });
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
            const available = dayHasAvailability(cell.iso, busyEvents, SLOT_DURATION_MINUTES, todayIso);
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
      const slots = computeAvailableSlots(state.selectedIso, busyEvents, SLOT_DURATION_MINUTES);
      const prettyDate = new Date(state.selectedIso + 'T00:00:00')
        .toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      els.slotsHint.textContent = prettyDate.charAt(0).toUpperCase() + prettyDate.slice(1);
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
          '<p class="booking-confirm-disclaimer">⚠️ Esta es una demo. No se ha reservado nada de verdad ni se ha enviado ningún email.</p>';
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
      render();
    });

    els.nextBtn.addEventListener('click', function () {
      state.viewMonth += 1;
      if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear += 1; }
      render();
    });

    render();
  });
})();
