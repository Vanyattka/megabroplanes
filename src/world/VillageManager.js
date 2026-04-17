import { VILLAGE_CELL_SIZE, VILLAGE_VIEW_CELLS } from '../config.js';
import { getVillage } from './Villages.js';
import { buildVillageGroup, disposeVillageGroup } from './VillageMeshes.js';

// Streams village meshes based on which cells the plane is near. Keeps a
// (2N+1)² grid loaded where N = VILLAGE_VIEW_CELLS.
export class VillageManager {
  constructor(scene) {
    this.scene = scene;
    this.active = new Map(); // "gcx,gcz" -> Group
  }

  update(planePos) {
    const pcx = Math.floor(planePos.x / VILLAGE_CELL_SIZE);
    const pcz = Math.floor(planePos.z / VILLAGE_CELL_SIZE);
    const needed = new Set();

    for (let dx = -VILLAGE_VIEW_CELLS; dx <= VILLAGE_VIEW_CELLS; dx++) {
      for (let dz = -VILLAGE_VIEW_CELLS; dz <= VILLAGE_VIEW_CELLS; dz++) {
        const gcx = pcx + dx;
        const gcz = pcz + dz;
        const v = getVillage(gcx, gcz);
        if (!v) continue;
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
