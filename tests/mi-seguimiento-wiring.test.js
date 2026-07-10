// Test de wiring (lectura de fuente) para el script inline de /mi-seguimiento/.
//
// La lógica pura vive en logic.js y se testea en mi-seguimiento.test.js; el
// cableado DOM+Supabase vive inline en index.njk y no es require()-able.
// Igual que tracking-integration.test.js, aquí comprobamos por lectura de
// fichero que los cables críticos siguen conectados.
//
// Existe por la regresión de 2026-07-01 (ef4d483): loadCheckins pasó a exigir
// pacienteId (guard `if (!pacienteId) return []`), pero el re-sync tras marcar
// un check-in seguía llamándolo sin él → devolvía [] y la racha + calendario
// se pintaban a 0 hasta cerrar y reabrir la app.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexNjk = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'mi-seguimiento', 'index.njk'),
  'utf8'
);

test('re-sync tras check-in llama a loadCheckins con paciente.id', () => {
  assert.match(
    indexNjk,
    /await loadCheckins\(\s*from\s*,\s*paciente\.id\s*\)/,
    'el re-fetch tras upsertCheckin debe pasar paciente.id — sin él loadCheckins devuelve [] y la racha se repinta a 0'
  );
});

test('ninguna llamada a loadCheckins en index.njk va sin pacienteId', () => {
  // Excluimos la definición (fromISO, pacienteId); cualquier otra invocación
  // con un solo argumento reintroduciría el bug de racha a 0.
  const calls = indexNjk.match(/loadCheckins\((?!fromISO)[^)]*\)/g) || [];
  for (const call of calls) {
    assert.ok(
      /,/.test(call),
      `llamada a loadCheckins sin pacienteId: "${call}"`
    );
  }
});

test('renderStreak devuelve la racha (la usa maybeCelebrarMilestone tras el check-in)', () => {
  const fn = indexNjk.match(/function renderStreak\([^)]*\)\s*\{[^{}]*\}/);
  assert.ok(fn, 'function renderStreak debe existir en index.njk');
  assert.match(
    fn[0],
    /return n;/,
    'renderStreak debe devolver el número de racha — el handler de check-in hace `const racha = renderStreak(...)` y sin return el milestone nunca se celebra en el momento'
  );
});

// ---- Curso «Aprender» (Tarea 7: tarjeta, vista y navegación) ----

test('mi-seguimiento carga aprender-logic.js antes del módulo principal', () => {
  assert.match(indexNjk, /<script src="\/mi-seguimiento\/aprender-logic\.js"><\/script>/);
});

test('la vista aprender existe y se navega con mostrarAprender', () => {
  assert.match(indexNjk, /data-view="aprender"|'aprender'/);
  assert.match(indexNjk, /function mostrarAprender\(\)/);
});

// ---- Curso «Aprender» (Tarea 8: loaders filtrados por paciente) ----

test('los loaders del curso filtran por la paciente logueada', () => {
  assert.match(indexNjk, /from\('curso_progreso'\)[\s\S]{0,200}?\.eq\('paciente_id', pacienteId\)/);
  assert.match(indexNjk, /from\('curso_overrides'\)[\s\S]{0,200}?\.eq\('paciente_id', pacienteId\)/);
});

// ---- Curso «Aprender» (Tarea 9: reproductor de lección) ----

test('completar lección hace upsert de curso_progreso con la paciente logueada', () => {
  assert.match(
    indexNjk,
    /from\('curso_progreso'\)[\s\S]{0,300}?upsert\([\s\S]{0,200}?paciente_id: paciente\.id/
  );
});
