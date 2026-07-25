// Tiny i18n layer. Two locales (en/ru), no dependencies, no build step.
//
// How it works:
//  * STATIC markup carries `data-i18n="key"` (text), `data-i18n-ph="key"`
//    (placeholder) or `data-i18n-title="key"`. `applyStatic()` walks those and
//    writes the current locale's string. Called on boot and on every switch.
//  * JS-written strings go through `t('key')` (with optional {vars}).
//  * Strings that live in CSS `content:` can't be swapped by JS, so anything
//    translatable was moved out of CSS into real elements.
//
// The choice persists in localStorage under LANG_KEY; first run falls back to
// the browser language (ru* → Russian, everything else → English).

import { STRINGS } from './strings.js';

// Same `mbp:*` namespace as the other persisted settings (mbp:gfx, mbp:view…).
const LANG_KEY = 'mbp:lang';
export const LANGUAGES = [
  { key: 'en', label: 'English' },
  { key: 'ru', label: 'Русский' },
];

function detectLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && STRINGS[saved]) return saved;
  } catch {}
  try {
    const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    if (String(nav).toLowerCase().startsWith('ru')) return 'ru';
  } catch {}
  return 'en';
}

let current = detectLang();
const listeners = new Set();

export function getLang() { return current; }

export function setLang(key) {
  if (!STRINGS[key] || key === current) return;
  current = key;
  try { localStorage.setItem(LANG_KEY, key); } catch {}
  document.documentElement.setAttribute('lang', key);
  applyStatic();
  for (const fn of listeners) {
    // One bad listener must not stop the rest of the UI from re-rendering.
    try { fn(key); } catch (e) { console.warn('[i18n] listener failed', e); }
  }
}

// Register a callback for JS-rendered UI that needs to rebuild on a switch.
export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Translate. Missing keys fall back to English, then to the key itself, so a
// gap shows up as readable text instead of blank UI.
export function t(key, vars) {
  const table = STRINGS[current] || STRINGS.en;
  let s = table[key];
  if (s == null) s = STRINGS.en[key];
  if (s == null) return key;
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m
    );
  }
  return s;
}

// Like t(), but falls back to a caller-supplied string when the key is missing.
// Used for config-driven labels (presets, aircraft copy) so the English value
// already in config.js stays the fallback instead of leaking a raw key.
export function tf(key, fallback) {
  const s = t(key);
  return s === key ? fallback : s;
}

// Pick the right plural form for `n`. English has 2 forms (one/many), Russian
// has 3 (1 игрок / 2–4 игрока / 5+ игроков), so callers pass a key STEM and we
// resolve `<stem>.one` / `.few` / `.many`.
export function plural(stem, n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  let form;
  if (current === 'ru') {
    if (abs > 10 && abs < 20) form = 'many';
    else if (last === 1) form = 'one';
    else if (last >= 2 && last <= 4) form = 'few';
    else form = 'many';
  } else {
    form = n === 1 ? 'one' : 'many';
  }
  // `.few` only exists in ru; fall back through many → one so en keys work too.
  const table = STRINGS[current] || STRINGS.en;
  const tryKeys = [`${stem}.${form}`, `${stem}.many`, `${stem}.one`];
  for (const k of tryKeys) if (table[k] != null || STRINGS.en[k] != null) return t(k);
  return stem;
}

// Swap every translatable node/attribute in `root`.
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'));
  }
  for (const el of root.querySelectorAll('[data-i18n-ph]')) {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  }
}

// Call once at boot, before the first paint of translated UI.
export function initI18n() {
  document.documentElement.setAttribute('lang', current);
  applyStatic();
}
