import { RUIN_CELL_SIZE } from '../config.js';
import { getRuin } from './Ruins.js';
import { buildRuinGroup, disposeRuinGroup } from './RuinMeshes.js';

// Streams ruin meshes based on the plane's cell position. Each ruin is one
// Group; cells without a ruin are still queried (Ruins.js caches the null).
export class RuinsManager {
  constructor(scene) {
    this.scene = scene;
    this.active = new Map();
  }

  update(planePos) {
    const pcx = Math.floor(planePos.x / RUIN_CELL_SIZE);
    const pcz = Math.floor(planePos.z / RUIN_CELL_SIZE);
    const needed = new Set();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const r = getRuin(pcx + dx, pcz + dz);
        if (!r) continue;
        const key = `${r.rcx},${r.rcz}`;
        needed.add(key);
        if (!this.active.has(key)) {
          const g = buildRuinGroup(r);
          this.scene.add(g);
          this.active.set(key, g);
        }
      }
    }
    for (const [key, group] of this.active) {
      if (!needed.has(key)) {
        this.scene.remove(group);
        disposeRuinGroup(group);
        this.active.delete(key);
      }
    }
  }
}
