import { createNoise2D } from 'simplex-noise';
import alea from 'alea';
import { SEA_SCALE } from '../config.js';

// Deterministic low-frequency noise that flags where the world should have a
// sea. Separate seed from the biome/terrain noise so sea regions don't align
// with biome boundaries — they feel like a completely independent geography
// layer, which they are.

const prng = alea('sea-mask-seed');
const noise2D = createNoise2D(prng);

// Returns a value in [0, 1]. Tuned so the majority of the map reads as
// "land" (< 0.55) and large contiguous pockets read as "sea" (> 0.7).
export function seaMaskAt(x, z) {
  const s = SEA_SCALE;
  // Two octaves — the lower one defines continent-sized basins; the higher
  // one adds gentle shoreline wobble so seas don't look like perfect ovals.
  let h = 0;
  h += noise2D(x * s, z * s);
  h += noise2D(x * s * 2.4, z * s * 2.4) * 0.4;
  // Range roughly [-1.4, 1.4] → normalize to [0, 1].
  return (h + 1.4) / 2.8;
}
