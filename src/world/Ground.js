import { heightAt as noiseHeightAt } from './Noise.js';
import { villageFlatFactor } from './Villages.js';
import { biomeAt } from './Biome.js';
import { WATER_LEVEL } from '../config.js';

// Canonical ground height. Every terrain vertex and every physics ground query
// goes through this. Order of operations:
//   1. Villages carve flat zones (factor 0 inside, smoothstep out).
//   2. Biome scales and shifts the noise (lake/forest/hills/mountain).
//   3. Water clamps the minimum elevation — you land on water, not on the
//      invisible lake bed.
export function groundHeight(x, z) {
  const f = villageFlatFactor(x, z);
  if (f === 0) return 0;
  const b = biomeAt(x, z);
  const h = noiseHeightAt(x, z) * b.amp + b.offset;
  const terrain = h * f;
  return Math.max(terrain, WATER_LEVEL);
}
