// Lógica pura del backoffice CLN — aislada de DOM y Supabase.
// Recibe datos ya cargados (arrays de pacientes, menus, sesiones, checkins) y
// devuelve estructuras para renderizar. Sin I/O, sin fetch, sin DOM.
//
// Navegador: `<script src="/backoffice/logic.js">` expone `window.BoLogic`.
// Node tests: `require('./logic.js')` devuelve la misma API.
//
// Convenciones de datos (esquema Supabase, ver supabase/migrations/*):
//   pacientes:    { id, email, nombre (MAYÚSCULAS), estado ('activo'|'cerrado'), alta, closed_at, close_reason }
//   Estado binario estricto desde 0014_paciente_estados.sql — sin 'pausa' ni variantes.
//   menus:        { id, paciente_id, numero, vigente_desde (date YYYY-MM-DD), pdf_url }
//   sesiones:     { id, paciente_id, fecha (timestamptz ISO), calendar_event_id }
//   checkins:     { paciente_id, fecha (date YYYY-MM-DD), estado }
//   valoraciones: { id, nombre, email, telefono, fecha (timestamptz), calendar_event_id,
//                   status ('confirmed'|'cancelled'|'no_show'|'converted') } — primeras
//   consultas (prospectos pre-pago, ver 0016_valoraciones.sql).
//
// Vigencia del menú: el schema solo tiene `vigente_desde`. El menú CLN es
// mensual (ver convenciones/clinica/plan-nutricional.md), así que asumimos
// 30 días de vigencia. Parametrizable vía `opts.vigenciaDias` por si cambia.
(function () {
  'use strict';

  const VIGENCIA_DIAS_DEFAULT = 30;
  const DIAS_SIN_CHECKIN_ALERTA = 3;
  const DIAS_AVISO_PROXIMO_MENU = 7;
  // Ventana del bloque "Próximos 7 días": de mañana (+1) hasta +7 inclusive.
  // Hoy queda fuera porque ya lo cubre el bloque "Sesiones hoy" — duplicar
  // sería ruido.
  const DIAS_VENTANA_PROXIMOS = 7;
  // Duración del slot de primera consulta (valoración gratuita). Pasado este
  // tiempo desde el inicio, la fila migra de "Sesiones hoy" a "Pendientes de
  // resolver" con botones [Dar de alta] [Descartar].
  const DURACION_VALORACION_MIN = 30;

  // Etiquetas es-ES con tildes. Usamos arrays propios en lugar de
  // toLocaleDateString('es-ES') para que el output sea determinista en
  // Node sin ICU completo y entre runners.
  const _DIAS_SEMANA_ABREV = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const _MESES_ABREV       = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                              'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function _capFirst(s) {
    if (!s) return '';
    return s.charAt(0).toLocaleUpperCase('es-ES') + s.slice(1);
  }
  // Etiqueta de día relativa al día actual:
  //   diff=0 → 'Hoy', diff=1 → 'Mañana', diff=-1 → 'Ayer',
  //   resto → 'Vie 24 abr' (día semana abreviado + día + mes abreviado).
  // Cobertura simétrica futuro/pasado para reutilizar la misma función desde
  // los bloques "Próximos 7 días" (diff>=1) y "Pendientes de resolver" (diff<=0).
  // El nombre del día va en Title Case para el copy visible.
  function _diaLabel(fechaMid, hoyMid) {
    const diff = diffEnDias(hoyMid, fechaMid);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Mañana';
    if (diff === -1) return 'Ayer';
    const dia = _capFirst(_DIAS_SEMANA_ABREV[fechaMid.getDay()]);
    const num = fechaMid.getDate();
    const mes = _MESES_ABREV[fechaMid.getMonth()];
    return dia + ' ' + num + ' ' + mes;
  }

  // -----------------------------------------------------------------
  // Helpers de fecha (privados, no exportados salvo diffEnDias)
  // -----------------------------------------------------------------

  function _pad2(n) { return String(n).padStart(2, '0'); }

  // Normaliza cualquier entrada (Date | string 'YYYY-MM-DD' | timestamptz) a
  // Date a medianoche local. Devuelve null si no parsea.
  function _toMidnight(input) {
    if (input == null) return null;
    const d = input instanceof Date ? new Date(input.getTime()) : new Date(String(input));
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function _toISO(d) {
    return d.getFullYear() + '-' + _pad2(d.getMonth() + 1) + '-' + _pad2(d.getDate());
  }

  // Diferencia en días civiles entre dos fechas (b - a). Positivo si b es
  // posterior. Redondea al día más cercano para ser robusto a DST.
  function diffEnDias(a, b) {
    const da = _toMidnight(a);
    const db = _toMidnight(b);
    if (!da || !db) return NaN;
    return Math.round((db.getTime() - da.getTime()) / 86400000);
  }

  // -----------------------------------------------------------------
  // Normalización de nombres para el comando /skill
  // -----------------------------------------------------------------

  // Skills actuales (ver .claude/skills/*/SKILL.md) aceptan el nombre como
  // argumento libre tras el identificador: `/alta-paciente NOMBRE APELLIDO`.
  // No esperan comillas. Convención CLN: nombre interno en MAYÚSCULAS,
  // preservando tildes, ñ y apóstrofes (p.ej. "MARÍA JOSÉ D'AMBROSIO").
  //
  // Reglas:
  //   - trim + colapsar espacios dobles
  //   - toLocaleUpperCase('es-ES') para mantener tildes correctamente
  //   - no quitar apóstrofes (forman parte de apellidos reales)
  //   - quitar caracteres de control y comillas envolventes
  function _normalizarNombre(nombre) {
    if (nombre == null) return '';
    let s = String(nombre).trim();
    // Quitar comillas envolventes si las trae (defensivo).
    s = s.replace(/^["'“”‘’](.*)["'“”‘’]$/s, '$1').trim();
    // Colapsar espacios internos.
    s = s.replace(/\s+/g, ' ');
    // MAYÚSCULAS con locale es-ES (preserva tildes y ñ).
    s = s.toLocaleUpperCase('es-ES');
    return s;
  }

  // Lista de skills válidas (duplicamos aquí el catálogo para no depender de
  // filesystem en el navegador). El test de sanity parsea .claude/skills/ y
  // valida que este set esté alineado con el disco.
  const SKILLS_VALIDAS = new Set([
    'agendar',
    'alta-paciente',
    'amplitude-overview',
    'borrar-paciente-rgpd',
    'cerrar-paciente',
    'crear-imagen',
    'crear-menu',
    'crear-video',
    'enviar-menu',
    'publicar-instagram',
    'publicar-post',
    'reactivar-paciente',
    'reagendar',
    'registrar-pago',
    'repescar-paciente',
    'retrospectiva',
    'seguimiento-paciente',
    'setup',
    'sincronizar-resenas'
  ]);

  function generarComando(skill, nombrePaciente) {
    const s = String(skill || '').trim().replace(/^\/+/, '');
    if (!SKILLS_VALIDAS.has(s)) {
      throw new Error('skill desconocida: ' + s);
    }
    const nombre = _normalizarNombre(nombrePaciente);
    if (!nombre) {
      throw new Error('nombrePaciente vacío para skill ' + s);
    }
    return '/' + s + ' ' + nombre;
  }

  // Comando especial para el bloque "Pendientes de resolver": la skill
  // /alta-paciente recoge nombre + email del mensaje (ver SKILL.md), así que
  // emitimos el prompt directamente con ambos datos para que Cristina solo
  // tenga que pegar y pulsar Enter. Email en minúsculas y trim.
  function _comandoAltaConEmail(nombrePaciente, email) {
    const nombre = _normalizarNombre(nombrePaciente);
    const e = String(email == null ? '' : email).trim().toLowerCase();
    if (!nombre || !e) return '';
    return '/alta-paciente ' + nombre + ' ' + e;
  }

  // -----------------------------------------------------------------
  // Indexadores: agrupan listas por paciente_id para O(1) lookups
  // -----------------------------------------------------------------

  function _indexBy(arr, key) {
    const map = new Map();
    if (!Array.isArray(arr)) return map;
    for (const item of arr) {
      const k = item && item[key];
      if (k == null) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    }
    return map;
  }

  // Menú vigente: el de `vigente_desde` más reciente ≤ hoy. Si no hay ninguno
  // con `vigente_desde` ≤ hoy, devolvemos null (paciente nueva sin menú aún).
  function _menuVigente(menusPaciente, hoyMid) {
    if (!Array.isArray(menusPaciente) || menusPaciente.length === 0) return null;
    let candidato = null;
    let candidatoDate = null;
    for (const m of menusPaciente) {
      const d = _toMidnight(m.vigente_desde);
      if (!d || d.getTime() > hoyMid.getTime()) continue;
      if (!candidatoDate || d.getTime() > candidatoDate.getTime()) {
        candidato = m;
        candidatoDate = d;
      }
    }
    return candidato;
  }

  // Última fecha de checkin del paciente. Devuelve Date midnight local o null.
  function _ultimoCheckin(checkinsPaciente) {
    if (!Array.isArray(checkinsPaciente) || checkinsPaciente.length === 0) return null;
    let max = null;
    for (const c of checkinsPaciente) {
      const d = _toMidnight(c.fecha);
      if (!d) continue;
      if (!max || d.getTime() > max.getTime()) max = d;
    }
    return max;
  }

  // Próxima sesión futura (o del día de hoy) para un paciente. Devuelve la
  // sesión con `fecha` más cercana ≥ hoy. Null si no hay.
  function _proximaSesion(sesionesPaciente, hoyMid) {
    if (!Array.isArray(sesionesPaciente) || sesionesPaciente.length === 0) return null;
    let mejor = null;
    let mejorTime = null;
    for (const s of sesionesPaciente) {
      const d = _toMidnight(s.fecha);
      if (!d) continue;
      if (d.getTime() < hoyMid.getTime()) continue;
      if (mejorTime == null || d.getTime() < mejorTime) {
        mejor = s;
        mejorTime = d.getTime();
      }
    }
    return mejor;
  }

  // -----------------------------------------------------------------
  // Formateo de hora para el bloque "sesiones hoy"
  // -----------------------------------------------------------------

  function _horaSesion(fecha) {
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (isNaN(d.getTime())) return '';
    return _pad2(d.getHours()) + ':' + _pad2(d.getMinutes());
  }

  // -----------------------------------------------------------------
  // Predicados de los 4 bloques
  // -----------------------------------------------------------------

  // Sesiones que caen en la fecha civil de `hoy`. Excluye pacientes cerrados
  // (si hay inconsistencia de datos, no mostramos al paciente cerrado —
  // Cristina no debería contactarlo; decisión 2026-04-22).
  // Estado binario desde 2026-04-24: solo 'activo' o 'cerrado' (ver 0014).
  function _esSesionHoy(sesion, hoyMid) {
    const d = _toMidnight(sesion.fecha);
    return !!d && d.getTime() === hoyMid.getTime();
  }

  // Menú próximo a caducar o ya caducado: `vigente_desde + vigenciaDias - hoy`
  // ≤ DIAS_AVISO_PROXIMO_MENU. Si no hay menú vigente y la paciente está
  // activa → también entra en "crear semana" (onboarding o primera renovación).
  function _necesitaMenuNuevo(menuVig, hoyMid, vigenciaDias) {
    if (!menuVig) return true; // sin menú vigente → hay que crear
    const d = _toMidnight(menuVig.vigente_desde);
    if (!d) return true;
    const diasRestantes = vigenciaDias - diffEnDias(d, hoyMid);
    return diasRestantes <= DIAS_AVISO_PROXIMO_MENU;
  }

  // Alerta por silencio: paciente activa sin checkins en ≥ N días.
  // Si nunca ha hecho check-in (onboarding), miramos `alta` como fallback.
  function _diasDesdeUltimoCheckin(ultimo, paciente, hoyMid) {
    if (ultimo) return diffEnDias(ultimo, hoyMid);
    const alta = _toMidnight(paciente.alta);
    if (!alta) return Infinity;
    return diffEnDias(alta, hoyMid);
  }

  // -----------------------------------------------------------------
  // sesionesProximos7Dias — bloque de agenda de los próximos 7 días
  // -----------------------------------------------------------------
  //
  // Ventana: mañana (+1) hasta +7 inclusive. Hoy queda fuera porque ya lo
  // cubre el bloque "Sesiones hoy". Excluye pacientes cerradas (mismo
  // criterio que `sesionesHoy`: si están cerradas, no debería contactarlas
  // aunque haya un evento residual en Calendar/Supabase).
  //
  // Mezcla dos fuentes:
  //   - `sesiones` (seguimiento mensual de pacientes activas) → tipo='seguimiento'
  //   - `valoraciones` con status='confirmed' (primera consulta de prospectos)
  //     → tipo='valoracion'
  //
  // Devuelve items para renderizar:
  //   { pacienteId, nombre, fechaISO, hora, diaLabel, comando, tipo }
  // Las valoraciones llevan pacienteId=null (aún no son pacientes) y comando=''
  // (la skill /reagendar las mueve solo en Calendar; la fila no expone botón
  // copy en esta vista).
  // Orden: ascendente por timestamp completo. Mismo día → orden por hora.
  function sesionesProximos7Dias(datos, hoy) {
    const pacientes    = (datos && datos.pacientes)    || [];
    const sesiones     = (datos && datos.sesiones)     || [];
    const valoraciones = (datos && datos.valoraciones) || [];
    const opts         = (datos && datos.opts)         || {};
    const ventana      = opts.ventanaProximos || DIAS_VENTANA_PROXIMOS;

    const hoyMid = _toMidnight(hoy) || _toMidnight(new Date());
    const pacienteById = new Map();
    for (const p of pacientes) {
      if (!p || p.id == null) continue;
      pacienteById.set(p.id, p);
    }

    const items = [];

    // Seguimientos: solo pacientes activas con sesiones en la ventana.
    for (const s of sesiones) {
      const fechaMid = _toMidnight(s.fecha);
      if (!fechaMid) continue;
      const diff = diffEnDias(hoyMid, fechaMid);
      if (diff < 1 || diff > ventana) continue;
      const p = pacienteById.get(s.paciente_id);
      if (!p) continue;
      // Excluir cerradas — coherente con el resto de la vista Hoy.
      if (p.estado === 'cerrado') continue;
      const fechaCompleta = new Date(s.fecha);
      items.push({
        pacienteId: p.id,
        nombre: p.nombre,
        fechaISO: _toISO(fechaMid),
        hora: _horaSesion(fechaCompleta),
        diaLabel: _diaLabel(fechaMid, hoyMid),
        comando: generarComando('seguimiento-paciente', p.nombre),
        tipo: 'seguimiento',
        _ts: fechaCompleta.getTime()
      });
    }

    // Valoraciones (primera consulta): solo confirmed en la ventana.
    for (const v of valoraciones) {
      if (!v || v.status !== 'confirmed') continue;
      const fechaMid = _toMidnight(v.fecha);
      if (!fechaMid) continue;
      const diff = diffEnDias(hoyMid, fechaMid);
      if (diff < 1 || diff > ventana) continue;
      const fechaCompleta = new Date(v.fecha);
      items.push({
        pacienteId: null,
        nombre: v.nombre || '',
        fechaISO: _toISO(fechaMid),
        hora: _horaSesion(fechaCompleta),
        diaLabel: _diaLabel(fechaMid, hoyMid),
        comando: '',
        tipo: 'valoracion',
        _ts: fechaCompleta.getTime()
      });
    }

    items.sort(function (a, b) {
      if (a._ts !== b._ts) return a._ts - b._ts;
      return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');
    });
    // _ts es interno para el sort; no se filtra para no romper consumidores
    // que ya reciben el objeto completo, pero documentamos que es privado.
    return items.map(function (it) {
      return {
        pacienteId: it.pacienteId,
        nombre: it.nombre,
        fechaISO: it.fechaISO,
        hora: it.hora,
        diaLabel: it.diaLabel,
        comando: it.comando,
        tipo: it.tipo
      };
    });
  }

  // -----------------------------------------------------------------
  // agruparHoy — motor principal de la vista "Hoy"
  // -----------------------------------------------------------------

  function agruparHoy(datos, hoy) {
    const pacientes    = (datos && datos.pacientes)    || [];
    const menus        = (datos && datos.menus)        || [];
    const sesiones     = (datos && datos.sesiones)     || [];
    const checkins     = (datos && datos.checkins)     || [];
    const valoraciones = (datos && datos.valoraciones) || [];
    const opts         = (datos && datos.opts)         || {};
    const vigenciaDias  = opts.vigenciaDias || VIGENCIA_DIAS_DEFAULT;
    const diasSilencio  = opts.diasSilencio || DIAS_SIN_CHECKIN_ALERTA;

    const hoyMid = _toMidnight(hoy) || _toMidnight(new Date());
    const menusByPac    = _indexBy(menus, 'paciente_id');
    const sesionesByPac = _indexBy(sesiones, 'paciente_id');
    const checkinsByPac = _indexBy(checkins, 'paciente_id');

    const sesionesHoy = [];
    const menusCrearSemana = [];
    const alertas = [];

    for (const p of pacientes) {
      const activa = p.estado !== 'cerrado';
      const misMenus    = menusByPac.get(p.id) || [];
      const misSesiones = sesionesByPac.get(p.id) || [];
      const misCheckins = checkinsByPac.get(p.id) || [];
      const menuVig = _menuVigente(misMenus, hoyMid);

      // Bloque 1: sesiones de hoy. Solo pacientes activas.
      if (activa) {
        for (const s of misSesiones) {
          if (_esSesionHoy(s, hoyMid)) {
            sesionesHoy.push({
              pacienteId: p.id,
              nombre: p.nombre,
              hora: _horaSesion(s.fecha),
              comando: generarComando('seguimiento-paciente', p.nombre),
              tipo: 'seguimiento',
              _ts: new Date(s.fecha).getTime()
            });
          }
        }
      }

      // Bloque 2: menús a crear esta semana. Solo activas.
      // `anamnesisLista` decide si el bloque ofrece botón "Crear menú con
      // Claude" (anamnesis rellena → se puede crear) o un aviso "Anamnesis
      // pendiente" (no rellena → bloquea, hay que esperar al onboarding de
      // la paciente). Fuente de verdad: `anamnesis_completed_at` (timestamp
      // que se setea cuando la paciente envía el formulario). Si la columna
      // no se cargó (caller antiguo), asumimos rellena para no bloquear UX.
      if (activa && _necesitaMenuNuevo(menuVig, hoyMid, vigenciaDias)) {
        const anamnesisLista = p.anamnesis_completed_at == null
          ? false
          : true;
        menusCrearSemana.push({
          pacienteId: p.id,
          nombre: p.nombre,
          vigenteDesde: menuVig ? menuVig.vigente_desde : null,
          diasParaCaducar: menuVig
            ? vigenciaDias - diffEnDias(_toMidnight(menuVig.vigente_desde), hoyMid)
            : null,
          anamnesisLista: anamnesisLista,
          comando: generarComando('crear-menu', p.nombre)
        });
      }

      // Bloque 3: alertas por silencio. Solo activas.
      if (activa) {
        const ultimo = _ultimoCheckin(misCheckins);
        const dias = _diasDesdeUltimoCheckin(ultimo, p, hoyMid);
        if (dias >= diasSilencio) {
          alertas.push({
            pacienteId: p.id,
            nombre: p.nombre,
            diasSinCheckin: dias === Infinity ? null : dias,
            ultimoCheckin: ultimo ? _toISO(ultimo) : null,
            comando: generarComando('repescar-paciente', p.nombre)
          });
        }
      }
    }

    // Bloque 1bis + Pendientes: las valoraciones (primera consulta, prospectos
    // pre-pago) se reparten en dos buckets según si su slot ya terminó:
    //
    //   - Slot vigente (now < fecha + 30min) y ES de hoy → `sesionesHoy` con
    //     badge azul "Primera consulta", sin botones (igual que antes).
    //   - Slot pasado (now >= fecha + 30min) y SIN resolver → `pendientes`
    //     con botones [Dar de alta] (copy /alta-paciente) y [Descartar]
    //     (acción directa con confirm). Persiste hasta que Cristina actúe;
    //     no se autopurga al día siguiente.
    //
    // Resolver = existe paciente con email igual (case-insensitive trim) y
    //   `alta >= valoracion.fecha` → la valoración ya convirtió. Si la
    //   paciente es anterior (caso edge: vuelve a hacer otra valoración),
    //   la fila aparece en pendientes para que Cristina decida (reactivar
    //   o descartar). Decoupling intencional: ni `/alta-paciente` ni
    //   `/reactivar-paciente` mutan `valoraciones`; el filtro detective
    //   evita mover estado en dos sitios.
    const pendientes = [];
    const ahora = (hoy instanceof Date && !isNaN(hoy.getTime()))
      ? hoy.getTime()
      : Date.now();
    const altaPorEmail = new Map();
    for (const p of pacientes) {
      const email = p && typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
      if (!email) continue;
      const tAlta = p.alta ? new Date(p.alta).getTime() : null;
      const prev = altaPorEmail.get(email);
      // Si una paciente tiene varias filas (no debería, pero defensivo), nos
      // quedamos con el alta más reciente.
      if (prev == null || (tAlta != null && tAlta > prev)) altaPorEmail.set(email, tAlta);
    }

    for (const v of valoraciones) {
      if (!v || v.status !== 'confirmed') continue;
      const fechaCompleta = new Date(v.fecha);
      if (isNaN(fechaCompleta.getTime())) continue;
      const tIni = fechaCompleta.getTime();
      const tFin = tIni + DURACION_VALORACION_MIN * 60000;
      const emailNorm = typeof v.email === 'string' ? v.email.trim().toLowerCase() : '';
      const tAltaPaciente = emailNorm ? altaPorEmail.get(emailNorm) : undefined;
      const yaResuelta = tAltaPaciente != null && tAltaPaciente >= tIni;
      if (yaResuelta) continue;

      const fechaMid = _toMidnight(v.fecha);
      const esHoy = !!fechaMid && fechaMid.getTime() === hoyMid.getTime();
      const slotVigente = ahora < tFin;

      if (esHoy && slotVigente) {
        // Aún no ha pasado el slot → bloque "Sesiones hoy" como antes.
        sesionesHoy.push({
          pacienteId: null,
          nombre: v.nombre || '',
          hora: _horaSesion(v.fecha),
          comando: '',
          tipo: 'valoracion',
          _ts: tIni
        });
      } else if (!slotVigente) {
        // Slot pasado y sin resolver → bloque "Pendientes". Cualquier día.
        pendientes.push({
          valoracionId: v.id,
          nombre: v.nombre || '',
          email: v.email || '',
          fechaISO: fechaMid ? _toISO(fechaMid) : null,
          hora: _horaSesion(v.fecha),
          diaLabel: fechaMid && hoyMid ? _diaLabel(fechaMid, hoyMid) : '',
          esHoy: esHoy,
          comandoAlta: _comandoAltaConEmail(v.nombre, v.email),
          _ts: tIni
        });
      }
      // Caso "valoración futura de otro día" no aplica: para esto está el
      // bloque "Próximos 7 días", no este bucle.
    }

    // Orden estable: sesiones por timestamp asc (mantiene sub-orden por hora
    // dentro del mismo día y mezcla bien seguimientos + valoraciones que
    // pueden tener idéntica hora pero distinto segundo). Empate → nombre.
    sesionesHoy.sort(function (a, b) {
      const at = a._ts == null ? 0 : a._ts;
      const bt = b._ts == null ? 0 : b._ts;
      if (at !== bt) return at - bt;
      return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');
    });
    // _ts es privado del sort; no lo exponemos al render.
    for (const s of sesionesHoy) delete s._ts;
    // Pendientes: las más antiguas primero — Cristina debería resolverlas en
    // orden de llegada para no acumular backlog. Empate → nombre alfabético.
    pendientes.sort(function (a, b) {
      const at = a._ts == null ? 0 : a._ts;
      const bt = b._ts == null ? 0 : b._ts;
      if (at !== bt) return at - bt;
      return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');
    });
    for (const p of pendientes) delete p._ts;
    menusCrearSemana.sort(function (a, b) {
      // más urgentes primero (diasParaCaducar más bajo; null = sin menú = muy urgente).
      const da = a.diasParaCaducar == null ? -Infinity : a.diasParaCaducar;
      const db = b.diasParaCaducar == null ? -Infinity : b.diasParaCaducar;
      if (da !== db) return da - db;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
    alertas.sort(function (a, b) {
      const da = a.diasSinCheckin == null ? Infinity : a.diasSinCheckin;
      const db = b.diasSinCheckin == null ? Infinity : b.diasSinCheckin;
      if (da !== db) return db - da; // más días de silencio primero
      return a.nombre.localeCompare(b.nombre, 'es');
    });

    // Bloque 4: próximos 7 días (mañana → +7). Reutiliza la función pura
    // exportada para que tenga su propio set de tests y se pueda invocar
    // sola. El opts también se le pasa por si se quiere acotar la ventana.
    // Pasamos también valoraciones para que se mezclen con seguimientos.
    const proximos7Dias = sesionesProximos7Dias(
      { pacientes, sesiones, valoraciones, opts },
      hoyMid
    );

    return { sesionesHoy, pendientes, proximos7Dias, menusCrearSemana, alertas };
  }

  // -----------------------------------------------------------------
  // priorizarPacientes — lista general del backoffice
  // -----------------------------------------------------------------

  // Opts:
  //   estado: 'activas' | 'cerradas' | 'todas'  (default: 'todas')
  //   sesiones: array de sesiones (se usa para ordenar por próxima sesión)
  //   hoy: Date (default: new Date())
  function priorizarPacientes(pacientes, opts) {
    const o = opts || {};
    const estado = o.estado || 'todas';
    const sesiones = o.sesiones || [];
    const hoyMid = _toMidnight(o.hoy) || _toMidnight(new Date());
    const sesionesByPac = _indexBy(sesiones, 'paciente_id');

    const lista = (Array.isArray(pacientes) ? pacientes : []).filter(function (p) {
      if (estado === 'activas') return p.estado !== 'cerrado';
      if (estado === 'cerradas') return p.estado === 'cerrado';
      return true;
    });

    // Decoramos con proximaSesion para el sort, sin mutar el input.
    const decoradas = lista.map(function (p) {
      const prox = _proximaSesion(sesionesByPac.get(p.id) || [], hoyMid);
      return {
        paciente: p,
        proximaSesion: prox ? prox.fecha : null,
        proximaSesionTime: prox ? _toMidnight(prox.fecha).getTime() : null
      };
    });

    // Orden: activas antes que cerradas; dentro de cada grupo, próxima sesión
    // ascendente (sin sesión = al final).
    decoradas.sort(function (a, b) {
      const aActiva = a.paciente.estado !== 'cerrado';
      const bActiva = b.paciente.estado !== 'cerrado';
      if (aActiva !== bActiva) return aActiva ? -1 : 1;
      const aTime = a.proximaSesionTime == null ? Infinity : a.proximaSesionTime;
      const bTime = b.proximaSesionTime == null ? Infinity : b.proximaSesionTime;
      if (aTime !== bTime) return aTime - bTime;
      return String(a.paciente.nombre || '').localeCompare(String(b.paciente.nombre || ''), 'es');
    });

    return decoradas.map(function (d) {
      return {
        id: d.paciente.id,
        nombre: d.paciente.nombre,
        email: d.paciente.email,
        estado: d.paciente.estado,
        proximaSesion: d.proximaSesion
      };
    });
  }

  // -----------------------------------------------------------------
  // calcularMetricasHoy — tarjeta de métricas simples para la vista Hoy
  // -----------------------------------------------------------------
  //
  // Devuelve tres números para pintar en una tarjeta arriba de los bloques:
  //   { activas, menusEsteMes, repescas: { numerador, denominador, label } }
  //
  // - `activas`: pacientes con estado === 'activo'.
  // - `menusEsteMes`: menús cuyo `created_at` (timestamptz) cae en el mes
  //   natural de `hoy`. Si un menú no tiene created_at (import legacy) cae
  //   al `vigente_desde` como proxy. Sumamos único por id.
  // - `repescas`: proxy de "tasa de respuesta a repescas" en los últimos
  //   REPESCA_VENTANA_DIAS (90) días. El schema NO tiene un campo explícito
  //   de "intento de repesca", así que calculamos un proxy honesto:
  //     - Para cada paciente activa, detectamos si dentro de la ventana tuvo
  //       una racha de silencio ≥ GAP_REPESCA_DIAS (21) días, medida como
  //       días consecutivos sin checkin ni sesión (timestamps que aparezcan
  //       en las tablas respectivas).
  //     - Denominador: pacientes con tal racha terminada dentro de la
  //       ventana.
  //     - Numerador: de esas, las que tuvieron al menos un checkin o sesión
  //       posterior a la racha dentro de la misma ventana (respuesta).
  //   Si denominador < REPESCA_MIN_DENOMINADOR (3), devolvemos label
  //   "Sin datos suficientes" y numerador/denominador = 0. Esto evita
  //   mostrar una tasa basada en 1-2 casos que no representa nada.
  //
  // Si algún día el schema tiene una tabla `repescas` con intento + resultado,
  // esta función se reemplaza por un cálculo directo. Mientras tanto, el
  // proxy es la mejor aproximación honesta (ver commit que añadió la tarjeta).

  const REPESCA_VENTANA_DIAS = 90;
  const GAP_REPESCA_DIAS = 21;
  const REPESCA_MIN_DENOMINADOR = 3;

  function _mesActualBounds(hoy) {
    const d = _toMidnight(hoy) || _toMidnight(new Date());
    const inicio = new Date(d.getFullYear(), d.getMonth(), 1);
    const finExcl = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return { inicio: inicio.getTime(), finExcl: finExcl.getTime() };
  }

  function _menuEnMesActual(menu, bounds) {
    const ref = menu.created_at || menu.vigente_desde;
    if (!ref) return false;
    const d = new Date(ref);
    if (isNaN(d.getTime())) return false;
    const t = d.getTime();
    return t >= bounds.inicio && t < bounds.finExcl;
  }

  // Calcula el proxy de repescas para una paciente. Devuelve:
  //   { tuvoGap: boolean, respondio: boolean }
  // Si `tuvoGap` es false, la paciente no entra en el denominador.
  function _evaluarRepesca(paciente, checkinsPac, sesionesPac, hoyMid) {
    if (paciente.estado !== 'activo') return { tuvoGap: false, respondio: false };
    const finVentana = hoyMid.getTime();
    const inicioVentana = finVentana - REPESCA_VENTANA_DIAS * 86400000;

    // Recolectamos timestamps de actividad (checkins + sesiones) dentro de
    // la ventana + un poco antes (para detectar gap que empieza antes).
    const actividades = [];
    for (const c of (checkinsPac || [])) {
      const d = _toMidnight(c.fecha);
      if (d) actividades.push(d.getTime());
    }
    for (const s of (sesionesPac || [])) {
      const d = _toMidnight(s.fecha);
      if (d) actividades.push(d.getTime());
    }
    actividades.sort((a, b) => a - b);

    // Buscamos la racha más larga de días sin actividad que **termine**
    // dentro de la ventana. Si la paciente no tiene actividad ninguna
    // dentro de la ventana, consideramos el gap como (hoy - último evento).
    // Si tampoco hay eventos previos, no podemos saber si ha sido repescada
    // → no cuenta.
    if (actividades.length === 0) return { tuvoGap: false, respondio: false };

    // Recorremos los eventos y calculamos gaps consecutivos. Añadimos un
    // evento sintético "hoy" al final, marcado como no-real, para capturar
    // el gap abierto actual (silencio que continúa hasta hoy).
    const eventos = actividades.map(t => ({ t, real: true }));
    eventos.push({ t: finVentana, real: false });

    let gapMax = 0;
    let finGapMaxReal = false; // true si la racha la cierra una actividad real
    for (let i = 1; i < eventos.length; i++) {
      const gap = Math.floor((eventos[i].t - eventos[i - 1].t) / 86400000);
      if (gap > gapMax && eventos[i].t >= inicioVentana && eventos[i].t <= finVentana) {
        gapMax = gap;
        finGapMaxReal = eventos[i].real;
      }
    }

    if (gapMax < GAP_REPESCA_DIAS) return { tuvoGap: false, respondio: false };

    // respondio = la racha máxima la cierra una actividad real (checkin o
    // sesión), no el evento sintético "hoy". Si fuera el sintético,
    // significa que la paciente sigue en silencio → no respondió.
    return { tuvoGap: true, respondio: finGapMaxReal };
  }

  function calcularMetricasHoy(datos, hoy) {
    const pacientes = (datos && datos.pacientes) || [];
    const menus     = (datos && datos.menus)     || [];
    const sesiones  = (datos && datos.sesiones)  || [];
    const checkins  = (datos && datos.checkins)  || [];

    const hoyMid = _toMidnight(hoy) || _toMidnight(new Date());
    const bounds = _mesActualBounds(hoyMid);

    // 1. Activas
    let activas = 0;
    for (const p of pacientes) if (p.estado === 'activo') activas++;

    // 2. Menús este mes (por created_at, fallback vigente_desde)
    let menusEsteMes = 0;
    for (const m of menus) if (_menuEnMesActual(m, bounds)) menusEsteMes++;

    // 3. Tasa de respuesta a repescas (proxy)
    const checkinsByPac = _indexBy(checkins, 'paciente_id');
    const sesionesByPac = _indexBy(sesiones, 'paciente_id');
    let numerador = 0;
    let denominador = 0;
    for (const p of pacientes) {
      const { tuvoGap, respondio } = _evaluarRepesca(
        p,
        checkinsByPac.get(p.id) || [],
        sesionesByPac.get(p.id) || [],
        hoyMid
      );
      if (tuvoGap) {
        denominador++;
        if (respondio) numerador++;
      }
    }

    let repescas;
    if (denominador < REPESCA_MIN_DENOMINADOR) {
      repescas = { numerador: 0, denominador: 0, label: 'Sin datos suficientes' };
    } else {
      repescas = {
        numerador,
        denominador,
        label: 'Respuesta a repescas (últimos 90 días)'
      };
    }

    return { activas, menusEsteMes, repescas };
  }

  // -----------------------------------------------------------------
  // Gate de entorno: en build de producción exigimos CRISTINA_EMAIL
  // -----------------------------------------------------------------

  // Se invoca desde el build (test o pipeline). Si falta la var en prod,
  // lanza Error — el backoffice no debe desplegarse sin gate UX configurado.
  // La seguridad dura vive en RLS de Supabase; este gate es UX/aviso.
  function validarEnv(env) {
    const e = env || {};
    if (e.NODE_ENV === 'production' && !e.CRISTINA_EMAIL) {
      throw new Error('CRISTINA_EMAIL requerida en build de producción (backoffice gate UX)');
    }
    return true;
  }

  // -----------------------------------------------------------------
  // API pública
  // -----------------------------------------------------------------

  const api = {
    agruparHoy,
    sesionesProximos7Dias,
    priorizarPacientes,
    calcularMetricasHoy,
    generarComando,
    diffEnDias,
    validarEnv,
    SKILLS_VALIDAS,
    VIGENCIA_DIAS_DEFAULT,
    DIAS_SIN_CHECKIN_ALERTA,
    DIAS_AVISO_PROXIMO_MENU,
    DIAS_VENTANA_PROXIMOS,
    DURACION_VALORACION_MIN,
    REPESCA_VENTANA_DIAS,
    GAP_REPESCA_DIAS,
    REPESCA_MIN_DENOMINADOR
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.BoLogic = api;
})();
