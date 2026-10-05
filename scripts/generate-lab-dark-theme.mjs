// Generates src/styles/lab-dark.generated.css: the lab's dark theme.
//
// The lab UI is written with light Tailwind utilities (bg-white, text-slate-700, border-slate-200, ...)
// across many components. Instead of adding a `dark:` twin to every class, this script scans the
// source for the light colour utilities actually in use and emits a dark replacement for each,
// scoped to `html.lab-dark` (set by App while the lab is open in dark mode, so portals are covered).
//
// Cascade: rules use `:where(html.lab-dark)` so they keep the utility's own specificity and win by
// coming later (the file is imported after index.css). Hand-written `dark:` variants are more
// specific and still win, so a component can override any generated colour.
//
// Dark backgrounds/borders (shade 400+) and light text (shade 400-) are already readable on dark
// surfaces and are left alone; only the light half is remapped.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import tailwindConfig from '../tailwind.config.js';

const require = createRequire(import.meta.url);
const colors = require('tailwindcss/colors');
const NEUTRALS = new Set(['slate', 'gray', 'zinc', 'neutral', 'stone']);
const FAMILIES = [...NEUTRALS, 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'circuit'];
// Read only the current names: the deprecated aliases (lightBlue, warmGray, ...) warn when touched.
const palette = Object.fromEntries(FAMILIES.map(name => [name, name === 'circuit' ? tailwindConfig.theme.extend.colors.circuit : colors[name]]));
const SURFACE = palette.slate[900];

function rgb(hex, alpha = 1) {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${+alpha.toFixed(3)})`;
}
function mix(a, b) {
  const pa = Number.parseInt(a.slice(1), 16), pb = Number.parseInt(b.slice(1), 16);
  const ch = s => Math.round((((pa >> s) & 255) + ((pb >> s) & 255)) / 2);
  return `#${[16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/** Dark replacement for a light background/border colour, or null to keep the original. */
function surface(family, shade, opacity, kind) {
  const alpha = opacity / 100;
  if (family === 'white') return rgb(kind === 'border' ? palette.slate[800] : SURFACE, alpha);
  if (!palette[family]?.[shade] || Number(shade) > 300) return null;
  const c = palette[family];
  if (NEUTRALS.has(family)) {
    const bg = { 50: mix(c[900], c[800]), 100: c[800], 200: c[700], 300: c[600] };
    const line = { 50: c[800], 100: c[800], 200: c[800], 300: c[700] };
    return rgb((kind === 'border' ? line : bg)[shade], alpha);
  }
  const bg = { 50: [c[900], 0.35], 100: [c[900], 0.55], 200: [c[800], 0.6], 300: [c[700], 0.7] };
  const line = { 50: [c[800], 0.6], 100: [c[800], 0.7], 200: [c[800], 0.8], 300: [c[700], 0.9] };
  const [hex, a] = (kind === 'border' ? line : bg)[shade];
  return rgb(hex, a * alpha);
}

/** Dark replacement for dark text, or null to keep the original. */
function ink(family, shade, opacity) {
  const alpha = opacity / 100;
  if (family === 'black') return rgb(palette.slate[100], alpha);
  if (!palette[family]?.[shade] || Number(shade) < 500) return null;
  const c = palette[family];
  const map = NEUTRALS.has(family)
    ? { 500: 400, 600: 400, 700: 300, 800: 200, 900: 100, 950: 50 }
    : { 500: 500, 600: 400, 700: 300, 800: 200, 900: 200, 950: 100 };
  return rgb(c[map[shade]], alpha);
}

const VARIANTS = {
  '': s => s,
  'hover:': s => `${s}:hover`,
  'focus:': s => `${s}:focus`,
  'focus-visible:': s => `${s}:focus-visible`,
  'active:': s => `${s}:active`,
  'disabled:': s => `${s}:disabled`,
  'group-hover:': s => `.group:hover ${s}`,
};
const PROPS = {
  bg: [v => `background-color: ${v}`, 'bg'],
  border: [v => `border-color: ${v}`, 'border'],
  'border-t': [v => `border-top-color: ${v}`, 'border'],
  'border-b': [v => `border-bottom-color: ${v}`, 'border'],
  'border-l': [v => `border-left-color: ${v}`, 'border'],
  'border-r': [v => `border-right-color: ${v}`, 'border'],
  'border-x': [v => `border-left-color: ${v}; border-right-color: ${v}`, 'border'],
  'border-y': [v => `border-top-color: ${v}; border-bottom-color: ${v}`, 'border'],
  divide: [v => `border-color: ${v}`, 'border', ' > :not([hidden]) ~ :not([hidden])'],
  ring: [v => `--tw-ring-color: ${v}`, 'border'],
  'ring-offset': [v => `--tw-ring-offset-color: ${v}`, 'bg'],
  outline: [v => `outline-color: ${v}`, 'border'],
  from: [v => `--tw-gradient-from: ${v} var(--tw-gradient-from-position); --tw-gradient-to: rgb(15 23 42 / 0) var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to)`, 'bg'],
  via: [v => `--tw-gradient-to: rgb(15 23 42 / 0) var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), ${v} var(--tw-gradient-via-position), var(--tw-gradient-to)`, 'bg'],
  to: [v => `--tw-gradient-to: ${v} var(--tw-gradient-to-position)`, 'bg'],
  text: [v => `color: ${v}`, 'text'],
};

const esc = cls => cls.replace(/[^a-zA-Z0-9_-]/g, ch => `\\${ch}`);
const token = new RegExp(String.raw`(?<![\w:/-])((?:hover|focus|focus-visible|active|disabled|group-hover):)?(${Object.keys(PROPS).sort((a, b) => b.length - a.length).join('|')})-(white|black|${FAMILIES.join('|')})(?:-(\d{2,3}))?(?:\/(\d{1,3}))?(?![\w/-])`, 'g');

function files(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = `${dir}/${name}`;
    return statSync(path).isDirectory() ? files(path) : /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}

const root = fileURLToPath(new URL('..', import.meta.url));
const rules = new Map();
for (const file of files(`${root}src`)) {
  if (file.includes('/components/home/')) continue; // the home page has its own theme in home.css
  for (const m of readFileSync(file, 'utf8').matchAll(token)) {
    const [cls, variant = '', prop, family, shade, opacity = '100'] = m;
    if (rules.has(cls)) continue;
    const [declare, kind, suffix = ''] = PROPS[prop];
    const value = kind === 'text' ? ink(family, shade, Number(opacity)) : surface(family, shade, Number(opacity), kind);
    if (!value) continue;
    rules.set(cls, `:where(html.lab-dark) ${VARIANTS[variant](`.${esc(cls)}`)}${suffix} { ${declare(value)}; }`);
  }
}

const css = `/* Generated by scripts/generate-lab-dark-theme.mjs (npm run theme:sync). Do not edit. */\n`
  + [...rules.keys()].sort().map(cls => rules.get(cls)).join('\n') + '\n';
writeFileSync(`${root}src/styles/lab-dark.generated.css`, css);
console.log(`lab dark theme: ${rules.size} utilities remapped`);
