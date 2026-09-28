// /mi-seguimiento/revision/ — asistente por pasos de la revisión mensual. El
// envío lo hace window.onbSubmitRevision, definido en revision-sesion.js.
(function() {
  const steps = document.querySelectorAll('.onb-step');
  const progress = document.getElementById('onb-progress');
  const progressFill = document.getElementById('onb-progress-fill');
  const stepCurrent = document.getElementById('onb-step-current');
  const stepTitle = document.getElementById('onb-step-title');
  const form = document.getElementById('onb-form');
  const totalSteps = 4;
  const STORAGE_KEY = 'rev-draft-v1';
  const SUBMIT_STEP = 4;
  const THANKS_STEP = 5;
  let currentStep = 0;

  function goToStep(n) {
    steps.forEach(function(s) { s.classList.remove('is-active'); });
    const target = document.querySelector('[data-step="' + n + '"]');
    if (!target) return;
    target.classList.add('is-active');
    currentStep = n;
    updateProgress(n);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateProgress(n) {
    if (n === 0 || n > totalSteps) {
      progress.hidden = true;
    } else {
      progress.hidden = false;
      stepCurrent.textContent = String(n);
      const pct = (n / totalSteps) * 100;
      progressFill.style.width = pct + '%';
      const target = document.querySelector('[data-step="' + n + '"]');
      if (target && target.dataset.title) stepTitle.textContent = target.dataset.title;
    }
  }

  function clearErrors(step) {
    step.querySelectorAll('.has-error').forEach(function(f) {
      f.classList.remove('has-error');
      f.removeAttribute('data-error');
    });
  }

  function markError(field, msg) {
    const wrapper = field.closest('.onb-field, .onb-consent');
    if (wrapper) {
      wrapper.classList.add('has-error');
      wrapper.setAttribute('data-error', msg);
    }
  }

  function validateStep(n) {
    const step = document.querySelector('[data-step="' + n + '"]');
    if (!step) return true;
    clearErrors(step);
    const required = step.querySelectorAll('[required]');
    let valid = true;
    let firstInvalid = null;
    required.forEach(function(el) {
      if (el.type === 'radio') {
        const group = step.querySelectorAll('input[name="' + el.name + '"]');
        const anyChecked = Array.from(group).some(function(r) { return r.checked; });
        if (!anyChecked) {
          valid = false;
          if (!firstInvalid) firstInvalid = el;
          markError(el, 'Elige una opción.');
        }
        return;
      }
      if (el.type === 'checkbox' && !el.checked) {
        valid = false;
        if (!firstInvalid) firstInvalid = el;
        markError(el, 'Marca esta casilla para continuar.');
        return;
      }
      if (!el.value.trim()) {
        valid = false;
        if (!firstInvalid) firstInvalid = el;
        markError(el, 'Este campo es obligatorio.');
        return;
      }
      if (el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value)) {
        valid = false;
        if (!firstInvalid) firstInvalid = el;
        markError(el, 'Revisa el formato del correo.');
      }
    });
    if (firstInvalid) {
      const scrollTarget = firstInvalid.closest('.onb-field, .onb-consent');
      if (scrollTarget) scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return valid;
  }

  function saveDraft() {
    if (!form) return;
    const data = {};
    const fd = new FormData(form);
    for (const [k, v] of fd.entries()) {
      if (data[k] !== undefined) {
        data[k] = [].concat(data[k], v);
      } else {
        data[k] = v;
      }
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
  }
  function loadDraft() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      Object.keys(data).forEach(function(name) {
        const value = data[name];
        const fields = form.querySelectorAll('[name="' + name + '"]');
        if (!fields.length) return;
        if (fields[0].type === 'radio') {
          fields.forEach(function(f) { if (f.value === value) f.checked = true; });
        } else if (fields[0].type === 'checkbox') {
          const arr = Array.isArray(value) ? value : [value];
          fields.forEach(function(f) { if (arr.indexOf(f.value) !== -1) f.checked = true; });
        } else {
          fields[0].value = value;
        }
      });
    } catch (e) {}
  }
  loadDraft();
  if (form) form.addEventListener('input', saveDraft);

  document.querySelectorAll('[data-next]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      const to = Number(btn.dataset.next);
      if (validateStep(currentStep)) goToStep(to);
    });
  });
  document.querySelectorAll('[data-prev]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      const to = Number(btn.dataset.prev);
      goToStep(to);
    });
  });

  // Submit: delega la persistencia a window.onbSubmitRevision (Supabase,
  // definido en revision-sesion.js).
  if (form) {
    const submitBtn = form.querySelector('button[type="submit"]');
    const submitLabelEl = submitBtn ? submitBtn.querySelector('.btn-label') : null;
    const originalLabel = submitLabelEl
      ? submitLabelEl.textContent
      : (submitBtn ? submitBtn.textContent : '');
    function setBtnLabel(text) {
      if (submitLabelEl) submitLabelEl.textContent = text;
      else if (submitBtn) submitBtn.textContent = text;
    }
    let submitErr = document.getElementById('onb-submit-error');
    if (!submitErr) {
      submitErr = document.createElement('p');
      submitErr.id = 'onb-submit-error';
      submitErr.className = 'onb-hint';
      submitErr.style.color = '#c0392b';
      submitErr.style.marginTop = '12px';
      submitErr.hidden = true;
      if (submitBtn && submitBtn.parentNode) {
        submitBtn.parentNode.insertBefore(submitErr, submitBtn.nextSibling);
      }
    }
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      if (!validateStep(SUBMIT_STEP)) return;
      submitErr.hidden = true; submitErr.textContent = '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('is-loading');
        setBtnLabel('Enviando…');
      }
      try {
        // Recoge todos los campos del form (incluye radios, checkboxes, textareas).
        const data = {};
        const fd = new FormData(form);
        for (const [k, v] of fd.entries()) {
          if (data[k] !== undefined) {
            data[k] = [].concat(data[k], v);
          } else {
            data[k] = v;
          }
        }
        if (typeof window.onbSubmitRevision !== 'function') {
          throw new Error('Cliente Supabase no cargado');
        }
        const result = await window.onbSubmitRevision(data);
        const firstName = (result && result.firstName) || 'tú';
        const nameSpan = document.getElementById('onb-thanks-name');
        if (nameSpan) nameSpan.textContent = firstName;
        try { localStorage.removeItem(STORAGE_KEY); } catch (err) {}
        goToStep(THANKS_STEP);
      } catch (err) {
        console.error('rev submit', err);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.classList.remove('is-loading');
          setBtnLabel(originalLabel);
        }
        submitErr.hidden = false;
        submitErr.textContent = 'No hemos podido guardar tu revisión. Refresca la página e inténtalo de nuevo, o escríbeme por WhatsApp.';
      }
    });
  }

  function openModal(id) {
    const modal = document.getElementById('modal-' + id);
    if (!modal) return;
    modal.hidden = false;
    const closeBtn = modal.querySelector('.onb-modal-close');
    if (closeBtn) closeBtn.focus();
  }
  function closeModal() {
    document.querySelectorAll('.onb-modal-backdrop').forEach(function(m) { m.hidden = true; });
  }
  document.querySelectorAll('[data-open-modal]').forEach(function(btn) {
    btn.addEventListener('click', function() { openModal(btn.dataset.openModal); });
  });
  document.querySelectorAll('[data-close-modal]').forEach(function(btn) {
    btn.addEventListener('click', closeModal);
  });
  document.querySelectorAll('.onb-modal-backdrop').forEach(function(bd) {
    bd.addEventListener('click', function(e) {
      if (e.target === bd) closeModal();
    });
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal();
  });

  function updateConditionals() {
    document.querySelectorAll('.onb-conditional').forEach(function(el) {
      const rule = el.dataset.showWhen || '';
      const parts = rule.split('=');
      if (parts.length !== 2) return;
      const name = parts[0];
      const value = parts[1];
      const input = form.querySelector('input[name="' + name + '"]:checked');
      const show = input && input.value === value;
      el.hidden = !show;
      if (!show) {
        el.querySelectorAll('input, textarea').forEach(function(f) { f.value = ''; });
      }
    });
  }
  form.querySelectorAll('input[type="radio"]').forEach(function(r) {
    r.addEventListener('change', updateConditionals);
  });
  updateConditionals();

  // Expone un salto directo a la pantalla de gracias — lo invoca el
  // script module cuando detecta que la revisión ya está enviada para
  // la próxima sesión. Evita que la paciente rellene el formulario una
  // segunda vez y genere un duplicado en `revisiones`.
  window.onbGoToThanks = function (firstName) {
    const nameSpan = document.getElementById('onb-thanks-name');
    if (nameSpan && firstName) nameSpan.textContent = firstName;
    try { localStorage.removeItem(STORAGE_KEY); } catch (err) {}
    goToStep(THANKS_STEP);
  };

  goToStep(0);
})();
