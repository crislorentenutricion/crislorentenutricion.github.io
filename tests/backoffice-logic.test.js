const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  agruparHoy,
  sesionesProximos7Dias,
  priorizarPacientes,
  calcularMetricasHoy,
  generarComando,
  diffEnDias,
  validarEnv,
  SKILLS_VALIDAS,
  VIGENCIA_DIAS_DEFAULT,
  DIAS_AVISO_PROXIMO_MENU,
  DIAS_VENTANA_PROXIMOS,
  REPESCA_VENTANA_DIAS,
  GAP_REPESCA_DIAS,
  REPESCA_MIN_DENOMINADOR,
  construirPayload,
  comandoRescate,
  resumenResultadoAccion,
  NOMBRE_EF
} = require("../src/backoffice/logic.js");

// ===================================================================
// diffEnDias
// ===================================================================

test("diffEnDias: misma fecha → 0", () => {
  const a = new Date(2026, 3, 17);
  const b = new Date(2026, 3, 17);
  assert.equal(diffEnDias(a, b), 0);
});

test("diffEnDias: b posterior a a → positivo", () => {
  const a = new Date(2026, 3, 10);
  const b = new Date(2026, 3, 17);
  assert.equal(diffEnDias(a, b), 7);
});

test("diffEnDias: b anterior a a → negativo", () => {
  const a = new Date(2026, 3, 17);
  const b = new Date(2026, 3, 10);
  assert.equal(diffEnDias(a, b), -7);
});

test("diffEnDias acepta strings 'YYYY-MM-DD'", () => {
  assert.equal(diffEnDias("2026-04-10", "2026-04-17"), 7);
});

test("diffEnDias: entradas inválidas → NaN", () => {
  assert.ok(Number.isNaN(diffEnDias(null, new Date())));
  assert.ok(Number.isNaN(diffEnDias("not-a-date", "2026-04-17")));
});

// ===================================================================
// generarComando
// ===================================================================

// Decisión documentada: las skills CLN reciben el nombre como argumento
// libre tras el identificador (p.ej. `/alta-paciente NOMBRE APELLIDO`). No
// se envuelve en comillas. Mantenemos tildes, ñ y apóstrofes (son parte
// de apellidos reales) y pasamos a MAYÚSCULAS con locale 'es-ES'.

test("generarComando: nombre básico MAYÚSCULAS se mantiene", () => {
  assert.equal(
    generarComando("seguimiento-paciente", "ANA GARCIA"),
    "/seguimiento-paciente ANA GARCIA"
  );
});

test("generarComando: upper-case entradas en minúsculas", () => {
  assert.equal(generarComando("crear-menu", "maría"), "/crear-menu MARÍA");
});

test("generarComando: preserva tildes en MAYÚSCULAS", () => {
  assert.equal(
    generarComando("crear-menu", "MARÍA JOSÉ"),
    "/crear-menu MARÍA JOSÉ"
  );
});

test("generarComando: preserva apóstrofes (apellidos reales)", () => {
  assert.equal(
    generarComando("enviar-menu", "D'AMBROSIO"),
    "/enviar-menu D'AMBROSIO"
  );
});

test("generarComando: título con apóstrofe y espacios múltiples", () => {
  assert.equal(
    generarComando("crear-menu", "  maría  josé   d'ambrosio  "),
    "/crear-menu MARÍA JOSÉ D'AMBROSIO"
  );
});

test("generarComando: quita comillas envolventes si el caller las trae", () => {
  assert.equal(
    generarComando("repescar-paciente", '"JOSÉ LUIS"'),
    "/repescar-paciente JOSÉ LUIS"
  );
});

test("generarComando: acepta slash inicial en la skill", () => {
  assert.equal(
    generarComando("/alta-paciente", "ANA"),
    "/alta-paciente ANA"
  );
});

test("generarComando: skill desconocida → lanza", () => {
  assert.throws(() => generarComando("inventada", "ANA"), /skill desconocida/);
});

test("generarComando: nombre vacío → lanza", () => {
  assert.throws(() => generarComando("crear-menu", ""), /nombrePaciente vacío/);
  assert.throws(() => generarComando("crear-menu", "   "), /nombrePaciente vacío/);
});

test("SKILLS_VALIDAS contiene las auto-invocables documentadas en CLAUDE.md", () => {
  const auto = [
    "crear-menu", "crear-imagen", "crear-video", "seguimiento-paciente",
    "enviar-menu", "alta-paciente", "cerrar-paciente", "repescar-paciente",
    "reagendar", "publicar-instagram", "publicar-post", "amplitude-overview",
    "retrospectiva", "setup"
  ];
  for (const s of auto) {
    assert.ok(SKILLS_VALIDAS.has(s), `falta skill auto-invocable: ${s}`);
  }
});

// ===================================================================
// agruparHoy — fixtures compartidas
// ===================================================================

const HOY = new Date(2026, 3, 22); // miércoles 22 abril 2026

// Fixture completa: pacientes en varios estados con datos cruzados para
// cubrir los 4 bloques en una sola invocación.
function fixtureCompleta() {
  return {
    pacientes: [
      // Activa con sesión hoy
      { id: "p1", nombre: "ANA GARCIA", email: "ana@x.com", estado: "activo", alta: "2026-01-10" },
      // Activa con menú caducando en 5 días (dentro de ventana)
      { id: "p2", nombre: "BEATRIZ RUIZ", email: "bea@x.com", estado: "activo", alta: "2026-01-10" },
      // Activa con menú reciente (PDF subido) y check-in al día — no aparece en ningún bloque
      { id: "p3", nombre: "CARMEN LOPEZ", email: "car@x.com", estado: "activo", alta: "2026-01-10" },
      // Activa con 4 días sin check-in → alerta
      { id: "p4", nombre: "DIANA PEREZ", email: "dia@x.com", estado: "activo", alta: "2026-01-10" },
      // Activa con check-in reciente (ayer) → NO alerta
      { id: "p5", nombre: "ELENA SANZ", email: "ele@x.com", estado: "activo", alta: "2026-01-10" },
      // Cerrada: no aparece en ningún bloque
      { id: "p6", nombre: "FATIMA GIL", email: "fat@x.com", estado: "cerrado", alta: "2025-09-01" }
    ],
    menus: [
      // p1: menú vigente sano (10 días dentro de 30) — no aparece en crear
      { id: "m1", paciente_id: "p1", numero: 3, vigente_desde: "2026-04-12", pdf_url: "https://drive/m1.pdf", enviado_at: "2026-04-12T10:00:00Z" },
      // p2: menú caducando (vigente_desde hace 26 días; 30-26=4 restantes ≤ 7)
      { id: "m2", paciente_id: "p2", numero: 2, vigente_desde: "2026-03-27", pdf_url: "https://drive/m2.pdf", enviado_at: "2026-03-27T10:00:00Z" },
      // p3: menú nuevo con PDF pero SIN enviar
      { id: "m3", paciente_id: "p3", numero: 1, vigente_desde: "2026-04-20", pdf_url: "https://drive/m3.pdf" /* enviado_at ausente */ },
      // p6 cerrada, tenía un menú antiguo
      { id: "m6", paciente_id: "p6", numero: 5, vigente_desde: "2025-10-01", pdf_url: "https://drive/m6.pdf", enviado_at: "2025-10-01T10:00:00Z" }
      // p4, p5 sin menú → entran en menusCrearSemana (activas sin menú)
    ],
    sesiones: [
      { id: "s1", paciente_id: "p1", fecha: "2026-04-22T17:00:00Z" }, // hoy
      { id: "s2", paciente_id: "p2", fecha: "2026-04-28T10:00:00Z" }, // futura
      { id: "s6", paciente_id: "p6", fecha: "2026-04-22T09:00:00Z" }  // cerrada — NO aparece
    ],
    checkins: [
      // p1 activa con checkin ayer
      { paciente_id: "p1", fecha: "2026-04-21", estado: "seguido" },
      // p2 con checkin ayer
      { paciente_id: "p2", fecha: "2026-04-21", estado: "parcial" },
      // p3 con checkin ayer
      { paciente_id: "p3", fecha: "2026-04-21", estado: "seguido" },
      // p4 último hace 4 días → alerta (≥ 3)
      { paciente_id: "p4", fecha: "2026-04-18", estado: "seguido" },
      // p5 con checkin ayer → NO alerta
      { paciente_id: "p5", fecha: "2026-04-21", estado: "seguido" }
    ]
  };
}

// ===================================================================
// agruparHoy — tests
// ===================================================================

test("agruparHoy: devuelve los bloques activos como arrays", () => {
  const r = agruparHoy(fixtureCompleta(), HOY);
  assert.ok(Array.isArray(r.sesionesHoy));
  assert.ok(Array.isArray(r.menusCrearSemana));
});

test("agruparHoy: sesionesHoy contiene solo sesiones de hoy de pacientes activas", () => {
  const r = agruparHoy(fixtureCompleta(), HOY);
  assert.equal(r.sesionesHoy.length, 1);
  assert.equal(r.sesionesHoy[0].pacienteId, "p1");
  assert.equal(r.sesionesHoy[0].nombre, "ANA GARCIA");
  assert.equal(r.sesionesHoy[0].comando, "/seguimiento-paciente ANA GARCIA");
  // La sesión de p6 (cerrada) NO aparece pese a ser hoy.
  const ids = r.sesionesHoy.map(s => s.pacienteId);
  assert.ok(!ids.includes("p6"));
});

test("agruparHoy: menusCrearSemana incluye caducando próximamente + activas sin menú", () => {
  const r = agruparHoy(fixtureCompleta(), HOY);
  const ids = r.menusCrearSemana.map(x => x.pacienteId).sort();
  // p2 caducando, p4 y p5 activas sin menú
  assert.deepEqual(ids, ["p2", "p4", "p5"]);
  // p1 menú fresco (10 días dentro de 30) → no aparece
  assert.ok(!ids.includes("p1"));
  // p6 cerrada → no aparece pese a no tener menú vigente reciente
  assert.ok(!ids.includes("p6"));
});

test("agruparHoy: paciente activa sin menú aparece en menusCrearSemana", () => {
  const datos = {
    pacientes: [
      { id: "p1", nombre: "ANA", email: "a@x", estado: "activo", alta: "2026-04-01" }
    ],
    menus: [],
    sesiones: [],
    checkins: []
  };
  const r = agruparHoy(datos, HOY);
  assert.equal(r.menusCrearSemana.length, 1);
  assert.equal(r.menusCrearSemana[0].pacienteId, "p1");
  assert.equal(r.menusCrearSemana[0].vigenteDesde, null);
  assert.equal(r.menusCrearSemana[0].diasParaCaducar, null);
  assert.equal(r.menusCrearSemana[0].comando, "/crear-menu ANA");
});

test("agruparHoy: menusCrearSemana incluye anamnesisLista=false si no hay anamnesis_completed_at", () => {
  const datos = {
    pacientes: [
      { id: "p1", nombre: "ANA", email: "a@x", estado: "activo", alta: "2026-04-01" }
    ],
    menus: [], sesiones: [], checkins: []
  };
  const r = agruparHoy(datos, HOY);
  assert.equal(r.menusCrearSemana[0].anamnesisLista, false);
});

test("agruparHoy: menusCrearSemana incluye anamnesisLista=true si hay anamnesis_completed_at", () => {
  const datos = {
    pacientes: [
      { id: "p1", nombre: "ANA", email: "a@x", estado: "activo", alta: "2026-04-01",
        anamnesis_completed_at: "2026-04-02T10:00:00Z" }
    ],
    menus: [], sesiones: [], checkins: []
  };
  const r = agruparHoy(datos, HOY);
  assert.equal(r.menusCrearSemana[0].anamnesisLista, true);
});

test("agruparHoy: paciente cerrado con sesión hoy NO aparece en sesionesHoy (decisión)", () => {
  // Decisión 2026-04-22: si un paciente cerrado tiene una sesión residual
  // en Calendar/Supabase, no debería contactarse. El cierre manda sobre el
  // dato inconsistente.
  const datos = {
    pacientes: [
      { id: "p1", nombre: "CERRADA", email: "c@x", estado: "cerrado", alta: "2025-01-01" }
    ],
    menus: [],
    sesiones: [
      { id: "s1", paciente_id: "p1", fecha: "2026-04-22T12:00:00Z" }
    ],
    checkins: []
  };
  const r = agruparHoy(datos, HOY);
  assert.equal(r.sesionesHoy.length, 0);
  assert.equal(r.menusCrearSemana.length, 0);
});

test("agruparHoy: menu vigente expirado hace días también entra en crear-semana", () => {
  const datos = {
    pacientes: [
      { id: "p1", nombre: "ANA", email: "a@x", estado: "activo", alta: "2026-01-01" }
    ],
    menus: [
      { id: "m1", paciente_id: "p1", numero: 1, vigente_desde: "2026-03-01", pdf_url: "x", enviado_at: "2026-03-01T10:00Z" }
    ],
    sesiones: [],
    checkins: [{ paciente_id: "p1", fecha: "2026-04-21", estado: "seguido" }]
  };
  const r = agruparHoy(datos, HOY); // hoy - 2026-03-01 = 52 días > 30
  assert.equal(r.menusCrearSemana.length, 1);
  // diasParaCaducar negativo (caducó hace 22 días)
  assert.ok(r.menusCrearSemana[0].diasParaCaducar < 0);
});

test("agruparHoy: orden estable — sesionesHoy por hora asc", () => {
  const datos = {
    pacientes: [
      { id: "p1", nombre: "ANA", email: "a@x", estado: "activo", alta: "2026-01-01" },
      { id: "p2", nombre: "BEA", email: "b@x", estado: "activo", alta: "2026-01-01" }
    ],
    menus: [],
    sesiones: [
      { id: "s1", paciente_id: "p1", fecha: "2026-04-22T17:00:00" },
      { id: "s2", paciente_id: "p2", fecha: "2026-04-22T10:00:00" }
    ],
    checkins: [
      { paciente_id: "p1", fecha: "2026-04-21", estado: "seguido" },
      { paciente_id: "p2", fecha: "2026-04-21", estado: "seguido" }
    ]
  };
  const r = agruparHoy(datos, HOY);
  assert.equal(r.sesionesHoy.length, 2);
  assert.equal(r.sesionesHoy[0].nombre, "BEA");   // 10:00 antes
  assert.equal(r.sesionesHoy[1].nombre, "ANA");   // 17:00 después
});

test("agruparHoy: constantes exportadas coherentes", () => {
  assert.equal(VIGENCIA_DIAS_DEFAULT, 30);
  assert.equal(DIAS_AVISO_PROXIMO_MENU, 7);
});

test("agruparHoy: vigenciaDias configurable via opts", () => {
  // Menú de 15 días (p.ej. plan quincenal futuro)
  const datos = {
    pacientes: [
      { id: "p1", nombre: "ANA", email: "a@x", estado: "activo", alta: "2026-01-01" }
    ],
    menus: [
      // hace 10 días + 15 vigencia = caduca en 5 → entra en crear
      { id: "m1", paciente_id: "p1", numero: 1, vigente_desde: "2026-04-12", pdf_url: "x", enviado_at: "2026-04-12T10:00Z" }
    ],
    sesiones: [],
    checkins: [{ paciente_id: "p1", fecha: "2026-04-21", estado: "seguido" }],
    opts: { vigenciaDias: 15 }
  };
  const r = agruparHoy(datos, HOY);
  assert.equal(r.menusCrearSemana.length, 1);
});

// ===================================================================
// sesionesProximos7Dias — bloque agenda mañana → +7
// ===================================================================
//
// HOY = miércoles 22 abril 2026 (constante definida arriba en este fichero).

test("sesionesProximos7Dias: incluye sesiones de mañana hasta +7 días", () => {
  const datos = {
    pacientes: [
      { id: "p1", nombre: "ANA", estado: "activo", alta: "2026-01-01" },
      { id: "p2", nombre: "BEA", estado: "activo", alta: "2026-01-01" },
      { id: "p3", nombre: "CAR", estado: "activo", alta: "2026-01-01" }
    ],
    sesiones: [
      { id: "s1", paciente_id: "p1", fecha: "2026-04-23T10:00:00" }, // +1 IN
      { id: "s2", paciente_id: "p2", fecha: "2026-04-29T17:00:00" }, // +7 IN
      { id: "s3", paciente_id: "p3", fecha: "2026-04-30T17:00:00" }  // +8 OUT
    ]
  };
  const r = sesionesProximos7Dias(datos, HOY);
  assert.deepEqual(r.map(s => s.pacienteId), ["p1", "p2"]);
});

test("sesionesProximos7Dias: excluye sesiones de hoy (las cubre el bloque sesionesHoy)", () => {
  const datos = {
    pacientes: [{ id: "p1", nombre: "ANA", estado: "activo", alta: "2026-01-01" }],
    sesiones: [
      { id: "s1", paciente_id: "p1", fecha: "2026-04-22T17:00:00" }, // hoy OUT
      { id: "s2", paciente_id: "p1", fecha: "2026-04-23T10:00:00" }  // +1 IN
    ]
  };
  const r = sesionesProximos7Dias(datos, HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].fechaISO, "2026-04-23");
});

test("sesionesProximos7Dias: excluye sesiones pasadas", () => {
  const datos = {
    pacientes: [{ id: "p1", nombre: "ANA", estado: "activo", alta: "2026-01-01" }],
    sesiones: [
      { id: "s1", paciente_id: "p1", fecha: "2026-04-10T10:00:00" } // -12 OUT
    ]
  };
  const r = sesionesProximos7Dias(datos, HOY);
  assert.equal(r.length, 0);
});

test("sesionesProximos7Dias: excluye pacientes cerradas", () => {
  // Modelo binario (migración 0014): solo 'activo' | 'cerrado'.
  // Ya no existe 'pausa' — si legacy lo tuviera se trata como activo (el
  // CHECK lo rechazaría igualmente, pero dejamos la defensa implícita).
  const datos = {
    pacientes: [
      { id: "p1", nombre: "CERRADA", estado: "cerrado", alta: "2025-01-01" },
      { id: "p2", nombre: "ANA",     estado: "activo",  alta: "2026-01-01" }
    ],
    sesiones: [
      { id: "s1", paciente_id: "p1", fecha: "2026-04-23T10:00:00" },
      { id: "s2", paciente_id: "p2", fecha: "2026-04-23T11:00:00" }
    ]
  };
  const r = sesionesProximos7Dias(datos, HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].pacienteId, "p2");
});

test("sesionesProximos7Dias: ordena ascendente por timestamp", () => {
  const datos = {
    pacientes: [
      { id: "p1", nombre: "ANA", estado: "activo", alta: "2026-01-01" },
      { id: "p2", nombre: "BEA", estado: "activo", alta: "2026-01-01" }
    ],
    sesiones: [
      { id: "s1", paciente_id: "p1", fecha: "2026-04-27T10:00:00" }, // +5
      { id: "s2", paciente_id: "p2", fecha: "2026-04-23T17:00:00" }  // +1
    ]
  };
  const r = sesionesProximos7Dias(datos, HOY);
  assert.deepEqual(r.map(s => s.pacienteId), ["p2", "p1"]);
});

test("sesionesProximos7Dias: cada item lleva pacienteId, nombre, fechaISO, hora, diaLabel, comando, tipo", () => {
  const datos = {
    pacientes: [{ id: "p1", nombre: "ANA GARCIA", estado: "activo", alta: "2026-01-01" }],
    sesiones: [{ id: "s1", paciente_id: "p1", fecha: "2026-04-23T10:30:00" }]
  };
  const r = sesionesProximos7Dias(datos, HOY);
  assert.equal(r.length, 1);
  const item = r[0];
  assert.equal(item.pacienteId, "p1");
  assert.equal(item.nombre, "ANA GARCIA");
  assert.equal(item.fechaISO, "2026-04-23");
  assert.equal(item.hora, "10:30");
  assert.equal(item.comando, "/seguimiento-paciente ANA GARCIA");
  assert.equal(item.tipo, "seguimiento");
  assert.ok(typeof item.diaLabel === "string" && item.diaLabel.length > 0);
});

test("sesionesProximos7Dias: diff=1 → diaLabel empieza por 'Mañana'", () => {
  const datos = {
    pacientes: [{ id: "p1", nombre: "ANA", estado: "activo", alta: "2026-01-01" }],
    sesiones: [{ id: "s1", paciente_id: "p1", fecha: "2026-04-23T10:00:00" }]
  };
  const r = sesionesProximos7Dias(datos, HOY);
  assert.match(r[0].diaLabel, /^Mañana/);
});

test("sesionesProximos7Dias: diff>=2 → diaLabel con día semana abrev + número + mes abrev (es-ES)", () => {
  // 2026-04-25 es sábado; HOY = miércoles 22; diff=3.
  const datos = {
    pacientes: [{ id: "p1", nombre: "ANA", estado: "activo", alta: "2026-01-01" }],
    sesiones: [{ id: "s1", paciente_id: "p1", fecha: "2026-04-25T10:00:00" }]
  };
  const r = sesionesProximos7Dias(datos, HOY);
  // Sáb 25 abr (con tilde y mayúscula inicial).
  assert.equal(r[0].diaLabel, "Sáb 25 abr");
});

test("sesionesProximos7Dias: ventana acotable vía opts.ventanaProximos", () => {
  const datos = {
    pacientes: [{ id: "p1", nombre: "ANA", estado: "activo", alta: "2026-01-01" }],
    sesiones: [
      { id: "s1", paciente_id: "p1", fecha: "2026-04-25T10:00:00" } // +3
    ],
    opts: { ventanaProximos: 2 }
  };
  const r = sesionesProximos7Dias(datos, HOY);
  assert.equal(r.length, 0, "+3 fuera de ventana de 2 días");
});

// ===================================================================
// valoraciones (primera consulta) — mezcla con seguimientos
// ===================================================================

test("sesionesProximos7Dias: incluye valoraciones confirmed con tipo='valoracion' y pacienteId=null", () => {
  const datos = {
    pacientes: [],
    sesiones: [],
    valoraciones: [
      { id: "v1", nombre: "JORGE NAVARRO", email: "j@x", fecha: "2026-04-23T11:00:00", status: "confirmed" }
    ]
  };
  const r = sesionesProximos7Dias(datos, HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].tipo, "valoracion");
  assert.equal(r[0].pacienteId, null);
  assert.equal(r[0].nombre, "JORGE NAVARRO");
  assert.equal(r[0].hora, "11:00");
  assert.equal(r[0].comando, "");
});

test("sesionesProximos7Dias: ignora valoraciones con status != confirmed", () => {
  const datos = {
    pacientes: [],
    sesiones: [],
    valoraciones: [
      { id: "v1", nombre: "X", email: "x@x", fecha: "2026-04-23T11:00:00", status: "cancelled" },
      { id: "v2", nombre: "Y", email: "y@x", fecha: "2026-04-23T12:00:00", status: "no_show" },
      { id: "v3", nombre: "Z", email: "z@x", fecha: "2026-04-23T13:00:00", status: "confirmed" }
    ]
  };
  const r = sesionesProximos7Dias(datos, HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].nombre, "Z");
});

test("sesionesProximos7Dias: ordena seguimientos y valoraciones mezclados por timestamp", () => {
  const datos = {
    pacientes: [{ id: "p1", nombre: "ANA", estado: "activo", alta: "2026-01-01" }],
    sesiones: [
      { id: "s1", paciente_id: "p1", fecha: "2026-04-23T15:00:00" } // +1 15:00
    ],
    valoraciones: [
      { id: "v1", nombre: "JORGE", email: "j@x", fecha: "2026-04-23T10:00:00", status: "confirmed" }, // +1 10:00
      { id: "v2", nombre: "ANTONIA", email: "a@x", fecha: "2026-04-24T09:00:00", status: "confirmed" }  // +2 09:00
    ]
  };
  const r = sesionesProximos7Dias(datos, HOY);
  assert.deepEqual(r.map(x => x.nombre), ["JORGE", "ANA", "ANTONIA"]);
  assert.deepEqual(r.map(x => x.tipo), ["valoracion", "seguimiento", "valoracion"]);
});

test("sesionesProximos7Dias: respeta la ventana también para valoraciones", () => {
  const datos = {
    pacientes: [],
    sesiones: [],
    valoraciones: [
      { id: "v1", nombre: "X", email: "x@x", fecha: "2026-04-22T10:00:00", status: "confirmed" }, // hoy → fuera
      { id: "v2", nombre: "Y", email: "y@x", fecha: "2026-04-30T10:00:00", status: "confirmed" }  // +8 → fuera
    ]
  };
  const r = sesionesProximos7Dias(datos, HOY);
  assert.equal(r.length, 0);
});

test("agruparHoy: sesionesHoy mezcla seguimiento y valoración del día con tipo correspondiente", () => {
  const datos = {
    pacientes: [
      { id: "p1", nombre: "ANA", estado: "activo", alta: "2026-01-01" }
    ],
    menus: [],
    sesiones: [
      { id: "s1", paciente_id: "p1", fecha: "2026-04-22T17:00:00" }
    ],
    checkins: [{ paciente_id: "p1", fecha: "2026-04-21", estado: "seguido" }],
    valoraciones: [
      { id: "v1", nombre: "JORGE", email: "j@x", fecha: "2026-04-22T10:00:00", status: "confirmed" }
    ]
  };
  const r = agruparHoy(datos, HOY);
  assert.equal(r.sesionesHoy.length, 2);
  // 10:00 antes que 17:00.
  assert.equal(r.sesionesHoy[0].tipo, "valoracion");
  assert.equal(r.sesionesHoy[0].nombre, "JORGE");
  assert.equal(r.sesionesHoy[0].pacienteId, null);
  assert.equal(r.sesionesHoy[1].tipo, "seguimiento");
  assert.equal(r.sesionesHoy[1].nombre, "ANA");
});

test("agruparHoy: valoración cancelled no aparece en sesionesHoy", () => {
  const datos = {
    pacientes: [],
    menus: [], sesiones: [], checkins: [],
    valoraciones: [
      { id: "v1", nombre: "X", email: "x@x", fecha: "2026-04-22T10:00:00", status: "cancelled" }
    ]
  };
  const r = agruparHoy(datos, HOY);
  assert.equal(r.sesionesHoy.length, 0);
});

test("agruparHoy: valoración futura aparece en proximos7Dias y NO en sesionesHoy", () => {
  const datos = {
    pacientes: [], menus: [], sesiones: [], checkins: [],
    valoraciones: [
      { id: "v1", nombre: "JORGE NAVARRO", email: "j@x", fecha: "2026-04-23T11:00:00", status: "confirmed" }
    ]
  };
  const r = agruparHoy(datos, HOY);
  assert.equal(r.sesionesHoy.length, 0);
  assert.equal(r.proximos7Dias.length, 1);
  assert.equal(r.proximos7Dias[0].tipo, "valoracion");
});

test("agruparHoy: ahora también devuelve proximos7Dias", () => {
  const r = agruparHoy(fixtureCompleta(), HOY);
  assert.ok(Array.isArray(r.proximos7Dias));
  // s2 es de p2 el 2026-04-28 (+6 días) → IN
  const ids = r.proximos7Dias.map(s => s.pacienteId);
  assert.ok(ids.includes("p2"), "p2 debería aparecer (sesión a +6 días)");
  // s1 es hoy → OUT, s6 es de p6 cerrada y hoy → OUT
  assert.ok(!ids.includes("p1"), "p1 (sesión hoy) NO debe aparecer");
  assert.ok(!ids.includes("p6"), "p6 (cerrada) NO debe aparecer");
});

test("DIAS_VENTANA_PROXIMOS exportada vale 7", () => {
  assert.equal(DIAS_VENTANA_PROXIMOS, 7);
});

// ===================================================================
// agruparHoy — bloque "Pendientes de resolver"
//
// Una valoración va a `pendientes` cuando:
//   - status='confirmed' (las cancelled/no_show/converted nunca aparecen)
//   - now >= fecha + 30 min (el slot ya ha terminado)
//   - NO existe paciente con ese email (case-insensitive trim) cuyo `alta`
//     sea posterior a la fecha de la valoración (ya dada de alta posterior)
//
// HOY_TARDE = 22 abril 2026 a las 15:00 — usado para los tests de pendientes
// porque HOY (00:00) deja todas las valoraciones del día con slot vigente.
// ===================================================================

const HOY_TARDE = new Date(2026, 3, 22, 15, 0);

test("agruparHoy: valoración con slot pasado y sin paciente → bloque pendientes", () => {
  const datos = {
    pacientes: [],
    menus: [], sesiones: [], checkins: [],
    valoraciones: [
      { id: "v1", nombre: "JORGE NAVARRO", email: "jorge@x.com",
        fecha: "2026-04-22T13:00:00", status: "confirmed" }
    ]
  };
  const r = agruparHoy(datos, HOY_TARDE);
  assert.equal(r.sesionesHoy.length, 0, "no debe aparecer en sesionesHoy");
  assert.equal(r.pendientes.length, 1, "sí debe aparecer en pendientes");
  const p = r.pendientes[0];
  assert.equal(p.valoracionId, "v1");
  assert.equal(p.nombre, "JORGE NAVARRO");
  assert.equal(p.email, "jorge@x.com");
  assert.equal(p.hora, "13:00");
  assert.equal(p.esHoy, true);
});

test("agruparHoy: valoración con slot vigente sigue en sesionesHoy, no en pendientes", () => {
  // HOY = 00:00; valoración a las 10:00 → slot termina 10:30, todavía no.
  const datos = {
    pacientes: [], menus: [], sesiones: [], checkins: [],
    valoraciones: [
      { id: "v1", nombre: "JORGE", email: "j@x", fecha: "2026-04-22T10:00:00", status: "confirmed" }
    ]
  };
  const r = agruparHoy(datos, HOY);
  assert.equal(r.sesionesHoy.length, 1, "sigue en sesionesHoy");
  assert.equal(r.pendientes.length, 0, "no debe aparecer en pendientes");
});

test("agruparHoy: valoración de día anterior con slot pasado → pendientes con diaLabel='Ayer'", () => {
  const datos = {
    pacientes: [], menus: [], sesiones: [], checkins: [],
    valoraciones: [
      { id: "v1", nombre: "ANA", email: "a@x.com", fecha: "2026-04-21T13:00:00", status: "confirmed" }
    ]
  };
  const r = agruparHoy(datos, HOY_TARDE);
  assert.equal(r.pendientes.length, 1);
  assert.equal(r.pendientes[0].diaLabel, "Ayer");
  assert.equal(r.pendientes[0].esHoy, false);
});

test("agruparHoy: valoración de hace varios días → diaLabel con fecha abreviada", () => {
  // 2026-04-19 → diff = -3 → 'Dom 19 abr' (abreviado, sin tilde en Dom).
  const datos = {
    pacientes: [], menus: [], sesiones: [], checkins: [],
    valoraciones: [
      { id: "v1", nombre: "MARTA", email: "m@x", fecha: "2026-04-19T10:00:00", status: "confirmed" }
    ]
  };
  const r = agruparHoy(datos, HOY_TARDE);
  assert.equal(r.pendientes.length, 1);
  assert.equal(r.pendientes[0].diaLabel, "Dom 19 abr");
  assert.equal(r.pendientes[0].esHoy, false);
});

test("agruparHoy: valoración con paciente alta posterior → resuelta, NO aparece en pendientes", () => {
  const datos = {
    pacientes: [
      { id: "p1", nombre: "JORGE NAVARRO", email: "jorge@x.com", estado: "activo",
        alta: "2026-04-22T14:00:00" }
    ],
    menus: [], sesiones: [], checkins: [],
    valoraciones: [
      { id: "v1", nombre: "JORGE NAVARRO", email: "jorge@x.com",
        fecha: "2026-04-22T13:00:00", status: "confirmed" }
    ]
  };
  const r = agruparHoy(datos, HOY_TARDE);
  assert.equal(r.pendientes.length, 0, "ya dada de alta → resuelta");
  assert.equal(r.sesionesHoy.length, 0);
});

test("agruparHoy: paciente con alta ANTERIOR a la valoración → la valoración sigue pendiente", () => {
  // Caso "paciente recurrente": cerrada hace meses y vuelve a hacer otra
  // valoración. El alta antigua no resuelve la valoración nueva.
  const datos = {
    pacientes: [
      { id: "p1", nombre: "JORGE", email: "jorge@x.com", estado: "cerrado",
        alta: "2025-10-01T10:00:00" }
    ],
    menus: [], sesiones: [], checkins: [],
    valoraciones: [
      { id: "v1", nombre: "JORGE", email: "jorge@x.com",
        fecha: "2026-04-22T13:00:00", status: "confirmed" }
    ]
  };
  const r = agruparHoy(datos, HOY_TARDE);
  assert.equal(r.pendientes.length, 1, "alta antigua no resuelve valoración nueva");
});

test("agruparHoy: match de email es case-insensitive y con trim", () => {
  const datos = {
    pacientes: [
      { id: "p1", nombre: "JORGE", email: "  Jorge@X.COM  ", estado: "activo",
        alta: "2026-04-22T14:00:00" }
    ],
    menus: [], sesiones: [], checkins: [],
    valoraciones: [
      { id: "v1", nombre: "JORGE", email: "jorge@x.com",
        fecha: "2026-04-22T13:00:00", status: "confirmed" }
    ]
  };
  const r = agruparHoy(datos, HOY_TARDE);
  assert.equal(r.pendientes.length, 0, "case+trim debe match → resuelta");
});

test("agruparHoy: status cancelled / no_show / converted nunca aparecen en pendientes", () => {
  const datos = {
    pacientes: [], menus: [], sesiones: [], checkins: [],
    valoraciones: [
      { id: "v1", nombre: "X", email: "x@x", fecha: "2026-04-22T13:00:00", status: "cancelled" },
      { id: "v2", nombre: "Y", email: "y@x", fecha: "2026-04-22T13:00:00", status: "no_show" },
      { id: "v3", nombre: "Z", email: "z@x", fecha: "2026-04-22T13:00:00", status: "converted" }
    ]
  };
  const r = agruparHoy(datos, HOY_TARDE);
  assert.equal(r.pendientes.length, 0);
});

test("agruparHoy: pendientes ordenadas por timestamp ascendente (más antiguas primero)", () => {
  const datos = {
    pacientes: [], menus: [], sesiones: [], checkins: [],
    valoraciones: [
      { id: "v_hoy",  nombre: "HOY",   email: "h@x", fecha: "2026-04-22T10:00:00", status: "confirmed" },
      { id: "v_ayer", nombre: "AYER",  email: "a@x", fecha: "2026-04-21T10:00:00", status: "confirmed" },
      { id: "v_lun",  nombre: "LUNES", email: "l@x", fecha: "2026-04-20T10:00:00", status: "confirmed" }
    ]
  };
  const r = agruparHoy(datos, HOY_TARDE);
  assert.deepEqual(r.pendientes.map(p => p.valoracionId), ["v_lun", "v_ayer", "v_hoy"]);
});

test("agruparHoy: pendientes conserva nombre/email vacíos tal cual (la UI valida al dar de alta)", () => {
  const datos = {
    pacientes: [], menus: [], sesiones: [], checkins: [],
    valoraciones: [
      { id: "v1", nombre: "", email: "x@x", fecha: "2026-04-22T13:00:00", status: "confirmed" },
      { id: "v2", nombre: "ANA", email: "", fecha: "2026-04-22T13:00:00", status: "confirmed" }
    ]
  };
  const r = agruparHoy(datos, HOY_TARDE);
  assert.equal(r.pendientes.length, 2);
  assert.equal(r.pendientes[0].nombre, "");
  assert.equal(r.pendientes[1].email, "");
});

// ===================================================================
// priorizarPacientes
// ===================================================================

test("priorizarPacientes: activas antes que cerradas", () => {
  const pacientes = [
    { id: "p1", nombre: "ZOE", estado: "cerrado" },
    { id: "p2", nombre: "ANA", estado: "activo" }
  ];
  const r = priorizarPacientes(pacientes, { hoy: HOY });
  assert.equal(r[0].id, "p2");
  assert.equal(r[1].id, "p1");
});

test("priorizarPacientes: dentro de activas, próxima sesión asc, sin sesión al final", () => {
  const pacientes = [
    { id: "p1", nombre: "ANA", estado: "activo" },
    { id: "p2", nombre: "BEA", estado: "activo" },
    { id: "p3", nombre: "CARMEN", estado: "activo" }
  ];
  const sesiones = [
    { id: "s1", paciente_id: "p1", fecha: "2026-04-30T10:00:00" },
    { id: "s2", paciente_id: "p2", fecha: "2026-04-23T10:00:00" }
    // p3 sin sesión
  ];
  const r = priorizarPacientes(pacientes, { hoy: HOY, sesiones });
  assert.deepEqual(r.map(x => x.id), ["p2", "p1", "p3"]);
});

test("priorizarPacientes: filtro estado='activas' excluye cerradas", () => {
  const pacientes = [
    { id: "p1", nombre: "ANA", estado: "activo" },
    { id: "p2", nombre: "BEA", estado: "cerrado" }
  ];
  const r = priorizarPacientes(pacientes, { estado: "activas", hoy: HOY });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, "p1");
});

test("priorizarPacientes: filtro estado='cerradas' devuelve solo cerradas", () => {
  const pacientes = [
    { id: "p1", nombre: "ANA", estado: "activo" },
    { id: "p2", nombre: "BEA", estado: "cerrado" }
  ];
  const r = priorizarPacientes(pacientes, { estado: "cerradas", hoy: HOY });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, "p2");
});

test("priorizarPacientes: filtro estado='todas' (default)", () => {
  const pacientes = [
    { id: "p1", nombre: "ANA", estado: "activo" },
    { id: "p2", nombre: "BEA", estado: "cerrado" }
  ];
  const r = priorizarPacientes(pacientes, { hoy: HOY });
  assert.equal(r.length, 2);
});

test("priorizarPacientes: ignora sesiones pasadas", () => {
  const pacientes = [
    { id: "p1", nombre: "ANA", estado: "activo" },
    { id: "p2", nombre: "BEA", estado: "activo" }
  ];
  const sesiones = [
    { id: "s1", paciente_id: "p1", fecha: "2026-04-30T10:00:00" },
    { id: "s2", paciente_id: "p2", fecha: "2026-04-01T10:00:00" } // pasada
  ];
  const r = priorizarPacientes(pacientes, { hoy: HOY, sesiones });
  // p2 tiene solo una sesión pasada → cae al final (como "sin sesión")
  assert.deepEqual(r.map(x => x.id), ["p1", "p2"]);
});

// ===================================================================
// Test de sanity: los comandos generados apuntan a skills que existen
// ===================================================================

// Ruta al repo original (read-only desde el worktree). Si el repo principal
// no está accesible (CI), caemos a validación contra SKILLS_VALIDAS.
const REPO_PRINCIPAL = path.resolve(
  __dirname, "..", "..", "..", "cln-claude-main", ".claude", "skills"
);
const REPO_WORKTREE = path.resolve(
  __dirname, "..", "..", ".claude", "skills"
);

function skillsEnDisco() {
  for (const dir of [REPO_WORKTREE, REPO_PRINCIPAL]) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        // excluir skill-factory (es clone read-only, no skill activa)
        .filter(n => n !== "skill-factory");
    } catch (e) {
      // probar siguiente ruta
    }
  }
  return null; // ninguna accesible
}

test("sanity: SKILLS_VALIDAS alineada con .claude/skills/ en disco", (t) => {
  const enDisco = skillsEnDisco();
  if (!enDisco) {
    // Ambos paths fallan: no podemos validar desde filesystem (caso típico:
    // CI público sin acceso al repo principal con `.claude/`). Marcamos como
    // skipped para que aparezca explícito en el reporter — un "✓ pass" sería
    // engañoso aquí.
    t.skip("skills en disco no accesibles (FS lookup vacío)");
    return;
  }
  // Cada skill en disco debe estar en SKILLS_VALIDAS
  for (const s of enDisco) {
    assert.ok(
      SKILLS_VALIDAS.has(s),
      `skill '${s}' existe en .claude/skills/ pero no está en SKILLS_VALIDAS`
    );
  }
  // Y viceversa: cada SKILLS_VALIDAS debe existir en disco (evita typos)
  for (const s of SKILLS_VALIDAS) {
    assert.ok(
      enDisco.includes(s),
      `SKILLS_VALIDAS incluye '${s}' pero no existe carpeta en .claude/skills/`
    );
  }
});

test("sanity: cada comando generado por agruparHoy apunta a una skill válida", () => {
  const r = agruparHoy(fixtureCompleta(), HOY);
  const todosComandos = [
    ...r.sesionesHoy.map(x => x.comando),
    ...r.proximos7Dias.map(x => x.comando),
    ...r.menusCrearSemana.map(x => x.comando)
  ];
  assert.ok(todosComandos.length > 0, "fixture debe generar al menos un comando");
  for (const cmd of todosComandos) {
    const match = cmd.match(/^\/([a-z-]+)\s/);
    assert.ok(match, `comando mal formado: ${cmd}`);
    const skill = match[1];
    assert.ok(
      SKILLS_VALIDAS.has(skill),
      `comando '${cmd}' apunta a skill desconocida '${skill}'`
    );
  }
});

// ===================================================================
// validarEnv — gate de build en prod
// ===================================================================

test("validarEnv: producción sin CRISTINA_EMAIL → lanza", () => {
  assert.throws(
    () => validarEnv({ NODE_ENV: "production" }),
    /CRISTINA_EMAIL requerida/
  );
});

test("validarEnv: producción con CRISTINA_EMAIL → ok", () => {
  assert.equal(
    validarEnv({ NODE_ENV: "production", CRISTINA_EMAIL: "cris@x.com" }),
    true
  );
});

test("validarEnv: desarrollo sin CRISTINA_EMAIL → ok (solo gate en prod)", () => {
  assert.equal(validarEnv({ NODE_ENV: "development" }), true);
  assert.equal(validarEnv({}), true);
});

test("validarEnv: sube al proceso vía child_process con env controlado", () => {
  // Simulamos el escenario real: el build de CI invocaría este validador
  // con process.env. Comprobamos el contrato acoplado a process.env.
  const { spawnSync } = require("node:child_process");
  const LOGIC = path.resolve(__dirname, "..", "src", "backoffice", "logic.js");

  const prodOk = spawnSync(process.execPath, [
    "-e",
    `const { validarEnv } = require(${JSON.stringify(LOGIC)}); validarEnv(process.env);`
  ], { env: { NODE_ENV: "production", CRISTINA_EMAIL: "cris@x.com" } });
  assert.equal(prodOk.status, 0, `stderr: ${prodOk.stderr}`);

  const prodFail = spawnSync(process.execPath, [
    "-e",
    `const { validarEnv } = require(${JSON.stringify(LOGIC)}); validarEnv(process.env);`
  ], { env: { NODE_ENV: "production" } });
  assert.notEqual(prodFail.status, 0, "esperaba exit != 0 sin CRISTINA_EMAIL en prod");
  assert.match(String(prodFail.stderr), /CRISTINA_EMAIL requerida/);
});

// ===================================================================
// calcularMetricasHoy
// ===================================================================
//
// Constantes fijadas en el módulo (no las hardcodeamos en tests para que un
// cambio razonado en una sola parte no requiera retocar 10 tests):
//   REPESCA_VENTANA_DIAS=90, GAP_REPESCA_DIAS=21, REPESCA_MIN_DENOMINADOR=3.
// Las usamos cuando el cálculo depende de ellas.

test("calcularMetricasHoy: expone constantes coherentes", () => {
  assert.equal(REPESCA_VENTANA_DIAS, 90);
  assert.equal(GAP_REPESCA_DIAS, 21);
  assert.equal(REPESCA_MIN_DENOMINADOR, 3);
});

test("calcularMetricasHoy: cuenta solo pacientes con estado 'activo'", () => {
  const datos = {
    pacientes: [
      { id: "p1", nombre: "A", estado: "activo", alta: "2026-01-01" },
      { id: "p2", nombre: "B", estado: "activo", alta: "2026-01-01" },
      { id: "p3", nombre: "C", estado: "cerrado", alta: "2025-01-01" },
      { id: "p4", nombre: "D", estado: "pausa",   alta: "2026-01-01" }
    ],
    menus: [], sesiones: [], checkins: []
  };
  const r = calcularMetricasHoy(datos, HOY);
  assert.equal(r.activas, 2);
});

test("calcularMetricasHoy: sin pacientes → 0 activas", () => {
  const r = calcularMetricasHoy({ pacientes: [], menus: [], sesiones: [], checkins: [] }, HOY);
  assert.equal(r.activas, 0);
});

test("calcularMetricasHoy: menusEsteMes cuenta solo menús con created_at en el mes actual", () => {
  // HOY = 22 abril 2026 → mes natural = abril 2026 [01-abril, 01-mayo)
  const datos = {
    pacientes: [],
    menus: [
      { id: "m1", paciente_id: "p1", numero: 1, vigente_desde: "2026-04-01", created_at: "2026-04-01T10:00:00Z" },
      { id: "m2", paciente_id: "p2", numero: 1, vigente_desde: "2026-04-15", created_at: "2026-04-15T08:00:00Z" },
      // Mes anterior
      { id: "m3", paciente_id: "p3", numero: 1, vigente_desde: "2026-03-28", created_at: "2026-03-28T10:00:00Z" },
      // Mes siguiente
      { id: "m4", paciente_id: "p4", numero: 1, vigente_desde: "2026-05-02", created_at: "2026-05-02T10:00:00Z" }
    ],
    sesiones: [], checkins: []
  };
  const r = calcularMetricasHoy(datos, HOY);
  assert.equal(r.menusEsteMes, 2);
});

test("calcularMetricasHoy: menusEsteMes usa vigente_desde cuando falta created_at (legacy)", () => {
  const datos = {
    pacientes: [],
    menus: [
      // sin created_at, vigente_desde en mes actual
      { id: "m1", paciente_id: "p1", numero: 1, vigente_desde: "2026-04-05" },
      // sin created_at, vigente_desde en otro mes
      { id: "m2", paciente_id: "p2", numero: 1, vigente_desde: "2026-02-10" }
    ],
    sesiones: [], checkins: []
  };
  const r = calcularMetricasHoy(datos, HOY);
  assert.equal(r.menusEsteMes, 1);
});

test("calcularMetricasHoy: devuelve estructura con las 3 claves esperadas", () => {
  const r = calcularMetricasHoy({ pacientes: [], menus: [], sesiones: [], checkins: [] }, HOY);
  assert.ok("activas" in r);
  assert.ok("menusEsteMes" in r);
  assert.ok("repescas" in r);
  assert.ok("numerador" in r.repescas);
  assert.ok("denominador" in r.repescas);
  assert.ok("label" in r.repescas);
});

test("calcularMetricasHoy: sin pacientes con gap suficiente → 'Sin datos suficientes'", () => {
  // Todas las pacientes tienen checkins recientes → ninguna con gap ≥ 21.
  const datos = {
    pacientes: [
      { id: "p1", nombre: "A", estado: "activo", alta: "2026-01-01" },
      { id: "p2", nombre: "B", estado: "activo", alta: "2026-01-01" },
      { id: "p3", nombre: "C", estado: "activo", alta: "2026-01-01" }
    ],
    menus: [],
    sesiones: [],
    checkins: [
      { paciente_id: "p1", fecha: "2026-04-20", estado: "seguido" },
      { paciente_id: "p2", fecha: "2026-04-19", estado: "seguido" },
      { paciente_id: "p3", fecha: "2026-04-18", estado: "seguido" }
    ]
  };
  const r = calcularMetricasHoy(datos, HOY);
  assert.equal(r.repescas.label, "Sin datos suficientes");
  assert.equal(r.repescas.numerador, 0);
  assert.equal(r.repescas.denominador, 0);
});

test("calcularMetricasHoy: denominador < 3 → 'Sin datos suficientes' aunque haya algún gap", () => {
  // Solo 1 paciente con gap; REPESCA_MIN_DENOMINADOR=3 → sin datos suficientes.
  const datos = {
    pacientes: [
      { id: "p1", nombre: "A", estado: "activo", alta: "2026-01-01" },
      { id: "p2", nombre: "B", estado: "activo", alta: "2026-01-01" }
    ],
    menus: [],
    sesiones: [],
    checkins: [
      // p1: tiene gap de ~25 días y responde después
      { paciente_id: "p1", fecha: "2026-02-15", estado: "seguido" },
      { paciente_id: "p1", fecha: "2026-03-15", estado: "seguido" },
      { paciente_id: "p1", fecha: "2026-04-10", estado: "seguido" },
      // p2: sin gap (checkins frecuentes)
      { paciente_id: "p2", fecha: "2026-04-20", estado: "seguido" },
      { paciente_id: "p2", fecha: "2026-04-15", estado: "seguido" }
    ]
  };
  const r = calcularMetricasHoy(datos, HOY);
  assert.equal(r.repescas.label, "Sin datos suficientes");
});

test("calcularMetricasHoy: ≥3 pacientes con gap → calcula tasa X/Y", () => {
  // 3 pacientes activas con gap ≥ 21 días dentro de la ventana de 90.
  // p1 y p2 vuelven después del gap (respondio=true).
  // p3 sigue en silencio (respondio=false).
  const datos = {
    pacientes: [
      { id: "p1", nombre: "A", estado: "activo", alta: "2026-01-01" },
      { id: "p2", nombre: "B", estado: "activo", alta: "2026-01-01" },
      { id: "p3", nombre: "C", estado: "activo", alta: "2026-01-01" }
    ],
    menus: [],
    sesiones: [],
    checkins: [
      // p1: actividad, luego gap de ~30 días, luego vuelve
      { paciente_id: "p1", fecha: "2026-02-01", estado: "seguido" },
      { paciente_id: "p1", fecha: "2026-03-05", estado: "seguido" },
      { paciente_id: "p1", fecha: "2026-04-15", estado: "seguido" }, // respondió
      // p2: actividad + gap + vuelve
      { paciente_id: "p2", fecha: "2026-02-10", estado: "seguido" },
      { paciente_id: "p2", fecha: "2026-03-15", estado: "seguido" },
      { paciente_id: "p2", fecha: "2026-04-18", estado: "seguido" }, // respondió
      // p3: un checkin hace mucho, gap abierto hasta hoy → no respondió
      { paciente_id: "p3", fecha: "2026-02-01", estado: "seguido" },
      { paciente_id: "p3", fecha: "2026-02-20", estado: "seguido" }
      // sin actividad después → gap abierto
    ]
  };
  const r = calcularMetricasHoy(datos, HOY);
  assert.equal(r.repescas.denominador, 3);
  assert.equal(r.repescas.numerador, 2);
  assert.equal(r.repescas.label, "Respuesta a repescas (últimos 90 días)");
});

test("calcularMetricasHoy: pacientes cerrados no entran en denominador de repescas", () => {
  const datos = {
    pacientes: [
      { id: "p1", nombre: "A", estado: "cerrado", alta: "2025-01-01" },
      { id: "p2", nombre: "B", estado: "cerrado", alta: "2025-01-01" },
      { id: "p3", nombre: "C", estado: "cerrado", alta: "2025-01-01" }
    ],
    menus: [],
    sesiones: [],
    checkins: [
      { paciente_id: "p1", fecha: "2026-02-01", estado: "seguido" },
      { paciente_id: "p2", fecha: "2026-02-10", estado: "seguido" },
      { paciente_id: "p3", fecha: "2026-02-15", estado: "seguido" }
    ]
  };
  const r = calcularMetricasHoy(datos, HOY);
  // 0 pacientes activas → 0 denominador → sin datos suficientes.
  assert.equal(r.activas, 0);
  assert.equal(r.repescas.label, "Sin datos suficientes");
});

test("calcularMetricasHoy: usa sesiones Y checkins para detectar actividad", () => {
  // 3 activas con gap + respondidas vía sesiones (no solo checkins).
  const datos = {
    pacientes: [
      { id: "p1", nombre: "A", estado: "activo", alta: "2026-01-01" },
      { id: "p2", nombre: "B", estado: "activo", alta: "2026-01-01" },
      { id: "p3", nombre: "C", estado: "activo", alta: "2026-01-01" }
    ],
    menus: [],
    sesiones: [
      // p1: sesión antes + sesión después del gap
      { id: "s1", paciente_id: "p1", fecha: "2026-02-01T10:00:00Z" },
      { id: "s2", paciente_id: "p1", fecha: "2026-03-10T10:00:00Z" },
      { id: "s3", paciente_id: "p1", fecha: "2026-04-15T10:00:00Z" },
      // p2: con sesiones espaciadas
      { id: "s4", paciente_id: "p2", fecha: "2026-02-05T10:00:00Z" },
      { id: "s5", paciente_id: "p2", fecha: "2026-03-12T10:00:00Z" },
      { id: "s6", paciente_id: "p2", fecha: "2026-04-18T10:00:00Z" },
      // p3: gap abierto, sin actividad reciente
      { id: "s7", paciente_id: "p3", fecha: "2026-02-20T10:00:00Z" }
    ],
    checkins: []
  };
  const r = calcularMetricasHoy(datos, HOY);
  assert.equal(r.repescas.denominador, 3);
  assert.equal(r.repescas.numerador, 2);
});

test("calcularMetricasHoy: integración — combina 3 métricas en fixture realista", () => {
  const datos = {
    pacientes: [
      { id: "p1", nombre: "A", estado: "activo", alta: "2026-01-01" },
      { id: "p2", nombre: "B", estado: "activo", alta: "2026-01-01" },
      { id: "p3", nombre: "C", estado: "cerrado", alta: "2025-01-01" }
    ],
    menus: [
      { id: "m1", paciente_id: "p1", numero: 2, vigente_desde: "2026-04-05", created_at: "2026-04-05T09:00:00Z" },
      { id: "m2", paciente_id: "p2", numero: 1, vigente_desde: "2026-04-12", created_at: "2026-04-12T09:00:00Z" },
      { id: "m3", paciente_id: "p3", numero: 5, vigente_desde: "2025-10-01", created_at: "2025-10-01T09:00:00Z" }
    ],
    sesiones: [],
    checkins: [
      { paciente_id: "p1", fecha: "2026-04-20", estado: "seguido" },
      { paciente_id: "p2", fecha: "2026-04-19", estado: "seguido" }
    ]
  };
  const r = calcularMetricasHoy(datos, HOY);
  assert.equal(r.activas, 2);
  assert.equal(r.menusEsteMes, 2);
  // denominador < 3 → sin datos suficientes
  assert.equal(r.repescas.label, "Sin datos suficientes");
});

test("calcularMetricasHoy: tolera datos undefined/null sin romper", () => {
  const r = calcularMetricasHoy({}, HOY);
  assert.equal(r.activas, 0);
  assert.equal(r.menusEsteMes, 0);
  assert.equal(r.repescas.label, "Sin datos suficientes");
});

// ===================================================================
// _sumarMeses — helper público para añadir N meses a una fecha
// ===================================================================

const { _sumarMeses } = require("../src/backoffice/logic.js");

// Helper local para asertar fecha en formato YYYY-MM-DD usando componentes
// LOCALES (getDate/getMonth/getFullYear). Evita el bug de .toISOString() que
// interpreta UTC y rompe los tests fuera de TZ=UTC. _sumarMeses devuelve un
// Date a medianoche local; comparar componentes locales es la única forma
// estable a través de zonas horarias.
function _ymdLocal(d) {
  if (!d) return null;
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}

test("_sumarMeses: caso simple 1 abr + 1 mes → 1 may", () => {
  const r = _sumarMeses("2026-04-01", 1);
  assert.equal(_ymdLocal(r), "2026-05-01");
});

test("_sumarMeses: caso simple 15 mar + 2 meses → 15 may", () => {
  const r = _sumarMeses("2026-03-15", 2);
  assert.equal(_ymdLocal(r), "2026-05-15");
});

test("_sumarMeses: 31 ene + 1 mes → 28 feb (año no bisiesto)", () => {
  const r = _sumarMeses("2026-01-31", 1);
  assert.equal(_ymdLocal(r), "2026-02-28");
});

test("_sumarMeses: 31 ene 2028 + 1 mes → 29 feb (año bisiesto)", () => {
  const r = _sumarMeses("2028-01-31", 1);
  assert.equal(_ymdLocal(r), "2028-02-29");
});

test("_sumarMeses: 31 mar + 1 mes → 30 abr", () => {
  const r = _sumarMeses("2026-03-31", 1);
  assert.equal(_ymdLocal(r), "2026-04-30");
});

test("_sumarMeses: cruza año (1 dic + 2 meses → 1 feb siguiente)", () => {
  const r = _sumarMeses("2026-12-01", 2);
  assert.equal(_ymdLocal(r), "2027-02-01");
});

test("_sumarMeses: acepta Date como entrada", () => {
  const r = _sumarMeses(new Date(2026, 3, 1), 1); // 1 abr 2026 (mes 3 es abril)
  assert.equal(r.getFullYear(), 2026);
  assert.equal(r.getMonth(), 4); // mayo
  assert.equal(r.getDate(), 1);
});

test("_sumarMeses: fecha inválida → null", () => {
  assert.equal(_sumarMeses("not-a-date", 1), null);
  assert.equal(_sumarMeses(null, 1), null);
});

// ===================================================================
// calcularProximoPago — derivación de la fecha esperada del próximo pago
// ===================================================================

const { calcularProximoPago, UMBRAL_AVISO_DIAS } = require("../src/backoffice/logic.js");

const HOY_PAGOS = new Date(2026, 4, 1); // 1 may 2026 (mes 4 = mayo)

test("calcularProximoPago: paciente cerrado → null", () => {
  const r = calcularProximoPago({ id: "p1", estado: "cerrado" }, [], HOY_PAGOS);
  assert.equal(r, null);
});

test("calcularProximoPago: paciente activo sin pagos → estado sin_pagos", () => {
  const r = calcularProximoPago({ id: "p1", estado: "activo" }, [], HOY_PAGOS);
  assert.equal(r.estado, "sin_pagos");
  assert.equal(r.fechaEsperada, null);
  assert.equal(r.diasDiff, null);
});

test("calcularProximoPago: alta 1 abr, hoy 1 may → aviso (vence hoy, diasDiff=0)", () => {
  const pagos = [{ id: "x", paciente_id: "p1", fecha: "2026-04-01", concepto: "alta" }];
  const r = calcularProximoPago({ id: "p1", estado: "activo" }, pagos, HOY_PAGOS);
  assert.equal(r.estado, "aviso");
  assert.equal(r.fechaEsperada, "2026-05-01");
  assert.equal(r.diasDiff, 0);
});

test("calcularProximoPago: alta 1 abr, hoy 30 abr → aviso (vence mañana, diasDiff=1)", () => {
  const pagos = [{ id: "x", paciente_id: "p1", fecha: "2026-04-01", concepto: "alta" }];
  const r = calcularProximoPago(
    { id: "p1", estado: "activo" },
    pagos,
    new Date(2026, 3, 30) // 30 abr
  );
  assert.equal(r.estado, "aviso");
  assert.equal(r.diasDiff, 1);
});

test("calcularProximoPago: alta 1 abr, hoy 28 abr → al_dia (3 días vista, fuera ventana aviso)", () => {
  const pagos = [{ id: "x", paciente_id: "p1", fecha: "2026-04-01", concepto: "alta" }];
  const r = calcularProximoPago(
    { id: "p1", estado: "activo" },
    pagos,
    new Date(2026, 3, 28) // 28 abr
  );
  assert.equal(r.estado, "al_dia");
  assert.equal(r.diasDiff, 3);
});

test("calcularProximoPago: alta 1 abr, hoy 5 may → vencido (4 días, diasDiff=-4)", () => {
  const pagos = [{ id: "x", paciente_id: "p1", fecha: "2026-04-01", concepto: "alta" }];
  const r = calcularProximoPago(
    { id: "p1", estado: "activo" },
    pagos,
    new Date(2026, 4, 5) // 5 may
  );
  assert.equal(r.estado, "vencido");
  assert.equal(r.diasDiff, -4);
});

test("calcularProximoPago: caso Cristina — alta 1 abr + renovación 3 may → próximo 3 jun", () => {
  // Regla "último pago + 1 mes": la renovación se pagó el 3 may, así que el
  // siguiente cobro se cuenta desde ahí (3 jun), no desde el alta.
  const pagos = [
    { id: "x", paciente_id: "p1", fecha: "2026-04-01", concepto: "alta" },
    { id: "y", paciente_id: "p1", fecha: "2026-05-03", concepto: "renovacion" }
  ];
  const r = calcularProximoPago(
    { id: "p1", estado: "activo" },
    pagos,
    new Date(2026, 4, 15) // 15 may
  );
  assert.equal(r.fechaEsperada, "2026-06-03");
  assert.equal(r.estado, "al_dia"); // 19 días vista
  assert.equal(r.diasDiff, 19);
});

test("calcularProximoPago: caso Antonia Marco — alta 22 may + renovación 7 jul → próximo 7 ago", () => {
  // Pago irregular (se saltó junio). El próximo cobro se cuenta desde el
  // último pago real (7 jul), no desde el alta.
  const pagos = [
    { id: "x", paciente_id: "p1", fecha: "2026-05-22", concepto: "alta" },
    { id: "y", paciente_id: "p1", fecha: "2026-07-07", concepto: "renovacion" }
  ];
  const r = calcularProximoPago(
    { id: "p1", estado: "activo" },
    pagos,
    new Date(2026, 6, 20) // 20 jul
  );
  assert.equal(r.fechaEsperada, "2026-08-07");
  assert.equal(r.estado, "al_dia");
});

test("calcularProximoPago: dos pagos el mismo día → cuenta el último (+1 mes)", () => {
  const pagos = [
    { id: "x", paciente_id: "p1", fecha: "2026-04-01", concepto: "alta" },
    { id: "y", paciente_id: "p1", fecha: "2026-04-01", concepto: "renovacion" }
  ];
  const r = calcularProximoPago(
    { id: "p1", estado: "activo" },
    pagos,
    new Date(2026, 4, 1)
  );
  // Último pago 1 abr + 1 mes = 1 may (vence hoy)
  assert.equal(r.fechaEsperada, "2026-05-01");
  assert.equal(r.estado, "aviso");
});

test("calcularProximoPago: concepto 'otro' no avanza el ciclo", () => {
  const pagos = [
    { id: "x", paciente_id: "p1", fecha: "2026-04-01", concepto: "alta" },
    { id: "y", paciente_id: "p1", fecha: "2026-04-15", concepto: "otro" } // ajuste/reembolso
  ];
  const r = calcularProximoPago(
    { id: "p1", estado: "activo" },
    pagos,
    new Date(2026, 4, 1)
  );
  // Solo el alta cuenta → ancla 1 abr + 1 mes = 1 may (estado aviso = vence hoy)
  assert.equal(r.fechaEsperada, "2026-05-01");
  assert.equal(r.estado, "aviso");
});

test("calcularProximoPago: reactivación con nueva alta → cuenta desde el último pago", () => {
  // Ciclo viejo: feb-mar (alta + renovacion), cerrado a finales mar.
  // Reactivación: 10 jun nueva alta. El último pago manda.
  const pagos = [
    { id: "viejo1", paciente_id: "p1", fecha: "2026-02-01", concepto: "alta" },
    { id: "viejo2", paciente_id: "p1", fecha: "2026-03-01", concepto: "renovacion" },
    { id: "nuevo",  paciente_id: "p1", fecha: "2026-06-10", concepto: "alta" }
  ];
  const r = calcularProximoPago(
    { id: "p1", estado: "activo" },
    pagos,
    new Date(2026, 5, 15) // 15 jun
  );
  // Último pago = 10 jun. fechaEsperada = 10 jun + 1 mes = 10 jul.
  assert.equal(r.fechaEsperada, "2026-07-10");
  assert.equal(r.estado, "al_dia");
});

test("calcularProximoPago: solo pagos sin alta (caso histórico) → último pago + 1 mes", () => {
  const pagos = [
    { id: "h1", paciente_id: "p1", fecha: "2026-02-01", concepto: "renovacion" },
    { id: "h2", paciente_id: "p1", fecha: "2026-03-01", concepto: "renovacion" }
  ];
  const r = calcularProximoPago(
    { id: "p1", estado: "activo" },
    pagos,
    new Date(2026, 3, 1) // 1 abr
  );
  // Último pago = 1 mar. fechaEsperada = 1 mar + 1 mes = 1 abr (vence hoy).
  assert.equal(r.fechaEsperada, "2026-04-01");
  assert.equal(r.estado, "aviso");
});

test("calcularProximoPago: pagos de OTROS pacientes se ignoran", () => {
  const pagos = [
    { id: "ajeno", paciente_id: "p2", fecha: "2026-04-01", concepto: "alta" },
    { id: "mio",   paciente_id: "p1", fecha: "2026-04-01", concepto: "alta" }
  ];
  const r = calcularProximoPago({ id: "p1", estado: "activo" }, pagos, HOY_PAGOS);
  assert.equal(r.fechaEsperada, "2026-05-01");
});

test("calcularProximoPago: pago con fecha malformada se ignora", () => {
  const pagos = [
    { id: "ok",  paciente_id: "p1", fecha: "2026-04-01", concepto: "alta" },
    { id: "mal", paciente_id: "p1", fecha: "not-a-date", concepto: "renovacion" }
  ];
  const r = calcularProximoPago(
    { id: "p1", estado: "activo" },
    pagos,
    new Date(2026, 4, 1)
  );
  // Solo el bueno cuenta: N=1, fechaEsperada = 1 may.
  assert.equal(r.fechaEsperada, "2026-05-01");
});

test("calcularProximoPago: alta 31 ene → fechaEsperada 28/29 feb (overflow día)", () => {
  const pagos = [{ id: "x", paciente_id: "p1", fecha: "2026-01-31", concepto: "alta" }];
  const r = calcularProximoPago(
    { id: "p1", estado: "activo" },
    pagos,
    new Date(2026, 1, 28) // 28 feb 2026 (no bisiesto)
  );
  assert.equal(r.fechaEsperada, "2026-02-28");
});

test("UMBRAL_AVISO_DIAS exportado como 2", () => {
  assert.equal(UMBRAL_AVISO_DIAS, 2);
});

// ===================================================================
// recordatoriosPago — agregación para el bloque "Pagos pendientes"
// ===================================================================

const { recordatoriosPago } = require("../src/backoffice/logic.js");

test("recordatoriosPago: filtra solo activos con estado vencido o aviso", () => {
  const pacientes = [
    { id: "p1", nombre: "ANA",   estado: "activo" },   // vencido
    { id: "p2", nombre: "LAURA", estado: "activo" },   // aviso
    { id: "p3", nombre: "SARA",  estado: "activo" },   // al_dia (no entra)
    { id: "p4", nombre: "EVA",   estado: "cerrado" },  // cerrado (no entra)
    { id: "p5", nombre: "INÉS",  estado: "activo" }    // sin_pagos (no entra)
  ];
  const pagos = [
    { id: "a", paciente_id: "p1", fecha: "2026-03-01", concepto: "alta" }, // próximo 1 abr (vencido)
    { id: "b", paciente_id: "p2", fecha: "2026-04-01", concepto: "alta" }, // próximo 1 may (aviso)
    { id: "c", paciente_id: "p3", fecha: "2026-04-15", concepto: "alta" }, // próximo 15 may (al_dia)
    { id: "d", paciente_id: "p4", fecha: "2026-04-01", concepto: "alta" }
  ];
  const r = recordatoriosPago(pacientes, pagos, new Date(2026, 4, 1)); // 1 may
  const ids = r.map(x => x.pacienteId);
  assert.deepEqual(ids, ["p1", "p2"]); // ANA primero (vencido), LAURA después (aviso)
});

test("recordatoriosPago: orden vencidos → avisos; vencidos por fecha más antigua arriba", () => {
  const pacientes = [
    { id: "a", nombre: "ANNA",  estado: "activo" },
    { id: "b", nombre: "BERTA", estado: "activo" },
    { id: "c", nombre: "CARLA", estado: "activo" },
    { id: "d", nombre: "DIANA", estado: "activo" }
  ];
  const pagos = [
    // próximo 1 mar (vencido 61 días)
    { id: "1", paciente_id: "a", fecha: "2026-02-01", concepto: "alta" },
    // próximo 1 abr (vencido 30 días)
    { id: "2", paciente_id: "b", fecha: "2026-03-01", concepto: "alta" },
    // próximo 1 may (aviso, vence hoy)
    { id: "3", paciente_id: "c", fecha: "2026-04-01", concepto: "alta" },
    // próximo 2 may (aviso, vence mañana)
    { id: "4", paciente_id: "d", fecha: "2026-04-02", concepto: "alta" }
  ];
  const r = recordatoriosPago(pacientes, pagos, new Date(2026, 4, 1)); // 1 may
  const ids = r.map(x => x.pacienteId);
  // ANNA (más vencido), BERTA (vencido), CARLA (aviso hoy), DIANA (aviso mañana)
  assert.deepEqual(ids, ["a", "b", "c", "d"]);
});

test("recordatoriosPago: empate de diasDiff → orden alfabético es-ES", () => {
  const pacientes = [
    { id: "1", nombre: "ZOE",    estado: "activo" },
    { id: "2", nombre: "ÁNGELA", estado: "activo" }, // tilde, debe ir antes en es-ES
    { id: "3", nombre: "BEA",    estado: "activo" }
  ];
  const pagos = [
    { id: "x", paciente_id: "1", fecha: "2026-04-01", concepto: "alta" },
    { id: "y", paciente_id: "2", fecha: "2026-04-01", concepto: "alta" },
    { id: "z", paciente_id: "3", fecha: "2026-04-01", concepto: "alta" }
  ];
  const r = recordatoriosPago(pacientes, pagos, new Date(2026, 4, 1));
  assert.deepEqual(r.map(x => x.nombre), ["ÁNGELA", "BEA", "ZOE"]);
});

test("recordatoriosPago: campos del item — pacienteId, nombre, fechaEsperada, estado, diasDiff", () => {
  const pacientes = [{ id: "p1", nombre: "ANA", estado: "activo" }];
  const pagos = [{ id: "x", paciente_id: "p1", fecha: "2026-04-01", concepto: "alta" }];
  const r = recordatoriosPago(pacientes, pagos, new Date(2026, 4, 1));
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], {
    pacienteId: "p1",
    nombre: "ANA",
    fechaEsperada: "2026-05-01",
    estado: "aviso",
    diasDiff: 0
  });
});

test("recordatoriosPago: sin pacientes → array vacío", () => {
  assert.deepEqual(recordatoriosPago([], [], new Date()), []);
  assert.deepEqual(recordatoriosPago(null, null, new Date()), []);
});

test("recordatoriosPago: error en calcularProximoPago de un paciente NO rompe el resto", () => {
  // Defensa: si un paciente tiene datos raros que provoquen excepción, el
  // bloque no debe explotar — ese paciente queda fuera y los demás siguen.
  const pacientes = [
    { id: "p1", nombre: "ANA", estado: "activo" },
    null, // entrada basura
    { id: "p2", nombre: "EVA", estado: "activo" }
  ];
  const pagos = [
    { id: "a", paciente_id: "p1", fecha: "2026-04-01", concepto: "alta" },
    { id: "b", paciente_id: "p2", fecha: "2026-04-01", concepto: "alta" }
  ];
  const r = recordatoriosPago(pacientes, pagos, new Date(2026, 4, 1));
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(x => x.pacienteId).sort(), ["p1", "p2"]);
});

// ===================================================================
// Acciones directas: construirPayload / comandoRescate / resumenResultadoAccion / NOMBRE_EF
// ===================================================================

test('construirPayload agendar: datetime-local → ISO + default 30min', () => {
  const r = construirPayload('agendar', { fecha: '2026-07-01T17:00', duracion: '', notas: '' }, { pacienteId: 'p1' });
  assert.equal(r.ok, true);
  assert.equal(r.payload.paciente_id, 'p1');
  assert.equal(r.payload.duracion_min, 30);
  assert.equal(isNaN(new Date(r.payload.fecha).getTime()), false);
});

test('construirPayload agendar: fecha vacía → error legible', () => {
  const r = construirPayload('agendar', { fecha: '' }, { pacienteId: 'p1' });
  assert.equal(r.ok, false);
  assert.match(r.error, /fecha/i);
});

test('construirPayload registrar-pago: método obligatorio, importe default 40', () => {
  const ko = construirPayload('registrar-pago', { importe: '40', metodo: '' }, { pacienteId: 'p1' });
  assert.equal(ko.ok, false);
  const okr = construirPayload('registrar-pago', { importe: '40', metodo: 'Bizum', concepto: '', fecha: '', notas: '' }, { pacienteId: 'p1' });
  assert.equal(okr.ok, true);
  assert.equal(okr.payload.concepto, undefined); // '' → auto en la EF
});

test('construirPayload cerrar: fin_de_prueba mapea a baja_voluntaria + flag', () => {
  const r = construirPayload('cerrar', { motivo: 'fin_de_prueba', nota_personal: '', confirmar: 'on' }, { pacienteId: 'p1' });
  assert.equal(r.payload.motivo, 'baja_voluntaria');
  assert.equal(r.payload.fin_de_prueba, true);
});

test('construirPayload cerrar: sin checkbox de confirmación → error', () => {
  const r = construirPayload('cerrar', { motivo: 'abandono', confirmar: '' }, { pacienteId: 'p1' });
  assert.equal(r.ok, false);
});

test('construirPayload alta: normaliza MAYÚSCULAS/minúsculas', () => {
  const r = construirPayload('alta', { nombre: 'marta ruiz', email: ' Marta@X.com ' }, {});
  assert.equal(r.payload.nombre, 'MARTA RUIZ');
  assert.equal(r.payload.email, 'marta@x.com');
});

test('comandoRescate devuelve la skill equivalente', () => {
  assert.equal(comandoRescate('cerrar', 'MARTA RUIZ'), '/cerrar-paciente MARTA RUIZ');
  assert.equal(comandoRescate('alta', 'MARTA RUIZ', 'a@b.c'), '/alta-paciente MARTA RUIZ a@b.c');
});

test('resumenResultadoAccion construye mensaje + extras copiables', () => {
  const r = resumenResultadoAccion('agendar', { calendar_event_id: 'e', meet_url: 'https://meet/x', whatsapp_texto: 'Hola Marta...' });
  assert.match(r.mensaje, /agendada/i);
  assert.equal(r.extras.length, 2); // WhatsApp + Meet
  const r2 = resumenResultadoAccion('cerrar', { sesiones_canceladas: 2, draft_id: 'd1', whatsapp_texto: 'x' });
  assert.match(r2.mensaje, /2 sesiones/);
  assert.match(r2.mensaje, /borrador/i);
});

test('construirPayload reagendar: calendar_event_id + fecha → nueva_fecha ISO + paciente_id', () => {
  const r = construirPayload('reagendar', { calendar_event_id: 'ev1', fecha: '2026-08-10T10:00' }, { pacienteId: 'p2' });
  assert.equal(r.ok, true);
  assert.equal(r.payload.calendar_event_id, 'ev1');
  assert.equal(r.payload.paciente_id, 'p2');
  assert.equal(isNaN(new Date(r.payload.nueva_fecha).getTime()), false);
});

test('construirPayload reagendar: sin calendar_event_id → error', () => {
  const r = construirPayload('reagendar', { calendar_event_id: '', fecha: '2026-08-10T10:00' }, { pacienteId: 'p2' });
  assert.equal(r.ok, false);
});

test('construirPayload reactivar: crear_borrador checkbox → true/false según valor', () => {
  const r1 = construirPayload('reactivar', { crear_borrador: 'on' }, { pacienteId: 'p3' });
  assert.equal(r1.ok, true);
  assert.equal(r1.payload.crear_borrador, true);
  const r2 = construirPayload('reactivar', { crear_borrador: '' }, { pacienteId: 'p3' });
  assert.equal(r2.ok, true);
  assert.equal(r2.payload.crear_borrador, false);
});

test('construirPayload repescar: force ausente/vacío → sin force; force on → true', () => {
  const r1 = construirPayload('repescar', { force: '' }, { pacienteId: 'p4' });
  assert.equal(r1.ok, true);
  assert.equal(r1.payload.force, undefined);
  assert.equal(r1.payload.paciente_id, 'p4');
  const r2 = construirPayload('repescar', { force: 'on' }, { pacienteId: 'p4' });
  assert.equal(r2.ok, true);
  assert.equal(r2.payload.force, true);
});

test('construirPayload enviar-menu: menu_id obligatorio', () => {
  const ko = construirPayload('enviar-menu', { menu_id: '' }, { pacienteId: 'p1' });
  assert.equal(ko.ok, false);
  const okr = construirPayload('enviar-menu', { menu_id: 'm42' }, { pacienteId: 'p1' });
  assert.equal(okr.ok, true);
  assert.equal(okr.payload.menu_id, 'm42');
});

test('construirPayload cerrar: nota_personal > 2000 chars → error', () => {
  const nota = 'x'.repeat(2001);
  const r = construirPayload('cerrar', { motivo: 'objetivo_cumplido', nota_personal: nota, confirmar: 'on' }, { pacienteId: 'p1' });
  assert.equal(r.ok, false);
});

test('NOMBRE_EF: spot-check alta → alta-paciente', () => {
  assert.equal(NOMBRE_EF['alta'], 'alta-paciente');
  assert.equal(NOMBRE_EF['cerrar'], 'cerrar-paciente');
  assert.equal(NOMBRE_EF['agendar'], 'agendar');
});

// PIGGYBACK — desde revisión Task 13
test('construirPayload reactivar: crear_borrador ausente → false en payload', () => {
  const r = construirPayload('reactivar', {}, { pacienteId: 'p1' });
  assert.equal(r.ok, true);
  assert.equal(r.payload.crear_borrador, false);
});

test('construirPayload repescar sin force: payload sin clave force', () => {
  const r = construirPayload('repescar', {}, { pacienteId: 'p1' });
  assert.equal(r.ok, true);
  assert.equal('force' in r.payload, false);
});
