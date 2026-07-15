const test = require('node:test');
const assert = require('node:assert/strict');
const AprenderLogic = require('../src/mi-seguimiento/aprender-logic.js');

test('fechaDesbloqueo: fase 1 (index 0), lección 1 abre el día del alta', () => {
  const d = AprenderLogic.fechaDesbloqueo('2026-07-01', 0, 1);
  assert.equal(d.toISOString().slice(0, 10), '2026-07-01');
});

test('fechaDesbloqueo: fase 1, lección 3 abre a las 2 semanas del alta', () => {
  const d = AprenderLogic.fechaDesbloqueo('2026-07-01', 0, 3);
  assert.equal(d.toISOString().slice(0, 10), '2026-07-15');
});

test('fechaDesbloqueo: fase 2 (index 1) abre al mes del alta', () => {
  const d = AprenderLogic.fechaDesbloqueo('2026-07-01', 1, 1);
  assert.equal(d.toISOString().slice(0, 10), '2026-08-01');
});

test('fechaDesbloqueo: clamp de fin de mes (alta 31 ene → fase 2 el 28 feb)', () => {
  const d = AprenderLogic.fechaDesbloqueo('2026-01-31', 1, 1);
  assert.equal(d.toISOString().slice(0, 10), '2026-02-28');
});

// ---- estadoCurso ----
// Fixture mínima: 10 lecciones con la forma que devuelve Supabase.
function lecciones() {
  const filas = [];
  const fases = [['cimientos', 3], ['construccion', 4], ['integracion', 3]];
  let orden = 1;
  for (const [fase, n] of fases) {
    for (let i = 1; i <= n; i++) {
      filas.push({
        slug: `${fase}-${i}`, fase, orden: orden++, titulo: `Lección ${fase} ${i}`,
        contenido: { min: 4, cards: [], accion: { type: 'text', p: 'x', placeholder: 'x' }, reto: `Reto de ${fase}-${i}` },
      });
    }
  }
  return filas;
}
const base = { lecciones: lecciones(), progreso: [], overrides: [], altaISO: '2026-07-01' };

test('estadoCurso: día 1 — solo la primera lección está disponible', () => {
  const e = AprenderLogic.estadoCurso({ ...base, hoyISO: '2026-07-01' });
  assert.equal(e.lecciones[0].estado, 'now');
  assert.equal(e.lecciones[1].estado, 'lock');   // secuencial: la 2 espera a la 1
  assert.equal(e.contadores.lecciones, 0);
  assert.equal(e.contadores.guias, 0);
  assert.equal(e.retoActivo, null);
});

test('estadoCurso: completada la 1 pero aún en semana 1 → la 2 queda en espera con fecha', () => {
  const progreso = [{ leccion_slug: 'cimientos-1', completada_at: '2026-07-01T10:00:00Z', reto_hecho: false, reto_nota: null }];
  const e = AprenderLogic.estadoCurso({ ...base, progreso, hoyISO: '2026-07-02' });
  assert.equal(e.lecciones[0].estado, 'done');
  assert.equal(e.lecciones[1].estado, 'wait');
  assert.equal(e.lecciones[1].abreElISO, '2026-07-08');
});

test('estadoCurso: en la semana 2 la lección 2 pasa a now', () => {
  const progreso = [{ leccion_slug: 'cimientos-1', completada_at: '2026-07-01T10:00:00Z', reto_hecho: false, reto_nota: null }];
  const e = AprenderLogic.estadoCurso({ ...base, progreso, hoyISO: '2026-07-08' });
  assert.equal(e.lecciones[1].estado, 'now');
});

test('estadoCurso: la fase 2 no abre antes de su mes aunque la 1 esté completa', () => {
  const progreso = ['cimientos-1', 'cimientos-2', 'cimientos-3']
    .map((slug) => ({ leccion_slug: slug, completada_at: '2026-07-20T10:00:00Z', reto_hecho: false, reto_nota: null }));
  const e = AprenderLogic.estadoCurso({ ...base, progreso, hoyISO: '2026-07-21' });
  assert.equal(e.lecciones[3].estado, 'wait');
  assert.equal(e.lecciones[3].abreElISO, '2026-08-01');
  assert.equal(e.guias[0].desbloqueada, true);    // Cimientos completa → guía 1
  assert.equal(e.contadores.guias, 1);
});

test('estadoCurso: override desbloquear de lección salta fecha y secuencia', () => {
  const overrides = [{ tipo: 'leccion', target: 'construccion-2', modo: 'desbloquear' }];
  const e = AprenderLogic.estadoCurso({ ...base, overrides, hoyISO: '2026-07-01' });
  assert.equal(e.lecciones[4].estado, 'now');     // construccion-2 forzada
  assert.equal(e.lecciones[3].estado, 'lock');    // construccion-1 sigue a lo suyo
});

test('estadoCurso: override bloquear de fase gana al ritmo, pero no re-bloquea lo hecho', () => {
  const progreso = [{ leccion_slug: 'cimientos-1', completada_at: '2026-07-01T10:00:00Z', reto_hecho: false, reto_nota: null }];
  const overrides = [{ tipo: 'fase', target: 'cimientos', modo: 'bloquear' }];
  const e = AprenderLogic.estadoCurso({ ...base, progreso, overrides, hoyISO: '2026-07-08' });
  assert.equal(e.lecciones[0].estado, 'done');    // lo completado nunca se re-bloquea
  assert.equal(e.lecciones[1].estado, 'lock');    // forzada aunque tocaría now
});

test('estadoCurso: override de lección gana al de fase', () => {
  const overrides = [
    { tipo: 'fase', target: 'cimientos', modo: 'bloquear' },
    { tipo: 'leccion', target: 'cimientos-1', modo: 'desbloquear' },
  ];
  const e = AprenderLogic.estadoCurso({ ...base, overrides, hoyISO: '2026-07-01' });
  assert.equal(e.lecciones[0].estado, 'now');
});

test('estadoCurso: reto activo = el de la última lección completada', () => {
  const progreso = [
    { leccion_slug: 'cimientos-1', completada_at: '2026-07-01T10:00:00Z', reto_hecho: true, reto_nota: 'hecho' },
    { leccion_slug: 'cimientos-2', completada_at: '2026-07-08T10:00:00Z', reto_hecho: false, reto_nota: null },
  ];
  const e = AprenderLogic.estadoCurso({ ...base, progreso, hoyISO: '2026-07-09' });
  assert.equal(e.retoActivo.slug, 'cimientos-2');
  assert.equal(e.retoActivo.reto, 'Reto de cimientos-2');
  assert.equal(e.retoActivo.hecho, false);
  assert.equal(e.contadores.lecciones, 2);
});
