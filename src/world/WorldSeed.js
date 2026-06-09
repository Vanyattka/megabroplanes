import { NOISE_SEED } from '../config.js';

// The world seed controls every procedural field (terrain, biomes, sea,
// villages, ruins, scatter). It's chosen ONCE per page load:
//   - Multiplayer always uses the default shared seed, so every client builds
//     the identical world (positions are synced, terrain is not transmitted).
//   - Singleplayer may use a custom seed (the "regenerate seed" button), read
//     from localStorage or a ?seed= URL param.
// In a Web Worker there's no URL seed / no localStorage, so it starts at the
// default and is overridden via setWorldSeed() from each build message.
export const DEFAULT_WORLD_SEED = NOISE_SEED;

function readInitial() {
  try {
    let mode = null;
    try { mode = JSON.parse(localStorage.getItem('mbp:loadout') || 'null')?.mode; } catch {}
    if (mode === 'multiplayer') return DEFAULT_WORLD_SEED; // MP shares one world
    const urlSeed = new URLSearchParams(self.location.search).get('seed');
    if (urlSeed) return urlSeed;
    let saved = null;
    try { saved = localStorage.getItem('mbp:seed'); } catch {}
    return saved || DEFAULT_WORLD_SEED;
  } catch {
    return DEFAULT_WORLD_SEED;
  }
}

let worldSeed = readInitial();

export function getWorldSeed() { return worldSeed; }
export function setWorldSeed(s) { worldSeed = s || DEFAULT_WORLD_SEED; }

// Namespacing helper for alea() keys. The DEFAULT seed uses BARE keys so the
// canonical world (and all multiplayer) stays byte-identical regardless of
// this feature; only custom seeds get a prefix → a genuinely different world.
export function seedKey(base) {
  return worldSeed === DEFAULT_WORLD_SEED ? base : `${worldSeed}:${base}`;
}
