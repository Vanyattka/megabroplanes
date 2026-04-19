import { VILLAGE_CELL_SIZE, VILLAGE_VIEW_CELLS } from '../config.js';
import { getVillage } from './Villages.js';
import { buildVillageGroup, disposeVillageGroup } from './VillageMeshes.js';

// Streams village meshes based on the plane's cell position. A village is
// only instantiated if it also lies within the currently-visible terrain
// radius — otherwise you'd see a village hovering over unloaded chunks.
export class VillageManager {
  constructor(scene) {
    this.scene = scene;
    this.active = new Map();
  }

  update(planePos, maxDistance = Infinity) {
    const pcx = Math.floor(planePos.x / VILLAGE_CELL_SIZE);
    const pcz = Math.floor(planePos.z / VILLAGE_CELL_SIZE);
    const maxSq = maxDistance * maxDistance;
    const needed = new Set();

    for (let dx = -VILLAGE_VIEW_CELLS; dx <= VILLAGE_VIEW_CELLS; dx++) {
      for (let dz = -VILLAGE_VIEW_CELLS; dz <= VILLAGE_VIEW_CELLS; dz++) {
        const gcx = pcx + dx;
        const gcz = pcz + dz;
        const v = getVillage(gcx, gcz);
        if (!v) continue;
        // Skip villages outside the visible terrain radius so they don't pop
        // into view over empty chunks.
        const ddx = v.airportX - planePos.x;
        const ddz = v.airportZ - planePos.z;
        if (ddx * ddx + ddz * ddz > maxSq) continue;
        const key = `${gcx},${gcz}`;
        needed.add(key);
        if (!this.active.has(key)) {
          const group = buildVillageGroup(v);
          this.scene.add(group);
          this.active.set(key, group);
        }
      }
    }

    for (const [key, group] of this.active) {
      if (!needed.has(key)) {
        this.scene.remove(group);
        disposeVillageGroup(group);
        this.active.delete(key);
      }
    }
  }
}
