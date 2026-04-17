import {
  RUNWAY_LENGTH,
  RUNWAY_WIDTH,
  RUNWAY_MARGIN,
  RUNWAY_BLEND,
} from '../config.js';
import { heightAt as noiseHeightAt } from './Noise.js';

// Smoothstep-based falloff around the runway: returns 0 inside the flat zone,
// 1 fully outside the blend distance, smooth in between. This lets terrain
// rise gently from the runway edge instead of forming a cliff or noise wall.
function runwayBlendFactor(x, z) {
  const halfL = RUNWAY_LENGTH / 2 + RUNWAY_MARGIN;
  const halfW = RUNWAY_WIDTH / 2 + RUNWAY_MARGIN;
  const dx = Math.max(0, Math.abs(x) - halfL);
  const dz = Math.max(0, Math.abs(z) - halfW);
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= 0) return 0;
  if (d >= RUNWAY_BLEND) return 1;
  const t = d / RUNWAY_BLEND;
  return t * t * (3 - 2 * t); // smoothstep
}

// The one true ground height. Both terrain mesh construction and physics ground
// collision must go through this, or they will disagree at the runway edge.
export function groundHeight(x, z) {
  const blend = runwayBlendFactor(x, z);
  if (blend === 0) return 0;
  return noiseHeightAt(x, z) * blend;
}
