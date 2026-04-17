import {
  BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import {
  CHUNK_SIZE,
  CHUNK_RESOLUTION,
  SLOPE_ROCK_THRESHOLD,
} from '../config.js';
import { groundHeight } from './Ground.js';

const ROCK = [0.48, 0.44, 0.40];

function colorByHeight(y) {
  if (y < 1) return [0.85, 0.80, 0.60];       // sand
  if (y < 10) return [0.35, 0.55, 0.25];      // grass
  if (y < 25) return [0.40, 0.48, 0.30];      // darker grass
  if (y < 40) return [0.55, 0.52, 0.45];      // scrub
  return [0.96, 0.96, 0.96];                  // snow
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
  const chunkOriginX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
  const chunkOriginZ = cz * CHUNK_SIZE + CHUNK_SIZE / 2;

  for (let i = 0; i < positions.count; i++) {
    const worldX = chunkOriginX + positions.getX(i);
    const worldZ = chunkOriginZ + positions.getZ(i);
    positions.setY(i, groundHeight(worldX, worldZ));
  }

  geo.computeVertexNormals();

  // Color after normals so we can bias toward rock on steep slopes.
  const normals = geo.attributes.normal;
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    const ny = normals.getY(i);
    let rgb;
    if (ny < SLOPE_ROCK_THRESHOLD && y > 0.5) {
      rgb = ROCK;
    } else {
      rgb = colorByHeight(y);
    }
    colors[i * 3] = rgb[0];
    colors[i * 3 + 1] = rgb[1];
    colors[i * 3 + 2] = rgb[2];
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));

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
