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
    PROD_API_URL: 'https://script.google.com/macros/s/AKfycbw4l1ok-Oi7_OE5eYbs-Sn-fyR7yUvHuR_Szqs3KjCf9Sda_evRQd4NcSyZcI9LNI9hbQ/exec',
    TIMEOUT_MS: 10000,
    HCAPTCHA_SITE_KEY: '9a82e394-bf54-4d36-8e8a-ed9e1f94f7fe'
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

  async function postBooking(payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, CONFIG.TIMEOUT_MS);
    try {
      const response = await fetch(currentApiUrl(), {
        method: 'POST',
        // Apps Script /exec solo acepta postData.contents como texto plano:
        // mandar text/plain evita el preflight CORS.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      if (!response.ok) throw new Error('HTTP_' + response.status);
      const json = await response.json();
      return parseBookingResponse(json);
    } finally {
      clearTimeout(timer);
    }
  }

  function track(eventName, props) {
    try {
      if (typeof window !== 'undefined' && window.amplitude && typeof window.amplitude.track === 'function') {
        window.amplitude.track(eventName, props || {});
      }
    } catch (_) { /* noop: telemetry never breaks UX */ }
  }

  function getCaptchaToken() {
    if (!CONFIG.HCAPTCHA_SITE_KEY) return Promise.resolve('');
    if (typeof window.hcaptcha === 'undefined' || !window.hcaptcha.execute) {
      return Promise.resolve('');
    }
    try {
      return Promise.resolve(window.hcaptcha.execute(CONFIG.HCAPTCHA_SITE_KEY, { async: true }))
        .then(function (res) { return (res && res.response) || ''; })
        .catch(function () { return ''; });
    } catch (err) {
      return Promise.resolve('');
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
      focusedIso: null,
      step: 'picker',
      submitting: false
    };

    // Carga el script de hCaptcha sólo si hay site key configurada.
    if (CONFIG.HCAPTCHA_SITE_KEY && !document.querySelector('script[data-hcaptcha]')) {
      const s = document.createElement('script');
      s.src = 'https://js.hcaptcha.com/1/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      s.setAttribute('data-hcaptcha', '');
      document.head.appendChild(s);
    }

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
      // Determina qué celda tiene el "roving focus" (tabindex=0). Solo una en todo el grid.
      const rovingIso = resolveRovingIso(availByDate);
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
            el.setAttribute('tabindex', '-1');
          } else {
            el.textContent = String(cell.day);
            el.setAttribute('data-iso', cell.iso);
            const hasSlots = availByDate.has(cell.iso);
            const isPast = cell.iso < todayIso;
            const available = hasSlots && !isPast;
            if (!available) {
              el.className += ' is-unavailable';
              el.disabled = true;
              el.setAttribute('aria-disabled', 'true');
              el.setAttribute('aria-label', cell.day + ' — sin huecos');
              el.setAttribute('tabindex', '-1');
            } else {
              el.className += ' is-available';
              if (cell.iso === state.selectedIso) {
                el.className += ' is-selected';
                el.setAttribute('aria-current', 'date');
              }
              el.setAttribute('aria-label', cell.day + ' — huecos disponibles');
              el.setAttribute('tabindex', cell.iso === rovingIso ? '0' : '-1');
              el.addEventListener('click', function () {
                state.selectedIso = cell.iso;
                state.focusedIso = cell.iso;
                state.selectedSlot = null;
                state.step = 'picker';
                render();
                track('booking_slot_viewed', { date: cell.iso });
              });
            }
          }
          els.grid.appendChild(el);
        });
      });
    }

    // ISO con tabindex=0 en el grid. Prioridad: focusedIso → selectedIso → primer disponible.
    function resolveRovingIso(availByDate) {
      if (state.focusedIso && availByDate.has(state.focusedIso) && state.focusedIso >= todayIso) {
        return state.focusedIso;
      }
      if (state.selectedIso && availByDate.has(state.selectedIso) && state.selectedIso >= todayIso) {
        return state.selectedIso;
      }
      return firstFocusableIsoInMonth(availByDate, todayIso, state.viewYear, state.viewMonth);
    }

    // Navegación por teclado dentro del calendario (roving tabindex + arrow keys).
    els.grid.addEventListener('keydown', function (e) {
      const target = e.target.closest('[data-iso]');
      if (!target) return;
      const currentIso = target.getAttribute('data-iso');
      const availByDate = currentMonthSlots() || new Map();
      let delta = 0;
      switch (e.key) {
        case 'ArrowLeft':  delta = -1; break;
        case 'ArrowRight': delta = +1; break;
        case 'ArrowUp':    delta = -7; break;
        case 'ArrowDown':  delta = +7; break;
        case 'Home':       delta = 0; break;
        case 'End':        delta = 0; break;
        default: return;
      }
      e.preventDefault();
      let nextIso;
      if (e.key === 'Home' || e.key === 'End') {
        // Primer/último disponible del mes visible.
        const keys = Array.from(availByDate.keys()).filter(function (iso) {
          const p = iso.split('-').map(Number);
          return p[0] === state.viewYear && p[1] - 1 === state.viewMonth && iso >= todayIso;
        }).sort();
        nextIso = e.key === 'Home' ? keys[0] : keys[keys.length - 1];
      } else {
        nextIso = findFocusableIso(
          currentIso, delta, availByDate, todayIso, state.viewYear, state.viewMonth
        );
      }
      if (!nextIso) return;
      state.focusedIso = nextIso;
      render();
      const newCell = els.grid.querySelector('[data-iso="' + nextIso + '"]');
      if (newCell) newCell.focus();
    });

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
          track('booking_slot_selected', { date: state.selectedIso, start: slot.start, end: slot.end });
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
        setTimeout(function () {
          const cell = state.selectedIso
            ? els.grid.querySelector('[data-iso="' + state.selectedIso + '"]')
            : els.grid.querySelector('[tabindex="0"][data-iso]');
          if (cell) cell.focus();
        }, 80);
      });
    }

    if (els.form) {
      els.form.addEventListener('submit', async function (e) {
        e.preventDefault();
        clearFormError();
        if (state.submitting) return;
        if (!state.selectedIso || !state.selectedSlot) return;
        state.submitting = true;
        const submitBtn = els.form.querySelector('button[type="submit"]');
        const prevLabel = submitBtn ? submitBtn.textContent : '';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Reservando…'; }
        track('booking_submitted', { date: state.selectedIso, start: state.selectedSlot.start });
        try {
          const data = new FormData(els.form);
          const captchaToken = await getCaptchaToken();
          const payload = buildBookingPayload(data, state.selectedIso, state.selectedSlot, captchaToken);
          const result = await postBooking(payload);
          if (result.ok) {
            renderConfirmed(data, result);
            state.step = 'confirmed';
            render();
            track('booking_confirmed', { date: state.selectedIso, start: state.selectedSlot.start, plan: (data.get('plan') || '').toString() });
            const h = els.confirmPanel.querySelector('[data-confirm-heading]');
            if (h) setTimeout(function () { h.focus(); }, 80);
            return;
          }
          if (result.reason === 'slot_taken') {
            const key = monthKey(state.viewYear, state.viewMonth);
            monthCache.delete(key);
            monthStatus.delete(key);
            state.selectedSlot = null;
            state.step = 'picker';
            showFormError(bookingErrorMessage('slot_taken'));
            ensureMonthLoaded(state.viewYear, state.viewMonth);
            render();
            track('booking_failed', { reason: 'slot_taken' });
            return;
          }
          showFormError(bookingErrorMessage(result.reason));
          track('booking_failed', { reason: result.reason || 'unknown' });
        } catch (err) {
          showFormError('No hemos podido conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
          track('booking_failed', { reason: 'network_error' });
        } finally {
          state.submitting = false;
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = prevLabel; }
        }
      });
    }

    function renderConfirmed(formDataObj, result) {
      const meetLink = (result && result.meetLink) || '';
      const linkHtml = meetLink
        ? '<p>Te hemos enviado la invitación de Google Calendar a <strong>' +
          escapeHtml(formDataObj.get('email') || '') + '</strong> con este enlace de Meet:<br>' +
          '<a href="' + escapeHtml(meetLink) + '" target="_blank" rel="noopener">' +
          escapeHtml(meetLink) + '</a></p>'
        : '<p>Te hemos enviado la invitación de Google Calendar a <strong>' +
          escapeHtml(formDataObj.get('email') || '') + '</strong>.</p>';
      els.confirmSummary.innerHTML =
        '<p><strong>' + escapeHtml(formDataObj.get('nombre') || '') + '</strong>, ' +
        'tu valoración gratuita ha quedado reservada para:</p>' +
        '<p class="booking-confirm-date">' +
        escapeHtml(formatPrettyDateTime(state.selectedIso, state.selectedSlot)) + '</p>' +
        linkHtml;
    }

    function showFormError(msg) {
      let box = els.formPanel.querySelector('[data-form-error]');
      if (!box) {
        box = document.createElement('div');
        box.className = 'booking-form-error';
        box.setAttribute('role', 'alert');
        box.setAttribute('data-form-error', '');
        els.formPanel.insertBefore(box, els.formPanel.firstChild);
      }
      box.textContent = msg;
      box.hidden = false;
    }

    function clearFormError() {
      const box = els.formPanel.querySelector('[data-form-error]');
      if (box) { box.textContent = ''; box.hidden = true; }
    }

    if (els.confirmRestart) {
      els.confirmRestart.addEventListener('click', function () {
        state.step = 'picker';
        state.selectedIso = null;
        state.selectedSlot = null;
        state.focusedIso = null;
        if (els.form) els.form.reset();
        render();
        setTimeout(function () {
          const cell = els.grid.querySelector('[tabindex="0"][data-iso]');
          if (cell) cell.focus();
        }, 80);
      });
    }

    els.prevBtn.addEventListener('click', function () {
      if (state.viewYear === today.getFullYear() && state.viewMonth === today.getMonth()) return;
      state.viewMonth -= 1;
      if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear -= 1; }
      state.focusedIso = null;
      ensureMonthLoaded(state.viewYear, state.viewMonth);
      render();
    });

    els.nextBtn.addEventListener('click', function () {
      state.viewMonth += 1;
      if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear += 1; }
      state.focusedIso = null;
      ensureMonthLoaded(state.viewYear, state.viewMonth);
      render();
    });

    ensureMonthLoaded(state.viewYear, state.viewMonth);
    render();
  });
})();
