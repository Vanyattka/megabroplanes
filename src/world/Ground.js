import { landElevation, spawnFlat01, riverWaterLevelAt } from './TerrainShape.js';
import { villageFlatFactor, lastFlatPadY } from './Villages.js';
import { seaMaskAt } from './SeaMask.js';
import {
  WATER_LEVEL,
  SEA_THRESHOLD_LOW,
  SEA_THRESHOLD_HIGH,
  SEA_DEPTH,
} from '../config.js';

function smoothstep(edge0, edge1, x) {
  if (x <= edge0) return 0;
  if (x >= edge1) return 1;
  const t = (x - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
}

// Raw terrain surface — can dip well below WATER_LEVEL in lake biomes and
// sea zones. Used for building terrain meshes, placing houses/trees/rocks.
// The water plane covers anything below water level, so we must NOT clamp
// here: clamping puts the terrain coplanar with the water surface and
// causes z-fighting.
//
// Order of operations:
//   1. Villages carve flat zones (factor 0 inside, smoothstep outward).
//   2. Biome scales and shifts the noise (lake/forest/hills/mountain).
//   3. Sea mask pushes whole regions deep so multi-km seas open up
//      independent of the per-biome lake spots.
export function groundHeight(x, z) {
  const f = villageFlatFactor(x, z);
  const padY = lastFlatPadY();
  if (f === 0) return padY;
  let h = landElevation(x, z);
  // Sea layer — smoothstep shoreline, full depth out in open water. Suppressed
  // near the world origin so the home spawn is always on dry land.
  const seaStrength = smoothstep(SEA_THRESHOLD_LOW, SEA_THRESHOLD_HIGH, seaMaskAt(x, z)) * spawnFlat01(x, z);
  h -= seaStrength * SEA_DEPTH;
  // (The anti-fake-pond land floor now lives inside landElevation, BEFORE the
  // river carve — applying it here clamped riverbeds dry.)

  // Blend from the airport pad height (flush plateau) to natural terrain.
  return padY + (h - padY) * f;
}

// What the plane actually collides with: terrain, unless we're over a lake
// or sea, in which case the water surface stops the plane. Shadows use this
// too so they sit on the water surface rather than sink to the seabed.
export function physicsFloor(x, z) {
  const g = groundHeight(x, z);
  // Rivers carry a local (often higher) water level — the plane lands on the
  // pool surface, not on the riverbed beneath it.
  let w = WATER_LEVEL;
  const rw = riverWaterLevelAt(x, z);
  if (rw != null && rw > w) w = rw;
  return g < w ? w : g;
}

// Exposed so the minimap can color sea cells distinctly from lake-biome cells.
export function isSeaAt(x, z) {
  return seaMaskAt(x, z) > (SEA_THRESHOLD_LOW + SEA_THRESHOLD_HIGH) * 0.5;
}
