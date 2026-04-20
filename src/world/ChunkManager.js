import { Group } from 'three';
import {
  CHUNK_SIZE,
  VIEW_DISTANCE_CHUNKS,
  CHUNK_BUILD_BUDGET_MS,
} from '../config.js';
import { buildChunk } from './Terrain.js';
import { buildScatter, disposeScatter } from './Scatter.js';

// Per-frame streaming with a time budget. When the plane crosses a cell
// boundary at speed, 5+ new chunks become "needed" in a single frame. The
// old code built them all immediately → 30-80ms main-thread stall → visible
// twitch. We now enqueue them sorted by distance, always build at least one
// (so progress is guaranteed), then keep building until the deadline.
// Disposals stay synchronous — they're cheap.
export class ChunkManager {
  constructor(scene, { roads } = {}) {
    this.scene = scene;
    this.roads = roads || null;
    this.chunks = new Map(); // "cx,cz" → { group, terrain, scatter }
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

    if (pending.length > 0) {
      // Build closest chunks first — whichever the player is about to fly
      // into shows up fastest.
      pending.sort((a, b) => a.d2 - b.d2);
      const tStart = performance.now();
      const deadline = tStart + CHUNK_BUILD_BUDGET_MS;
      let built = 0;
      for (const p of pending) {
        const terrain = buildChunk(p.cx, p.cz);
        const scatter = buildScatter(p.cx, p.cz);
        const group = new Group();
        group.add(terrain);
        group.add(scatter);
        this.scene.add(group);
        this.chunks.set(p.key, { group, terrain, scatter });
        if (this.roads) this.roads.buildForChunk(p.cx, p.cz);
        built++;
        // Always build the first candidate; then respect the budget.
        if (built >= 1 && performance.now() > deadline) break;
      }
    }

    for (const [key, entry] of this.chunks) {
      if (!needed.has(key)) {
        this.scene.remove(entry.group);
        entry.terrain.geometry.dispose();
        entry.terrain.material.dispose();
        disposeScatter(entry.scatter);
        this.chunks.delete(key);
        const [cx, cz] = key.split(',').map(Number);
        if (this.roads) this.roads.disposeForChunk(cx, cz);
      }
    }
  }
}
