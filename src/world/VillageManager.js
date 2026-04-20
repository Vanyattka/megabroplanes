import {
  VILLAGE_CELL_SIZE,
  VILLAGE_VIEW_CELLS,
  VILLAGE_BUILD_BUDGET_MS,
} from '../config.js';
import { getVillage } from './Villages.js';
import { buildVillageGroup, disposeVillageGroup } from './VillageMeshes.js';

// Same early-exit pattern as ChunkManager: villages only need to be
// rechecked when the player crosses a cell boundary. In between, this
// update is a no-op.
export class VillageManager {
  constructor(scene) {
    this.scene = scene;
    this.active = new Map();
    this._lastCx = NaN;
    this._lastCz = NaN;
    this._lastMaxSq = -1;
  }

  update(planePos, maxDistance = Infinity) {
    const pcx = Math.floor(planePos.x / VILLAGE_CELL_SIZE);
    const pcz = Math.floor(planePos.z / VILLAGE_CELL_SIZE);
    const maxSq = maxDistance * maxDistance;
    if (
      pcx === this._lastCx &&
      pcz === this._lastCz &&
      maxSq === this._lastMaxSq
    ) {
      return;
    }
    this._lastCx = pcx;
    this._lastCz = pcz;
    this._lastMaxSq = maxSq;

    const needed = new Set();
    const pending = [];

    for (let dx = -VILLAGE_VIEW_CELLS; dx <= VILLAGE_VIEW_CELLS; dx++) {
      for (let dz = -VILLAGE_VIEW_CELLS; dz <= VILLAGE_VIEW_CELLS; dz++) {
        const gcx = pcx + dx;
        const gcz = pcz + dz;
        const v = getVillage(gcx, gcz);
        if (!v) continue;
        const ddx = v.airportX - planePos.x;
        const ddz = v.airportZ - planePos.z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 > maxSq) continue;
        const key = `${gcx},${gcz}`;
        needed.add(key);
        if (!this.active.has(key)) {
          pending.push({ village: v, key, d2 });
        }
      }
    }

    if (pending.length > 0) {
      pending.sort((a, b) => a.d2 - b.d2);
      const tStart = performance.now();
      const deadline = tStart + VILLAGE_BUILD_BUDGET_MS;
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        if (i > 0 && performance.now() > deadline) break;
        const group = buildVillageGroup(p.village);
        this.scene.add(group);
        this.active.set(p.key, group);
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
