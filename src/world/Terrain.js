import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  Sphere,
  Vector3,
} from 'three';
import { CHUNK_SIZE, CHUNK_RESOLUTION } from '../config.js';
import { villagesAffectingArea } from './Villages.js';
import { villagesToWorkerData } from './VillageData.js';
import { computeTerrainData } from './TerrainCompute.js';
import { gfx } from '../ui/GraphicsSettings.js';
import { profiler } from '../debug/Profiler.js';

// One MeshStandardMaterial shared across every terrain chunk. Before this,
// buildChunk() allocated a fresh material per chunk — Three.js compiles
// shader programs lazily on first render, so every new chunk triggered a
// 40–80 ms shader-compile stall. With one shared material the program
// compiles exactly once; per-chunk variation is driven by vertex colors.
// castShadow is a mesh-level flag so it's still configurable per chunk.
const SHARED_TERRAIN_MAT = new MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 1.0,
  metalness: 0.0,
});
export function getSharedTerrainMaterial() {
  return SHARED_TERRAIN_MAT;
}

// Shared, reused index buffer. Every terrain mesh has the same topology
// (RES×RES grid), so we compute the pattern once and every BufferGeometry
// references it — saves allocating + uploading a fresh index buffer per
// chunk and keeps GPU VBO count down.
let SHARED_TERRAIN_INDEX = null;
function getSharedIndex() {
  if (SHARED_TERRAIN_INDEX) return SHARED_TERRAIN_INDEX;
  const RES = CHUNK_RESOLUTION;
  const tris = (RES - 1) * (RES - 1) * 2;
  const arr = new Uint32Array(tris * 3);
  let p = 0;
  for (let iy = 0; iy < RES - 1; iy++) {
    for (let ix = 0; ix < RES - 1; ix++) {
      const a = iy * RES + ix;
      const b = iy * RES + ix + 1;
      const c = (iy + 1) * RES + ix;
      const d = (iy + 1) * RES + ix + 1;
      // Winding chosen so the face normal points +Y (up) for flat terrain.
      arr[p++] = a; arr[p++] = c; arr[p++] = b;
      arr[p++] = b; arr[p++] = c; arr[p++] = d;
    }
  }
  SHARED_TERRAIN_INDEX = new BufferAttribute(arr, 1);
  return SHARED_TERRAIN_INDEX;
}

// Wrap raw buffers (from sync compute OR worker result) in a Three.js
// Mesh. Cheap — a few BufferAttributes + a Mesh; all the heavy math
// already happened inside computeTerrainData.
export function finalizeTerrainMesh(data, cx, cz, shadowTerrain) {
  const chunkOriginX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
  const chunkOriginZ = cz * CHUNK_SIZE + CHUNK_SIZE / 2;

  const geo = new BufferGeometry();
  geo.setIndex(getSharedIndex());
  geo.setAttribute('position', new BufferAttribute(data.positions, 3));
  geo.setAttribute('normal', new BufferAttribute(data.normals, 3));
  geo.setAttribute('color', new BufferAttribute(data.colors, 3));
  const [sx, sy, sz] = data.boundingSphereCenter;
  geo.boundingSphere = new Sphere(new Vector3(sx, sy, sz), data.boundingSphereRadius);

  const mesh = new Mesh(geo, SHARED_TERRAIN_MAT);
  mesh.position.set(chunkOriginX, 0, chunkOriginZ);
  mesh.receiveShadow = true;
  mesh.castShadow = !!shadowTerrain;
  return mesh;
}

// Extract the lightweight villages-data array for a chunk. Called from
// both the sync path (here) and the main thread before dispatching a
// worker build request — the worker can't query the village cache itself
// (it's per-thread), so main always does villagesAffectingArea first.
export function villagesForChunk(cx, cz) {
  const chunkOriginX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
  const chunkOriginZ = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
  const minX = chunkOriginX - CHUNK_SIZE / 2;
  const maxX = chunkOriginX + CHUNK_SIZE / 2;
  const minZ = chunkOriginZ - CHUNK_SIZE / 2;
  const maxZ = chunkOriginZ + CHUNK_SIZE / 2;
  return villagesToWorkerData(villagesAffectingArea(minX, maxX, minZ, maxZ));
}

// Synchronous compose — used by primeAll (blocks the first ~300 ms of the
// session) and as a fallback if the worker pool isn't ready.
export function buildChunk(cx, cz) {
  const _t0 = profiler.timeBegin();
  const villages = villagesForChunk(cx, cz);
  const data = computeTerrainData(cx, cz, villages, !!gfx.settings.terrainDetail);
  const mesh = finalizeTerrainMesh(data, cx, cz, !!gfx.settings.shadowTerrain);
  profiler.timeEnd('terrain', _t0);
  return mesh;
}
