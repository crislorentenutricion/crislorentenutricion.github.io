const test = require('node:test');
const assert = require('node:assert/strict');
const BoPaciente = require('../src/backoffice/backoffice-paciente.js');

const ESTADO = {
  lecciones: [
    { slug: 'cimientos-1', fase: 'cimientos', titulo: 'Tu carro base', estado: 'done', abreElISO: '2026-07-01', forzada: false },
    { slug: 'cimientos-2', fase: 'cimientos', titulo: 'Leer una etiqueta sin liarte', estado: 'wait', abreElISO: '2026-07-08', forzada: false },
    { slug: 'cimientos-3', fase: 'cimientos', titulo: 'Organiza la compra', estado: 'lock', abreElISO: '2026-07-15', forzada: true },
  ],
  guias: [{ fase: 'cimientos', titulo: 'Guía de la compra', path: 'guia-de-la-compra.pdf', desbloqueada: false }],
  contadores: { lecciones: 1, guias: 0 },
  retoActivo: { slug: 'cimientos-1', leccion: 'Tu carro base', reto: 'En tu próxima compra…', hecho: true, nota: 'compré lentejas' },
};
const PROGRESO = [{ leccion_slug: 'cimientos-1', completada_at: '2026-07-01T10:00:00Z', mini_accion: 'casi nunca tengo legumbre', reto_hecho: true, reto_nota: 'compré lentejas' }];

test('renderCurso pinta lección completada con su mini-acción y reto', () => {
  const html = BoPaciente.renderCurso(ESTADO, PROGRESO);
  assert.match(html, /Tu carro base/);
  assert.match(html, /casi nunca tengo legumbre/);
  assert.match(html, /compré lentejas/);
});

test('renderCurso ofrece los tres controles por lección según su estado', () => {
  const html = BoPaciente.renderCurso(ESTADO, PROGRESO);
  assert.match(html, /data-bo-curso="desbloquear"[^>]*data-target="cimientos-2"/);
  assert.match(html, /data-bo-curso="bloquear"[^>]*data-target="cimientos-2"/);
  assert.match(html, /data-bo-curso="auto"[^>]*data-target="cimientos-3"/);   // forzada → puede volver a automático
});

test('renderCurso marca los estados forzados', () => {
  const html = BoPaciente.renderCurso(ESTADO, PROGRESO);
  assert.match(html, /forzada|manual/i);
});

test('renderCurso incluye los botones de fase (data-tipo="fase")', () => {
  const html = BoPaciente.renderCurso(ESTADO, PROGRESO);
  assert.match(html, /data-tipo="fase"[^>]*data-target="cimientos"/);
});

test('renderCurso lección sin forzar ofrece desbloquear+bloquear, no auto', () => {
  const html = BoPaciente.renderCurso(ESTADO, PROGRESO);
  const bloqueCimientos2 = html.slice(html.indexOf('cimientos-2'), html.indexOf('cimientos-3'));
  assert.doesNotMatch(bloqueCimientos2, /data-bo-curso="auto"/);
});
