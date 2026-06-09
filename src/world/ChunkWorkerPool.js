import { getWorldSeed } from './WorldSeed.js';

// Small pool of Web Workers for offloading buildChunk computation off the
// main thread. With 2 workers on an 8+ core machine (any modern Mac), all
// chunk generation runs in parallel with physics + render + audio — the
// main thread's only chunk cost is finalizeTerrainMesh (a few hundred μs
// of BufferGeometry wiring) and scene.add(). No more 20–40 ms stutters
// when the plane crosses chunk boundaries.

export class ChunkWorkerPool {
  // `size` — number of workers. 2 is a good default: saturates buildChunk
  //   (each build ~3 ms; 2 workers → 600+ chunks/sec throughput) without
  //   fighting physics/render for cores.
  constructor(size = 2) {
    this.workers = [];
    // Per-worker queue depth, used to route new requests to the least-busy
    // worker. Avoids head-of-line blocking if one worker is stuck on a
    // chunk with many nearby villages (rare, but >5× slower).
    this.inFlight = [];
    // reqId → { resolve, reject, workerIdx } — looked up when a result
    // message arrives.
    this.pending = new Map();
    this.nextReqId = 1;
    this.disposed = false;

    for (let i = 0; i < size; i++) {
      // Vite resolves `new URL(..., import.meta.url)` at build time and
      // emits the worker as a separate chunk. type: 'module' lets the
      // worker use ES imports.
      const worker = new Worker(new URL('./ChunkWorker.js', import.meta.url), {
        type: 'module',
      });
      worker.addEventListener('message', (e) => this._onMessage(i, e));
      worker.addEventListener('error', (e) => this._onError(i, e));
      this.workers.push(worker);
      this.inFlight.push(0);
    }
  }

  // Returns a Promise that resolves with { positions, normals, colors,
  // boundingSphereCenter, boundingSphereRadius } or rejects on worker
  // error. Callers should handle rejection gracefully — e.g. fall back
  // to the synchronous buildChunk path, or skip the chunk.
  buildTerrain(cx, cz, villages, detail) {
    if (this.disposed) return Promise.reject(new Error('pool disposed'));
    const reqId = this.nextReqId++;
    // Least-busy worker — simple 2-way compare avoids the cost of a full
    // sort when we only have a handful of workers.
    let workerIdx = 0;
    let minLoad = this.inFlight[0];
    for (let i = 1; i < this.workers.length; i++) {
      if (this.inFlight[i] < minLoad) { minLoad = this.inFlight[i]; workerIdx = i; }
    }
    this.inFlight[workerIdx]++;

    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject, workerIdx });
      this.workers[workerIdx].postMessage({
        type: 'buildTerrain',
        reqId,
        cx,
        cz,
        villages,
        detail,
        seed: getWorldSeed(), // worker reseeds its noise if this changed
      });
    });
  }

  _onMessage(workerIdx, event) {
    const msg = event.data;
    if (!msg || !msg.reqId) return;
    const entry = this.pending.get(msg.reqId);
    if (!entry) return; // stale / cancelled request
    this.pending.delete(msg.reqId);
    this.inFlight[workerIdx]--;
    if (msg.type === 'terrainResult') {
      entry.resolve({
        positions: msg.positions,
        normals: msg.normals,
        colors: msg.colors,
        boundingSphereCenter: msg.boundingSphereCenter,
        boundingSphereRadius: msg.boundingSphereRadius,
      });
    } else if (msg.type === 'terrainError') {
      entry.reject(new Error(`worker ${workerIdx}: ${msg.message}`));
    }
  }

  _onError(workerIdx, event) {
    console.error(`[ChunkWorkerPool] worker ${workerIdx} error:`, event.message);
    // Fail every outstanding request routed to this worker so callers can
    // retry synchronously. Rebuilding the worker could work but adds
    // complexity we don't need yet — in practice a worker that errored
    // once is probably broken in a way that'll re-error.
    for (const [reqId, entry] of this.pending) {
      if (entry.workerIdx === workerIdx) {
        entry.reject(new Error(`worker ${workerIdx} crashed: ${event.message}`));
        this.pending.delete(reqId);
      }
    }
    this.inFlight[workerIdx] = 0;
  }

  // Current total in-flight count — used by ChunkManager to cap how many
  // build requests are outstanding before falling back to queuing.
  totalInFlight() {
    let total = 0;
    for (let i = 0; i < this.inFlight.length; i++) total += this.inFlight[i];
    return total;
  }

  dispose() {
    this.disposed = true;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.pending.clear();
  }
}
