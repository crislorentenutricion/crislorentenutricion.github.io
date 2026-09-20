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
