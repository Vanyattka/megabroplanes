import { landElevation } from './TerrainShape.js';
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
  // Sea layer — smoothstep shoreline, full depth out in open water.
  const seaStrength = smoothstep(SEA_THRESHOLD_LOW, SEA_THRESHOLD_HIGH, seaMaskAt(x, z));
  h -= seaStrength * SEA_DEPTH;

  // Outside the sea, keep the land from dipping below water — gentle plains
  // undulation occasionally crosses the waterline, which would read as fake
  // ponds. Softly compress below-floor values so they asymptote just under
  // the land floor (no flat plateau, no false lakes).
  if (seaStrength < 0.3) {
    const LAND_FLOOR = WATER_LEVEL + 2;
    if (h < LAND_FLOOR) {
      h = LAND_FLOOR - 3 * (1 - Math.exp((h - LAND_FLOOR) / 20));
    }
  }

  // Blend from the airport pad height (flush plateau) to natural terrain.
  return padY + (h - padY) * f;
}

// What the plane actually collides with: terrain, unless we're over a lake
// or sea, in which case the water surface stops the plane. Shadows use this
// too so they sit on the water surface rather than sink to the seabed.
export function physicsFloor(x, z) {
  const g = groundHeight(x, z);
  return g < WATER_LEVEL ? WATER_LEVEL : g;
}

// Exposed so the minimap can color sea cells distinctly from lake-biome cells.
export function isSeaAt(x, z) {
  return seaMaskAt(x, z) > (SEA_THRESHOLD_LOW + SEA_THRESHOLD_HIGH) * 0.5;
}
