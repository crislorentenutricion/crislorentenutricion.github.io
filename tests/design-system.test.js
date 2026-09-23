const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, 'src/css', f), 'utf8');
const styleCss = read('style.css');
const rootBlock = styleCss.match(/:root\s*\{([\s\S]*?)\n\}/)[1];
const token = (name) => (rootBlock.match(new RegExp(`${name}:\\s*([^;]+);`)) || [])[1]?.trim();

test('tokens: paleta y tipografía de la maqueta, valores exactos', () => {
  const esperado = {
    '--papel': '#F6F2EA', '--panel': '#FFFDF9',
    '--verde-oscuro': '#3E4A32', '--verde-medio': '#6E7A55', '--verde-claro': '#B9C0A2',
    '--verde-hover': '#5A6644', '--verde-claro-hover': '#C9D0B2',
    '--texto': '#2E2A24', '--texto-2': '#575147', '--texto-3': '#6E675C', '--texto-4': '#8A8276',
    '--texto-art': '#3A342C', '--linea': '#C8CDB4', '--linea-calida': '#E2D9CA', '--linea-campo': '#B3B79C',
    '--display': "'Cormorant Garamond', Georgia, serif",
    '--sans': "'Jost', system-ui, sans-serif",
  };
  for (const [k, v] of Object.entries(esperado)) assert.equal(token(k), v, k);
});

test('tokens: los alias heredados apuntan a la paleta nueva (PWA, backoffice, booking)', () => {
  const alias = {
    '--color-green': 'var(--verde-oscuro)', '--color-green-dark': 'var(--verde-hover)',
    '--color-cream': 'var(--papel)', '--color-white': 'var(--panel)',
    '--color-black': 'var(--texto)', '--color-gray': 'var(--texto-2)',
    '--color-border': 'var(--linea)',
    '--font-family': 'var(--sans)', '--font-accent': 'var(--display)',
  };
  for (const [k, v] of Object.entries(alias)) assert.equal(token(k), v, k);
});

test('tokens: radios a 0 y sombras a none', () => {
  for (const t of ['--border-radius-sm', '--border-radius-card', '--border-radius-lg', '--border-radius-btn']) assert.equal(token(t), '0', t);
  for (const t of ['--shadow-sm', '--shadow-md', '--shadow-card', '--shadow-card-hover', '--shadow-elevated', '--shadow-portrait']) assert.equal(token(t), 'none', t);
});

const sinDecoracion = (nombre, css) => {
  assert.doesNotMatch(css, /(linear|radial)-gradient/, `${nombre}: hay degradados`);
  const sombras = [...css.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim()).filter((v) => v !== 'none');
  assert.deepEqual(sombras, [], `${nombre}: hay sombras`);
  const radios = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim()).filter((v) => !/^(0|var\(--border-radius-[a-z]+\))$/.test(v));
  assert.deepEqual(radios, [], `${nombre}: hay radios distintos de 0`);
  assert.doesNotMatch(css, /74,\s*124,\s*89|#4a7c59|#3a6347/i, `${nombre}: queda el verde antiguo escrito a mano`);
};

test('style.css (web pública): sin degradados, sombras ni radios', () => {
  // El bloque del backoffice conserva sus formas propias (celdas redondas del calendario).
  const publico = styleCss.split(/\/\* =+\s*BACKOFFICE/)[0];
  sinDecoracion('style.css', publico);
});

test('booking.css: sin degradados, sombras ni radios', () => sinDecoracion('booking.css', read('booking.css')));
test('lead-magnet.css: sin degradados, sombras ni radios', () => sinDecoracion('lead-magnet.css', read('lead-magnet.css')));

test('marca: SVG maestros y redirección de servicios sin el verde ni las fuentes antiguas', () => {
  const ficheros = ['src/img/brand/monogram.svg', 'src/img/brand/wordmark.svg', 'src/servicios.njk'];
  for (const f of ficheros) {
    const txt = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(txt, /#4a7c59|#3a6347|#345840|74,\s*124,\s*89/i, `${f}: queda el verde antiguo`);
    assert.doesNotMatch(txt, /\b(Lora|Manrope)\b|font-family:\s*system-ui/, `${f}: quedan las fuentes antiguas`);
  }
  for (const f of ficheros.slice(0, 2)) {
    assert.match(fs.readFileSync(path.join(root, f), 'utf8'), /#3E4A32/, `${f}: sin el verde de marca`);
  }
});

test('marca: ninguna plantilla ni estilo de src/ usa la paleta o las fuentes antiguas', () => {
  const antiguo = /#4a7c59|#3a6347|#345840|#1f2a23|#d4e6d9|#5a6961|#7a8a7e|#9ca395|74,\s*124,\s*89|\b(Lora|Manrope)\b/i;
  const recorrer = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? recorrer(p) : /\.(njk|html|css|svg|js|md)$/.test(e.name) ? [p] : [];
  });
  const conRestos = recorrer(path.join(root, 'src'))
    .filter((f) => antiguo.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(root, f).replace(/\\/g, '/'));
  assert.deepEqual(conRestos, [], 'quedan colores o fuentes del diseño anterior');
});
