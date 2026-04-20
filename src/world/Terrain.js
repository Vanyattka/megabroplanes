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
  WATER_LEVEL,
  SEA_THRESHOLD_LOW,
  SEA_THRESHOLD_HIGH,
  SEA_DEPTH,
} from '../config.js';
import { heightAt as noiseHeightAt } from './Noise.js';
import { biomeAt } from './Biome.js';
import { seaMaskAt } from './SeaMask.js';
import { villagesAffectingArea, villageFlatFactorFromList } from './Villages.js';
import { gfx } from '../ui/GraphicsSettings.js';

const ROCK = [0.48, 0.44, 0.40];

function colorByHeight(y) {
  if (y < 1) return [0.85, 0.80, 0.60];       // sand
  if (y < 10) return [0.35, 0.55, 0.25];      // grass
  if (y < 25) return [0.40, 0.48, 0.30];      // darker grass
  if (y < 40) return [0.55, 0.52, 0.45];      // scrub
  return [0.96, 0.96, 0.96];                  // snow
}

// Deterministic per-vertex hash in [0, 1). Used to perturb vertex colors
// so each triangle reads as slightly different grass/rock instead of one
// flat biome band.
function vertexHash(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function smoothstep01(edge0, edge1, x) {
  if (x <= edge0) return 0;
  if (x >= edge1) return 1;
  const t = (x - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
}

// Inline fast-path groundHeight that takes a precomputed village list.
// Avoids the per-vertex 3×3 cell lookup that Ground.groundHeight does —
// biggest single win for chunks far from any village (most of them).
function groundHeightFast(x, z, villages) {
  const f = villageFlatFactorFromList(x, z, villages);
  if (f === 0) return 0;
  const b = biomeAt(x, z);
  let h = noiseHeightAt(x, z) * b.amp + b.offset;
  const seaStrength = smoothstep01(
    SEA_THRESHOLD_LOW,
    SEA_THRESHOLD_HIGH,
    seaMaskAt(x, z)
  );
  h -= seaStrength * SEA_DEPTH;
  if (b.type !== 'lake' && seaStrength < 0.3) {
    const LAND_FLOOR = WATER_LEVEL + 2;
    if (h < LAND_FLOOR) {
      h = LAND_FLOOR - 3 * (1 - Math.exp((h - LAND_FLOOR) / 20));
    }
  }
  return h * f;
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

  // Precompute villages that actually touch this chunk's area. Usually 0;
  // sometimes 1–2 near a settlement. Saves 9 × 1089 = ~10k wasted cell
  // lookups per chunk when we're out in open terrain.
  const minX = chunkOriginX - CHUNK_SIZE / 2;
  const maxX = chunkOriginX + CHUNK_SIZE / 2;
  const minZ = chunkOriginZ - CHUNK_SIZE / 2;
  const maxZ = chunkOriginZ + CHUNK_SIZE / 2;
  const villages = villagesAffectingArea(minX, maxX, minZ, maxZ);

  for (let i = 0; i < positions.count; i++) {
    const worldX = chunkOriginX + positions.getX(i);
    const worldZ = chunkOriginZ + positions.getZ(i);
    positions.setY(i, groundHeightFast(worldX, worldZ, villages));
  }

  geo.computeVertexNormals();

  const detail = !!gfx.settings.terrainDetail;
  const normals = geo.attributes.normal;
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const y = positions.getY(i);
    const ny = normals.getY(i);
    let rgb;
    if (ny < SLOPE_ROCK_THRESHOLD && y > 0.5) {
      rgb = ROCK;
    } else {
      rgb = colorByHeight(y);
    }
    let r = rgb[0], g = rgb[1], b = rgb[2];
    if (detail) {
      // Two hashes per vertex for slightly anisotropic jitter — breaks up
      // per-triangle banding. Kept small (~±5%) so the biome palette still
      // reads clearly.
      const h1 = vertexHash(chunkOriginX + x, chunkOriginZ + z) - 0.5;
      const h2 = vertexHash(chunkOriginX + x + 17.3, chunkOriginZ + z - 9.7) - 0.5;
      const jitter = h1 * 0.09 + h2 * 0.05;
      r = Math.max(0, Math.min(1, r + jitter * 0.6));
      g = Math.max(0, Math.min(1, g + jitter));
      b = Math.max(0, Math.min(1, b + jitter * 0.5));
    }
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
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
  mesh.receiveShadow = true;
  // Terrain casts shadows on Medium/High. Skip on Low to keep the shadow
  // pass triangle count manageable on weak GPUs.
  mesh.castShadow = !!gfx.settings.shadowTerrain;
  return mesh;
}
