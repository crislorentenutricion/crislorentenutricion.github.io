// /mi-seguimiento/empezar/ — asistente por pasos de la anamnesis (validación,
// borrador en localStorage, resumen, modal de medidas). El envío lo hace
// window.onbSubmitAnamnesis, definido en empezar-sesion.js.
(function() {
  const steps = document.querySelectorAll('.onb-step');
  const progress = document.getElementById('onb-progress');
  const progressFill = document.getElementById('onb-progress-fill');
  const stepCurrent = document.getElementById('onb-step-current');
  const stepTitle = document.getElementById('onb-step-title');
  const form = document.getElementById('onb-form');
  const totalSteps = 7;
  const STORAGE_KEY = 'onb-draft-v1';
  let currentStep = 0;

  function goToStep(n) {
    steps.forEach(function(s) { s.classList.remove('is-active'); });
    const target = document.querySelector('[data-step="' + n + '"]');
    if (!target) return;
    target.classList.add('is-active');
    currentStep = n;
    updateProgress(n);
    if (n === 7 && typeof updateSummary === 'function') updateSummary();
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

  // Recoge el form completo como objeto (único o array si el name se repite)
  function collectFormData() {
    const data = {};
    if (!form) return data;
    const fd = new FormData(form);
    for (const [k, v] of fd.entries()) {
      if (data[k] !== undefined) {
        data[k] = [].concat(data[k], v);
      } else {
        data[k] = v;
      }
    }
    return data;
  }

  // Persistencia en localStorage (draft)
  function saveDraft() {
    if (!form) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collectFormData())); } catch (e) {}
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

  // Bind navigation
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

  // Submit: delega la persistencia a window.onbSubmitAnamnesis (Supabase,
  // definido en empezar-sesion.js).
  if (form) {
    const submitBtn = document.getElementById('onb-submit-btn');
    const submitErr = document.getElementById('onb-submit-error');
    const submitLabelEl = submitBtn ? submitBtn.querySelector('.btn-label') : null;
    const originalLabel = submitLabelEl
      ? submitLabelEl.textContent
      : (submitBtn ? submitBtn.textContent : '');
    function setBtnLabel(text) {
      if (submitLabelEl) submitLabelEl.textContent = text;
      else if (submitBtn) submitBtn.textContent = text;
    }
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      if (!validateStep(7)) return;
      if (submitErr) { submitErr.hidden = true; submitErr.textContent = ''; }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('is-loading');
        setBtnLabel('Enviando…');
      }
      try {
        const data = collectFormData();
        if (typeof window.onbSubmitAnamnesis !== 'function') {
          throw new Error('Cliente Supabase no cargado');
        }
        await window.onbSubmitAnamnesis(data);
        const nombreField = form.querySelector('[name="nombre"]');
        const firstName = nombreField && nombreField.value.trim().split(/\s+/)[0] || 'tú';
        const nameSpan = document.getElementById('onb-thanks-name');
        if (nameSpan) nameSpan.textContent = firstName;
        try { localStorage.removeItem(STORAGE_KEY); } catch (err) {}
        goToStep(8);
      } catch (err) {
        console.error('onb submit', err);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.classList.remove('is-loading');
          setBtnLabel(originalLabel);
        }
        if (submitErr) {
          submitErr.hidden = false;
          submitErr.textContent = 'No hemos podido guardar tus datos. Refresca la página e inténtalo de nuevo, o escríbeme por WhatsApp.';
        }
      }
    });
  }

  // Modal: abrir / cerrar guía visual
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

  // Campos condicionales: mostrar / ocultar según radio seleccionado
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

  // Resumen en paso 7
  const OBJETIVO_LABELS = {
    perder_grasa: 'Perder grasa',
    ganar_masa: 'Ganar masa muscular',
    'mantener_hábitos': 'Mantener peso y mejorar hábitos',
    salud: 'Mejorar un tema de salud',
    otro: 'Otro'
  };
  const ACTIVIDAD_LABELS = {
    sedentario: 'Sedentario',
    ligero: 'Ligero',
    moderado: 'Moderado',
    activo: 'Activo',
    muy_activo: 'Muy activo'
  };
  const ALIMENTACION_LABELS = {
    no: 'Sin restricciones',
    vegetariana: 'Vegetariana',
    vegana: 'Vegana',
    pescetariana: 'Pescetariana',
    otra: 'Otra'
  };
  function getRadio(name) {
    const r = form.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : '';
  }
  function getChecks(name) {
    return Array.from(form.querySelectorAll('input[name="' + name + '"]:checked')).map(function(c) { return c.value; });
  }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : ''; }
  function updateSummary() {
    const set = function(key, val) {
      const el = document.querySelector('[data-sum="' + key + '"]');
      if (el) el.textContent = val && val.length ? val : '—';
    };
    const nombre = (form.querySelector('[name="nombre"]') || {}).value || '';
    const email = (form.querySelector('[name="email"]') || {}).value || '';
    const peso = (form.querySelector('[name="peso"]') || {}).value || '';
    const altura = (form.querySelector('[name="altura"]') || {}).value || '';
    const objetivo = getRadio('objetivo');
    const objetivoOtro = (form.querySelector('[name="objetivo_otro"]') || {}).value || '';
    const numComidas = getRadio('num_comidas');
    const nivelAct = getRadio('nivel_actividad');
    const alergias = getChecks('alergias');
    const condiciones = getChecks('condiciones');
    const alim = getRadio('alimentacion_especial');
    const alimOtra = (form.querySelector('[name="alimentacion_especial_otra"]') || {}).value || '';

    set('nombre', nombre.trim());
    set('email', email.trim());
    let objLabel = OBJETIVO_LABELS[objetivo] || '';
    if (objetivo === 'otro' && objetivoOtro) objLabel += ' — ' + objetivoOtro;
    set('objetivo', objLabel);
    set('peso_altura', (peso && altura) ? (peso + ' kg · ' + altura + ' cm') : '');
    set('num_comidas', numComidas === 'varia' ? 'Varía' : numComidas);
    set('nivel_actividad', ACTIVIDAD_LABELS[nivelAct] || '');
    set('alergias', alergias.length ? alergias.map(capitalize).join(', ') : '');
    set('condiciones', condiciones.length ? condiciones.map(capitalize).join(', ') : '');
    let alimLabel = ALIMENTACION_LABELS[alim] || '';
    if (alim === 'otra' && alimOtra) alimLabel += ' — ' + alimOtra;
    set('alimentacion_especial', alimLabel);
  }

  // Contador de chips marcados por categoría
  function updateFoodCounters() {
    document.querySelectorAll('.onb-cat').forEach(function(cat) {
      const checked = cat.querySelectorAll('.onb-chip input:checked').length;
      const badge = cat.querySelector('.onb-cat-count');
      if (!badge) return;
      if (checked > 0) {
        badge.textContent = String(checked);
        badge.classList.add('has-selection');
      } else {
        badge.textContent = '';
        badge.classList.remove('has-selection');
      }
    });
  }
  document.querySelectorAll('.onb-cat .onb-chip input').forEach(function(chip) {
    chip.addEventListener('change', updateFoodCounters);
  });
  updateFoodCounters();

  // Arranca en el paso 0 (bienvenida)
  goToStep(0);
})();
