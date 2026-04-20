import { RUIN_CELL_SIZE, RUIN_BUILD_BUDGET_MS } from '../config.js';
import { getRuin } from './Ruins.js';
import { buildRuinGroup, disposeRuinGroup } from './RuinMeshes.js';

export class RuinsManager {
  constructor(scene) {
    this.scene = scene;
    this.active = new Map();
  }

  update(planePos, maxDistance = Infinity) {
    const pcx = Math.floor(planePos.x / RUIN_CELL_SIZE);
    const pcz = Math.floor(planePos.z / RUIN_CELL_SIZE);
    const maxSq = maxDistance * maxDistance;
    const needed = new Set();
    const pending = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const r = getRuin(pcx + dx, pcz + dz);
        if (!r) continue;
        const ddx = r.x - planePos.x;
        const ddz = r.z - planePos.z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 > maxSq) continue;
        const key = `${r.rcx},${r.rcz}`;
        needed.add(key);
        if (!this.active.has(key)) {
          pending.push({ ruin: r, key, d2 });
        }
      }
    }

    if (pending.length > 0) {
      pending.sort((a, b) => a.d2 - b.d2);
      const tStart = performance.now();
      const deadline = tStart + RUIN_BUILD_BUDGET_MS;
      let built = 0;
      for (const p of pending) {
        const g = buildRuinGroup(p.ruin);
        this.scene.add(g);
        this.active.set(p.key, g);
        built++;
        if (built >= 1 && performance.now() > deadline) break;
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
