import {
  GRAPHICS_PRESETS,
  DEFAULT_GFX_PRESET,
  VIEW_DISTANCE_PRESETS,
  DEFAULT_VIEW_PRESET,
} from '../config.js';

const GFX_KEY = 'mbp:gfx';
const VIEW_KEY = 'mbp:view';

function loadKey(storageKey, allowed, def) {
  try {
    const k = localStorage.getItem(storageKey);
    if (k && allowed[k]) return k;
  } catch {}
  return def;
}

function save(storageKey, key) {
  try { localStorage.setItem(storageKey, key); } catch {}
}

function makeSingleton(storageKey, presets, defaultKey) {
  const listeners = new Set();
  let current = loadKey(storageKey, presets, defaultKey);
  return {
    get preset() { return current; },
    get settings() { return presets[current]; },
    set(key) {
      if (!presets[key] || key === current) return;
      current = key;
      save(storageKey, current);
      const s = presets[current];
      for (const l of listeners) l(s);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// Graphics: shadows / bloom / atmospheric sky / etc.
export const gfx = makeSingleton(GFX_KEY, GRAPHICS_PRESETS, DEFAULT_GFX_PRESET);
// View distance: how many chunks to stream at ground level + altitude.
export const view = makeSingleton(VIEW_KEY, VIEW_DISTANCE_PRESETS, DEFAULT_VIEW_PRESET);
