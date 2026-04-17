import { heightAt as noiseHeightAt } from './Noise.js';
import { villageFlatFactor } from './Villages.js';
import { biomeAt } from './Biome.js';
import { WATER_LEVEL } from '../config.js';

// Raw terrain surface — can dip well below WATER_LEVEL in lake biomes. Used
// for building terrain meshes, placing houses/trees/rocks. The water plane
// covers anything below water level, so we must NOT clamp here: clamping
// puts the terrain coplanar with the water surface and causes z-fighting.
export function groundHeight(x, z) {
  const f = villageFlatFactor(x, z);
  if (f === 0) return 0;
  const b = biomeAt(x, z);
  const h = noiseHeightAt(x, z) * b.amp + b.offset;
  return h * f;
}

// What the plane actually collides with: terrain, unless we're over a lake,
// in which case the water surface stops the plane. Shadows use this too so
// they sit on the water surface rather than sink to the lake bed.
export function physicsFloor(x, z) {
  const g = groundHeight(x, z);
  return g < WATER_LEVEL ? WATER_LEVEL : g;
}
