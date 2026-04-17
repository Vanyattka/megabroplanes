import {
  BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { CHUNK_SIZE, CHUNK_RESOLUTION, RUNWAY_CHUNK } from '../config.js';
import { heightAt } from './Noise.js';
import { isInRunwayFlatZone } from './Runway.js';

function colorForVertex(y) {
  if (y < 1) return [0.85, 0.8, 0.6];
  if (y < 10) return [0.35, 0.55, 0.25];
  if (y < 25) return [0.45, 0.5, 0.35];
  if (y < 40) return [0.5, 0.45, 0.4];
  return [0.95, 0.95, 0.95];
}

export function buildChunk(cx, cz) {
  const geo = new PlaneGeometry(
    CHUNK_SIZE,
    CHUNK_SIZE,
    CHUNK_RESOLUTION - 1,
    CHUNK_RESOLUTION - 1
  );
  geo.rotateX(-Math.PI / 2);

  const positions = geo.attributes.position;
  const colors = new Float32Array(positions.count * 3);

  const isRunwayChunk = cx === RUNWAY_CHUNK.cx && cz === RUNWAY_CHUNK.cz;
  const chunkOriginX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
  const chunkOriginZ = cz * CHUNK_SIZE + CHUNK_SIZE / 2;

  for (let i = 0; i < positions.count; i++) {
    const localX = positions.getX(i);
    const localZ = positions.getZ(i);
    const worldX = chunkOriginX + localX;
    const worldZ = chunkOriginZ + localZ;

    let y = heightAt(worldX, worldZ);

    if (isRunwayChunk && isInRunwayFlatZone(worldX, worldZ)) {
      y = 0;
    }

    positions.setY(i, y);

    const [r, g, b] = colorForVertex(y);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1.0,
    metalness: 0.0,
  });

  const mesh = new Mesh(geo, mat);
  mesh.position.set(chunkOriginX, 0, chunkOriginZ);
  return mesh;
}
