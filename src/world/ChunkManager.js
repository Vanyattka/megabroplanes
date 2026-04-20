import { Group } from 'three';
import {
  CHUNK_SIZE,
  VIEW_DISTANCE_CHUNKS,
  CHUNK_BUILD_BUDGET_MS,
} from '../config.js';
import { buildChunk } from './Terrain.js';
import { buildScatter, disposeScatter } from './Scatter.js';

// Two-pass streaming with a strict time budget.
//
//   Phase A — terrain + road (~14 ms, mandatory at least once, produces the
//             visible ground). Always builds the closest pending chunk if
//             there is one, then keeps going until the deadline.
//
//   Phase B — scatter trees/rocks (~4 ms). Runs at most one build per frame
//             AND only if Phase A left any budget at all. Previous iteration
//             had a bug where Phase B would build one scatter regardless of
//             budget — so terrain + scatter stacked on the same frame.
//
// We also early-exit the whole update when the plane's cell hasn't changed
// and no scatter is pending: there's no work to do but iterating 225 cells
// at 60 Hz was still costing ~0.4 ms every physics tick for nothing.
export class ChunkManager {
  constructor(scene, { roads } = {}) {
    this.scene = scene;
    this.roads = roads || null;
    this.chunks = new Map();
    this._lastCx = NaN;
    this._lastCz = NaN;
    this._lastVd = -1;
    this._scatterQueue = []; // refs to entries with scatterPending === true
  }

  update(planePos, viewDistance) {
    const pcx = Math.floor(planePos.x / CHUNK_SIZE);
    const pcz = Math.floor(planePos.z / CHUNK_SIZE);
    const vd = viewDistance ?? VIEW_DISTANCE_CHUNKS;

    const tStart = performance.now();
    const deadline = tStart + CHUNK_BUILD_BUDGET_MS;

    // Fast path — cell/view didn't change, nothing to add or remove. Still
    // drain one scatter if anything is pending.
    const cellChanged =
      pcx !== this._lastCx || pcz !== this._lastCz || vd !== this._lastVd;

    if (cellChanged) {
      this._lastCx = pcx;
      this._lastCz = pcz;
      this._lastVd = vd;
      this._rebuildNeeded(pcx, pcz, vd, planePos, deadline);
    }

    this._drainScatter(deadline, planePos);
  }

  _rebuildNeeded(pcx, pcz, vd, planePos, deadline) {
    const needed = new Set();
    const pending = [];

    for (let dx = -vd; dx <= vd; dx++) {
      for (let dz = -vd; dz <= vd; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = `${cx},${cz}`;
        needed.add(key);
        if (!this.chunks.has(key)) {
          pending.push({ cx, cz, key, d2: dx * dx + dz * dz });
        }
      }
    }

    // Build closest pending chunks first. Always build at least one so the
    // player never sees a hole in the near view after a cell crossing; stop
    // as soon as the deadline is hit.
    if (pending.length > 0) {
      pending.sort((a, b) => a.d2 - b.d2);
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        // First iteration: always build. Subsequent: respect budget.
        if (i > 0 && performance.now() > deadline) break;
        this._buildTerrain(p);
      }
    }

    // Dispose chunks outside the new radius.
    for (const [key, entry] of this.chunks) {
      if (!needed.has(key)) {
        this.scene.remove(entry.group);
        entry.terrain.geometry.dispose();
        entry.terrain.material.dispose();
        if (entry.scatter) disposeScatter(entry.scatter);
        this.chunks.delete(key);
        // Remove from scatter queue if present.
        const qi = this._scatterQueue.indexOf(entry);
        if (qi !== -1) this._scatterQueue.splice(qi, 1);
        if (this.roads) this.roads.disposeForChunk(entry.cx, entry.cz);
      }
    }
  }

  _buildTerrain({ cx, cz, key, d2 }) {
    const terrain = buildChunk(cx, cz);
    const group = new Group();
    group.add(terrain);
    this.scene.add(group);
    const entry = {
      group,
      terrain,
      scatter: null,
      cx,
      cz,
      d2,
      scatterPending: true,
    };
    this.chunks.set(key, entry);
    this._scatterQueue.push(entry);
    if (this.roads) this.roads.buildForChunk(cx, cz);
  }

  _drainScatter(deadline, planePos) {
    // Skip entirely if Phase A already ate the budget.
    if (performance.now() > deadline) return;
    if (this._scatterQueue.length === 0) return;

    // Pick the closest-to-plane scatter — recompute distance since the
    // plane has moved since the chunk was queued.
    let bestIdx = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < this._scatterQueue.length; i++) {
      const e = this._scatterQueue[i];
      const dx = e.cx * CHUNK_SIZE + CHUNK_SIZE / 2 - planePos.x;
      const dz = e.cz * CHUNK_SIZE + CHUNK_SIZE / 2 - planePos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) return;
    const entry = this._scatterQueue.splice(bestIdx, 1)[0];

    entry.scatter = buildScatter(entry.cx, entry.cz);
    entry.group.add(entry.scatter);
    entry.scatterPending = false;
  }
}
