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
// Las acciones con Edge Function detrás (/repescar-paciente, /cerrar-paciente)
// se ejecutan directamente contra el backend. /crear-menu, /seguimiento-paciente,
// /agendar y /reagendar siguen en copy-command (los dos primeros porque
// requieren a Claude Code; los dos últimos porque el gesto es trivial). El
// envío del menú se hace al final de /crear-menu en Claude Code, no desde
// el backoffice — por eso no hay botón "Enviar menú" en el detalle.
//
// Si una ejecución falla (red caída o endpoint no desplegado), el botón
// fabrica fallback copy-command para que Cristina lo lance en Claude.
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

  // Para decidir si mostramos /repescar → ≥3 días sin check-in.
  const DIAS_REPESCAR = 3;

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
    const map = {
      'activo': 'Activa', 'activa': 'Activa',
      'cerrado': 'Cerrada', 'cerrada': 'Cerrada',
      'pausa': 'En pausa', 'pausado': 'En pausa', 'pausada': 'En pausa',
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
  // Dos tipos de botones en el detalle:
  //
  // 1) Copy-command (data-bo-action="copy" implícito via data-bo-comando):
  //    - /crear-menu — complejo, requiere Claude Code.
  //    - /seguimiento-paciente — ídem.
  //    - /alta-paciente — solo si la paciente está alta_pendiente (raro en
  //      detalle: lo dejamos como copy por contigüidad con Hoy/Pacientes).
  //
  // 2) Backend (data-bo-action="backend"): dispara la Edge Function directa
  //    con fallback a copy si falla. data-bo-payload lleva los campos del
  //    contrato JSON stringificados. data-bo-comando también va presente —
  //    se usa como fallback cuando el backend no responde.
  //    - /repescar-paciente: si activa y ≥3 días sin check-in.
  //    - /cerrar-paciente: siempre (marcado destructivo). Abre mini selector
  //      de motivo (objetivo_cumplido | abandono) antes de invocar.
  // -----------------------------------------------------------------

  function _btnCopiar(comando, etiqueta, extra) {
    const clase = 'bo-btn bo-btn-copiar' + (extra ? ' ' + extra : '');
    return '<button type="button" class="' + clase +
      '" data-bo-action="copy"' +
      ' data-bo-comando="' + BoUi.escapeHtml(comando) + '">' +
      BoUi.escapeHtml(etiqueta) + '</button>';
  }

  // Botón backend: el usuario hace click, confirmamos, llamamos a la Edge
  // Function. Incluye `data-bo-comando` como fallback copy si falla la red.
  // `payload` es un objeto que se serializa a JSON en el atributo data-*.
  function _btnBackend(nombreFn, etiqueta, payload, comandoFallback, extra) {
    const clase = 'bo-btn bo-btn-accion' + (extra ? ' ' + extra : '');
    const payloadAttr = BoUi.escapeHtml(JSON.stringify(payload || {}));
    const comandoAttr = BoUi.escapeHtml(comandoFallback || '');
    return '<button type="button" class="' + clase + '"' +
      ' data-bo-action="backend"' +
      ' data-bo-function="' + BoUi.escapeHtml(nombreFn) + '"' +
      ' data-bo-payload="' + payloadAttr + '"' +
      ' data-bo-comando="' + comandoAttr + '">' +
      BoUi.escapeHtml(etiqueta) + '</button>';
  }

  function _diasDesdeUltimoCheckin(checkins, hoy) {
    if (!Array.isArray(checkins) || checkins.length === 0) return Infinity;
    const hoyT = (hoy instanceof Date ? hoy : new Date()).getTime();
    let max = null;
    for (const c of checkins) {
      const t = c && c.fecha ? new Date(String(c.fecha)).getTime() : NaN;
      if (isNaN(t)) continue;
      if (max == null || t > max) max = t;
    }
    if (max == null) return Infinity;
    return Math.max(0, Math.round((hoyT - max) / 86400000));
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
    const checkins = (ctx && ctx.checkins) || [];
    const sesiones = (ctx && ctx.sesiones) || [];
    const hoy      = (ctx && ctx.hoy)      || new Date();

    const nombre = paciente.nombre || '';
    if (!nombre) {
      return '<section class="bo-acciones" data-bo-bloque="acciones">' +
        '<h2>Acciones</h2><p class="bo-vacio">Sin acciones disponibles.</p></section>';
    }

    const estado = String(paciente.estado || '').toLowerCase();
    const activa = estado === 'activo' || estado === 'activa' || estado === '';
    const altaPendiente = estado === 'alta_pendiente' ||
      (paciente.onboarding === false && !paciente.anamnesis_completed_at && !activa);

    const botones = [];

    // Siempre copy (complejas: requieren Claude Code). Etiquetas legibles
    // por acción (no "Copiar /xxx") — el comando real va en el toast tras
    // el click, así que la etiqueta describe lo que pasa cuando lo pegas
    // en Claude, no el comando en sí.
    botones.push(_btnCopiar(
      BoLogic.generarComando('crear-menu', nombre),
      'Crear menú'
    ));
    botones.push(_btnCopiar(
      BoLogic.generarComando('seguimiento-paciente', nombre),
      'Hacer seguimiento'
    ));

    // /repescar-paciente si activa y ≥3 días sin check-in → backend.
    if (activa && paciente.id) {
      const dias = _diasDesdeUltimoCheckin(checkins, hoy);
      if (dias >= DIAS_REPESCAR) {
        botones.push(_btnBackend(
          'repescar-paciente',
          'Repescar paciente',
          { paciente_id: paciente.id },
          BoLogic.generarComando('repescar-paciente', nombre)
        ));
      }
    }

    // /alta-paciente si estado = alta_pendiente — copy (edge case en detalle).
    if (altaPendiente && paciente.email) {
      const cmdBase = BoLogic.generarComando('alta-paciente', nombre);
      botones.push(_btnCopiar(cmdBase + ' ' + paciente.email, 'Dar de alta'));
    }

    // /agendar si activa → copy (requiere Claude Code: resuelve email,
    // llama a scripts/agendar_sesion.py y sincroniza Calendar + Supabase).
    // Útil para crear la primera sesión del mes o para sincronizar a
    // Supabase una cita ya existente en Calendar (idempotente).
    if (activa) {
      botones.push(_btnCopiar(
        BoLogic.generarComando('agendar', nombre),
        'Agendar sesión'
      ));
    }

    // /reagendar si hay próxima sesión futura → copy-command. La Edge
    // Function existe pero no está desplegada y el copy es trivial; un
    // input datetime-local en mini-form no aporta sobre pegar el comando
    // y dejar que Claude lo procese.
    const proxSesion = _proximaSesionFutura(sesiones, hoy);
    if (proxSesion) {
      botones.push(_btnCopiar(
        BoLogic.generarComando('reagendar', nombre),
        'Reagendar sesión'
      ));
    }

    // /cerrar-paciente — siempre backend, marcada como destructiva. El click
    // revela un mini-selector de motivo antes de invocar.
    if (paciente.id) {
      botones.push(_btnBackend(
        'cerrar-paciente',
        'Cerrar paciente',
        { paciente_id: paciente.id },
        BoLogic.generarComando('cerrar-paciente', nombre),
        'bo-btn-destructivo'
      ));
    } else {
      botones.push(_btnCopiar(
        BoLogic.generarComando('cerrar-paciente', nombre),
        'Cerrar paciente',
        'bo-btn-destructivo'
      ));
    }

    return '<section class="bo-acciones" data-bo-bloque="acciones">' +
      '<h2>Acciones</h2>' +
      '<div class="bo-acciones-botones">' + botones.join('') + '</div>' +
    '</section>';
  }

  // -----------------------------------------------------------------
  // Wiring DOM: delegación de clicks + carga de datos
  // -----------------------------------------------------------------

  // Mensajes de confirmación y éxito por función. Source-of-truth única
  // para los textos visibles tras click en una acción backend.
  const _CONFIRMS = {
    'alta-paciente':    '¿Crear alta en Supabase y borrador de bienvenida?',
    'repescar-paciente':'¿Crear borrador de repesca?',
    'cerrar-paciente':  '¿Marcar paciente como cerrado? (esta acción es destructiva)'
  };

  const _TOAST_OK = {
    'alta-paciente':    'Alta creada. Revisa el borrador de bienvenida en Gmail.',
    'repescar-paciente':'Borrador de repesca creado. Revísalo en Gmail antes de enviar.',
    'cerrar-paciente':  'Paciente cerrada. Revisa Gmail (si procede) y NOTAS.'
  };

  // Convierte el botón a modo copy (fallback): cambia data-bo-action, etiqueta
  // y texto del toast. El siguiente click copiará el comando al portapapeles.
  function _degradarAFallback(btn) {
    if (!btn) return;
    btn.setAttribute('data-bo-action', 'copy');
    const etiqueta = 'Copiar comando';
    btn.textContent = etiqueta;
    btn.disabled = false;
  }

  function _setEstadoBoton(btn, estado) {
    if (!btn) return;
    if (estado === 'enviando') {
      btn.disabled = true;
      if (!btn.dataset.boEtiquetaOriginal) {
        btn.dataset.boEtiquetaOriginal = btn.textContent;
      }
      btn.textContent = 'Enviando…';
    } else if (estado === 'reset') {
      btn.disabled = false;
      if (btn.dataset.boEtiquetaOriginal) {
        btn.textContent = btn.dataset.boEtiquetaOriginal;
        delete btn.dataset.boEtiquetaOriginal;
      }
    }
  }

  // Despliega dos botones de motivo para /cerrar-paciente antes de invocar.
  function _abrirFormCerrar(btn, payload, supa) {
    if (!btn || !btn.parentNode) return;
    if (btn.nextElementSibling && btn.nextElementSibling.classList &&
        btn.nextElementSibling.classList.contains('bo-form-cerrar')) {
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'bo-form-cerrar';
    wrap.setAttribute('data-bo-form', 'cerrar-paciente');
    wrap.innerHTML =
      '<span class="bo-form-cerrar-etiqueta">Motivo de cierre:</span>' +
      '<button type="button" class="bo-btn bo-btn-accion" data-bo-motivo="objetivo_cumplido">Objetivo cumplido</button>' +
      '<button type="button" class="bo-btn bo-btn-destructivo" data-bo-motivo="abandono">Abandono</button>' +
      '<button type="button" class="bo-btn bo-btn-secundario" data-bo-form-cancel>Cancelar</button>';
    btn.hidden = true;
    btn.parentNode.insertBefore(wrap, btn.nextSibling);

    wrap.addEventListener('click', async function (ev) {
      const cancel = ev.target && ev.target.closest && ev.target.closest('[data-bo-form-cancel]');
      if (cancel) {
        ev.preventDefault();
        wrap.remove();
        btn.hidden = false;
        return;
      }
      const motivoBtn = ev.target && ev.target.closest && ev.target.closest('[data-bo-motivo]');
      if (!motivoBtn) return;
      ev.preventDefault();
      if (!window.confirm(_CONFIRMS['cerrar-paciente'])) return;
      const motivo = motivoBtn.getAttribute('data-bo-motivo');
      Array.from(wrap.querySelectorAll('button')).forEach(b => { b.disabled = true; });
      motivoBtn.textContent = 'Enviando…';
      const full = Object.assign({}, payload, { motivo: motivo });
      const res = await BoUi.ejecutarEdgeFunction(supa, 'cerrar-paciente', full);
      if (res.ok) {
        BoUi.toast(_TOAST_OK['cerrar-paciente']);
        wrap.remove();
        btn.hidden = true;
      } else {
        BoUi.toast('No he podido ejecutar. Pulsa Copiar comando para hacerlo en Claude Code.');
        wrap.remove();
        btn.hidden = false;
        _degradarAFallback(btn);
      }
    });
  }

  // Handler principal: despacha click a copy o backend según data-bo-action.
  async function _manejarClickAccion(ev, supa) {
    const btn = ev.target && ev.target.closest && ev.target.closest('[data-bo-action]');
    if (!btn) return;
    ev.preventDefault();
    const action = btn.getAttribute('data-bo-action') || 'copy';
    if (action === 'copy') {
      const comando = btn.getAttribute('data-bo-comando');
      if (comando) await BoUi.copiarComando(comando, btn);
      return;
    }
    // action === 'backend'
    const fn = btn.getAttribute('data-bo-function');
    if (!fn) return;
    let payload = {};
    try {
      payload = JSON.parse(btn.getAttribute('data-bo-payload') || '{}');
    } catch (_) { payload = {}; }

    // Mini-form antes de invocar (cerrar-paciente pide motivo).
    if (fn === 'cerrar-paciente') {
      _abrirFormCerrar(btn, payload, supa);
      return;
    }

    // Flujo común: confirm → invoke → toast.
    const confirmMsg = _CONFIRMS[fn] || '¿Ejecutar acción?';
    if (!window.confirm(confirmMsg)) return;
    _setEstadoBoton(btn, 'enviando');
    const res = await BoUi.ejecutarEdgeFunction(supa, fn, payload);
    if (res.ok) {
      BoUi.toast(_TOAST_OK[fn] || 'Acción completada.');
      _setEstadoBoton(btn, 'reset');
      btn.disabled = true; // evita doble click tras éxito
      btn.textContent = 'Hecho';
    } else {
      BoUi.toast('No he podido ejecutar. Pulsa Copiar comando para hacerlo en Claude Code.');
      _setEstadoBoton(btn, 'reset');
      _degradarAFallback(btn);
    }
  }

  // Compat: se mantiene el nombre histórico. Acepta `supa` opcional —
  // sin él, los clicks backend también degradan a fallback copy (útil para
  // tests puros de DOM sin cliente Supabase).
  function conectarClickCopiar(root, supa) {
    if (!root || typeof root.addEventListener !== 'function') return;
    if (root.dataset && root.dataset.boBound === '1') return;
    root.addEventListener('click', function (ev) {
      _manejarClickAccion(ev, supa);
    });
    if (root.dataset) root.dataset.boBound = '1';
  }

  // PDFs del menú viven en el bucket privado `menus-pdf`. Firmamos al click
  // con createSignedUrl(path, 60, { download: filename }) y navegamos con
  // location.href — window.open tras await lo bloquea Safari (ver
  // convención mi-seguimiento-auth.md § PDF bucket + memoria
  // feedback_safari_window_open_await).
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
      supa.from('pacientes').select('id, email, nombre, estado, alta, onboarding, anamnesis, anamnesis_completed_at, created_at').eq('id', idPaciente).maybeSingle(),
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
        menus:    datos.menus,
        checkins: datos.checkins,
        sesiones: datos.sesiones,
        hoy:      new Date()
      });
      conectarClickCopiar(acc, supa);
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
