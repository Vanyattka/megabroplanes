import { GRAPHICS_PRESETS, DEFAULT_GFX_PRESET } from '../config.js';

const STORAGE_KEY = 'mbp:gfx';

function loadInitial() {
  try {
    const k = localStorage.getItem(STORAGE_KEY);
    if (k && GRAPHICS_PRESETS[k]) return k;
  } catch {}
  return DEFAULT_GFX_PRESET;
}

function save(key) {
  try { localStorage.setItem(STORAGE_KEY, key); } catch {}
}

const listeners = new Set();
let currentKey = loadInitial();

// Simple event-bus singleton — subsystems subscribe with onChange() and get
// a fresh preset object whenever the user picks a new quality level.
export const gfx = {
  get preset() { return currentKey; },
  get settings() { return GRAPHICS_PRESETS[currentKey]; },
  set(key) {
    if (!GRAPHICS_PRESETS[key] || key === currentKey) return;
    currentKey = key;
    save(currentKey);
    const s = GRAPHICS_PRESETS[currentKey];
    for (const l of listeners) l(s);
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
