import { heightAt as noiseHeightAt } from './Noise.js';
import { villageFlatFactor } from './Villages.js';

// The one true ground height — every terrain vertex and every physics ground
// query goes through this, so they can never disagree. Each village's runway
// has a smoothstep flat zone; noise is multiplied by the blend factor.
export function groundHeight(x, z) {
  const f = villageFlatFactor(x, z);
  if (f === 0) return 0;
  return noiseHeightAt(x, z) * f;
}
