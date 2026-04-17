import { createNoise2D } from 'simplex-noise';
import alea from 'alea';
import { BIOME_SCALE } from '../config.js';

const prng = alea('biome-seed');
const biomeNoise2D = createNoise2D(prng);

// Biome reference palette. `amp` scales the noise (so mountains are taller,
// forests flatter), `offset` shifts the whole terrain vertically (lakes sink
// below water, mountains rise above).
const BIOMES = [
  { type: 'lake',     center: 0.12, amp: 0.30, offset: -15, trees: 0.0, rocks: 0.2 },
  { type: 'forest',   center: 0.38, amp: 0.55, offset:   6, trees: 2.8, rocks: 0.4 },
  { type: 'hills',    center: 0.65, amp: 1.00, offset:   6, trees: 1.0, rocks: 1.0 },
  { type: 'mountain', center: 0.90, amp: 2.00, offset:  12, trees: 0.3, rocks: 2.5 },
];
const BANDWIDTH = 0.35;

// Return blended biome params at (x, z). Every field (amp/offset/trees/rocks)
// smoothly interpolates between the 4 named biomes based on a low-frequency
// simplex — so biome transitions are gradual, not hard-edged.
export function biomeAt(x, z) {
  const n = biomeNoise2D(x * BIOME_SCALE, z * BIOME_SCALE); // -1..1
  const t = n * 0.5 + 0.5; // 0..1

  let total = 0;
  let amp = 0;
  let offset = 0;
  let trees = 0;
  let rocks = 0;
  let bestW = -1;
  let bestType = 'hills';
  for (const b of BIOMES) {
    const d = Math.abs(t - b.center);
    const w = Math.max(0, 1 - d / BANDWIDTH);
    if (w === 0) continue;
    total += w;
    amp += w * b.amp;
    offset += w * b.offset;
    trees += w * b.trees;
    rocks += w * b.rocks;
    if (w > bestW) {
      bestW = w;
      bestType = b.type;
    }
  }
  if (total === 0) {
    return { type: 'hills', amp: 1, offset: 6, trees: 1, rocks: 1 };
  }
  return {
    type: bestType,
    amp: amp / total,
    offset: offset / total,
    trees: trees / total,
    rocks: rocks / total,
  };
}
