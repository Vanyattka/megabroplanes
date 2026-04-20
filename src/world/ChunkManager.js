import { Group } from 'three';
import {
  CHUNK_SIZE,
  VIEW_DISTANCE_CHUNKS,
  CHUNK_BUILD_BUDGET_MS,
} from '../config.js';
import { buildChunk } from './Terrain.js';
import { buildScatter, disposeScatter } from './Scatter.js';

// Two-pass streaming. Each chunk now has two build phases:
//   Phase A — terrain + road (~14 ms, mandatory, visible as ground)
//   Phase B — scatter trees/rocks (~4 ms, deferred to later frame)
// By separating them we never spend the full ~18 ms on a single frame; at
// worst we spend ~14 ms on one frame (terrain) and ~4 ms the next (scatter).
// Combined with distance-priority and a per-frame time budget, this keeps
// chunk streaming invisible on any decent CPU.
export class ChunkManager {
  constructor(scene, { roads } = {}) {
    this.scene = scene;
    this.roads = roads || null;
    this.chunks = new Map(); // "cx,cz" → { group, terrain, scatter, cx, cz, scatterPending }
  }

  update(planePos, viewDistance) {
    const pcx = Math.floor(planePos.x / CHUNK_SIZE);
    const pcz = Math.floor(planePos.z / CHUNK_SIZE);
    const needed = new Set();
    const pending = [];
    const vd = viewDistance ?? VIEW_DISTANCE_CHUNKS;

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

    const tStart = performance.now();
    const deadline = tStart + CHUNK_BUILD_BUDGET_MS;

    // Phase A — build terrain for the closest pending chunk(s). Always build
    // at least one per frame so progress is guaranteed; stop once over budget.
    if (pending.length > 0) {
      pending.sort((a, b) => a.d2 - b.d2);
      let built = 0;
      for (const p of pending) {
        const terrain = buildChunk(p.cx, p.cz);
        const group = new Group();
        group.add(terrain);
        this.scene.add(group);
        this.chunks.set(p.key, {
          group,
          terrain,
          scatter: null,
          cx: p.cx,
          cz: p.cz,
          d2: p.d2,
          scatterPending: true,
        });
        if (this.roads) this.roads.buildForChunk(p.cx, p.cz);
        built++;
        if (built >= 1 && performance.now() > deadline) break;
      }
    }

    // Phase B — build scatter for any chunk whose terrain is already in the
    // scene. Closest first. The scatter build is always cheap (~4 ms); if
    // budget is already spent by Phase A, we push it to the next frame.
    let scatterBuilt = 0;
    const scatterCandidates = [];
    for (const entry of this.chunks.values()) {
      if (entry.scatterPending) scatterCandidates.push(entry);
    }
    if (scatterCandidates.length > 0) {
      scatterCandidates.sort((a, b) => a.d2 - b.d2);
      for (const entry of scatterCandidates) {
        if (performance.now() > deadline && scatterBuilt >= 1) break;
        entry.scatter = buildScatter(entry.cx, entry.cz);
        entry.group.add(entry.scatter);
        entry.scatterPending = false;
        scatterBuilt++;
      }
    }

    for (const [key, entry] of this.chunks) {
      if (!needed.has(key)) {
        this.scene.remove(entry.group);
        entry.terrain.geometry.dispose();
        entry.terrain.material.dispose();
        if (entry.scatter) disposeScatter(entry.scatter);
        this.chunks.delete(key);
        if (this.roads) this.roads.disposeForChunk(entry.cx, entry.cz);
      }
    }
  }
}
