import { Group } from 'three';
import { CHUNK_SIZE, VIEW_DISTANCE_CHUNKS } from '../config.js';
import { buildChunk } from './Terrain.js';
import { buildScatter, disposeScatter } from './Scatter.js';

export class ChunkManager {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map(); // "cx,cz" → { group, terrain, scatter }
  }

  update(planePos) {
    const pcx = Math.floor(planePos.x / CHUNK_SIZE);
    const pcz = Math.floor(planePos.z / CHUNK_SIZE);
    const needed = new Set();

    for (let dx = -VIEW_DISTANCE_CHUNKS; dx <= VIEW_DISTANCE_CHUNKS; dx++) {
      for (let dz = -VIEW_DISTANCE_CHUNKS; dz <= VIEW_DISTANCE_CHUNKS; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = `${cx},${cz}`;
        needed.add(key);
        if (!this.chunks.has(key)) {
          const terrain = buildChunk(cx, cz);
          const scatter = buildScatter(cx, cz);
          const group = new Group();
          group.add(terrain);
          group.add(scatter);
          this.scene.add(group);
          this.chunks.set(key, { group, terrain, scatter });
        }
      }
    }

    for (const [key, entry] of this.chunks) {
      if (!needed.has(key)) {
        this.scene.remove(entry.group);
        entry.terrain.geometry.dispose();
        entry.terrain.material.dispose();
        disposeScatter(entry.scatter);
        this.chunks.delete(key);
      }
    }
  }
}
