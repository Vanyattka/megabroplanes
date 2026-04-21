import { CHUNK_SIZE, RUIN_CELL_SIZE, RUIN_BUILD_BUDGET_MS } from '../config.js';
import { getRuin } from './Ruins.js';
import { buildRuinGroup, disposeRuinGroup } from './RuinMeshes.js';

export class RuinsManager {
  constructor(scene) {
    this.scene = scene;
    this.active = new Map();
    this.pending = [];
    this._lastCx = NaN;
    this._lastCz = NaN;
    this._lastMaxSq = -1;
  }

  update(planePos, maxDistance = Infinity, isChunkReady = null) {
    const pcx = Math.floor(planePos.x / RUIN_CELL_SIZE);
    const pcz = Math.floor(planePos.z / RUIN_CELL_SIZE);
    const maxSq = maxDistance * maxDistance;
    const cellChanged =
      pcx !== this._lastCx ||
      pcz !== this._lastCz ||
      maxSq !== this._lastMaxSq;
    if (cellChanged) {
      this._lastCx = pcx;
      this._lastCz = pcz;
      this._lastMaxSq = maxSq;
      this._recomputeNeeded(pcx, pcz, planePos, maxSq);
    }

    if (this.pending.length > 0) {
      const tStart = performance.now();
      const deadline = tStart + RUIN_BUILD_BUDGET_MS;
      for (let i = 0; i < this.pending.length; i++) {
        const p = this.pending[i];
        if (isChunkReady) {
          const rcx = Math.floor(p.ruin.x / CHUNK_SIZE);
          const rcz = Math.floor(p.ruin.z / CHUNK_SIZE);
          if (!isChunkReady(rcx, rcz)) continue;
        }
        const g = buildRuinGroup(p.ruin);
        this.scene.add(g);
        this.active.set(p.key, g);
        this.pending.splice(i, 1);
        break;
      }
      if (performance.now() > deadline) return;
    }
  }

  // Synchronously build every pending ruin whose chunk is ready.
  primeAll(planePos, maxDistance, isChunkReady) {
    this.update(planePos, maxDistance, isChunkReady);
    const remaining = [];
    for (const p of this.pending) {
      if (isChunkReady) {
        const rcx = Math.floor(p.ruin.x / CHUNK_SIZE);
        const rcz = Math.floor(p.ruin.z / CHUNK_SIZE);
        if (!isChunkReady(rcx, rcz)) { remaining.push(p); continue; }
      }
      const g = buildRuinGroup(p.ruin);
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
    for (const [key, group] of this.active) {
      if (!needed.has(key)) {
        this.scene.remove(group);
        disposeRuinGroup(group);
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
