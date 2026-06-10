import { Group } from 'three';
import {
  CHUNK_SIZE,
  VIEW_DISTANCE_CHUNKS,
  CHUNK_BUILD_BUDGET_MS,
  CHUNK_BUILD_BUDGET_MAX_MS,
  CHUNK_BUILD_BUDGET_PER_PENDING_MS,
} from '../config.js';
import {
  buildChunk,
  finalizeTerrainMesh,
  villagesForChunk,
} from './Terrain.js';
import { buildScatter, disposeScatter } from './Scatter.js';
import { gfx } from '../ui/GraphicsSettings.js';
import { profiler } from '../debug/Profiler.js';

// Max concurrent in-flight worker build requests. Higher = the pool can
// work on more chunks in parallel; lower = less worker queue latency when
// the plane changes direction. Tuned for 2 workers: one chunk each plus
// a small backlog so the worker never sits idle between results. Going
// higher means cancelled results (chunks we've already unloaded) eat
// worker time.
const MAX_IN_FLIGHT = 8;

// Cap how many worker results get finalized into Three.js meshes per
// frame. CAP=4 keeps single-frame GPU upload under 2 ms (terrain
// finalize ~0.3 ms each, each creating a ~40 KB BufferGeometry) while
// draining the backlog fast enough to keep up with workers that can
// produce ~500 chunks/s. At 2/frame main was the bottleneck: at long-
// distance sustained flight, workers built chunks faster than install
// could run them, so visible ground lagged several seconds behind and
// the plane flew over "emptiness" that was actually chunks still in
// the result queue.
const MAX_TERRAIN_INSTALLS_PER_FRAME = 4;
// Backpressure — stop dispatching new work to the pool once this many
// results are already buffered waiting to install. Keeps the result
// queue bounded even when the plane flies faster than 4 installs/frame
// can absorb, and stops workers spinning on stale chunks (which would
// then get pruned anyway when the plane moves further).
const MAX_BUFFERED_RESULTS = 12;
// Matching cap for scatter. 0.2 ms CPU per scatter × many → mostly
// cheap but still bulks up a single frame's GPU upload when several
// fresh InstancedMesh instance buffers arrive at once.
const MAX_SCATTER_INSTALLS_PER_FRAME = 3;

export class ChunkManager {
  // `pool` (optional ChunkWorkerPool): when provided, terrain is built
  //   asynchronously on worker threads and the main thread only finalizes
  //   (BufferGeometry wiring + Mesh + scene.add). Without a pool,
  //   streaming falls back to synchronous buildChunk on the main thread.
  constructor(scene, { roads, pool } = {}) {
    this.scene = scene;
    this.roads = roads || null;
    this.pool = pool || null;
    this.chunks = new Map();
    this._lastCx = NaN;
    this._lastCz = NaN;
    this._lastVd = -1;
    this._scatterQueue = []; // refs to entries with scatterPending === true
    // Persistent terrain pending queue. Chunks that haven't been dispatched
    // to a worker (or built on main) yet.
    this._pendingTerrain = new Map(); // key → { cx, cz }
    // In-flight chunks: sent to a worker, awaiting result. Tracked
    // separately so we can avoid double-dispatch and detect cancellation
    // (chunk was unloaded before the result came back).
    this._inFlight = new Map(); // key → { cx, cz }
    // Results buffered between worker-return and main-thread install.
    // Lets us cap mesh creation rate (MAX_TERRAIN_INSTALLS_PER_FRAME) —
    // without this, 6–8 workers returning in the same frame all install
    // at once, producing a 20+ ms GPU-upload spike even though CPU work
    // is tiny. Draining 2 per frame keeps frame time flat.
    this._terrainResults = []; // [{ cx, cz, key, data }]
    // Cached sort state; rebuilt lazily when pending changes.
    this._pendingSorted = null;
    this._pendingSortedIndex = 0;
  }

  // `visibilityRadius` (optional, world meters) — hide chunks beyond the
  // radius. Fog hides distant chunks in the fragment shader but Three.js
  // still renders them (shadow pass, vertex shader, depth). Toggling
  // .visible on the chunk Group skips all of that for free.
  update(planePos, viewDistance, visibilityRadius) {
    const _tMgr = profiler.timeBegin();
    // NaN guard — if physics ever produces a non-finite position (rare,
    // but division-by-zero or sqrt(-x) in the plane physics could do it),
    // Math.floor returns NaN, visibility compares false for everything,
    // and the player sees every chunk go invisible. Better to no-op the
    // streaming update than to blank the world.
    if (!Number.isFinite(planePos.x) || !Number.isFinite(planePos.z)) {
      profiler.timeEnd('chunkMgr', _tMgr);
      return;
    }
    const pcx = Math.floor(planePos.x / CHUNK_SIZE);
    const pcz = Math.floor(planePos.z / CHUNK_SIZE);
    const vd = viewDistance ?? VIEW_DISTANCE_CHUNKS;

    const cellChanged =
      pcx !== this._lastCx || pcz !== this._lastCz || vd !== this._lastVd;
    if (cellChanged) {
      this._lastCx = pcx;
      this._lastCz = pcz;
      this._lastVd = vd;
      this._rebuildNeeded(pcx, pcz, vd);
    }

    this._drainTerrain(pcx, pcz);
    this._drainTerrainResults();
    this._drainScatter(planePos);
    if (visibilityRadius) this._updateVisibility(planePos, visibilityRadius);
    profiler.timeEnd('chunkMgr', _tMgr);
  }

  _updateVisibility(planePos, radius) {
    const px = planePos.x;
    const pz = planePos.z;
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

  // Update pending queue on cell/view change; dispose chunks outside the
  // new radius. Terrain BUILDING happens separately in _drainTerrain.
  _rebuildNeeded(pcx, pcz, vd) {
    const needed = new Set();
    let pendingChanged = false;

    for (let dx = -vd; dx <= vd; dx++) {
      for (let dz = -vd; dz <= vd; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = `${cx},${cz}`;
        needed.add(key);
        if (
          !this.chunks.has(key) &&
          !this._pendingTerrain.has(key) &&
          !this._inFlight.has(key)
        ) {
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
    // Prune in-flight entries that fell out — when results come back
    // they'll check .has(key) and drop silently.
    for (const key of this._inFlight.keys()) {
      if (!needed.has(key)) this._inFlight.delete(key);
    }
    // Also prune buffered results that are no longer needed — avoids
    // finalizing a Mesh for a chunk that's about to be out of range.
    for (let i = this._terrainResults.length - 1; i >= 0; i--) {
      if (!needed.has(this._terrainResults[i].key)) {
        this._terrainResults.splice(i, 1);
      }
    }

    if (pendingChanged) {
      this._pendingSorted = null;
      this._pendingSortedIndex = 0;
    }

    // Dispose chunks outside the new radius.
    for (const [key, entry] of this.chunks) {
      if (!needed.has(key)) {
        this.scene.remove(entry.group);
        entry.terrain.geometry.dispose();
        // Do NOT dispose terrain.material — it's SHARED_TERRAIN_MAT.
        if (entry.scatter) disposeScatter(entry.scatter);
        this.chunks.delete(key);
        const qi = this._scatterQueue.indexOf(entry);
        if (qi !== -1) this._scatterQueue.splice(qi, 1);
        // Roads stream independently by player distance (Roads.update) — they
        // are no longer tied to terrain-chunk lifetime.
      }
    }
  }

  // Dispatch pending chunks to the worker pool (or build synchronously as
  // fallback if no pool is configured). Results arrive asynchronously via
  // _onTerrainReady.
  _drainTerrain(pcx, pcz) {
    if (this._pendingTerrain.size === 0) return;

    // Lazy-rebuild the sorted list. Only happens when pending changes.
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

    const sorted = this._pendingSorted;

    if (this.pool) {
      // Backpressure: if the result buffer is already full, don't spawn
      // more work. Workers would produce results that sit in memory
      // growing backlog while main can only install a few per frame.
      // Pausing dispatch gives install time to drain the buffer.
      if (this._terrainResults.length >= MAX_BUFFERED_RESULTS) return;
      const budget = MAX_BUFFERED_RESULTS - this._terrainResults.length;
      // Async path: dispatch up to min(slots, budget) chunks. Each
      // dispatch is cheap (~20 μs: extract villages, postMessage). The
      // worker does the 3 ms of pure math off the main thread and the
      // result arrives later via _onTerrainReady.
      const slots = Math.min(MAX_IN_FLIGHT - this._inFlight.size, budget);
      if (slots <= 0) return;
      let dispatched = 0;
      while (
        this._pendingSortedIndex < sorted.length &&
        dispatched < slots
      ) {
        const e = sorted[this._pendingSortedIndex++];
        const key = `${e.cx},${e.cz}`;
        if (!this._pendingTerrain.has(key)) continue; // stale entry
        this._pendingTerrain.delete(key);
        this._inFlight.set(key, { cx: e.cx, cz: e.cz });
        this._dispatchBuild(e.cx, e.cz, key);
        dispatched++;
      }
    } else {
      // Sync fallback: build on main thread, respecting time budget.
      const n = this._pendingTerrain.size;
      const adaptiveMs = Math.min(
        CHUNK_BUILD_BUDGET_MAX_MS,
        CHUNK_BUILD_BUDGET_MS + n * CHUNK_BUILD_BUDGET_PER_PENDING_MS
      );
      const deadline = performance.now() + adaptiveMs;
      let built = 0;
      while (this._pendingSortedIndex < sorted.length) {
        if (built > 0 && performance.now() > deadline) break;
        const e = sorted[this._pendingSortedIndex++];
        const key = `${e.cx},${e.cz}`;
        if (!this._pendingTerrain.has(key)) continue;
        this._pendingTerrain.delete(key);
        this._buildTerrainSync(e.cx, e.cz, key);
        built++;
      }
    }

    if (this._pendingSortedIndex >= sorted.length) {
      this._pendingSorted = null;
      this._pendingSortedIndex = 0;
    }
  }

  _dispatchBuild(cx, cz, key) {
    // Villages must be gathered on the main thread — worker can't query
    // the village cache (it's per-thread). The query is cheap (typically
    // 0 or 1 villages per chunk) and results get shipped to the worker
    // as a small plain-object array.
    const villages = villagesForChunk(cx, cz);
    const detail = !!gfx.settings.terrainDetail;
    this.pool
      .buildTerrain(cx, cz, villages, detail)
      .then((data) => this._onTerrainReady(cx, cz, key, data))
      .catch((err) => this._onTerrainError(cx, cz, key, err));
  }

  // Worker finished — buffer the raw data for throttled finalization.
  // Deferring the Mesh construction to _drainTerrainResults is what
  // prevents a burst of simultaneous worker returns from stacking 8
  // scene.add calls (and their GPU uploads) on one frame.
  _onTerrainReady(cx, cz, key, data) {
    if (!this._inFlight.has(key)) return; // cancelled
    this._inFlight.delete(key);
    this._terrainResults.push({ cx, cz, key, data });
  }

  // Drain buffered worker results into Three.js meshes, capped at
  // MAX_TERRAIN_INSTALLS_PER_FRAME so GPU upload stays smooth.
  _drainTerrainResults() {
    if (this._terrainResults.length === 0) return;
    const max = Math.min(MAX_TERRAIN_INSTALLS_PER_FRAME, this._terrainResults.length);
    for (let i = 0; i < max; i++) {
      const { cx, cz, key, data } = this._terrainResults.shift();
      // Double-check: chunk might have been pruned between message
      // receipt and this frame (rare race after a long turn).
      if (this.chunks.has(key)) continue;
      const _t0 = profiler.timeBegin();
      const terrain = finalizeTerrainMesh(data, cx, cz, !!gfx.settings.shadowTerrain);
      profiler.timeEnd('terrain', _t0);
      this._installChunk(cx, cz, key, terrain);
    }
  }

  _onTerrainError(cx, cz, key, err) {
    // eslint-disable-next-line no-console
    console.warn(`[ChunkManager] worker build failed for ${key}, falling back to sync:`, err);
    if (!this._inFlight.has(key)) return;
    this._inFlight.delete(key);
    // Fallback to sync build so the chunk doesn't stay missing forever.
    // Cost is a single ~3 ms hiccup, acceptable vs. a permanent hole.
    this._buildTerrainSync(cx, cz, key);
  }

  // Sync build (primeAll, fallback when pool errors, or no pool at all).
  _buildTerrainSync(cx, cz, key) {
    const terrain = buildChunk(cx, cz);
    this._installChunk(cx, cz, key, terrain);
  }

  _installChunk(cx, cz, key, terrainMesh) {
    const group = new Group();
    group.add(terrainMesh);
    this.scene.add(group);
    const entry = {
      group,
      terrain: terrainMesh,
      scatter: null,
      cx,
      cz,
      scatterPending: true,
    };
    this.chunks.set(key, entry);
    this._scatterQueue.push(entry);
  }

  hasChunk(cx, cz) {
    return this.chunks.has(`${cx},${cz}`);
  }

  // Synchronous prime — always runs on main thread. Keeps the first-frame
  // guarantee simple: by the time primeAll() returns, the inner radius is
  // fully built and ready to render. Async worker dispatch would require
  // awaiting, which would force the whole startup to be async and delay
  // audio/input wiring. 121 chunks × ~3 ms = ~350 ms blocking, acceptable
  // for a one-off startup cost.
  primeAll(planePos, viewDistance) {
    const pcx = Math.floor(planePos.x / CHUNK_SIZE);
    const pcz = Math.floor(planePos.z / CHUNK_SIZE);
    const vd = viewDistance ?? VIEW_DISTANCE_CHUNKS;
    this._lastCx = pcx;
    this._lastCz = pcz;
    this._lastVd = vd;

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
    for (const p of pending) this._buildTerrainSync(p.cx, p.cz, p.key);

    // Drain scatter queue fully so primed chunks render with trees/rocks.
    while (this._scatterQueue.length > 0) {
      const entry = this._scatterQueue.shift();
      entry.scatter = buildScatter(entry.cx, entry.cz);
      entry.group.add(entry.scatter);
      entry.scatterPending = false;
    }
  }

  _drainScatter(planePos) {
    if (this._scatterQueue.length === 0) return;

    // Hard cap: N scatter installs per frame. Scatter math itself is
    // cheap (~0.2 ms per chunk) but each one adds 2–3 InstancedMesh
    // instances whose instance buffers get uploaded to the GPU next
    // draw. Building 8 in one frame bursts the upload cost onto one
    // frame's GPU time; spreading to 2/frame makes it invisible.
    this._scatterQueue.sort((a, b) => {
      const adx = a.cx * CHUNK_SIZE + CHUNK_SIZE / 2 - planePos.x;
      const adz = a.cz * CHUNK_SIZE + CHUNK_SIZE / 2 - planePos.z;
      const bdx = b.cx * CHUNK_SIZE + CHUNK_SIZE / 2 - planePos.x;
      const bdz = b.cz * CHUNK_SIZE + CHUNK_SIZE / 2 - planePos.z;
      return adx * adx + adz * adz - (bdx * bdx + bdz * bdz);
    });

    const max = Math.min(MAX_SCATTER_INSTALLS_PER_FRAME, this._scatterQueue.length);
    for (let i = 0; i < max; i++) {
      const entry = this._scatterQueue.shift();
      entry.scatter = buildScatter(entry.cx, entry.cz);
      entry.group.add(entry.scatter);
      entry.scatterPending = false;
    }
  }
}
