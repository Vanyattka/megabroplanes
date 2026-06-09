// Background worker: computes raw terrain data (positions, normals, colors
// + bounding sphere) for a chunk. Main thread wraps the result in a
// BufferGeometry + Mesh via finalizeTerrainMesh(). No Three.js imports
// here — the worker is pure math so it can run on any JS runtime.
//
// Noise/Biome/SeaMask modules are imported directly; they initialise from
// the same seeds as the main thread (they're pure ES modules with no DOM
// deps), so the terrain this worker produces is bit-identical to what the
// main-thread synchronous path produces. Determinism is required so a
// chunk primed synchronously and a chunk streamed asynchronously look the
// same when re-rendered from the same (cx, cz).
//
// Imports only TerrainCompute — that module is deliberately Three-free so
// the worker bundle stays small (~30 KB vs. 700+ KB if it pulled in the
// full Three.js library). Noise/Biome/SeaMask are pure math modules that
// initialise once from config seeds on both sides.
import { computeTerrainData } from './TerrainCompute.js';
import { getWorldSeed, setWorldSeed } from './WorldSeed.js';
import { reseedTerrain } from './TerrainShape.js';
import { reseedSea } from './SeaMask.js';

// The worker starts on the default seed; the main thread sends the active world
// seed with each build request so worker terrain matches the main thread.
let currentSeed = getWorldSeed();

self.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'buildTerrain') return;
  if (msg.seed && msg.seed !== currentSeed) {
    currentSeed = msg.seed;
    setWorldSeed(msg.seed);
    reseedTerrain();
    reseedSea();
  }
  const { reqId, cx, cz, villages, detail } = msg;
  try {
    const data = computeTerrainData(cx, cz, villages || [], !!detail);
    // Transfer the three big Float32Array buffers back zero-copy.
    self.postMessage(
      {
        type: 'terrainResult',
        reqId,
        positions: data.positions,
        normals: data.normals,
        colors: data.colors,
        boundingSphereCenter: data.boundingSphereCenter,
        boundingSphereRadius: data.boundingSphereRadius,
      },
      [data.positions.buffer, data.normals.buffer, data.colors.buffer]
    );
  } catch (err) {
    self.postMessage({
      type: 'terrainError',
      reqId,
      message: err && err.message ? err.message : String(err),
    });
  }
});
