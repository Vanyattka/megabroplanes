import { Group } from 'three';
import {
  CHUNK_SIZE,
  VIEW_DISTANCE_CHUNKS,
  CHUNK_BUILD_BUDGET_MS,
  CHUNK_BUILD_BUDGET_MAX_MS,
  CHUNK_BUILD_BUDGET_PER_PENDING_MS,
} from '../config.js';
import { buildChunk } from './Terrain.js';
import { buildScatter, disposeScatter } from './Scatter.js';
import { profiler } from '../debug/Profiler.js';

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
    // Persistent terrain pending queue. Was previously local to
    // _rebuildNeeded(), meaning chunks that didn't fit in one
    // cell-change budget never got built until the NEXT cell change.
    // At high VD (Ultra: 22) that starved 2000+ chunks after a VD
    // expansion — we were using ~2% of available CPU. Now drained
    // every frame up to the time budget.
    this._pendingTerrain = new Map(); // key → { cx, cz, d2 }
    // Cached sort state. _pendingTerrain is the source of truth; the
    // sorted array is rebuilt ONLY when the pending set changes (cell
    // boundary crossing, view-distance change, or primeAll). Draining
    // advances an index into the sorted list instead of re-sorting or
    // shifting the array — previously _drainTerrain allocated N entries
    // and sorted them every frame, which with 1500 pending chunks cost
    // ~1 ms/frame of GC/sort work.
    this._pendingSorted = null;
    this._pendingSortedIndex = 0;
  }

  // `visibilityRadius` (optional, world meters) — hide chunks fully beyond
  // this radius. Fog makes distant chunks look invisible in the fragment
  // shader, but Three.js still renders them every frame: shadow pass,
  // vertex shader, depth test. Toggling .visible on the chunk Group is
  // nearly free and avoids all that work. With grid ~500 chunks and fog
  // at ~80% of the grid radius, this typically hides 30–40% of chunks —
  // the biggest GPU win we can get without LOD.
  update(planePos, viewDistance, visibilityRadius) {
    const _tMgr = profiler.timeBegin();
    const pcx = Math.floor(planePos.x / CHUNK_SIZE);
    const pcz = Math.floor(planePos.z / CHUNK_SIZE);
    const vd = viewDistance ?? VIEW_DISTANCE_CHUNKS;

    // On cell/view change: update the pending queue (add missing, prune
    // out-of-range) and unload chunks that left the radius.
    const cellChanged =
      pcx !== this._lastCx || pcz !== this._lastCz || vd !== this._lastVd;
    if (cellChanged) {
      this._lastCx = pcx;
      this._lastCz = pcz;
      this._lastVd = vd;
      this._rebuildNeeded(pcx, pcz, vd);
    }

    // Drain terrain EVERY frame, not just on cell change. Before this fix,
    // a chunk stuck in pending sat until the next boundary crossing — at
    // Ultra VD (grid = 2025) that left 1800+ chunks unbuilt for seconds.
    this._drainTerrain(pcx, pcz);
    this._drainScatter(planePos);
    if (visibilityRadius) this._updateVisibility(planePos, visibilityRadius);
    profiler.timeEnd('chunkMgr', _tMgr);
  }

  // Hide chunks whose nearest point is beyond the visibility radius. Uses
  // square-distance for speed and adds a chunk-diagonal margin so partially
  // visible chunks stay rendered. Running every update() is cheap — ~500
  // cheap distance compares = well under 0.1 ms.
  _updateVisibility(planePos, radius) {
    const px = planePos.x;
    const pz = planePos.z;
    // Add half a chunk's diagonal as a margin: a chunk whose center is
    // barely past `radius` may still have a corner within the visible
    // zone. Hiding it would cause popping at the edge of fog.
    const margin = CHUNK_SIZE * 0.75;
    const cutoff = radius + margin;
    const cutoff2 = cutoff * cutoff;
    for (const entry of this.chunks.values()) {
      const cx = entry.cx * CHUNK_SIZE + CHUNK_SIZE / 2;
      const cz = entry.cz * CHUNK_SIZE + CHUNK_SIZE / 2;
      const dx = cx - px;
      const dz = cz - pz;
      const visible = dx * dx + dz * dz <= cutoff2;
      if (entry.group.visible !== visible) entry.group.visible = visible;
    }
  }

  // Called only when the plane's cell or view distance changes.
  // Updates the pending queue and disposes chunks outside the new radius.
  // Building is handled separately in _drainTerrain(), every frame.
  _rebuildNeeded(pcx, pcz, vd) {
    const needed = new Set();
    let pendingChanged = false;

    for (let dx = -vd; dx <= vd; dx++) {
      for (let dz = -vd; dz <= vd; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = `${cx},${cz}`;
        needed.add(key);
        if (!this.chunks.has(key) && !this._pendingTerrain.has(key)) {
          this._pendingTerrain.set(key, { cx, cz });
          pendingChanged = true;
        }
      }
    }

    // Prune pending chunks that fell out of the new radius.
    for (const key of this._pendingTerrain.keys()) {
      if (!needed.has(key)) {
        this._pendingTerrain.delete(key);
        pendingChanged = true;
      }
    }

    // Invalidate the sorted cache — _drainTerrain will rebuild it on the
    // next call if needed. Also rebuild when the plane just moved even if
    // pending didn't change, so sort priorities reflect the new cell.
    if (pendingChanged) {
      this._pendingSorted = null;
      this._pendingSortedIndex = 0;
    }

    // Dispose chunks outside the new radius.
    for (const [key, entry] of this.chunks) {
      if (!needed.has(key)) {
        this.scene.remove(entry.group);
        entry.terrain.geometry.dispose();
        // Do NOT dispose terrain.material — it's SHARED_TERRAIN_MAT, reused
        // by every chunk. Disposing it would kill the next chunk's render.
        if (entry.scatter) disposeScatter(entry.scatter);
        this.chunks.delete(key);
        // Remove from scatter queue if present.
        const qi = this._scatterQueue.indexOf(entry);
        if (qi !== -1) this._scatterQueue.splice(qi, 1);
        if (this.roads) this.roads.disposeForChunk(entry.cx, entry.cz);
      }
    }
  }

  // Build as many pending terrain chunks as fit in the adaptive time
  // budget. Runs every frame — not just on cell change — so chunks that
  // didn't fit in one budget keep building on subsequent frames.
  _drainTerrain(pcx, pcz) {
    if (this._pendingTerrain.size === 0) return;

    // Lazy-rebuild the sorted list. Only happens when pending changes
    // (cell boundary crossing, view-distance change, or prime). Between
    // those, we iterate the same sorted array via an index.
    if (this._pendingSorted === null) {
      this._pendingSorted = [];
      for (const e of this._pendingTerrain.values()) {
        const dx = e.cx - pcx;
        const dz = e.cz - pcz;
        this._pendingSorted.push({ cx: e.cx, cz: e.cz, d2: dx * dx + dz * dz });
      }
      this._pendingSorted.sort((a, b) => a.d2 - b.d2);
      this._pendingSortedIndex = 0;
    }

    const n = this._pendingTerrain.size;
    const adaptiveMs = Math.min(
      CHUNK_BUILD_BUDGET_MAX_MS,
      CHUNK_BUILD_BUDGET_MS + n * CHUNK_BUILD_BUDGET_PER_PENDING_MS
    );
    const deadline = performance.now() + adaptiveMs;

    let built = 0;
    const sorted = this._pendingSorted;
    while (this._pendingSortedIndex < sorted.length) {
      if (built > 0 && performance.now() > deadline) break;
      const e = sorted[this._pendingSortedIndex++];
      const key = `${e.cx},${e.cz}`;
      if (!this._pendingTerrain.has(key)) continue; // stale entry
      this._buildTerrain({ cx: e.cx, cz: e.cz, key, d2: e.d2 });
      this._pendingTerrain.delete(key);
      built++;
    }

    // Fully drained? Drop the cache so memory doesn't stay pinned.
    if (this._pendingSortedIndex >= sorted.length) {
      this._pendingSorted = null;
      this._pendingSortedIndex = 0;
    }
  }

  // Expose whether a chunk is loaded so VillageManager / RuinsManager can
// avoid "floating village with no ground under it" pop-in.
  hasChunk(cx, cz) {
    return this.chunks.has(`${cx},${cz}`);
  }

  // Synchronously build every pending chunk (terrain + scatter) in range.
  // Used once at game start so the player never sees "missing runway /
  // sandy ground" — the initial world is fully present by first render.
  // Takes ~200–500 ms of blocking CPU depending on view distance, which
  // is fine before the first frame.
  primeAll(planePos, viewDistance) {
    const pcx = Math.floor(planePos.x / CHUNK_SIZE);
    const pcz = Math.floor(planePos.z / CHUNK_SIZE);
    const vd = viewDistance ?? VIEW_DISTANCE_CHUNKS;
    this._lastCx = pcx;
    this._lastCz = pcz;
    this._lastVd = vd;

    // Build all missing terrain (+ road) in range, closest-first.
    const pending = [];
    for (let dx = -vd; dx <= vd; dx++) {
      for (let dz = -vd; dz <= vd; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = `${cx},${cz}`;
        if (this.chunks.has(key)) continue;
        pending.push({ cx, cz, key, d2: dx * dx + dz * dz });
      }
    }
    pending.sort((a, b) => a.d2 - b.d2);
    for (const p of pending) this._buildTerrain(p);

    // Drain scatter queue fully.
    while (this._scatterQueue.length > 0) {
      const entry = this._scatterQueue.shift();
      entry.scatter = buildScatter(entry.cx, entry.cz);
      entry.group.add(entry.scatter);
      entry.scatterPending = false;
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

  _drainScatter(planePos) {
    if (this._scatterQueue.length === 0) return;

    // Scatter shares the adaptive budget model with terrain but uses its
    // own independent budget — it runs AFTER terrain drain so the frame
    // may already have spent its terrain budget. That's fine; at worst
    // we spend MAX+MAX ≈ 20 ms on a hot frame, still below the 60 fps line.
    const n = this._scatterQueue.length;
    const adaptiveMs = Math.min(
      CHUNK_BUILD_BUDGET_MAX_MS,
      CHUNK_BUILD_BUDGET_MS + n * CHUNK_BUILD_BUDGET_PER_PENDING_MS
    );
    const localDeadline = performance.now() + adaptiveMs;

    // Sort by distance to plane — closest scatter first.
    this._scatterQueue.sort((a, b) => {
      const adx = a.cx * CHUNK_SIZE + CHUNK_SIZE / 2 - planePos.x;
      const adz = a.cz * CHUNK_SIZE + CHUNK_SIZE / 2 - planePos.z;
      const bdx = b.cx * CHUNK_SIZE + CHUNK_SIZE / 2 - planePos.x;
      const bdz = b.cz * CHUNK_SIZE + CHUNK_SIZE / 2 - planePos.z;
      return adx * adx + adz * adz - (bdx * bdx + bdz * bdz);
    });

    let built = 0;
    while (this._scatterQueue.length > 0) {
      if (built >= 1 && performance.now() > localDeadline) break;
      const entry = this._scatterQueue.shift();
      entry.scatter = buildScatter(entry.cx, entry.cz);
      entry.group.add(entry.scatter);
      entry.scatterPending = false;
      built++;
    }
  }
}
