// Lógica pura del backoffice CLN — aislada de DOM y Supabase.
// Recibe datos ya cargados (arrays de pacientes, menus, sesiones, checkins) y
// devuelve estructuras para renderizar. Sin I/O, sin fetch, sin DOM.
//
// Navegador: `<script src="/backoffice/logic.js">` expone `window.BoLogic`.
// Node tests: `require('./logic.js')` devuelve la misma API.
//
// Convenciones de datos (esquema Supabase, ver supabase/migrations/*):
//   pacientes: { id, email, nombre (MAYÚSCULAS), estado ('activo'|'cerrado'|...), alta, ... }
//   menus:     { id, paciente_id, numero, vigente_desde (date YYYY-MM-DD), pdf_url, enviado_at? }
//              `enviado_at` NO existe hoy en el schema; lo leemos como opt-in (null
//              o ausente = no enviado). Si el Agente 3/4 añade la columna, este
//              módulo ya la respeta. Mientras tanto, el marcador lo mantiene
//              Cristina en NOTAS de Drive.
//   sesiones:  { id, paciente_id, fecha (timestamptz ISO), calendar_event_id }
//   checkins:  { paciente_id, fecha (date YYYY-MM-DD), estado }
//
// Vigencia del menú: el schema solo tiene `vigente_desde`. El menú CLN es
// mensual (ver convenciones/clinica/plan-nutricional.md), así que asumimos
// 30 días de vigencia. Parametrizable vía `opts.vigenciaDias` por si cambia.
(function () {
  'use strict';

  const VIGENCIA_DIAS_DEFAULT = 30;
  const DIAS_SIN_CHECKIN_ALERTA = 3;
  const DIAS_AVISO_PROXIMO_MENU = 7;

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
    'alta-paciente',
    'amplitude-overview',
    'cerrar-paciente',
    'crear-imagen',
    'crear-menu',
    'crear-video',
    'enviar-menu',
    'publicar-instagram',
    'publicar-post',
    'reagendar',
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

  // Menú listo para enviar: tiene PDF subido pero no marcador de envío.
  // `enviado_at` es el campo opt-in (ver nota arriba).
  function _necesitaEnviar(menuVig) {
    if (!menuVig) return false;
    if (!menuVig.pdf_url) return false;
    return !menuVig.enviado_at;
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
  // agruparHoy — motor principal de la vista "Hoy"
  // -----------------------------------------------------------------

  function agruparHoy(datos, hoy) {
    const pacientes = (datos && datos.pacientes) || [];
    const menus     = (datos && datos.menus)     || [];
    const sesiones  = (datos && datos.sesiones)  || [];
    const checkins  = (datos && datos.checkins)  || [];
    const opts      = (datos && datos.opts)      || {};
    const vigenciaDias  = opts.vigenciaDias || VIGENCIA_DIAS_DEFAULT;
    const diasSilencio  = opts.diasSilencio || DIAS_SIN_CHECKIN_ALERTA;

    const hoyMid = _toMidnight(hoy) || _toMidnight(new Date());
    const menusByPac    = _indexBy(menus, 'paciente_id');
    const sesionesByPac = _indexBy(sesiones, 'paciente_id');
    const checkinsByPac = _indexBy(checkins, 'paciente_id');

    const sesionesHoy = [];
    const menusCrearSemana = [];
    const menusEnviar = [];
    const alertas = [];

    for (const p of pacientes) {
      const activa = p.estado !== 'cerrado' && p.estado !== 'pausa';
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
              comando: generarComando('seguimiento-paciente', p.nombre)
            });
          }
        }
      }

      // Bloque 2: menús a crear esta semana. Solo activas.
      if (activa && _necesitaMenuNuevo(menuVig, hoyMid, vigenciaDias)) {
        menusCrearSemana.push({
          pacienteId: p.id,
          nombre: p.nombre,
          vigenteDesde: menuVig ? menuVig.vigente_desde : null,
          diasParaCaducar: menuVig
            ? vigenciaDias - diffEnDias(_toMidnight(menuVig.vigente_desde), hoyMid)
            : null,
          comando: generarComando('crear-menu', p.nombre)
        });
      }

      // Bloque 3: menús con PDF listo para enviar. Incluye activas Y pausas;
      // si está "cerrado", no tiene sentido enviar.
      if (p.estado !== 'cerrado' && menuVig && _necesitaEnviar(menuVig)) {
        menusEnviar.push({
          pacienteId: p.id,
          nombre: p.nombre,
          menuId: menuVig.id,
          numero: menuVig.numero,
          pdfUrl: menuVig.pdf_url,
          comando: generarComando('enviar-menu', p.nombre)
        });
      }

      // Bloque 4: alertas por silencio. Solo activas.
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

    // Orden estable: sesiones por hora ascendente, resto por nombre.
    sesionesHoy.sort(function (a, b) {
      if (a.hora !== b.hora) return a.hora.localeCompare(b.hora);
      return a.nombre.localeCompare(b.nombre, 'es');
    });
    menusCrearSemana.sort(function (a, b) {
      // más urgentes primero (diasParaCaducar más bajo; null = sin menú = muy urgente).
      const da = a.diasParaCaducar == null ? -Infinity : a.diasParaCaducar;
      const db = b.diasParaCaducar == null ? -Infinity : b.diasParaCaducar;
      if (da !== db) return da - db;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
    menusEnviar.sort(function (a, b) {
      return a.nombre.localeCompare(b.nombre, 'es');
    });
    alertas.sort(function (a, b) {
      const da = a.diasSinCheckin == null ? Infinity : a.diasSinCheckin;
      const db = b.diasSinCheckin == null ? Infinity : b.diasSinCheckin;
      if (da !== db) return db - da; // más días de silencio primero
      return a.nombre.localeCompare(b.nombre, 'es');
    });

    return { sesionesHoy, menusCrearSemana, menusEnviar, alertas };
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
      if (estado === 'activas') return p.estado !== 'cerrado' && p.estado !== 'pausa';
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
      const aActiva = a.paciente.estado !== 'cerrado' && a.paciente.estado !== 'pausa';
      const bActiva = b.paciente.estado !== 'cerrado' && b.paciente.estado !== 'pausa';
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
    priorizarPacientes,
    generarComando,
    diffEnDias,
    validarEnv,
    SKILLS_VALIDAS,
    VIGENCIA_DIAS_DEFAULT,
    DIAS_SIN_CHECKIN_ALERTA,
    DIAS_AVISO_PROXIMO_MENU
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.BoLogic = api;
})();
