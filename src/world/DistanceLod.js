import { LOD_HYSTERESIS } from '../config.js';

// Shadow-caster LOD for streamed content (villages, ruins, farms).
//
// Every group a content manager installs is tagged `group.userData.lod =
// { x, z, r }` — the feature's centre and a pad radius (LOD_PAD_*) so a wide
// town keeps its shadows while any part of it is within range. On the first
// pass the group's casters are collected once (each Mesh / InstancedMesh that
// was built with castShadow = true); every later pass is a handful of float
// ops per feature plus flag flips when a feature crosses the radius.
//
// Why: the sun shadow map re-renders every gameplay frame, and at low sun its
// footprint is a kilometres-long strip — a village 1.5 km up-sun contributes
// hundreds of instanced draws to that pass for a shadow that lands nowhere
// the player can see. Beyond `radius` (per graphics preset) content stops
// casting; it still receives, and terrain shadows are untouched.
//
// Returns true when any flag flipped, so the menu path can refresh its
// throttled shadow map (the gameplay path re-renders it every frame anyway).
export function updateContentShadowLod(managers, camPos, radius) {
  if (!Number.isFinite(camPos.x) || !Number.isFinite(camPos.z)) return false;
  const px = camPos.x;
  const pz = camPos.z;
  const far = radius;
  const near = radius / LOD_HYSTERESIS;
  let changed = false;
  for (const mgr of managers) {
    for (const group of mgr.active.values()) {
      const lod = group.userData.lod;
      if (!lod) continue;
      if (!lod.casters) {
        lod.casters = [];
        group.traverse((o) => {
          if ((o.isMesh || o.isInstancedMesh) && o.castShadow) lod.casters.push(o);
        });
        lod.cast = true; // everything was built casting
      }
      if (lod.casters.length === 0) continue;
      const dx = lod.x - px;
      const dz = lod.z - pz;
      // Distance to the feature's nearest edge (approximated by its pad).
      const d = Math.max(0, Math.sqrt(dx * dx + dz * dz) - lod.r);
      let cast = lod.cast;
      if (radius <= 0) cast = false;
      else if (cast && d > far) cast = false;
      else if (!cast && d < near) cast = true;
      if (cast !== lod.cast) {
        lod.cast = cast;
        for (const o of lod.casters) o.castShadow = cast;
        changed = true;
      }
    }
  }
  return changed;
}
