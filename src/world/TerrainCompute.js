// Pure-JS terrain computation — no Three.js imports. Shared by the main
// thread (Terrain.buildChunk sync path, used by primeAll) AND the worker
// (streaming). Bit-for-bit identical output on both sides as long as the
// same seeds/config are used, which they are (the noise modules are pure
// ES modules that initialise once per module load from config seeds).
//
// Keeping this file three-free is what lets the worker avoid bundling the
// entire Three.js library. Vite builds ChunkWorker.js with just
// TerrainCompute + its transitive imports (Noise, Biome, SeaMask,
// Profiler, config) — ~30 KB worker bundle instead of 700+ KB.

import {
  CHUNK_SIZE,
  CHUNK_RESOLUTION,
  SLOPE_ROCK_THRESHOLD,
  WATER_LEVEL,
  SEA_THRESHOLD_LOW,
  SEA_THRESHOLD_HIGH,
  SEA_DEPTH,
  RUNWAY_LENGTH,
  RUNWAY_WIDTH,
  RUNWAY_MARGIN,
  RUNWAY_BLEND,
} from '../config.js';
import { heightAt as noiseHeightAt } from './Noise.js';
import { biomeAt } from './Biome.js';
import { seaMaskAt } from './SeaMask.js';

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

// Rotated-rectangle flat-factor — inlined copy of Villages.rectFlatFactor
// so this file has no dependency on the Villages module (which pulls in
// Three.js-adjacent village-mesh stuff transitively).
// 0 inside the rect, 1 once further than RUNWAY_BLEND away, smoothstep between.
function rectFlatFactor(x, z, cx, cz, angle, halfL, halfW) {
  const dx = x - cx;
  const dz = z - cz;
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const distX = Math.max(0, Math.abs(lx) - halfL);
  const distZ = Math.max(0, Math.abs(lz) - halfW);
  const d = Math.sqrt(distX * distX + distZ * distZ);
  if (d <= 0) return 0;
  if (d >= RUNWAY_BLEND) return 1;
  const t = d / RUNWAY_BLEND;
  return t * t * (3 - 2 * t);
}

// Mirror of Villages.airportFlatFactorFor — only the runway strip
// flattens the ground. Village rect is placement-only, not a flatten
// rect. See Villages.airportFlatFactorFor for the rationale.
function villageFlatFactorFromData(x, z, villages) {
  if (villages.length === 0) return 1;
  const airportHalfL = RUNWAY_LENGTH / 2 + RUNWAY_MARGIN;
  const airportHalfW = RUNWAY_WIDTH / 2 + RUNWAY_MARGIN;
  let minF = 1;
  for (let i = 0; i < villages.length; i++) {
    const v = villages[i];
    const fA = rectFlatFactor(x, z, v.airportX, v.airportZ, v.angle, airportHalfL, airportHalfW);
    if (fA < minF) minF = fA;
    if (minF === 0) return 0;
  }
  return minF;
}

function groundHeightFast(x, z, villages) {
  const f = villageFlatFactorFromData(x, z, villages);
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

// Compute terrain as raw Float32Arrays. Same code on main thread and in the
// worker. Vertex layout matches what Three.js PlaneGeometry produces after
// rotateX(-π/2), so the main-thread finalizeTerrainMesh can use a shared
// static index buffer with the correct winding.
//
//   `villages` — lightweight VillageData objects (airport + villageRect
//                only). Pass [] for chunks nowhere near a village.
//   `detail`   — whether to apply the per-vertex color jitter.
export function computeTerrainData(cx, cz, villages, detail) {
  const RES = CHUNK_RESOLUTION;
  const N = RES * RES;
  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);

  const chunkOriginX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
  const chunkOriginZ = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
  const step = CHUNK_SIZE / (RES - 1);
  const startLocal = -CHUNK_SIZE / 2;

  // Pass 1: heights + positions.
  const heights = new Float32Array(N);
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let iy = 0; iy < RES; iy++) {
    const localZ = startLocal + iy * step;
    const worldZ = chunkOriginZ + localZ;
    for (let ix = 0; ix < RES; ix++) {
      const idx = iy * RES + ix;
      const localX = startLocal + ix * step;
      const worldX = chunkOriginX + localX;
      const h = groundHeightFast(worldX, worldZ, villages);
      heights[idx] = h;
      positions[idx * 3 + 0] = localX;
      positions[idx * 3 + 1] = h;
      positions[idx * 3 + 2] = localZ;
      if (localX < minX) minX = localX;
      if (localX > maxX) maxX = localX;
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
      if (localZ < minZ) minZ = localZ;
      if (localZ > maxZ) maxZ = localZ;
    }
  }

  // Pass 2: vertex normals via analytical central differences. Faster than
  // iterating indexed faces, and mathematically equivalent to Three.js
  // computeVertexNormals on a regular grid (both produce smoothed averages).
  const normals = new Float32Array(N * 3);
  for (let iy = 0; iy < RES; iy++) {
    for (let ix = 0; ix < RES; ix++) {
      const idx = iy * RES + ix;
      const hL = heights[iy * RES + Math.max(0, ix - 1)];
      const hR = heights[iy * RES + Math.min(RES - 1, ix + 1)];
      const hU = heights[Math.max(0, iy - 1) * RES + ix];
      const hD = heights[Math.min(RES - 1, iy + 1) * RES + ix];
      const spanX = ix === 0 || ix === RES - 1 ? step : 2 * step;
      const spanZ = iy === 0 || iy === RES - 1 ? step : 2 * step;
      const dhdx = (hR - hL) / spanX;
      const dhdz = (hD - hU) / spanZ;
      const nx = -dhdx;
      const ny = 1;
      const nz = -dhdz;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      normals[idx * 3 + 0] = nx / len;
      normals[idx * 3 + 1] = ny / len;
      normals[idx * 3 + 2] = nz / len;
    }
  }

  // Pass 3: colors (height band + rock on steep slopes + optional jitter).
  for (let iy = 0; iy < RES; iy++) {
    for (let ix = 0; ix < RES; ix++) {
      const idx = iy * RES + ix;
      const y = heights[idx];
      const ny = normals[idx * 3 + 1];
      let rgb;
      if (ny < SLOPE_ROCK_THRESHOLD && y > 0.5) {
        rgb = ROCK;
      } else {
        rgb = colorByHeight(y);
      }
      let r = rgb[0], g = rgb[1], b = rgb[2];
      if (detail) {
        const localX = positions[idx * 3 + 0];
        const localZ = positions[idx * 3 + 2];
        const h1 = vertexHash(chunkOriginX + localX, chunkOriginZ + localZ) - 0.5;
        const h2 = vertexHash(chunkOriginX + localX + 17.3, chunkOriginZ + localZ - 9.7) - 0.5;
        const jitter = h1 * 0.09 + h2 * 0.05;
        r = Math.max(0, Math.min(1, r + jitter * 0.6));
        g = Math.max(0, Math.min(1, g + jitter));
        b = Math.max(0, Math.min(1, b + jitter * 0.5));
      }
      colors[idx * 3 + 0] = r;
      colors[idx * 3 + 1] = g;
      colors[idx * 3 + 2] = b;
    }
  }

  const cxLocal = (minX + maxX) * 0.5;
  const cyLocal = (minY + maxY) * 0.5;
  const czLocal = (minZ + maxZ) * 0.5;
  const halfX = (maxX - minX) * 0.5;
  const halfY = (maxY - minY) * 0.5;
  const halfZ = (maxZ - minZ) * 0.5;
  const radius = Math.sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ);

  return {
    positions,
    normals,
    colors,
    boundingSphereCenter: [cxLocal, cyLocal, czLocal],
    boundingSphereRadius: radius,
  };
}
