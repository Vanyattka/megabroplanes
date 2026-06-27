import {
  CHUNK_SIZE,
  VILLAGE_CELL_SIZE,
  VILLAGE_VIEW_CELLS,
} from '../config.js';
import { getVillage } from './Villages.js';
import { buildVillageGroup, disposeVillageGroup } from './VillageMeshes.js';
import { profiler } from '../debug/Profiler.js';

// Two-stage streaming: when the plane crosses a village cell, we enqueue
// any new villages in range, but we don't build them until the chunk
// containing the airport is actually loaded. Without this gate, cities
// would pop in floating over empty sky while the chunk terrain is still
// being streamed in.
export class VillageManager {
  constructor(scene) {
    this.scene = scene;
    this.active = new Map();
    this.pending = [];
    this._lastCx = NaN;
    this._lastCz = NaN;
    this._lastMaxSq = -1;
  }

  update(planePos, maxDistance = Infinity, isChunkReady = null, gate = null) {
    const pcx = Math.floor(planePos.x / VILLAGE_CELL_SIZE);
    const pcz = Math.floor(planePos.z / VILLAGE_CELL_SIZE);
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

    // Drain pending — build at most one village per frame, only once the
    // terrain chunk under it is loaded. The shared cross-manager gate caps the
    // whole frame to a single content-feature build.
    if (gate && gate.used) return;
    if (this.pending.length > 0) {
      for (let i = 0; i < this.pending.length; i++) {
        const p = this.pending[i];
        if (isChunkReady) {
          const vcx = Math.floor(p.village.airportX / CHUNK_SIZE);
          const vcz = Math.floor(p.village.airportZ / CHUNK_SIZE);
          if (!isChunkReady(vcx, vcz)) continue;
        }
        // Build this one and remove from pending.
        const _t0 = profiler.timeBegin();
        const group = buildVillageGroup(p.village);
        profiler.timeEnd('village', _t0);
        this.scene.add(group);
        this.active.set(p.key, group);
        this.pending.splice(i, 1);
        if (gate) gate.used = true;
        break;
      }
    }
  }

  // Build every pending village whose underlying chunk is already loaded.
  // Call AFTER chunks.primeAll() at startup so the runway village and any
  // nearby airports are present on the first rendered frame.
  primeAll(planePos, maxDistance, isChunkReady) {
    this.update(planePos, maxDistance, isChunkReady);
    const remaining = [];
    for (const p of this.pending) {
      if (isChunkReady) {
        const vcx = Math.floor(p.village.airportX / CHUNK_SIZE);
        const vcz = Math.floor(p.village.airportZ / CHUNK_SIZE);
        if (!isChunkReady(vcx, vcz)) { remaining.push(p); continue; }
      }
      const group = buildVillageGroup(p.village);
      this.scene.add(group);
      this.active.set(p.key, group);
    }
    this.pending = remaining;
  }

  _recomputeNeeded(pcx, pcz, planePos, maxSq) {
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

    // Remove villages now out of range.
    for (const [key, group] of this.active) {
      if (!needed.has(key)) {
        this.scene.remove(group);
        disposeVillageGroup(group);
        this.active.delete(key);
      }
    }

    // Replace pending with the fresh list (sorted closest-first).
    pending.sort((a, b) => a.d2 - b.d2);
    // Keep any pending entries that are still needed (avoid losing them if
    // we cross cells quickly back and forth); otherwise the fresh list wins.
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
