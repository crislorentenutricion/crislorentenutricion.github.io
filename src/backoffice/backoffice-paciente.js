// Vista "Detalle de paciente" del backoffice CLN — una sola página con
// cabecera, resumen de anamnesis, timeline de eventos y botonera de comandos.
//
// Flujo:
//   1. La página lee `?id=` de la URL y llama `BoAuth.iniciar`.
//   2. BoPaciente.arrancar(supa, id) hace SELECTs en paralelo:
//      pacientes (por id), menus, sesiones, revisiones, checkins (~2 años).
//   3. Si no existe el paciente → mensaje en #estado-paciente.
//   4. Pinta #cabecera, #anamnesis, #timeline, #acciones con funciones puras
//      testeables desde Node.
//
// Las acciones del detalle siguen dos vías: 8 acciones directas vía panel
// (agendar, reagendar, alta, reactivar, cerrar, repescar, registrar-pago,
// enviar-menu) invocan Edge Functions; 3 acciones copy-command "vía Claude"
// (crear-menu, seguimiento, borrar-rgpd) pegan el prompt en Claude Code y
// dejan que la skill lo procese.
//
// Funciones puras exportadas: renderCabecera, renderAnamnesis, renderTimeline,
// renderAcciones. Reciben los datos ya cargados y devuelven HTML string.

(function () {
  'use strict';

  // Resolución a call-time de las deps (logic.js/ui.js cargan después en el
  // layout). Mismo patrón que backoffice-hoy.js y backoffice-pacientes.js.
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
  const BoUi     = new Proxy({}, { get: (_t, prop) => _BoUi()[prop] });
  const BoLogic  = new Proxy({}, { get: (_t, prop) => _BoLogic()[prop] });
  const BoPaneles = new Proxy({}, { get: (_t, prop) => _BoPaneles()[prop] });

  // -----------------------------------------------------------------
  // Constantes / estado de render
  // -----------------------------------------------------------------

  // Contador de ids únicos para los <span class="bo-anamnesis-valor">.
  // Se reinicia al inicio de cada renderAnamnesis para que los ids sean
  // estables y predecibles dentro de un mismo render. _marcarDesbordados
  // (post-render) los usa como aria-controls del botón "Ver más".
  let _libreCounter = 0;

  // -----------------------------------------------------------------
  // Tabs de la ficha (slug helpers + activación)
  // -----------------------------------------------------------------

  // Slugs canónicos en orden vertical (= orden histórico de los bloques).
  // Pegar al orden visible facilita aprender muscle memory.
  const TAB_SLUGS = ['anamnesis', 'evolucion', 'adherencia', 'pagos', 'timeline'];

  // Devuelve el slug si pertenece al catálogo (case-sensitive, ASCII), o null.
  // Trim previo para tolerar URLs copiadas con espacios.
  function slugTabValido(slug) {
    if (typeof slug !== 'string') return null;
    const s = slug.trim();
    return TAB_SLUGS.indexOf(s) >= 0 ? s : null;
  }

  // Construye el querystring resultante de fijar tab=<slug> sin tocar el
  // resto. Recibe el `currentSearch` como argumento para mantenerla pura
  // (los tests no necesitan tocar window.location).
  function urlConTab(slug, currentSearch) {
    const raw = currentSearch == null ? '' : String(currentSearch);
    const norm = raw.charAt(0) === '?' ? raw.slice(1) : raw;
    const params = new URLSearchParams(norm);
    params.set('tab', slug);
    return '?' + params.toString();
  }

  // Calcula el slug vecino dado un array ordenado, el slug actual y la
  // dirección. next/prev envuelven los extremos. Si actual no está en el
  // array, devuelve el primero. Dirección desconocida → actual.
  function siguienteTab(slugs, actual, dir) {
    if (!Array.isArray(slugs) || slugs.length === 0) return actual;
    if (dir === 'first') return slugs[0];
    if (dir === 'last')  return slugs[slugs.length - 1];
    const idx = slugs.indexOf(actual);
    if (idx < 0) return slugs[0];
    if (dir === 'next') return slugs[(idx + 1) % slugs.length];
    if (dir === 'prev') return slugs[(idx - 1 + slugs.length) % slugs.length];
    return actual;
  }

  // Aplica el slug activo al DOM: aria-selected, tabindex, hidden de paneles,
  // history.replaceState con la URL nueva, y scrollIntoView del tab activo.
  // Slug inválido → no-op (defensivo, evita corrupción si llega ?tab=foo).
  function _activarTab(slug) {
    if (typeof document === 'undefined') return;
    if (!slugTabValido(slug)) return;
    const tabs = document.querySelectorAll('[role="tab"]');
    const panels = document.querySelectorAll('[role="tabpanel"]');
    let activeBtn = null;
    for (const tab of tabs) {
      const isActive = tab.dataset && tab.dataset.boTab === slug;
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.setAttribute('tabindex', isActive ? '0' : '-1');
      if (isActive) activeBtn = tab;
    }
    for (const panel of panels) {
      panel.hidden = !(panel.dataset && panel.dataset.boPanel === slug);
    }
    if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
      const search = (typeof location !== 'undefined' && location.search) || '';
      history.replaceState({}, '', urlConTab(slug, search));
    }
    if (activeBtn && typeof activeBtn.scrollIntoView === 'function') {
      activeBtn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }

  // Wiring delegado del tablist. Idempotente vía data-bo-tabs-bound. Click
  // sobre un [role="tab"] activa su pestaña; teclado en el tablist navega
  // con flechas/Home/End usando siguienteTab.
  function _conectarTabs(root) {
    if (!root || typeof root.getElementById !== 'function') return;
    const tablist = root.getElementById('tabs');
    if (!tablist) return;
    if (tablist.dataset && tablist.dataset.boTabsBound === '1') return;

    tablist.addEventListener('click', function (ev) {
      const btn = ev.target && ev.target.closest && ev.target.closest('[role="tab"]');
      if (!btn || !tablist.contains(btn)) return;
      const slug = slugTabValido(btn.dataset && btn.dataset.boTab);
      if (slug) _activarTab(slug);
    });

    tablist.addEventListener('keydown', function (ev) {
      let dir = null;
      if (ev.key === 'ArrowRight')      dir = 'next';
      else if (ev.key === 'ArrowLeft')  dir = 'prev';
      else if (ev.key === 'Home')       dir = 'first';
      else if (ev.key === 'End')        dir = 'last';
      if (!dir) return;
      const activo = tablist.querySelector('[role="tab"][aria-selected="true"]');
      const slugActual = activo && activo.dataset ? activo.dataset.boTab : TAB_SLUGS[0];
      const nuevo = siguienteTab(TAB_SLUGS, slugActual, dir);
      if (nuevo && nuevo !== slugActual) {
        _activarTab(nuevo);
        const nuevoBtn = tablist.querySelector('[data-bo-tab="' + nuevo + '"]');
        if (nuevoBtn && typeof nuevoBtn.focus === 'function') nuevoBtn.focus();
      }
      ev.preventDefault();
    });

    if (tablist.dataset) tablist.dataset.boTabsBound = '1';
  }

  // -----------------------------------------------------------------
  // Helpers de formato de anamnesis
  // -----------------------------------------------------------------

  function _esVacio(v) {
    if (v == null) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.keys(v).length === 0;
    return false;
  }

  function _truncar(s, max) {
    const str = String(s == null ? '' : s);
    if (str.length <= max) return { text: str, trunc: false };
    return { text: str.slice(0, max).trimEnd() + '…', trunc: true };
  }

  // Humaniza un enum del formulario ("perder_grasa" → "Perder grasa").
  // Reglas simples: reemplaza '_' por ' ' y capitaliza la primera letra.
  function _humanizar(valor) {
    if (valor == null) return '';
    const s = String(valor).replace(/_/g, ' ').trim();
    if (!s) return '';
    return s.charAt(0).toLocaleUpperCase('es-ES') + s.slice(1);
  }

  // Detecta valores que parecen enum del formulario (snake_case corto o
  // palabras tipo slug) para decidir si humanizar. Texto libre con espacios
  // se deja intacto para no manipular narrativas de la paciente.
  function _pareceEnum(s) {
    if (typeof s !== 'string') return false;
    const t = s.trim();
    if (!t) return false;
    // Contiene guion bajo → snake_case (p.ej. "perder_grasa", "15_30").
    if (t.indexOf('_') !== -1) return true;
    // Token único sin espacios y corto → probable enum ("alta", "moderado").
    if (!/\s/.test(t) && t.length <= 24 && /^[a-záéíóúñ]+$/i.test(t)) return true;
    return false;
  }

  function _formatValor(v) {
    if (_esVacio(v)) return '';
    if (Array.isArray(v)) {
      return v.filter(function (x) { return !_esVacio(x); })
              .map(_humanizar).join(', ');
    }
    if (typeof v === 'object') {
      // Objeto anidado poco frecuente; lo aplanamos como "clave: valor".
      return Object.keys(v).map(function (k) {
        return _humanizar(k) + ': ' + _formatValor(v[k]);
      }).filter(Boolean).join(' · ');
    }
    // String escalar: humanizar solo si parece un enum/slug ("perder_grasa",
    // "moderado"). Textos libres (motivación, dia_normal, notas) se dejan
    // intactos — no manipulamos la voz de la paciente.
    if (typeof v === 'string') return _pareceEnum(v) ? _humanizar(v) : String(v);
    return String(v);
  }

  // Construye un <dd> con el texto ya formateado, envuelto en un <span> con
  // clase + id único. CSS aplica line-clamp:3; _marcarDesbordados (post-render)
  // detecta overflow real e inyecta el botón "Ver más" como hermano del span
  // dentro del propio <dd>. Si el valor está vacío, devolvemos '<dd>—</dd>'
  // sin span — no entra en el flujo de clamp.
  function _dd(valor) {
    const raw = _formatValor(valor);
    if (!raw) return '<dd>—</dd>';
    _libreCounter += 1;
    const id = 'bo-libre-' + _libreCounter;
    return '<dd><span class="bo-anamnesis-valor" id="' + id + '">' +
      BoUi.escapeHtml(raw) + '</span></dd>';
  }

  function _par(label, valor) {
    if (_esVacio(valor)) return '';
    const formateado = _formatValor(valor);
    if (!formateado) return '';
    return '<dt>' + BoUi.escapeHtml(label) + '</dt>' + _dd(valor);
  }

  // -----------------------------------------------------------------
  // Agrupación de la anamnesis en bloques lógicos.
  // Claves esperadas (nativo /mi-seguimiento/empezar/):
  //   nombre, email, telefono, fecha_nacimiento, sexo, localidad,
  //   peso, altura, cintura, cadera, pecho, brazo, pierna,
  //   objetivo, objetivo_otro, motivacion, dietas_previas,
  //   condiciones, condiciones_otras, medicacion, embarazo, tca, otro_profesional,
  //   alergias, alergias_otras, alimentacion_especial, alimentacion_especial_otra,
  //   horario_trabajo, come_acompanada, electrodomesticos, tiempo_cocinar,
  //   presupuesto, num_comidas, come_fuera, dia_normal,
  //   no_gustan, no_gustan_otros, gustan,
  //   nivel_actividad, ejercicio, sueno, estres_come, notas_extra.
  //
  // Para pacientes legacy (Google Form) las claves pueden tener tildes/guiones;
  // tratamos ambas variantes sin discriminar. Si una clave no existe o su
  // valor está vacío, se omite silenciosamente.
  // -----------------------------------------------------------------

  const GRUPOS = [
    {
      titulo: 'Datos básicos',
      campos: [
        ['fecha_nacimiento',       'Fecha de nacimiento'],
        ['sexo',                   'Sexo'],
        ['localidad',              'Localidad'],
        ['telefono',               'Teléfono'],
        ['teléfono_whatsapp',      'Teléfono'],          // legacy
        ['peso',                   'Peso (kg)'],
        ['altura',                 'Altura (cm)'],
        ['cintura',                'Cintura (cm)'],
        ['cadera',                 'Cadera (cm)'],
        ['pecho',                  'Pecho (cm)'],
        ['brazo',                  'Brazo (cm)'],
        ['pierna',                 'Pierna (cm)']
      ]
    },
    {
      titulo: 'Objetivo',
      campos: [
        ['objetivo',               'Objetivo principal'],
        ['objetivo_otro',          'Objetivo (otro)'],
        ['motivacion',             'Motivación'],
        ['dietas_previas',         'Dietas previas']
      ]
    },
    {
      titulo: 'Alergias y patologías',
      campos: [
        ['condiciones',            'Condiciones'],
        ['condiciones_otras',      'Otras condiciones'],
        ['alergias',               'Alergias / intolerancias'],
        ['alergias_otras',         'Otras alergias'],
        ['embarazo',               'Embarazo / lactancia'],
        ['tca',                    'TCA'],
        ['otro_profesional',       'Otros profesionales']
      ]
    },
    {
      titulo: 'Medicación',
      campos: [
        ['medicacion',             'Medicación / suplementos']
      ]
    },
    {
      titulo: 'Hábitos',
      campos: [
        ['horario_trabajo',        'Horario de trabajo'],
        ['come_acompanada',        'Con quién come'],
        ['electrodomesticos',      'Electrodomésticos'],
        ['tiempo_cocinar',         'Tiempo para cocinar'],
        ['presupuesto',            'Presupuesto semanal'],
        ['num_comidas',            'Número de comidas/día'],
        ['come_fuera',             'Come fuera de casa'],
        ['dia_normal',             'Un día normal'],
        ['nivel_actividad',        'Nivel de actividad'],
        ['ejercicio',              'Ejercicio'],
        ['sueno',                  'Sueño'],
        ['estres_come',            'Estrés al comer']
      ]
    },
    {
      titulo: 'Preferencias',
      campos: [
        ['alimentacion_especial',       'Alimentación especial'],
        ['alimentacion_especial_otra',  'Alimentación (otra)'],
        ['gustan',                      'Le gustan'],
        ['no_gustan',                   'No le gustan'],
        ['no_gustan_otros',             'No le gustan (otros)']
      ]
    },
    {
      titulo: 'Notas',
      campos: [
        ['notas_extra',            'Notas extra'],
        ['notas_adicionales',      'Notas adicionales']  // legacy
      ]
    }
  ];

  // -----------------------------------------------------------------
  // Resolución de la fecha del alta para el bloque "Adherencia"
  //
  // Cascada con fallback: paciente.alta es el campo canónico desde la
  // migración 0009 (ver convenciones/clinica/paciente.md). Para pacientes
  // legacy con alta=NULL caemos a anamnesis_completed_at (timestamp ISO con
  // hora — truncamos los 10 primeros chars), y de ahí a created_at. La
  // última red de seguridad (hoy - 30 días) cubre el caso teórico de fila
  // sin ninguno de los 3 campos; ningún paciente real debería caer ahí.
  // -----------------------------------------------------------------

  function _resolverFechaAlta(paciente, hoy) {
    const p = paciente || {};
    if (typeof p.alta === 'string' && p.alta.trim()) return p.alta.slice(0, 10);
    if (typeof p.anamnesis_completed_at === 'string' && p.anamnesis_completed_at.trim()) {
      return p.anamnesis_completed_at.slice(0, 10);
    }
    if (typeof p.created_at === 'string' && p.created_at.trim()) return p.created_at.slice(0, 10);
    const d = hoy instanceof Date ? new Date(hoy.getTime()) : new Date();
    d.setDate(d.getDate() - 30);
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return yy + '-' + mm + '-' + dd;
  }

  // -----------------------------------------------------------------
  // construirHistorialCheckins — datos para el bloque "Adherencia"
  //
  // Genera un array de meses desde el mes de `hoy` hacia atrás hasta el mes
  // de `fechaAlta` (orden DESC, mes actual primero) e incluye meses sin
  // actividad como meses en blanco. Cada mes tiene `cells` con la misma
  // forma que el calendario de la PWA (lunes=0, leading + days + trailing
  // empties), y un `estado` por día tomado del Map indexado por ISO.
  //
  // Sin highlight de "hoy": en backoffice no aplica.
  //
  // Ver docs/superpowers/specs/2026-05-04-calendario-checkins-backoffice-design.md
  // -----------------------------------------------------------------

  const _MESES_LARGO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                        'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  function _cellsDeMes(year, month, checkinsMap) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    // Mon=0..Sun=6. JS getDay() devuelve Sun=0..Sat=6, por eso el +6 mod 7.
    const offset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = lastDay.getDate();
    const trailing = (7 - ((offset + daysInMonth) % 7)) % 7;
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push({ type: 'empty' });
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      const estado = checkinsMap.get(iso) || null;
      cells.push({ type: 'day', day, iso, estado });
    }
    for (let i = 0; i < trailing; i++) cells.push({ type: 'empty' });
    return cells;
  }

  function construirHistorialCheckins(checkins, fechaAlta, hoy) {
    const lista = Array.isArray(checkins) ? checkins : [];
    const checkinsMap = new Map();
    for (const c of lista) {
      if (c && c.fecha && c.estado) checkinsMap.set(String(c.fecha), c.estado);
    }

    const hoyDate = hoy instanceof Date ? hoy : new Date();
    const altaStr = String(fechaAlta || '').slice(0, 10);
    const altaParts = altaStr.split('-').map(Number);
    const altaYear = altaParts[0];
    const altaMonth = (altaParts[1] || 1) - 1;

    const meses = [];
    let y = hoyDate.getFullYear();
    let m = hoyDate.getMonth();
    // Iteramos del mes actual hacia atrás hasta el mes del alta (incl.).
    // Guardia defensiva: máximo 36 meses (3 años) para evitar bucles si los
    // datos están corruptos. Ningún paciente CLN debería superarlos.
    for (let i = 0; i < 36; i++) {
      meses.push({
        year: y,
        month: m,
        label: _MESES_LARGO[m] + ' ' + y,
        cells: _cellsDeMes(y, m, checkinsMap)
      });
      if (y === altaYear && m === altaMonth) break;
      m -= 1;
      if (m < 0) { m = 11; y -= 1; }
    }

    // Resumen agregado: cómputo sobre el rango [fechaAlta, hoy] inclusivo.
    const altaDate = new Date(altaYear, altaMonth, altaParts[2] || 1);
    altaDate.setHours(0, 0, 0, 0);
    const hoyMid = new Date(hoyDate.getFullYear(), hoyDate.getMonth(), hoyDate.getDate());

    const MS_DIA = 86400000;
    const totalDias = Math.max(0, Math.round((hoyMid.getTime() - altaDate.getTime()) / MS_DIA) + 1);

    let diasConCheckin = 0;
    if (totalDias > 0) {
      const d = new Date(altaDate.getTime());
      for (let i = 0; i < totalDias; i++) {
        const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        if (checkinsMap.has(iso)) diasConCheckin += 1;
        d.setDate(d.getDate() + 1);
      }
    }

    const adherenciaPct = totalDias > 0
      ? Math.round((diasConCheckin / totalDias) * 100)
      : null;

    // Rachas — reglas idénticas a la PWA: 'seguido' suma, 'parcial' mantiene
    // (no suma pero no rompe), 'no' o ausencia rompe.
    //
    // rachaActual: desde AYER hacia atrás. No penaliza al paciente por no
    // haber hecho aún el check-in del día en curso.
    // rachaMaxima: recorre TODO el rango [fechaAlta, hoy] (incluido hoy).
    function _siguienteRacha(estado, racha) {
      // Devuelve [nuevaRacha, rota?]
      if (estado === 'seguido') return [racha + 1, false];
      if (estado === 'parcial') return [racha, false];
      return [racha, true];  // 'no', null o undefined
    }

    let rachaActual = 0;
    if (totalDias > 0) {
      // Calendar arithmetic (setDate ±1) — coherente con el resto del fichero
      // y DST-safe sin depender de Math.round (cf. M1 review Task 4).
      const d = new Date(hoyMid.getTime());
      d.setDate(d.getDate() - 1);
      const limite = altaDate.getTime();
      while (d.getTime() >= limite) {
        const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const estado = checkinsMap.get(iso) || null;
        const [next, rota] = _siguienteRacha(estado, rachaActual);
        if (rota) break;
        rachaActual = next;
        d.setDate(d.getDate() - 1);
      }
    }

    let rachaMaxima = 0;
    if (totalDias > 0) {
      let actual = 0;
      const d = new Date(altaDate.getTime());
      for (let i = 0; i < totalDias; i++) {
        const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const estado = checkinsMap.get(iso) || null;
        const [next, rota] = _siguienteRacha(estado, actual);
        if (rota) {
          if (actual > rachaMaxima) rachaMaxima = actual;
          actual = 0;
        } else {
          actual = next;
        }
        d.setDate(d.getDate() + 1);
      }
      if (actual > rachaMaxima) rachaMaxima = actual;
    }

    return {
      meses,
      resumen: {
        diasConCheckin,
        totalDias,
        adherenciaPct,
        rachaActual,
        rachaMaxima,
        primerDia: altaStr
      }
    };
  }

  // -----------------------------------------------------------------
  // renderCheckins — pinta el bloque "Adherencia" a partir de un historial.
  //
  // Forma del DOM:
  //   <section class="bo-checkins" data-bo-bloque="checkins" data-bo-mes-idx="N">
  //     <h2>Adherencia (check-ins diarios)</h2>
  //     <p class="bo-checkins-resumen">… métricas globales …</p>
  //     <div class="bo-checkins-nav">
  //       <button data-bo-cal-dir="prev">‹</button>
  //       <h3 class="bo-checkins-mes-label">Mayo 2026</h3>
  //       <button data-bo-cal-dir="next">›</button>
  //     </div>
  //     <div class="bo-checkins-meses">
  //       <article class="bo-checkins-mes is-active" data-bo-mes="YYYY-MM">…</article>
  //       <article class="bo-checkins-mes" data-bo-mes="YYYY-MM">…</article>
  //       …  (todos los articles renderizados, CSS oculta los que no son is-active)
  //     </div>
  //     <p class="bo-checkins-leyenda">…</p>
  //   </section>
  //
  // Navegación: índice 0 = mes más reciente (default al entrar), índice
  // máximo = mes del alta. La flecha "‹" (prev) avanza hacia atrás (idx++);
  // "›" (next) avanza hacia adelante (idx--). Botones disabled en los extremos.
  //
  // Estado vacío:
  //   - historial null o meses vacíos → ''. La sección desaparece de la UI.
  //   - historial con totalDias=0 (caso degradado): el resumen muestra
  //     adherencia '—' y todas las métricas a 0; el calendario del mes
  //     activo se ve con celdas neutras. La sección sigue visible.
  // -----------------------------------------------------------------

  function _formatPctOrDash(pct) {
    return pct == null ? '—' : (pct + '%');
  }

  function _formatRacha(n) {
    return n + ' ' + (n === 1 ? 'día' : 'días');
  }

  function renderCheckins(historial, idxActivo) {
    if (!historial || !Array.isArray(historial.meses) || historial.meses.length === 0) return '';
    const numMeses = historial.meses.length;
    let idx = idxActivo == null ? 0 : Number(idxActivo);
    if (isNaN(idx) || idx < 0) idx = 0;
    if (idx > numMeses - 1) idx = numMeses - 1;

    const r = historial.resumen || {
      diasConCheckin: 0, totalDias: 0, adherenciaPct: null,
      rachaActual: 0, rachaMaxima: 0, primerDia: ''
    };

    const fechaDesde = r.primerDia ? BoUi.formatearFecha(r.primerDia) : '—';

    const resumen = '<p class="bo-checkins-resumen">' +
      'Adherencia global: <strong>' + _formatPctOrDash(r.adherenciaPct) + '</strong> · ' +
      'Días con check-in: <strong>' + r.diasConCheckin + ' / ' + r.totalDias + '</strong> · ' +
      'Racha actual: <strong>' + _formatRacha(r.rachaActual) + '</strong> · ' +
      'Racha máxima: <strong>' + _formatRacha(r.rachaMaxima) + '</strong>' +
      '<span class="bo-checkins-desde">desde el ' + BoUi.escapeHtml(fechaDesde) + '</span>' +
    '</p>';

    const mesActivo = historial.meses[idx];
    const labelActivo = BoUi.escapeHtml(mesActivo.label);
    const prevDisabled = idx >= numMeses - 1 ? ' disabled' : '';
    const nextDisabled = idx <= 0 ? ' disabled' : '';

    const nav = '<div class="bo-checkins-nav">' +
      '<button type="button" class="bo-checkins-nav-btn" data-bo-cal-dir="prev" aria-label="Mes anterior"' + prevDisabled + '>‹</button>' +
      '<h3 class="bo-checkins-mes-label">' + labelActivo + '</h3>' +
      '<button type="button" class="bo-checkins-nav-btn" data-bo-cal-dir="next" aria-label="Mes siguiente"' + nextDisabled + '>›</button>' +
    '</div>';

    const meses = historial.meses.map(function (mes, i) {
      const idMes = mes.year + '-' + String(mes.month + 1).padStart(2, '0');
      const cls = 'bo-checkins-mes' + (i === idx ? ' is-active' : '');
      const cellsHtml = mes.cells.map(function (c) {
        if (c.type === 'empty') return '<span class="bo-cal-cell is-empty"></span>';
        let estadoCls = 'bo-cal-cell';
        if (c.estado === 'seguido') estadoCls += ' is-ok';
        else if (c.estado === 'parcial') estadoCls += ' is-mid';
        else if (c.estado === 'no') estadoCls += ' is-no';
        return '<span class="' + estadoCls + '" data-iso="' + c.iso + '">' + c.day + '</span>';
      }).join('');
      return '<article class="' + cls + '" data-bo-mes="' + idMes + '">' +
        '<div class="bo-cal-weekdays" aria-hidden="true">' +
          '<span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span>' +
        '</div>' +
        '<div class="bo-cal-grid" aria-label="Check-ins de ' + BoUi.escapeHtml(mes.label) + '">' +
          cellsHtml +
        '</div>' +
      '</article>';
    }).join('');

    const leyenda = '<p class="bo-checkins-leyenda">' +
      '<span class="bo-cal-cell is-ok" aria-hidden="true"></span> Seguido' +
      '<span class="bo-cal-cell is-mid" aria-hidden="true"></span> A medias' +
      '<span class="bo-cal-cell is-no" aria-hidden="true"></span> No seguido' +
    '</p>';

    return '<section class="bo-checkins" data-bo-bloque="checkins" data-bo-mes-idx="' + idx + '">' +
      '<h2>Adherencia (check-ins diarios)</h2>' +
      resumen +
      nav +
      '<div class="bo-checkins-meses">' + meses + '</div>' +
      leyenda +
    '</section>';
  }

  // Wiring del switcher de mes: delega click en el container del bloque
  // (#checkins). Cada click en una flecha lee el idx actual del atributo
  // `data-bo-mes-idx` de la `<section>`, calcula el nuevo, y reemplaza el
  // innerHTML con un re-render. Idempotente vía data-bo-bound-checkins en
  // el container.
  function conectarSwitcherCheckins(container, historial) {
    if (!container || typeof container.addEventListener !== 'function') return;
    if (container.dataset && container.dataset.boBoundCheckins === '1') return;
    container.addEventListener('click', function (ev) {
      const btn = ev.target && ev.target.closest && ev.target.closest('[data-bo-cal-dir]');
      if (!btn || !container.contains(btn)) return;
      if (btn.disabled) return;
      const dir = btn.getAttribute('data-bo-cal-dir');
      const section = container.querySelector('.bo-checkins');
      if (!section) return;
      const idxActual = parseInt(section.getAttribute('data-bo-mes-idx') || '0', 10);
      const newIdx = dir === 'prev' ? idxActual + 1 : idxActual - 1;
      container.innerHTML = renderCheckins(historial, newIdx);
    });
    if (container.dataset) container.dataset.boBoundCheckins = '1';
  }

  // -----------------------------------------------------------------
  // renderCabecera (pura)
  // -----------------------------------------------------------------

  function _estadoLabel(estado) {
    // Modelo binario desde 0014_paciente_estados.sql: solo 'activo' | 'cerrado'.
    // Mantenemos 'alta_pendiente' como etiqueta UI (no en DB) para pacientes
    // creadas sin anamnesis, se deriva por onboarding=false y activo.
    const map = {
      'activo': 'Activa',
      'cerrado': 'Cerrada',
      'alta_pendiente': 'Alta pendiente'
    };
    const k = String(estado || '').toLowerCase();
    return map[k] || BoUi.titleCase(estado || '—');
  }

  function renderCabecera(paciente) {
    if (!paciente) return '';
    const nombre = BoUi.titleCase(paciente.nombre || '');
    const nombreH = BoUi.escapeHtml(nombre || '—');
    const estado  = _estadoLabel(paciente.estado);
    const email   = paciente.email ? BoUi.escapeHtml(paciente.email) : '—';
    const tel = paciente.anamnesis &&
      (paciente.anamnesis.telefono || paciente.anamnesis['teléfono_whatsapp']);
    const telH = tel ? BoUi.escapeHtml(String(tel)) : '—';
    const ultima = paciente.anamnesis_completed_at || paciente.created_at || paciente.alta;
    const ultimaFmt = ultima ? BoUi.formatearFecha(ultima) : '—';

    return '<header class="bo-cabecera" data-bo-bloque="cabecera">' +
      '<h1>' + nombreH + '</h1>' +
      '<dl class="bo-cabecera-meta">' +
        '<dt>Estado</dt><dd data-col="estado">' + BoUi.escapeHtml(estado) + '</dd>' +
        '<dt>Email</dt><dd data-col="email">' + email + '</dd>' +
        '<dt>Teléfono</dt><dd data-col="telefono">' + telH + '</dd>' +
        '<dt>Última actualización</dt><dd data-col="actualizada">' + BoUi.escapeHtml(ultimaFmt) + '</dd>' +
      '</dl>' +
    '</header>';
  }

  // -----------------------------------------------------------------
  // renderAnamnesis (pura)
  // -----------------------------------------------------------------

  function renderAnamnesis(anamnesis) {
    _libreCounter = 0;
    if (_esVacio(anamnesis)) {
      return '<section class="bo-anamnesis" data-bo-bloque="anamnesis">' +
        '<h2>Anamnesis</h2>' +
        '<p class="bo-vacio" data-bo-anamnesis-vacia>Anamnesis no rellena (onboarding pendiente).</p>' +
      '</section>';
    }

    const partes = GRUPOS.map(function (g) {
      const items = g.campos.map(function (c) {
        return _par(c[1], anamnesis[c[0]]);
      }).filter(Boolean).join('');
      if (!items) return '';
      return '<section class="bo-anamnesis-grupo" data-bo-grupo="' +
        BoUi.escapeHtml(g.titulo) + '">' +
        '<h3>' + BoUi.escapeHtml(g.titulo) + '</h3>' +
        '<dl>' + items + '</dl>' +
      '</section>';
    }).filter(Boolean).join('');

    // Si la anamnesis existe pero ninguna clave conocida tenía contenido, al
    // menos decimos que no hay datos reconocibles.
    const cuerpo = partes || '<p class="bo-vacio">Sin campos reconocibles en la anamnesis.</p>';

    return '<section class="bo-anamnesis" data-bo-bloque="anamnesis">' +
      '<h2>Anamnesis</h2>' +
      cuerpo +
    '</section>';
  }

  // -----------------------------------------------------------------
  // Post-render: marca campos libres que desbordan e inyecta botón
  // "Ver más / Ver menos". Idempotente: re-ejecutable tras resize sin
  // duplicar botones; respeta el estado "expandido" del usuario.
  //
  // Estrategia: el CSS aplica el clamp salvo cuando data-bo-libre es
  // "expandido". Eliminamos data-bo-libre antes de medir para limpiar
  // un posible "truncado" obsoleto: si el span ya no desborda (resize a
  // mayor ancho), el atributo se quedaría rancio. La medición es válida
  // tanto sin atributo como con "truncado" porque el clamp sigue activo.
  // -----------------------------------------------------------------

  function _marcarDesbordados(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    if (typeof document === 'undefined') return;
    const spans = root.querySelectorAll('.bo-anamnesis-valor');
    for (const span of spans) {
      const estado = span.getAttribute('data-bo-libre');
      // Política de "respeto al usuario": si ya lo abrió, no lo cerramos
      // automáticamente, ni siquiera si tras un resize el texto cabría sin
      // clamp. Trade-off conocido: queda un botón "Ver menos" colgado en un
      // span que no desbordaría — funcionalmente inocuo (clamp release =
      // "unset" da el mismo render que ausencia de clamp en texto que cabe)
      // y cuando el usuario lo cierre, _marcarDesbordados eliminará el botón
      // en la siguiente pasada al ver que ya no desborda.
      if (estado === 'expandido') continue;
      span.removeAttribute('data-bo-libre');
      const desborda = span.scrollHeight > span.clientHeight + 1;
      const dd = span.parentElement;
      if (!dd) continue;
      if (!span.id) continue; // sin id no podemos referenciarlo desde aria-controls; saltamos
      let toggle = dd.querySelector('.bo-libre-toggle');
      if (desborda) {
        span.setAttribute('data-bo-libre', 'truncado');
        if (!toggle) {
          toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'bo-libre-toggle';
          toggle.setAttribute('aria-expanded', 'false');
          toggle.setAttribute('aria-controls', span.id);
          toggle.textContent = 'Ver más';
          dd.appendChild(toggle);
        }
      } else if (toggle) {
        toggle.remove();
      }
    }
  }

  // -----------------------------------------------------------------
  // renderEvolucion (pura) — gráfico de peso + tabla de medidas a partir
  // de las revisiones (Supabase) y la fila "INICIO" derivada de la
  // anamnesis. Sustituye al `SEGUIMIENTO_[NOMBRE].xlsx` de Drive
  // (deprecado 2026-04-30, ver .aiplans/deuda-tecnica/fuente-unica-supabase.md).
  //
  // Sparkline SVG sin dependencias externas: simple polyline normalizada al
  // viewBox + puntos. Si hay <2 puntos no dibujamos línea. Si no hay peso en
  // ninguna revisión, escondemos toda la sección (no hay nada que graficar).
  // -----------------------------------------------------------------

  const SPARK_W = 280;
  const SPARK_H = 60;
  const SPARK_PAD = 6;
  const MEDIDAS = [
    ['cintura', 'Cintura'],
    ['cadera',  'Cadera'],
    ['pecho',   'Pecho'],
    ['brazo',   'Brazo'],
    ['pierna',  'Pierna']
  ];

  function _toNum(v) {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  function _delta(actual, ref) {
    if (actual == null || ref == null) return null;
    const d = Math.round((actual - ref) * 10) / 10;
    return d;
  }

  function _formatDelta(d) {
    if (d == null) return '—';
    if (d === 0) return '0';
    const signo = d > 0 ? '+' : '';
    return signo + d;
  }

  // Construye filas [{fecha, sesion, peso, cintura, cadera, ...}] orden ASC
  // (más antiguo primero). Inicio = anamnesis si tiene peso.
  function _filasEvolucion(revisiones, anamnesis, anamnesisFecha) {
    const filas = [];

    const pesoIni = anamnesis ? _toNum(anamnesis.peso) : null;
    if (pesoIni != null) {
      filas.push({
        tipo: 'inicio',
        fecha: anamnesisFecha || null,
        peso: pesoIni,
        cintura: anamnesis ? _toNum(anamnesis.cintura) : null,
        cadera:  anamnesis ? _toNum(anamnesis.cadera)  : null,
        pecho:   anamnesis ? _toNum(anamnesis.pecho)   : null,
        brazo:   anamnesis ? _toNum(anamnesis.brazo)   : null,
        pierna:  anamnesis ? _toNum(anamnesis.pierna)  : null
      });
    }

    const revOrdenadas = (revisiones || []).slice().sort(function (a, b) {
      const ta = new Date(String(a.created_at || '')).getTime();
      const tb = new Date(String(b.created_at || '')).getTime();
      if (isNaN(ta) && isNaN(tb)) return 0;
      if (isNaN(ta)) return -1;
      if (isNaN(tb)) return 1;
      return ta - tb;
    });

    revOrdenadas.forEach(function (r, i) {
      const c = r.contenido || {};
      filas.push({
        tipo: 'revision',
        fecha: r.created_at,
        sesion: i + 1,
        peso:    _toNum(c.peso),
        cintura: _toNum(c.cintura),
        cadera:  _toNum(c.cadera),
        pecho:   _toNum(c.pecho),
        brazo:   _toNum(c.brazo),
        pierna:  _toNum(c.pierna)
      });
    });

    return filas;
  }

  // Sparkline SVG del peso (orden ASC). Devuelve '' si <2 puntos con peso.
  function _sparkline(filas) {
    const puntos = filas.filter(function (f) { return f.peso != null; });
    if (puntos.length < 2) return '';

    const pesos = puntos.map(function (p) { return p.peso; });
    const minP = Math.min.apply(null, pesos);
    const maxP = Math.max.apply(null, pesos);
    const rango = maxP - minP || 1;
    const w = SPARK_W - SPARK_PAD * 2;
    const h = SPARK_H - SPARK_PAD * 2;
    const stepX = puntos.length > 1 ? w / (puntos.length - 1) : 0;

    const coords = puntos.map(function (p, i) {
      const x = SPARK_PAD + i * stepX;
      const y = SPARK_PAD + h - ((p.peso - minP) / rango) * h;
      return [x, y];
    });

    const polyline = coords.map(function (c) {
      return c[0].toFixed(1) + ',' + c[1].toFixed(1);
    }).join(' ');

    const dots = coords.map(function (c) {
      return '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) +
        '" r="2.5" class="bo-evol-dot" />';
    }).join('');

    return '<svg class="bo-evol-spark" viewBox="0 0 ' + SPARK_W + ' ' + SPARK_H +
      '" role="img" aria-label="Evolución del peso">' +
      '<polyline points="' + polyline + '" class="bo-evol-line" />' +
      dots +
    '</svg>';
  }

  function _filaTabla(f, primera) {
    const fechaTxt = f.tipo === 'inicio'
      ? (f.fecha ? BoUi.formatearFecha(f.fecha) : 'Inicio')
      : (BoUi.formatearFecha(f.fecha) || '—');
    const etiqueta = f.tipo === 'inicio' ? 'Inicio' : ('#' + f.sesion);
    // Δ vs inicio (`primera` es la primera fila con peso). Si f es la propia
    // `primera` el delta es null → "—". Resto, calcula contra el peso inicio.
    const dPeso = (f === primera) ? null : _delta(f.peso, primera.peso);

    const celdas = [
      '<td>' + BoUi.escapeHtml(fechaTxt) + '</td>',
      '<td>' + BoUi.escapeHtml(etiqueta) + '</td>',
      '<td>' + (f.peso != null ? f.peso.toFixed(1) : '—') + '</td>',
      '<td class="bo-evol-delta">' + _formatDelta(dPeso) + '</td>'
    ];

    MEDIDAS.forEach(function (m) {
      const v = f[m[0]];
      celdas.push('<td>' + (v != null ? v : '—') + '</td>');
    });

    return '<tr data-bo-fila="' + f.tipo + '">' + celdas.join('') + '</tr>';
  }

  function _resumenCabecera(filas) {
    const conPeso = filas.filter(function (f) { return f.peso != null; });
    if (conPeso.length === 0) return '';
    const ini = conPeso[0];
    const act = conPeso[conPeso.length - 1];
    const delta = _delta(act.peso, ini.peso);
    const fechaIni = ini.fecha ? BoUi.formatearFecha(ini.fecha) : '—';
    const fechaAct = act.fecha ? BoUi.formatearFecha(act.fecha) : '—';
    const partes = [
      'Inicio: <strong>' + ini.peso.toFixed(1) + ' kg</strong> · ' + BoUi.escapeHtml(fechaIni)
    ];
    if (act !== ini) {
      partes.push('Actual: <strong>' + act.peso.toFixed(1) + ' kg</strong> · ' + BoUi.escapeHtml(fechaAct));
      partes.push('Δ peso: <strong>' + _formatDelta(delta) + ' kg</strong>');
    }
    return '<p class="bo-evol-resumen">' + partes.join(' · ') + '</p>';
  }

  function renderEvolucion(revisiones, anamnesis, anamnesisFecha) {
    const filas = _filasEvolucion(revisiones, anamnesis, anamnesisFecha);
    const conPeso = filas.filter(function (f) { return f.peso != null; });
    if (conPeso.length === 0) {
      // Sin peso ni en anamnesis ni en revisiones: la sección no aporta nada.
      return '';
    }

    const cabecera = _resumenCabecera(filas);
    const spark = _sparkline(filas);
    const primera = conPeso[0];

    const cabezasMedidas = MEDIDAS.map(function (m) {
      return '<th>' + BoUi.escapeHtml(m[1]) + '</th>';
    }).join('');

    const tbody = filas.map(function (f) { return _filaTabla(f, primera); }).join('');

    return '<section class="bo-evolucion" data-bo-bloque="evolucion">' +
      '<h2>Evolución</h2>' +
      cabecera +
      (spark || '') +
      '<table class="bo-evol-tabla">' +
        '<thead><tr>' +
          '<th>Fecha</th><th>Sesión</th><th>Peso</th><th>Δ vs inicio</th>' +
          cabezasMedidas +
        '</tr></thead>' +
        '<tbody>' + tbody + '</tbody>' +
      '</table>' +
    '</section>';
  }

  // -----------------------------------------------------------------
  // renderPagos (pura) — histórico de cobros por paciente desde Supabase `pagos`
  // (migración 0019, ver convenciones/clinica/paciente.md § Pagos). Sustituye
  // al apartado "Pagos" que vivía en NOTAS Drive como texto plano.
  //
  // Incluye:
  //   - Resumen: total cobrado + último pago + nº de pagos.
  //   - Tabla DESC (más reciente arriba): fecha · concepto · importe · método · notas.
  //   - Si no hay pagos → "Sin pagos registrados todavía."
  // -----------------------------------------------------------------

  const CONCEPTO_LABEL = {
    'alta':       'Alta',
    'renovacion': 'Renovación',
    'otro':       'Otro'
  };

  function _conceptoLabel(c) {
    const k = String(c || '').toLowerCase();
    return CONCEPTO_LABEL[k] || _humanizar(c || '—');
  }

  function _fmtImporte(n) {
    if (n == null || n === '') return '—';
    const v = Number(n);
    if (isNaN(v)) return '—';
    // Formato es-ES: 40 €, 40,50 €. Sin separador de miles para importes
    // pequeños del negocio (los planes son 40 €/mes).
    const decimales = (v % 1 === 0) ? 0 : 2;
    return v.toFixed(decimales).replace('.', ',') + ' €';
  }

  // Renderiza la sección "Pagos" del detalle. Argumentos extra opcionales:
  //   paciente: { id, estado } — necesario para la línea "Próximo pago esperado".
  //   hoy:      Date            — fecha de referencia (default new Date()).
  // Si no se pasan, la línea de próximo pago se omite (compat con tests
  // antiguos y llamadas que no la quieren).
  function renderPagos(pagos, paciente, hoy) {
    const lista = Array.isArray(pagos) ? pagos.slice() : [];

    if (lista.length === 0) {
      return '<section class="bo-pagos" data-bo-bloque="pagos">' +
        '<h2>Pagos</h2>' +
        '<p class="bo-vacio">Sin pagos registrados todavía.</p>' +
      '</section>';
    }

    // Orden DESC: más reciente arriba. Empate por created_at desc.
    lista.sort(function (a, b) {
      const fa = String(a.fecha || '');
      const fb = String(b.fecha || '');
      if (fa !== fb) return fa < fb ? 1 : -1;
      const ca = String(a.created_at || '');
      const cb = String(b.created_at || '');
      return ca < cb ? 1 : (ca > cb ? -1 : 0);
    });

    const total = lista.reduce(function (acc, p) {
      const v = Number(p.importe);
      return acc + (isNaN(v) ? 0 : v);
    }, 0);

    const ultimo = lista[0];
    const fechaUlt = ultimo && ultimo.fecha ? BoUi.formatearFecha(ultimo.fecha) : '—';

    const resumen = '<p class="bo-pagos-resumen">' +
      'Total cobrado: <strong>' + _fmtImporte(total) + '</strong> · ' +
      'Último pago: <strong>' + BoUi.escapeHtml(fechaUlt) + '</strong> · ' +
      lista.length + ' ' + (lista.length === 1 ? 'pago' : 'pagos') +
    '</p>';

    // Línea "Próximo pago esperado". Solo si tenemos paciente activo y al
    // menos un pago — calcularProximoPago devuelve null para cerrados y
    // 'sin_pagos' para listas vacías (que ya hemos rechazado arriba).
    // calcularProximoPago filtra por paciente_id; en este contexto la lista
    // ya pertenece al paciente, así que la enriquecemos con paciente_id.
    let lineaProximoPago = '';
    if (paciente) {
      const pagosParaCalc = lista.map(function (p) {
        return p && p.paciente_id ? p : Object.assign({}, p, { paciente_id: paciente.id });
      });
      const r = BoLogic.calcularProximoPago(paciente, pagosParaCalc, hoy || new Date());
      if (r && r.estado !== 'sin_pagos') {
        const fechaLarga = BoUi.formatearFecha(r.fechaEsperada);
        let texto, clase = '';
        if (r.estado === 'vencido') {
          const dias = Math.abs(r.diasDiff);
          texto = '🔴 Pago vencido desde hace ' + dias + ' ' +
            (dias === 1 ? 'día' : 'días') +
            ' (esperado el ' + fechaLarga + ')';
          clase = 'bo-proximo-pago-vencido';
        } else if (r.estado === 'aviso') {
          let cuando;
          if (r.diasDiff === 0) cuando = 'hoy';
          else if (r.diasDiff === 1) cuando = 'mañana';
          else cuando = 'pasado mañana';
          texto = '🟡 Próximo pago esperado: ' + cuando + ' (' + fechaLarga + ')';
          clase = 'bo-proximo-pago-aviso';
        } else {
          // al_dia
          texto = 'Próximo pago esperado: ' + fechaLarga +
            ' (en ' + r.diasDiff + ' ' + (r.diasDiff === 1 ? 'día' : 'días') + ')';
        }
        const claseAttr = clase ? ' class="' + clase + '"' : '';
        lineaProximoPago = '<p data-bo-proximo-pago="' + r.estado + '"' + claseAttr + '>' +
          BoUi.escapeHtml(texto) + '</p>';
      }
    }

    const filas = lista.map(function (p) {
      const fecha = p.fecha ? BoUi.formatearFecha(p.fecha) : '—';
      const concepto = _conceptoLabel(p.concepto);
      const importe = _fmtImporte(p.importe);
      const metodo = p.metodo ? BoUi.escapeHtml(String(p.metodo)) : '—';
      const notas = p.notas ? BoUi.escapeHtml(String(p.notas)) : '';
      return '<tr data-bo-pago-id="' + BoUi.escapeHtml(String(p.id || '')) + '">' +
        '<td>' + BoUi.escapeHtml(fecha) + '</td>' +
        '<td>' + BoUi.escapeHtml(concepto) + '</td>' +
        '<td class="bo-pagos-importe">' + BoUi.escapeHtml(importe) + '</td>' +
        '<td>' + metodo + '</td>' +
        '<td class="bo-pagos-notas">' + notas + '</td>' +
      '</tr>';
    }).join('');

    return '<section class="bo-pagos" data-bo-bloque="pagos">' +
      '<h2>Pagos</h2>' +
      resumen +
      lineaProximoPago +
      '<table class="bo-pagos-tabla">' +
        '<thead><tr>' +
          '<th>Fecha</th><th>Concepto</th><th>Importe</th><th>Método</th><th>Notas</th>' +
        '</tr></thead>' +
        '<tbody>' + filas + '</tbody>' +
      '</table>' +
    '</section>';
  }

  // -----------------------------------------------------------------
  // renderTimeline (pura) — lista cronológica descendente mixta
  // -----------------------------------------------------------------

  // Extrae el timestamp (ms) de un evento según su tipo.
  function _tsEvento(ev) {
    if (!ev) return NaN;
    const raw = ev.fecha || ev.created_at;
    if (!raw) return NaN;
    const t = new Date(String(raw)).getTime();
    return isNaN(t) ? NaN : t;
  }

  function _resumenRevision(contenido) {
    if (_esVacio(contenido)) return '';
    // Preferimos peso si existe; si no, claves habituales del formulario de revisión.
    if (contenido.peso != null) {
      return 'Peso ' + contenido.peso + (contenido.adherencia ? ' · Adherencia ' + _humanizar(contenido.adherencia) : '');
    }
    if (contenido.adherencia) return 'Adherencia: ' + _humanizar(contenido.adherencia);
    if (contenido.notas)      return _truncar(String(contenido.notas), 80).text;
    const primera = Object.keys(contenido)[0];
    if (!primera) return '';
    return _humanizar(primera) + ': ' + _truncar(_formatValor(contenido[primera]), 80).text;
  }

  function _itemsDesde(eventos) {
    const lista = (eventos.menus || []).map(function (m) {
      return {
        tipo: 'menu',
        t: _tsEvento(m) || (m.vigente_desde ? new Date(String(m.vigente_desde)).getTime() : NaN),
        fecha: m.created_at || m.vigente_desde,
        data: m
      };
    }).concat((eventos.sesiones || []).map(function (s) {
      return { tipo: 'sesion', t: _tsEvento(s), fecha: s.fecha, data: s };
    })).concat((eventos.revisiones || []).map(function (r) {
      return { tipo: 'revision', t: _tsEvento(r), fecha: r.created_at, data: r };
    }));

    // Descartamos los que no tienen timestamp parseable (raro, pero seguro).
    return lista.filter(function (x) { return !isNaN(x.t); });
  }

  function _renderItem(item) {
    const fechaFmt = BoUi.formatearFecha(item.fecha) || '—';
    if (item.tipo === 'sesion') {
      const cal = item.data.calendar_event_id
        ? ' <span class="bo-cal-id">(' + BoUi.escapeHtml(item.data.calendar_event_id) + ')</span>'
        : '';
      return '<li class="bo-timeline-item" data-bo-evento="sesion">' +
        '<span class="bo-timeline-tipo">Sesión</span>' +
        '<span class="bo-timeline-desc">Sesión del ' + BoUi.escapeHtml(fechaFmt) + cal + '</span>' +
      '</li>';
    }
    if (item.tipo === 'menu') {
      const num = item.data.numero != null ? ('Menú ' + item.data.numero) : 'Menú';
      // pdf_url guarda la RUTA dentro del bucket privado menus-pdf (ej.
      // "<paciente_id>/menu-1.pdf"), no una URL absoluta. El href="#" +
      // data-bo-menu-path dispara createSignedUrl al click (ver
      // conectarClickPdf y convención mi-seguimiento-auth.md § PDF bucket).
      // Excepción explícita a la regla "todo en esta vista es copy-command":
      // abrir el PDF del menú es la única acción no-Claude permitida.
      const pdf = item.data.pdf_url
        ? ' · <a class="bo-fila-link" href="#" data-bo-menu-path="' +
            BoUi.escapeHtml(item.data.pdf_url) + '" data-bo-menu-filename="menu-' +
            BoUi.escapeHtml(String(item.data.numero || 'N')) + '.pdf">Ver PDF</a>'
        : '';
      return '<li class="bo-timeline-item" data-bo-evento="menu">' +
        '<span class="bo-timeline-tipo">Menú</span>' +
        '<span class="bo-timeline-desc">' + BoUi.escapeHtml(num) + ' del ' +
        BoUi.escapeHtml(fechaFmt) + pdf + '</span>' +
      '</li>';
    }
    // revision
    const resumen = _resumenRevision(item.data.contenido);
    const resumenH = resumen ? ' · ' + BoUi.escapeHtml(resumen) : '';
    return '<li class="bo-timeline-item" data-bo-evento="revision">' +
      '<span class="bo-timeline-tipo">Revisión</span>' +
      '<span class="bo-timeline-desc">Revisión del ' + BoUi.escapeHtml(fechaFmt) + resumenH + '</span>' +
    '</li>';
  }

  function renderTimeline(eventos) {
    const items = _itemsDesde(eventos || {});
    // Orden descendente por timestamp (más reciente primero).
    items.sort(function (a, b) { return b.t - a.t; });

    const cuerpo = items.length
      ? '<ol class="bo-timeline">' + items.map(_renderItem).join('') + '</ol>'
      : '<p class="bo-vacio">Sin eventos registrados todavía.</p>';

    return '<section class="bo-bloque-timeline" data-bo-bloque="timeline">' +
      '<h2>Historial</h2>' +
      cuerpo +
    '</section>';
  }

  // -----------------------------------------------------------------
  // renderAcciones (pura)
  //
  // Todas las acciones del detalle son copy-command: el click copia el prompt
  // al portapapeles para pegar en Claude Code. No hay botones backend en esta
  // vista. Visibilidad por estado del paciente:
  //
  //   activa         → Crear menú, Hacer seguimiento, Agendar sesión,
  //                    Reagendar (si hay próxima sesión), Repescar,
  //                    Cerrar paciente.
  //   cerrada        → Reactivar, Borrar RGPD (destructivo).
  //   alta_pendiente → Dar de alta (+ las de activa; normalmente no se llega
  //                    a este detalle sin onboarding, pero no bloqueamos UI).
  // -----------------------------------------------------------------

  function _btnCopiar(comando, etiqueta, extra) {
    const clase = 'bo-btn bo-btn-copiar' + (extra ? ' ' + extra : '');
    return '<button type="button" class="' + clase +
      '" data-bo-action="copy"' +
      ' data-bo-comando="' + BoUi.escapeHtml(comando) + '">' +
      BoUi.escapeHtml(etiqueta) +
      '<span class="bo-btn-via">vía Claude</span>' +
      '</button>';
  }

  function _btnDirecto(accion, etiqueta, extra) {
    const clase = 'bo-btn bo-btn-directo' + (extra ? ' ' + extra : '');
    return '<button type="button" class="' + clase +
      '" data-bo-action="panel" data-bo-panel="' + accion + '">' +
      BoUi.escapeHtml(etiqueta) + '</button>';
  }

  function _proximaSesionFutura(sesiones, hoy) {
    if (!Array.isArray(sesiones) || sesiones.length === 0) return null;
    const hoyT = (hoy instanceof Date ? hoy : new Date()).getTime();
    let mejor = null;
    for (const s of sesiones) {
      const t = s && s.fecha ? new Date(String(s.fecha)).getTime() : NaN;
      if (isNaN(t) || t < hoyT) continue;
      if (mejor == null || t < mejor.t) mejor = { t: t, sesion: s };
    }
    return mejor ? mejor.sesion : null;
  }

  function renderAcciones(ctx) {
    const paciente = (ctx && ctx.paciente) || {};
    const sesiones = (ctx && ctx.sesiones) || [];
    const menus    = (ctx && ctx.menus)    || [];
    const hoy      = (ctx && ctx.hoy)      || new Date();

    const nombre = paciente.nombre || '';
    if (!nombre) {
      return '<section class="bo-acciones" data-bo-bloque="acciones">' +
        '<h2>Acciones</h2><p class="bo-vacio">Sin acciones disponibles.</p></section>';
    }

    const estado = String(paciente.estado || '').toLowerCase();
    // Modelo binario (0014): activa si no está cerrada. '' = legacy → activa.
    const activa = estado !== 'cerrado';
    const cerrada = estado === 'cerrado';
    const altaPendiente = estado === 'alta_pendiente' ||
      (activa && paciente.onboarding === false && !paciente.anamnesis_completed_at);

    const botones = [];

    if (activa) {
      // Alta pendiente: acción directa (panel inline). El nombre/email ya
      // llegan al panel vía deps.ctxAccion().prefill — no necesitamos
      // pasarlos como argumento posicional en un copy-command.
      if (altaPendiente) {
        botones.push(_btnDirecto('alta', 'Dar de alta'));
      }

      // Copy-command: crear-menu y seguimiento-paciente van a Claude.
      botones.push(_btnCopiar(
        BoLogic.generarComando('crear-menu', nombre),
        'Crear menú'
      ));
      botones.push(_btnCopiar(
        BoLogic.generarComando('seguimiento-paciente', nombre),
        'Hacer seguimiento'
      ));

      // Enviar menú solo si algún menú tiene pdf_url.
      const menusConPdf = menus.filter(function (m) { return m && m.pdf_url; });
      if (menusConPdf.length > 0) {
        botones.push(_btnDirecto('enviar-menu', 'Enviar menú'));
      }

      // Panel directo: acciones que tienen form inline.
      botones.push(_btnDirecto('agendar', 'Agendar sesión'));

      // Reagendar solo si hay sesión futura para mover.
      if (_proximaSesionFutura(sesiones, hoy)) {
        botones.push(_btnDirecto('reagendar', 'Reagendar sesión'));
      }

      botones.push(_btnDirecto('registrar-pago', 'Registrar pago'));
      botones.push(_btnDirecto('repescar', 'Repescar paciente'));
      botones.push(_btnDirecto('cerrar', 'Cerrar paciente'));
    }

    if (cerrada) {
      botones.push(_btnDirecto('reactivar', 'Reactivar paciente'));
    }

    // El derecho al olvido (RGPD) se puede ejercer en cualquier estado —
    // copy-command porque el borrado físico lo ejecuta Claude (irreversible).
    botones.push(_btnCopiar(
      BoLogic.generarComando('borrar-paciente-rgpd', nombre),
      'Borrar RGPD',
      'bo-btn-destructivo'
    ));

    return '<section class="bo-acciones" data-bo-bloque="acciones">' +
      '<h2>Acciones</h2>' +
      '<div class="bo-acciones-botones">' + botones.join('') + '</div>' +
      '<div id="bo-panel-accion"></div>' +
    '</section>';
  }

  // -----------------------------------------------------------------
  // Wiring DOM: delegación de clicks + carga de datos
  // -----------------------------------------------------------------

  // Handler de clicks del detalle. Soporta tres tipos de acción:
  //   copy       → copia data-bo-comando al portapapeles vía BoUi.copiarComando.
  //   panel      → abre/cierra panel inline en #bo-panel-accion.
  //   cerrar-panel → cierra el panel inline.
  async function _manejarClickAccion(ev, deps) {
    const btn = ev.target && ev.target.closest && ev.target.closest('[data-bo-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-bo-action');
    if (action === 'copy') {
      ev.preventDefault();
      const comando = btn.getAttribute('data-bo-comando');
      if (comando) await BoUi.copiarComando(comando, btn);
      return;
    }
    if (action === 'panel') {
      ev.preventDefault();
      const cont = typeof document !== 'undefined' && document.getElementById('bo-panel-accion');
      if (!cont || !deps) return;
      const accion = btn.getAttribute('data-bo-panel');
      if (cont.getAttribute('data-bo-abierto') === accion) {
        cont.innerHTML = '';
        cont.removeAttribute('data-bo-abierto');
        return;
      }
      cont.innerHTML = BoPaneles.renderPanelAccion(accion, deps.ctxAccion());
      cont.setAttribute('data-bo-abierto', accion);
      BoPaneles.conectarPanel(cont, accion, deps);
      return;
    }
    if (action === 'cerrar-panel') {
      ev.preventDefault();
      const cont = typeof document !== 'undefined' && document.getElementById('bo-panel-accion');
      if (cont) { cont.innerHTML = ''; cont.removeAttribute('data-bo-abierto'); }
    }
  }

  function conectarClickCopiar(root, deps) {
    if (!root || typeof root.addEventListener !== 'function') return;
    if (root.dataset && root.dataset.boBound === '1') return;
    root.addEventListener('click', function (ev) {
      _manejarClickAccion(ev, deps);
    });
    if (root.dataset) root.dataset.boBound = '1';
  }

  // Delegación de clicks en `.bo-libre-toggle` dentro de `root`. Idempotente
  // vía data-bo-bound-libre. Cada click alterna data-bo-libre del span
  // controlado (truncado ↔ expandido), aria-expanded del botón y el texto
  // del botón ("Ver más" ↔ "Ver menos"). El span destino se localiza por
  // aria-controls; si el id no resuelve (DOM mutó), no rompemos.
  function conectarToggleLibre(root) {
    if (!root || typeof root.addEventListener !== 'function') return;
    if (root.dataset && root.dataset.boBoundLibre === '1') return;
    root.addEventListener('click', function (ev) {
      const btn = ev.target && ev.target.closest && ev.target.closest('.bo-libre-toggle');
      if (!btn || !root.contains(btn)) return;
      const id = btn.getAttribute('aria-controls');
      if (!id) return;
      const span = root.querySelector('#' + (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id));
      if (!span) return;
      const expandido = span.getAttribute('data-bo-libre') === 'expandido';
      span.setAttribute('data-bo-libre', expandido ? 'truncado' : 'expandido');
      btn.setAttribute('aria-expanded', expandido ? 'false' : 'true');
      btn.textContent = expandido ? 'Ver más' : 'Ver menos';
    });
    if (root.dataset) root.dataset.boBoundLibre = '1';
  }

  // Auto-expand al buscar (Ctrl+F): cuando el navegador resalta un match
  // dentro de un span clamped, la selección cae en zona oculta. Detectamos
  // selección con texto, miramos el ancestro `.bo-anamnesis-valor` y si está
  // truncado lo expandimos (sincronizando aria + texto del botón hermano).
  // Listener global a `document`: idempotente vía variable module-level.
  let _selectionListenerBound = false;
  function _conectarSelectionAutoExpand() {
    if (typeof document === 'undefined') return;
    if (_selectionListenerBound) return;
    _selectionListenerBound = true;
    document.addEventListener('selectionchange', function () {
      const sel = document.getSelection && document.getSelection();
      if (!sel || !String(sel).length) return;
      const node = sel.anchorNode;
      if (!node) return;
      const el = node.nodeType === 1 ? node : node.parentElement;
      if (!el || typeof el.closest !== 'function') return;
      const span = el.closest('.bo-anamnesis-valor[data-bo-libre="truncado"]');
      if (!span) return;
      span.setAttribute('data-bo-libre', 'expandido');
      const dd = span.parentElement;
      const toggle = dd && dd.querySelector('.bo-libre-toggle');
      if (toggle) {
        toggle.setAttribute('aria-expanded', 'true');
        toggle.textContent = 'Ver menos';
      }
    });
  }

  // Re-medir overflow cuando cambie el ancho del contenedor de anamnesis
  // (resize de ventana, sidebar abierto/cerrado en el futuro). Debounced
  // con requestAnimationFrame para no machacar al usuario al arrastrar.
  // _marcarDesbordados es idempotente y respeta data-bo-libre=expandido,
  // así que la re-evaluación nunca colapsa lo que el usuario abrió.
  function _observarResize(root) {
    if (!root || typeof ResizeObserver === 'undefined') return;
    if (root.dataset && root.dataset.boResizeObserved === '1') return;
    let pending = null;
    const observer = new ResizeObserver(function () {
      if (pending) return;
      const raf = (typeof requestAnimationFrame === 'function')
        ? requestAnimationFrame
        : function (cb) { return setTimeout(cb, 16); };
      pending = raf(function () {
        pending = null;
        _marcarDesbordados(root);
      });
    });
    observer.observe(root);
    if (root.dataset) root.dataset.boResizeObserved = '1';
  }

  // PDFs del menú viven en el bucket privado `menus-pdf`. Firmamos al click
  // con createSignedUrl(path, 60, { download: filename }) y navegamos con
  // location.href — window.open tras await lo bloquea Safari (ver
  // convención mi-seguimiento-auth.md § PDF bucket + memoria
  // feedback_safari_window_open_await). Es la única excepción a la regla
  // "todo en esta vista es copy-command".
  function conectarClickPdf(root, supa) {
    if (!root || typeof root.addEventListener !== 'function') return;
    if (root.dataset && root.dataset.boBoundPdf === '1') return;
    root.addEventListener('click', async function (ev) {
      const a = ev.target && ev.target.closest && ev.target.closest('[data-bo-menu-path]');
      if (!a) return;
      ev.preventDefault();
      if (!supa || !supa.storage) {
        if (BoUi && BoUi.toast) BoUi.toast('No se pudo abrir el PDF (sin sesión).');
        return;
      }
      const path = a.getAttribute('data-bo-menu-path');
      const filename = a.getAttribute('data-bo-menu-filename') || 'menu.pdf';
      try {
        const { data, error } = await supa.storage
          .from('menus-pdf')
          .createSignedUrl(path, 60, { download: filename });
        if (error || !data || !data.signedUrl) {
          if (BoUi && BoUi.toast) {
            BoUi.toast('No se pudo abrir el PDF. ' + ((error && error.message) || ''));
          }
          return;
        }
        window.location.href = data.signedUrl;
      } catch (err) {
        console.error('[backoffice/paciente] PDF', err);
        if (BoUi && BoUi.toast) BoUi.toast('No se pudo abrir el PDF.');
      }
    });
    if (root.dataset) root.dataset.boBoundPdf = '1';
  }

  // ISO N días atrás (para filtrar checkins históricos desde Supabase).
  function _isoHaceNDias(n, hoy) {
    const d = hoy instanceof Date ? new Date(hoy.getTime()) : new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  // Ventana de carga del histórico de check-ins. Cubre ~2 años con margen
  // — el filtrado fino al rango [fechaAlta, hoy] se hace en cliente dentro
  // de `construirHistorialCheckins`. Si una paciente legacy lleva más de
  // 2 años, los checkins anteriores no se muestran (caso edge aceptado).
  const DIAS_HISTORICO_CHECKINS = 730;

  async function cargarDatos(supa, idPaciente) {
    const desdeCheckins = _isoHaceNDias(DIAS_HISTORICO_CHECKINS, new Date());
    // `pagos` se separa del Promise.all por tolerancia: la tabla la añade la
    // migración 0019_pagos.sql; mientras no esté aplicada en una rama o entorno
    // dado, queremos que la página siga funcionando con el bloque "Pagos" vacío.
    const corePromises = Promise.all([
      supa.from('pacientes').select('id, email, nombre, estado, alta, onboarding, anamnesis, anamnesis_completed_at, created_at, closed_at, close_reason, ultimo_intento_repesca').eq('id', idPaciente).maybeSingle(),
      supa.from('menus').select('id, paciente_id, numero, vigente_desde, pdf_url, created_at').eq('paciente_id', idPaciente),
      supa.from('sesiones').select('id, paciente_id, fecha, calendar_event_id, created_at').eq('paciente_id', idPaciente),
      supa.from('revisiones').select('id, paciente_id, sesion_id, contenido, created_at').eq('paciente_id', idPaciente).order('created_at', { ascending: false }),
      supa.from('checkins').select('paciente_id, fecha, estado').eq('paciente_id', idPaciente).gte('fecha', desdeCheckins).order('fecha', { ascending: true })
    ]);
    const pagosPromise = supa
      .from('pagos')
      .select('id, paciente_id, fecha, importe, concepto, metodo, notas, created_at')
      .eq('paciente_id', idPaciente)
      .then(r => r, () => ({ data: [], error: null }));

    const [results, pagosRes] = await Promise.all([corePromises, pagosPromise]);
    const [pac, menus, sesiones, revisiones, checkins] = results;
    const errores = results.map(r => r.error).filter(Boolean);
    if (errores.length) {
      throw new Error('Supabase: ' + errores.map(e => e.message || String(e)).join(' · '));
    }
    // pagosRes.error se ignora: si la tabla aún no existe (404) o las RLS
    // bloquean, mostramos "Sin pagos registrados" en vez de romper la página.
    return {
      paciente:   pac.data || null,
      menus:      menus.data || [],
      sesiones:   sesiones.data || [],
      revisiones: revisiones.data || [],
      checkins:   checkins.data || [],
      pagos:      (pagosRes && pagosRes.data) || []
    };
  }

  function _mostrarNoEncontrado() {
    const est = document.getElementById('estado-paciente');
    if (!est) return;
    est.className = 'bo-estado is-error';
    est.innerHTML = 'Paciente no encontrado. ' +
      '<a class="bo-fila-link" href="/backoffice/pacientes/">Volver a Pacientes</a>.';
    for (const id of ['cabecera', 'panel-anamnesis', 'panel-evolucion', 'panel-adherencia', 'panel-pagos', 'panel-timeline', 'acciones']) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    }
  }

  function _mostrarError(msg) {
    const est = document.getElementById('estado-paciente');
    if (!est) return;
    est.className = 'bo-estado is-error';
    est.textContent = 'No se pudieron cargar los datos: ' + msg;
  }

  async function arrancar(supa, idPaciente) {
    if (typeof document === 'undefined') return;
    const est = document.getElementById('estado-paciente');
    if (est) {
      est.className = 'bo-estado';
      est.textContent = 'Cargando paciente…';
    }

    // Variables de closure para recargar y ctxAccion.
    let paciente, sesiones, menus, pagos;

    async function cargar() {
      let datos;
      try {
        datos = await cargarDatos(supa, idPaciente);
      } catch (err) {
        console.error('[backoffice/paciente]', err);
        _mostrarError(err.message || 'error');
        return;
      }
      if (!datos.paciente) {
        _mostrarNoEncontrado();
        return;
      }
      // Actualizar closure variables para ctxAccion.
      paciente = datos.paciente;
      sesiones = datos.sesiones;
      menus    = datos.menus;
      pagos    = datos.pagos;

      if (est) { est.className = 'bo-estado'; est.textContent = ''; }

      const cab = document.getElementById('cabecera');
      const ana = document.getElementById('panel-anamnesis');
      const evo = document.getElementById('panel-evolucion');
      const chk = document.getElementById('panel-adherencia');
      const pag = document.getElementById('panel-pagos');
      const tim = document.getElementById('panel-timeline');
      const acc = document.getElementById('acciones');
      if (cab) cab.innerHTML = renderCabecera(paciente);
      _conectarSelectionAutoExpand();
      if (ana) {
        ana.innerHTML = renderAnamnesis(paciente.anamnesis || null);
        _marcarDesbordados(ana);
        conectarToggleLibre(ana);
        _observarResize(ana);
      }
      if (evo) {
        evo.innerHTML = renderEvolucion(
          datos.revisiones,
          paciente.anamnesis || null,
          paciente.anamnesis_completed_at || paciente.alta || null
        );
      }
      if (chk) {
        const fechaAlta = _resolverFechaAlta(paciente, new Date());
        const historial = construirHistorialCheckins(datos.checkins || [], fechaAlta, new Date());
        chk.innerHTML = renderCheckins(historial);
        conectarSwitcherCheckins(chk, historial);
      }
      if (pag) pag.innerHTML = renderPagos(pagos || [], paciente, new Date());
      if (tim) {
        tim.innerHTML = renderTimeline({
          menus: menus, sesiones: sesiones, revisiones: datos.revisiones
        });
        conectarClickPdf(tim, supa);
      }
      if (acc) {
        acc.innerHTML = renderAcciones({
          paciente: paciente,
          sesiones: sesiones,
          menus:    menus,
          hoy:      new Date()
        });
        conectarClickCopiar(acc, deps);
      }

      // Wiring de pestañas: delegación + activación inicial. Idempotente.
      _conectarTabs(document);
      const params = new URLSearchParams((typeof location !== 'undefined' && location.search) || '');
      const slugInicial = slugTabValido(params.get('tab')) || TAB_SLUGS[0];
      _activarTab(slugInicial);
    }

    const deps = {
      supa: supa,
      recargar: cargar,
      ctxAccion: function () {
        return {
          pacienteId: paciente && paciente.id,
          nombre:     paciente && paciente.nombre,
          email:      paciente && paciente.email,
          prefill: {
            nombre: paciente && paciente.nombre,
            email:  paciente && paciente.email
          },
          sesionesFuturas: (sesiones || []).filter(function (s) {
            return s && s.fecha && new Date(String(s.fecha)) > new Date();
          }),
          menus:               menus || [],
          pagosPrevios:        (pagos || []).length,
          ultimoIntentoRepesca: paciente && paciente.ultimo_intento_repesca || null
        };
      }
    };

    await cargar();
  }

  // -----------------------------------------------------------------
  // API pública
  // -----------------------------------------------------------------

  const api = {
    renderCabecera,
    renderAnamnesis,
    renderEvolucion,
    renderPagos,
    renderTimeline,
    renderAcciones,
    arrancar,
    // Expuestas para tests (y posibles consumidores futuros del wiring).
    _manejarClickAccion: _manejarClickAccion,
    _marcarDesbordados: _marcarDesbordados,
    conectarClickCopiar: conectarClickCopiar,
    conectarToggleLibre: conectarToggleLibre,
    _conectarSelectionAutoExpand: _conectarSelectionAutoExpand,
    _observarResize: _observarResize,
    _resolverFechaAlta: _resolverFechaAlta,
    construirHistorialCheckins: construirHistorialCheckins,
    renderCheckins: renderCheckins,
    conectarSwitcherCheckins: conectarSwitcherCheckins,
    // Tabs de la ficha
    _TAB_SLUGS: TAB_SLUGS,
    slugTabValido: slugTabValido,
    urlConTab: urlConTab,
    siguienteTab: siguienteTab,
    _activarTab: _activarTab,
    _conectarTabs: _conectarTabs
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.BoPaciente = api;
})();
