import { CHUNK_SIZE, FARM_CELL_SIZE, FARM_BUILD_BUDGET_MS } from '../config.js';
import { getFarm } from './Farms.js';
import { buildFarmGroup, disposeFarmGroup } from './FarmMeshes.js';

// Streams standalone farms/fields exactly like RuinsManager: builds at most one
// feature per frame within a small time budget, only once the terrain chunk
// under the farm centre is ready, and disposes features as they leave range.
// Farms are contained in their cell so a 3×3 window around the player cell is
// complete.
export class FarmManager {
  constructor(scene) {
    this.scene = scene;
    this.active = new Map();
    this.pending = [];
    this._lastCx = NaN;
    this._lastCz = NaN;
    this._lastMaxSq = -1;
  }

  update(planePos, maxDistance = Infinity, isChunkReady = null) {
    const pcx = Math.floor(planePos.x / FARM_CELL_SIZE);
    const pcz = Math.floor(planePos.z / FARM_CELL_SIZE);
    const maxSq = maxDistance * maxDistance;
    const cellChanged =
      pcx !== this._lastCx || pcz !== this._lastCz || maxSq !== this._lastMaxSq;
    if (cellChanged) {
      this._lastCx = pcx;
      this._lastCz = pcz;
      this._lastMaxSq = maxSq;
      this._recomputeNeeded(pcx, pcz, planePos, maxSq);
    }

    if (this.pending.length > 0) {
      const tStart = performance.now();
      const deadline = tStart + FARM_BUILD_BUDGET_MS;
      for (let i = 0; i < this.pending.length; i++) {
        const p = this.pending[i];
        if (isChunkReady) {
          const fcx = Math.floor(p.farm.x / CHUNK_SIZE);
          const fcz = Math.floor(p.farm.z / CHUNK_SIZE);
          if (!isChunkReady(fcx, fcz)) continue;
        }
        const g = buildFarmGroup(p.farm);
        this.scene.add(g);
        this.active.set(p.key, g);
        this.pending.splice(i, 1);
        break;
      }
      if (performance.now() > deadline) return;
    }
  }

  // Synchronously build every pending farm whose chunk is ready.
  primeAll(planePos, maxDistance, isChunkReady) {
    this.update(planePos, maxDistance, isChunkReady);
    const remaining = [];
    for (const p of this.pending) {
      if (isChunkReady) {
        const fcx = Math.floor(p.farm.x / CHUNK_SIZE);
        const fcz = Math.floor(p.farm.z / CHUNK_SIZE);
        if (!isChunkReady(fcx, fcz)) { remaining.push(p); continue; }
      }
      const g = buildFarmGroup(p.farm);
      this.scene.add(g);
      this.active.set(p.key, g);
    }
    this.pending = remaining;
  }

  _recomputeNeeded(pcx, pcz, planePos, maxSq) {
    const needed = new Set();
    const pending = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const f = getFarm(pcx + dx, pcz + dz);
        if (!f) continue;
        const ddx = f.x - planePos.x;
        const ddz = f.z - planePos.z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 > maxSq) continue;
        const key = `${f.fcx},${f.fcz}`;
        needed.add(key);
        if (!this.active.has(key)) {
          pending.push({ farm: f, key, d2 });
        }
      }
    }
    for (const [key, group] of this.active) {
      if (!needed.has(key)) {
        this.scene.remove(group);
        disposeFarmGroup(group);
        this.active.delete(key);
      }
    }
    pending.sort((a, b) => a.d2 - b.d2);
    const keptPending = this.pending.filter(
      (p) => needed.has(p.key) && !this.active.has(p.key)
    );
    const seenKeys = new Set(keptPending.map((p) => p.key));
    this.pending = keptPending;
    for (const p of pending) {
      if (!seenKeys.has(p.key)) this.pending.push(p);
    }
  }
}
