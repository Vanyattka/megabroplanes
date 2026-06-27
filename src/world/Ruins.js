import alea from 'alea';
import {
  CHUNK_SIZE,
  CHUNK_RESOLUTION,
  RUIN_CELL_SIZE,
  RUIN_CHANCE,
  RUIN_MIN_HEIGHT,
  RUIN_GRAND_CHANCE,
  RUIN_GRAND_MIN_HEIGHT,
  RUIN_GRAND_MAX_SPREAD,
  RUIN_GRAND_REACH,
} from '../config.js';
import { groundHeight } from './Ground.js';
import { seedKey } from './WorldSeed.js';

// Terrain mesh vertices sit on this grid. Snapping ruin spawn points to the
// grid guarantees the ruin's base y matches the rendered surface exactly —
// otherwise on a steep mountain the true noise value can be well above the
// linearly-interpolated mesh surface, making the ruin visibly hover.
const VERTEX_GRID = CHUNK_SIZE / (CHUNK_RESOLUTION - 1);
function snapToGrid(v) {
  return Math.round(v / VERTEX_GRID) * VERTEX_GRID;
}

// 8 compass directions for the grand-tier flatness pre-check.
const OCT8 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.707, 0.707], [0.707, -0.707], [-0.707, 0.707], [-0.707, -0.707],
];

// Deterministic ruin lookup per (rcx, rcz) cell. A ruin only appears if the
// cell contains a mountain-biome spot above RUIN_MIN_HEIGHT; otherwise it's
// null (still cached to avoid re-sampling).
const ruinCache = new Map();

export function getRuin(rcx, rcz) {
  const key = `${rcx},${rcz}`;
  if (ruinCache.has(key)) return ruinCache.get(key);

  const prng = alea(seedKey(`ruin:${rcx}:${rcz}`));
  let ruin = null;
  if (prng() < RUIN_CHANCE) {
    // Sample several points inside the cell and pick the highest mountain
    // spot. Skip cells that have no eligible peak.
    let best = null;
    for (let i = 0; i < 10; i++) {
      const x = snapToGrid(
        rcx * RUIN_CELL_SIZE + 300 + prng() * (RUIN_CELL_SIZE - 600)
      );
      const z = snapToGrid(
        rcz * RUIN_CELL_SIZE + 300 + prng() * (RUIN_CELL_SIZE - 600)
      );
      const h = groundHeight(x, z);
      if (h < RUIN_MIN_HEIGHT) continue;
      if (!best || h > best.h) best = { x, z, h };
    }
    if (best) {
      // Tier selection on a SEPARATE seed stream so the existing small-ruin
      // PRNG sequence (rot, mesh seed) is untouched — old worlds stay
      // byte-identical. A ruin is "grand" only on a high, broad summit; on a
      // jagged peak the roll silently falls back to small (never rejected).
      const tprng = alea(seedKey(`ruin-tier:${rcx}:${rcz}`));
      let tier = 'small';
      if (tprng() < RUIN_GRAND_CHANCE && best.h > RUIN_GRAND_MIN_HEIGHT) {
        let lo = best.h;
        let hi = best.h;
        for (const [ox, oz] of OCT8) {
          const hh = groundHeight(
            snapToGrid(best.x + ox * RUIN_GRAND_REACH),
            snapToGrid(best.z + oz * RUIN_GRAND_REACH)
          );
          if (hh < lo) lo = hh;
          if (hh > hi) hi = hh;
        }
        if (hi - lo <= RUIN_GRAND_MAX_SPREAD) tier = 'grand';
      }
      ruin = {
        rcx,
        rcz,
        x: best.x,
        z: best.z,
        y: best.h,
        rot: prng() * Math.PI * 2,
        tier,
        seed: seedKey(`ruin-mesh:${rcx}:${rcz}`),
      };
    }
  }
  ruinCache.set(key, ruin);
  return ruin;
}
