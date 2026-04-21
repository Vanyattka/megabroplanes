import {
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import alea from 'alea';
import {
  CHUNK_SIZE,
  TREES_PER_CHUNK,
  ROCKS_PER_CHUNK,
  TREE_MIN_HEIGHT,
  TREE_MAX_HEIGHT,
  TREE_MAX_SLOPE,
  MAX_TREE_FACTOR,
  MAX_ROCK_FACTOR,
  WATER_LEVEL,
  SEA_THRESHOLD_LOW,
  SEA_THRESHOLD_HIGH,
  SEA_DEPTH,
  RUNWAY_LENGTH,
  RUNWAY_WIDTH,
  RUNWAY_MARGIN,
  VILLAGE_CELL_SIZE,
} from '../config.js';
import { heightAt as noiseHeightAt } from './Noise.js';
import { biomeAt } from './Biome.js';
import { seaMaskAt } from './SeaMask.js';
import {
  villagesAffectingArea,
  villageFlatFactorFromList,
  rectFlatFactor,
  getVillage,
} from './Villages.js';
import { gfx } from '../ui/GraphicsSettings.js';
import { profiler } from '../debug/Profiler.js';

// Shared geometries and materials — one set for the whole world. Do not
// dispose per-chunk; only dispose the per-chunk InstancedMesh instance buffer.
const trunkGeom = new CylinderGeometry(0.25, 0.35, 2, 6);
trunkGeom.translate(0, 1, 0);
const topGeom = new ConeGeometry(1.4, 3.8, 7);
topGeom.translate(0, 3.9, 0);
const rockGeom = new IcosahedronGeometry(1, 0);

const trunkMat = new MeshStandardMaterial({ color: 0x5a3a20, flatShading: true, roughness: 1 });
const topMat = new MeshStandardMaterial({ color: 0x2d6b22, flatShading: true, roughness: 1 });
const rockMat = new MeshStandardMaterial({ color: 0x7a7572, flatShading: true, roughness: 1 });

function smoothstep01(edge0, edge1, x) {
  if (x <= edge0) return 0;
  if (x >= edge1) return 1;
  const t = (x - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
}

// Inline groundHeight that consumes a pre-computed village list instead of
// doing a 3×3 cell lookup every call. With ~700 groundHeight calls per
// chunk (140 tree candidates × up to 5 calls for height + slope), dropping
// the cell lookup from O(9) to O(villages.length) is the biggest single win.
function groundHeightFast(x, z, villages) {
  const f = villageFlatFactorFromList(x, z, villages);
  if (f === 0) return 0;
  const b = biomeAt(x, z);
  let h = noiseHeightAt(x, z) * b.amp + b.offset;
  const seaStrength = smoothstep01(SEA_THRESHOLD_LOW, SEA_THRESHOLD_HIGH, seaMaskAt(x, z));
  h -= seaStrength * SEA_DEPTH;
  if (b.type !== 'lake' && seaStrength < 0.3) {
    const LAND_FLOOR = WATER_LEVEL + 2;
    if (h < LAND_FLOOR) {
      h = LAND_FLOOR - 3 * (1 - Math.exp((h - LAND_FLOOR) / 20));
    }
  }
  return h * f;
}

// Scatter-local village-area test that uses the precomputed list.
function isInVillageAreaFast(x, z, villages) {
  if (villages.length === 0) return false;
  const pad = 12;
  for (const v of villages) {
    const hL = RUNWAY_LENGTH / 2 + RUNWAY_MARGIN + pad;
    const hW = RUNWAY_WIDTH / 2 + RUNWAY_MARGIN + pad;
    if (rectFlatFactor(x, z, v.airportX, v.airportZ, v.angle, hL, hW) === 0) {
      return true;
    }
    const r = v.villageRect;
    if (
      rectFlatFactor(x, z, r.cx, r.cz, r.angle, r.halfL + pad, r.halfW + pad) === 0
    ) {
      return true;
    }
  }
  return false;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _pos = new Vector3();
const _scale = new Vector3();

// Build scatter (trees + rocks) for a single chunk. Deterministic per (cx,cz)
// so chunks look identical whether freshly built or revisited.
export function buildScatter(cx, cz) {
  const _t0 = profiler.timeBegin();
  const group = new Group();
  const prng = alea(`scatter:${cx}:${cz}`);

  const chunkOriginX = cx * CHUNK_SIZE;
  const chunkOriginZ = cz * CHUNK_SIZE;
  // Villages that could reach any point inside this chunk. Typically 0 for
  // open terrain, 1 when a village edge overlaps, occasionally 2.
  const villages = villagesAffectingArea(
    chunkOriginX,
    chunkOriginX + CHUNK_SIZE,
    chunkOriginZ,
    chunkOriginZ + CHUNK_SIZE
  );

  const slopeAt = (x, z) => {
    const d = 2;
    const hx =
      (groundHeightFast(x + d, z, villages) -
        groundHeightFast(x - d, z, villages)) /
      (2 * d);
    const hz =
      (groundHeightFast(x, z + d, villages) -
        groundHeightFast(x, z - d, villages)) /
      (2 * d);
    return Math.sqrt(hx * hx + hz * hz);
  };

  // Trees — trunk and top share the same per-instance matrix.
  const treeMatrices = [];
  for (let i = 0; i < TREES_PER_CHUNK; i++) {
    const x = chunkOriginX + prng() * CHUNK_SIZE;
    const z = chunkOriginZ + prng() * CHUNK_SIZE;
    const b = biomeAt(x, z);
    if (prng() > b.trees / MAX_TREE_FACTOR) continue;
    if (isInVillageAreaFast(x, z, villages)) continue;
    const y = groundHeightFast(x, z, villages);
    if (y < TREE_MIN_HEIGHT || y > TREE_MAX_HEIGHT) continue;
    if (y <= WATER_LEVEL + 0.5) continue;
    if (slopeAt(x, z) > TREE_MAX_SLOPE) continue;

    const s = 0.8 + prng() * 0.7;
    _pos.set(x, y, z);
    _e.set(0, prng() * Math.PI * 2, 0);
    _q.setFromEuler(_e);
    _scale.set(s, s, s);
    _m.compose(_pos, _q, _scale);
    treeMatrices.push(_m.clone());
  }

  if (treeMatrices.length > 0) {
    const trunks = new InstancedMesh(trunkGeom, trunkMat, treeMatrices.length);
    const tops = new InstancedMesh(topGeom, topMat, treeMatrices.length);
    const castTreeShadows = !!gfx.settings.shadowTrees;
    trunks.castShadow = castTreeShadows;
    trunks.receiveShadow = true;
    tops.castShadow = castTreeShadows;
    tops.receiveShadow = true;
    for (let i = 0; i < treeMatrices.length; i++) {
      trunks.setMatrixAt(i, treeMatrices[i]);
      tops.setMatrixAt(i, treeMatrices[i]);
    }
    trunks.instanceMatrix.needsUpdate = true;
    tops.instanceMatrix.needsUpdate = true;
    group.add(trunks, tops);
  }

  // Rocks — tolerant of slope, bias toward higher terrain.
  const rockMatrices = [];
  for (let i = 0; i < ROCKS_PER_CHUNK; i++) {
    const x = chunkOriginX + prng() * CHUNK_SIZE;
    const z = chunkOriginZ + prng() * CHUNK_SIZE;
    const b = biomeAt(x, z);
    if (prng() > b.rocks / MAX_ROCK_FACTOR) continue;
    if (isInVillageAreaFast(x, z, villages)) continue;
    const y = groundHeightFast(x, z, villages);
    if (y < 0.3) continue;
    if (y <= WATER_LEVEL + 0.5) continue;

    const s = 0.4 + prng() * 1.2;
    _pos.set(x, y - s * 0.3, z);
    _e.set(prng() * 0.4, prng() * Math.PI * 2, prng() * 0.4);
    _q.setFromEuler(_e);
    _scale.set(s * (0.8 + prng() * 0.6), s, s * (0.8 + prng() * 0.6));
    _m.compose(_pos, _q, _scale);
    rockMatrices.push(_m.clone());
  }

  if (rockMatrices.length > 0) {
    const rocks = new InstancedMesh(rockGeom, rockMat, rockMatrices.length);
    rocks.castShadow = !!gfx.settings.shadowTrees;
    rocks.receiveShadow = true;
    for (let i = 0; i < rockMatrices.length; i++) {
      rocks.setMatrixAt(i, rockMatrices[i]);
    }
    rocks.instanceMatrix.needsUpdate = true;
    group.add(rocks);
  }

  profiler.timeEnd('scatter', _t0);
  return group;
}

// Release per-chunk instance buffers. Shared geometry/material stay alive.
export function disposeScatter(group) {
  for (const child of group.children) {
    if (child.isInstancedMesh) child.dispose();
  }
}
