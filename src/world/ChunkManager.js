import { CHUNK_SIZE, VIEW_DISTANCE_CHUNKS } from '../config.js';
import { buildChunk } from './Terrain.js';

export class ChunkManager {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
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
          const mesh = buildChunk(cx, cz);
          this.chunks.set(key, mesh);
          this.scene.add(mesh);
        }
      }
    }

    for (const [key, mesh] of this.chunks) {
      if (!needed.has(key)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        this.chunks.delete(key);
      }
    }
  }
}
