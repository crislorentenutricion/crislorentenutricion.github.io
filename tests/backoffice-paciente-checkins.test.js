const { test } = require('node:test');
const assert = require('node:assert/strict');

const BoPaciente = require('../src/backoffice/backoffice-paciente.js');

// ===================================================================
// _resolverFechaAlta — cascada
// ===================================================================

const HOY = new Date(2026, 4, 4); // 4 de mayo de 2026

test('_resolverFechaAlta: usa paciente.alta cuando existe', () => {
  const r = BoPaciente._resolverFechaAlta(
    { alta: '2026-01-10', anamnesis_completed_at: '2026-01-15T10:00:00Z', created_at: '2026-01-05T08:00:00Z' },
    HOY
  );
  assert.equal(r, '2026-01-10');
});

test('_resolverFechaAlta: cae a anamnesis_completed_at (truncando timestamp ISO)', () => {
  const r = BoPaciente._resolverFechaAlta(
    { alta: null, anamnesis_completed_at: '2026-01-15T10:00:00Z', created_at: '2026-01-05T08:00:00Z' },
    HOY
  );
  assert.equal(r, '2026-01-15');
});

test('_resolverFechaAlta: cae a created_at (truncando timestamp ISO)', () => {
  const r = BoPaciente._resolverFechaAlta(
    { alta: null, anamnesis_completed_at: null, created_at: '2026-01-05T08:00:00Z' },
    HOY
  );
  assert.equal(r, '2026-01-05');
});

test('_resolverFechaAlta: red de seguridad — todos null → hoy menos 30 días', () => {
  const r = BoPaciente._resolverFechaAlta(
    { alta: null, anamnesis_completed_at: null, created_at: null },
    HOY
  );
  assert.equal(r, '2026-04-04');
});

test('_resolverFechaAlta: paciente null → red de seguridad', () => {
  const r = BoPaciente._resolverFechaAlta(null, HOY);
  assert.equal(r, '2026-04-04');
});

// ===================================================================
// construirHistorialCheckins — estructura de meses
// ===================================================================

test('construirHistorialCheckins: orden DESC, primer mes es el de hoy', () => {
  const checkins = [
    { paciente_id: 'p1', fecha: '2026-01-10', estado: 'seguido' }
  ];
  const r = BoPaciente.construirHistorialCheckins(checkins, '2026-01-01', new Date(2026, 4, 4));
  assert.ok(Array.isArray(r.meses));
  assert.equal(r.meses[0].year, 2026);
  assert.equal(r.meses[0].month, 4);  // mayo (0-indexed)
  assert.equal(r.meses[0].label, 'Mayo 2026');
  assert.equal(r.meses[r.meses.length - 1].month, 0);  // enero
  assert.equal(r.meses[r.meses.length - 1].label, 'Enero 2026');
});

test('construirHistorialCheckins: incluye meses sin checkins entre dos meses con datos', () => {
  const checkins = [
    { paciente_id: 'p1', fecha: '2026-01-10', estado: 'seguido' },
    { paciente_id: 'p1', fecha: '2026-03-05', estado: 'parcial' }
  ];
  const r = BoPaciente.construirHistorialCheckins(checkins, '2026-01-01', new Date(2026, 2, 31));
  // Esperamos: Marzo, Febrero, Enero
  assert.equal(r.meses.length, 3);
  assert.equal(r.meses[1].month, 1);  // febrero entre marzo y enero
  // Febrero no tiene checkins pero está presente con cells solo de tipo 'day' con estado=null
  const febCellsConEstado = r.meses[1].cells.filter(c => c.type === 'day' && c.estado != null);
  assert.equal(febCellsConEstado.length, 0);
});

test('construirHistorialCheckins: offset de inicio del mes lunes=0', () => {
  // Mayo 2026: 1 de mayo es VIERNES → offset 4 (L=0,M=1,X=2,J=3,V=4)
  const r = BoPaciente.construirHistorialCheckins([], '2026-05-01', new Date(2026, 4, 4));
  const mayo = r.meses[0];
  assert.equal(mayo.cells[0].type, 'empty');
  assert.equal(mayo.cells[1].type, 'empty');
  assert.equal(mayo.cells[2].type, 'empty');
  assert.equal(mayo.cells[3].type, 'empty');
  assert.equal(mayo.cells[4].type, 'day');
  assert.equal(mayo.cells[4].day, 1);
  assert.equal(mayo.cells[4].iso, '2026-05-01');
});

test('construirHistorialCheckins: cell.estado se rellena desde checkins', () => {
  const checkins = [
    { paciente_id: 'p1', fecha: '2026-05-01', estado: 'seguido' },
    { paciente_id: 'p1', fecha: '2026-05-02', estado: 'parcial' },
    { paciente_id: 'p1', fecha: '2026-05-03', estado: 'no' }
  ];
  const r = BoPaciente.construirHistorialCheckins(checkins, '2026-05-01', new Date(2026, 4, 4));
  const mayo = r.meses[0];
  const dia1 = mayo.cells.find(c => c.type === 'day' && c.day === 1);
  const dia2 = mayo.cells.find(c => c.type === 'day' && c.day === 2);
  const dia3 = mayo.cells.find(c => c.type === 'day' && c.day === 3);
  const dia4 = mayo.cells.find(c => c.type === 'day' && c.day === 4);
  assert.equal(dia1.estado, 'seguido');
  assert.equal(dia2.estado, 'parcial');
  assert.equal(dia3.estado, 'no');
  assert.equal(dia4.estado, null);
});

test('construirHistorialCheckins: trailing empties al final del mes', () => {
  // Mayo 2026: 31 días, 1 cae viernes (offset 4) → 4 + 31 = 35 → trailing 0.
  // Probemos con febrero 2026: 28 días, 1 cae domingo (getDay=0, offset (0+6)%7=6).
  // 6 + 28 = 34 → trailing (7 - 34%7) % 7 = (7-6)%7 = 1.
  const r = BoPaciente.construirHistorialCheckins([], '2026-02-01', new Date(2026, 1, 28));
  const feb = r.meses[0];
  // Total cells = offset + dias + trailing = 6 + 28 + 1 = 35
  assert.equal(feb.cells.length, 35);
  assert.equal(feb.cells[feb.cells.length - 1].type, 'empty');
});

// ===================================================================
// construirHistorialCheckins — resumen agregado
// ===================================================================

test('construirHistorialCheckins: diasConCheckin cuenta los 3 estados', () => {
  const checkins = [
    { paciente_id: 'p1', fecha: '2026-05-01', estado: 'seguido' },
    { paciente_id: 'p1', fecha: '2026-05-02', estado: 'parcial' },
    { paciente_id: 'p1', fecha: '2026-05-03', estado: 'no' }
  ];
  const r = BoPaciente.construirHistorialCheckins(checkins, '2026-05-01', new Date(2026, 4, 4));
  assert.equal(r.resumen.diasConCheckin, 3);
});

test('construirHistorialCheckins: totalDias incluye fechaAlta y hoy', () => {
  // 2026-05-01 a 2026-05-04 incl. = 4 días
  const r = BoPaciente.construirHistorialCheckins([], '2026-05-01', new Date(2026, 4, 4));
  assert.equal(r.resumen.totalDias, 4);
});

test('construirHistorialCheckins: adherenciaPct redondeado correctamente', () => {
  // 92 días con check-in / 118 totales = 77.97% → 78
  const checkins = [];
  for (let i = 0; i < 92; i++) {
    const d = new Date(2026, 0, 1 + i);
    const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    checkins.push({ paciente_id: 'p1', fecha: iso, estado: 'seguido' });
  }
  // fechaAlta=2026-01-01, hoy=2026-04-28 → 118 días
  const r = BoPaciente.construirHistorialCheckins(checkins, '2026-01-01', new Date(2026, 3, 28));
  assert.equal(r.resumen.totalDias, 118);
  assert.equal(r.resumen.diasConCheckin, 92);
  assert.equal(r.resumen.adherenciaPct, 78);
});

test('construirHistorialCheckins: adherenciaPct null si totalDias=0', () => {
  // Caso degradado: fechaAlta posterior a hoy
  const r = BoPaciente.construirHistorialCheckins([], '2026-05-10', new Date(2026, 4, 4));
  assert.equal(r.resumen.totalDias, 0);
  assert.equal(r.resumen.adherenciaPct, null);
});

test('construirHistorialCheckins: primerDia = fechaAlta', () => {
  const r = BoPaciente.construirHistorialCheckins([], '2026-01-15', new Date(2026, 4, 4));
  assert.equal(r.resumen.primerDia, '2026-01-15');
});

// ===================================================================
// construirHistorialCheckins — rachas
// ===================================================================

// rachaActual: cuenta desde AYER hacia atrás (no penaliza al paciente por no
// haber hecho aún el check-in del día en curso, mismo criterio que la PWA).

test('construirHistorialCheckins: rachaActual con seguido desde ayer hacia atrás', () => {
  const checkins = [
    { paciente_id: 'p1', fecha: '2026-05-01', estado: 'seguido' },  // hace 3 días
    { paciente_id: 'p1', fecha: '2026-05-02', estado: 'seguido' },  // hace 2 días
    { paciente_id: 'p1', fecha: '2026-05-03', estado: 'seguido' }   // ayer
  ];
  // hoy = 2026-05-04; ayer=2026-05-03 → cuenta 3 (3, 2, 1 mayo)
  const r = BoPaciente.construirHistorialCheckins(checkins, '2026-04-01', new Date(2026, 4, 4));
  assert.equal(r.resumen.rachaActual, 3);
});

test('construirHistorialCheckins: rachaActual con parcial mantiene', () => {
  const checkins = [
    { paciente_id: 'p1', fecha: '2026-05-01', estado: 'seguido' },
    { paciente_id: 'p1', fecha: '2026-05-02', estado: 'parcial' },  // mantiene
    { paciente_id: 'p1', fecha: '2026-05-03', estado: 'seguido' }
  ];
  const r = BoPaciente.construirHistorialCheckins(checkins, '2026-04-01', new Date(2026, 4, 4));
  // 2 'seguido' + 1 'parcial' = racha de 2 (parcial no suma pero no rompe)
  assert.equal(r.resumen.rachaActual, 2);
});

test('construirHistorialCheckins: rachaActual rompe en "no"', () => {
  const checkins = [
    { paciente_id: 'p1', fecha: '2026-05-01', estado: 'seguido' },
    { paciente_id: 'p1', fecha: '2026-05-02', estado: 'no' },  // rompe
    { paciente_id: 'p1', fecha: '2026-05-03', estado: 'seguido' }
  ];
  const r = BoPaciente.construirHistorialCheckins(checkins, '2026-04-01', new Date(2026, 4, 4));
  // racha desde ayer hacia atrás: 2026-05-03=seguido (1) → 2026-05-02=no → rompe.
  assert.equal(r.resumen.rachaActual, 1);
});

test('construirHistorialCheckins: rachaActual rompe en ausencia', () => {
  const checkins = [
    { paciente_id: 'p1', fecha: '2026-04-30', estado: 'seguido' },
    // hueco el 1 de mayo
    { paciente_id: 'p1', fecha: '2026-05-02', estado: 'seguido' },
    { paciente_id: 'p1', fecha: '2026-05-03', estado: 'seguido' }
  ];
  const r = BoPaciente.construirHistorialCheckins(checkins, '2026-04-01', new Date(2026, 4, 4));
  // ayer=03 seguido (1), 02 seguido (2), 01 ausente → rompe.
  assert.equal(r.resumen.rachaActual, 2);
});

test('construirHistorialCheckins: rachaMaxima recorre todo el histórico', () => {
  const checkins = [
    // racha 1: 5 días
    { paciente_id: 'p1', fecha: '2026-01-10', estado: 'seguido' },
    { paciente_id: 'p1', fecha: '2026-01-11', estado: 'seguido' },
    { paciente_id: 'p1', fecha: '2026-01-12', estado: 'parcial' },
    { paciente_id: 'p1', fecha: '2026-01-13', estado: 'seguido' },
    { paciente_id: 'p1', fecha: '2026-01-14', estado: 'seguido' },
    // gap
    // racha 2: 2 días (la actual)
    { paciente_id: 'p1', fecha: '2026-05-02', estado: 'seguido' },
    { paciente_id: 'p1', fecha: '2026-05-03', estado: 'seguido' }
  ];
  const r = BoPaciente.construirHistorialCheckins(checkins, '2026-01-10', new Date(2026, 4, 4));
  // racha máxima = 4 (parcial mantiene pero no suma; cuenta 'seguido' días)
  assert.equal(r.resumen.rachaMaxima, 4);
  assert.equal(r.resumen.rachaActual, 2);
});

test('construirHistorialCheckins: paciente con seguido todos los días → rachaActual=rachaMaxima', () => {
  const checkins = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(2026, 3, 1 + i);
    const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    checkins.push({ paciente_id: 'p1', fecha: iso, estado: 'seguido' });
  }
  // fechaAlta = 2026-04-01, hoy = 2026-04-30 → totalDias = 30, todos 'seguido'
  const r = BoPaciente.construirHistorialCheckins(checkins, '2026-04-01', new Date(2026, 3, 30));
  // rachaActual cuenta desde ayer (29) hacia atrás → 29 días seguidos
  assert.equal(r.resumen.rachaActual, 29);
  // rachaMaxima incluye el día de hoy también (recorre TODOS los días) → 30
  assert.equal(r.resumen.rachaMaxima, 30);
});
