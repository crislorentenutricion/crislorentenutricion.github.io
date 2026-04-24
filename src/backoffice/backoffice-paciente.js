// Vista "Detalle de paciente" del backoffice CLN — una sola página con
// cabecera, resumen de anamnesis, timeline de eventos y botonera de comandos.
//
// Flujo:
//   1. La página lee `?id=` de la URL y llama `BoAuth.iniciar`.
//   2. BoPaciente.arrancar(supa, id) hace SELECTs en paralelo:
//      pacientes (por id), menus, sesiones, revisiones, checkins (30d).
//   3. Si no existe el paciente → mensaje en #estado-paciente.
//   4. Pinta #cabecera, #anamnesis, #timeline, #acciones con funciones puras
//      testeables desde Node.
//
// Todas las acciones del detalle son copy-command: pegar el prompt en Claude
// Code y dejar que la skill lo procese. No hay botones backend aquí — las
// Edge Functions (supabase/functions/*) siguen vivas para invocación manual
// pero la UI no las llama. El envío del menú es la cola natural de
// `/crear-menu` en Claude, así que tampoco hay botón "Enviar menú".
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
  const BoUi    = new Proxy({}, { get: (_t, prop) => _BoUi()[prop] });
  const BoLogic = new Proxy({}, { get: (_t, prop) => _BoLogic()[prop] });

  // -----------------------------------------------------------------
  // Constantes de render
  // -----------------------------------------------------------------

  // Truncado visual para campos libres (motivación, dieta_habitual, notas…).
  // No eliminamos el texto — CSS podría mostrar el completo; aquí cortamos a
  // 160 chars con "…" si excede. Simple, sin "ver más" interactivo.
  const MAX_LIBRE = 160;

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

  // Construye un <dd> con la cadena ya formateada. Si el texto supera
  // MAX_LIBRE caracteres, añade atributo title con el original y una clase
  // para poder poner "ver más" vía CSS si se desea más adelante.
  function _dd(valor) {
    const raw = _formatValor(valor);
    if (!raw) return '<dd>—</dd>';
    const { text, trunc } = _truncar(raw, MAX_LIBRE);
    if (!trunc) return '<dd>' + BoUi.escapeHtml(text) + '</dd>';
    return '<dd class="bo-anamnesis-libre" title="' + BoUi.escapeHtml(raw) +
      '">' + BoUi.escapeHtml(text) + '</dd>';
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
      // Alta pendiente: botón antes del resto (el resto apenas aplica hasta
      // que la paciente rellene anamnesis, pero no bloqueamos la UI).
      if (altaPendiente && paciente.email) {
        const cmdAlta = BoLogic.generarComando('alta-paciente', nombre);
        botones.push(_btnCopiar(cmdAlta + ' ' + paciente.email, 'Dar de alta'));
      }

      botones.push(_btnCopiar(
        BoLogic.generarComando('crear-menu', nombre),
        'Crear menú'
      ));
      botones.push(_btnCopiar(
        BoLogic.generarComando('seguimiento-paciente', nombre),
        'Hacer seguimiento'
      ));
      botones.push(_btnCopiar(
        BoLogic.generarComando('agendar', nombre),
        'Agendar sesión'
      ));

      // Reagendar solo si hay sesión futura para mover. Sin próxima sesión
      // el comando no aplica — mejor no ofrecerlo que forzar a Claude a
      // responder "no hay nada que reagendar".
      if (_proximaSesionFutura(sesiones, hoy)) {
        botones.push(_btnCopiar(
          BoLogic.generarComando('reagendar', nombre),
          'Reagendar sesión'
        ));
      }

      botones.push(_btnCopiar(
        BoLogic.generarComando('repescar-paciente', nombre),
        'Repescar paciente'
      ));
      botones.push(_btnCopiar(
        BoLogic.generarComando('cerrar-paciente', nombre),
        'Cerrar paciente'
      ));
    }

    if (cerrada) {
      botones.push(_btnCopiar(
        BoLogic.generarComando('reactivar-paciente', nombre),
        'Reactivar paciente'
      ));
    }

    // El derecho al olvido (RGPD) se puede ejercer en cualquier estado —
    // el botón aparece siempre (con cualquier nombre válido). Clase
    // destructiva (rojo outline) porque borra físicamente fila en Supabase,
    // auth.users, checkins, menús, PDFs del bucket y carpeta Drive.
    botones.push(_btnCopiar(
      BoLogic.generarComando('borrar-paciente-rgpd', nombre),
      'Borrar RGPD',
      'bo-btn-destructivo'
    ));

    return '<section class="bo-acciones" data-bo-bloque="acciones">' +
      '<h2>Acciones</h2>' +
      '<div class="bo-acciones-botones">' + botones.join('') + '</div>' +
    '</section>';
  }

  // -----------------------------------------------------------------
  // Wiring DOM: delegación de clicks + carga de datos
  // -----------------------------------------------------------------

  // Handler único: todos los botones del detalle son copy-command. El click
  // copia `data-bo-comando` al portapapeles vía BoUi.copiarComando (que ya
  // maneja toast + feedback visual en el botón).
  async function _manejarClickAccion(ev /*, supa */) {
    const btn = ev.target && ev.target.closest && ev.target.closest('[data-bo-action]');
    if (!btn) return;
    ev.preventDefault();
    const comando = btn.getAttribute('data-bo-comando');
    if (comando) await BoUi.copiarComando(comando, btn);
  }

  function conectarClickCopiar(root /*, supa */) {
    if (!root || typeof root.addEventListener !== 'function') return;
    if (root.dataset && root.dataset.boBound === '1') return;
    root.addEventListener('click', function (ev) {
      _manejarClickAccion(ev);
    });
    if (root.dataset) root.dataset.boBound = '1';
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

  // ISO 30 días atrás (para filtrar checkins recientes desde Supabase).
  function _isoHaceNDias(n, hoy) {
    const d = hoy instanceof Date ? new Date(hoy.getTime()) : new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  async function cargarDatos(supa, idPaciente) {
    const hace30 = _isoHaceNDias(30, new Date());
    const results = await Promise.all([
      supa.from('pacientes').select('id, email, nombre, estado, alta, onboarding, anamnesis, anamnesis_completed_at, created_at, closed_at, close_reason').eq('id', idPaciente).maybeSingle(),
      supa.from('menus').select('id, paciente_id, numero, vigente_desde, pdf_url, created_at').eq('paciente_id', idPaciente),
      supa.from('sesiones').select('id, paciente_id, fecha, calendar_event_id, created_at').eq('paciente_id', idPaciente),
      supa.from('revisiones').select('id, paciente_id, sesion_id, contenido, created_at').eq('paciente_id', idPaciente).order('created_at', { ascending: false }),
      supa.from('checkins').select('paciente_id, fecha, estado').eq('paciente_id', idPaciente).gte('fecha', hace30)
    ]);
    const [pac, menus, sesiones, revisiones, checkins] = results;
    const errores = results.map(r => r.error).filter(Boolean);
    if (errores.length) {
      throw new Error('Supabase: ' + errores.map(e => e.message || String(e)).join(' · '));
    }
    return {
      paciente:   pac.data || null,
      menus:      menus.data || [],
      sesiones:   sesiones.data || [],
      revisiones: revisiones.data || [],
      checkins:   checkins.data || []
    };
  }

  function _mostrarNoEncontrado() {
    const est = document.getElementById('estado-paciente');
    if (!est) return;
    est.className = 'bo-estado is-error';
    est.innerHTML = 'Paciente no encontrado. ' +
      '<a class="bo-fila-link" href="/backoffice/pacientes/">Volver a Pacientes</a>.';
    for (const id of ['cabecera', 'anamnesis', 'timeline', 'acciones']) {
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
    if (est) { est.className = 'bo-estado'; est.textContent = ''; }

    const cab = document.getElementById('cabecera');
    const ana = document.getElementById('anamnesis');
    const tim = document.getElementById('timeline');
    const acc = document.getElementById('acciones');
    if (cab) cab.innerHTML = renderCabecera(datos.paciente);
    if (ana) ana.innerHTML = renderAnamnesis(datos.paciente.anamnesis || null);
    if (tim) {
      tim.innerHTML = renderTimeline({
        menus: datos.menus, sesiones: datos.sesiones, revisiones: datos.revisiones
      });
      conectarClickPdf(tim, supa);
    }
    if (acc) {
      acc.innerHTML = renderAcciones({
        paciente: datos.paciente,
        sesiones: datos.sesiones,
        hoy:      new Date()
      });
      conectarClickCopiar(acc);
    }
  }

  // -----------------------------------------------------------------
  // API pública
  // -----------------------------------------------------------------

  const api = {
    renderCabecera,
    renderAnamnesis,
    renderTimeline,
    renderAcciones,
    arrancar,
    // Expuestas para tests (y posibles consumidores futuros del wiring).
    _manejarClickAccion: _manejarClickAccion,
    conectarClickCopiar: conectarClickCopiar
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.BoPaciente = api;
})();
