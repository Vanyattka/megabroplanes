import { Group } from 'three';
import { CHUNK_SIZE, VIEW_DISTANCE_CHUNKS } from '../config.js';
import { buildChunk } from './Terrain.js';
import { buildScatter, disposeScatter } from './Scatter.js';

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
    const vd = viewDistance ?? VIEW_DISTANCE_CHUNKS;

    for (let dx = -vd; dx <= vd; dx++) {
      for (let dz = -vd; dz <= vd; dz++) {
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
          // Roads owned by this chunk are added as sibling meshes — not as
          // children of the chunk group — so their BufferGeometries can be
          // disposed independently when the chunk unloads.
          if (this.roads) this.roads.buildForChunk(cx, cz);
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
        const [cx, cz] = key.split(',').map(Number);
        if (this.roads) this.roads.disposeForChunk(cx, cz);
      }
    }
  }
}
