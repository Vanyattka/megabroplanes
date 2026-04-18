import alea from 'alea';
import { RUIN_CELL_SIZE, RUIN_CHANCE, RUIN_MIN_HEIGHT } from '../config.js';
import { biomeAt } from './Biome.js';
import { groundHeight } from './Ground.js';

// Deterministic ruin lookup per (rcx, rcz) cell. A ruin only appears if the
// cell contains a mountain-biome spot above RUIN_MIN_HEIGHT; otherwise it's
// null (still cached to avoid re-sampling).
const ruinCache = new Map();

export function getRuin(rcx, rcz) {
  const key = `${rcx},${rcz}`;
  if (ruinCache.has(key)) return ruinCache.get(key);

  const prng = alea(`ruin:${rcx}:${rcz}`);
  let ruin = null;
  if (prng() < RUIN_CHANCE) {
    // Sample several points inside the cell and pick the highest mountain
    // spot. Skip cells that have no eligible peak.
    let best = null;
    for (let i = 0; i < 10; i++) {
      const x = rcx * RUIN_CELL_SIZE + 300 + prng() * (RUIN_CELL_SIZE - 600);
      const z = rcz * RUIN_CELL_SIZE + 300 + prng() * (RUIN_CELL_SIZE - 600);
      const b = biomeAt(x, z);
      if (b.type !== 'mountain') continue;
      const h = groundHeight(x, z);
      if (h < RUIN_MIN_HEIGHT) continue;
      if (!best || h > best.h) best = { x, z, h };
    }
    if (best) {
      ruin = {
        rcx,
        rcz,
        x: best.x,
        z: best.z,
        y: best.h,
        rot: prng() * Math.PI * 2,
        seed: `ruin-mesh:${rcx}:${rcz}`,
      };
    }
  }
  ruinCache.set(key, ruin);
  return ruin;
}
