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
import { landElevation, biomeAt } from './TerrainShape.js';
import { seaMaskAt } from './SeaMask.js';
import { seedKey } from './WorldSeed.js';
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
const rockGeom = new IcosahedronGeometry(1, 0);
const rockMat = new MeshStandardMaterial({ color: 0x7a7572, flatShading: true, roughness: 1 });

// Tree species — each is a trunk + canopy geometry/material pair, built from
// primitives and shared across the whole world (per-chunk only the instance
// buffers are allocated). Geometries are pre-translated so the model sits on
// the ground at y=0.
function makeSpecies(trunk, canopy) {
  trunk.geom.translate(0, trunk.y, 0);
  canopy.geom.translate(0, canopy.y, 0);
  return {
    trunkGeom: trunk.geom,
    canopyGeom: canopy.geom,
    trunkMat: new MeshStandardMaterial({ color: trunk.color, flatShading: true, roughness: 1 }),
    canopyMat: new MeshStandardMaterial({ color: canopy.color, flatShading: true, roughness: 1 }),
  };
}
const SPECIES = {
  // Classic pine — the original tree.
  conifer: makeSpecies(
    { geom: new CylinderGeometry(0.25, 0.35, 2, 6), y: 1, color: 0x5a3a20 },
    { geom: new ConeGeometry(1.4, 3.8, 7), y: 3.9, color: 0x2d6b22 }
  ),
  // Rounded deciduous tree.
  broadleaf: makeSpecies(
    { geom: new CylinderGeometry(0.3, 0.42, 2.4, 6), y: 1.2, color: 0x6b4a2a },
    { geom: new IcosahedronGeometry(2.0, 0), y: 3.6, color: 0x3f8f3a }
  ),
  // Slim, pale-trunked birch with a light canopy.
  birch: makeSpecies(
    { geom: new CylinderGeometry(0.16, 0.2, 3, 5), y: 1.5, color: 0xd8d8d0 },
    { geom: new IcosahedronGeometry(1.3, 0), y: 3.8, color: 0x9fc77a }
  ),
  // Flat-topped savanna acacia.
  acacia: makeSpecies(
    { geom: new CylinderGeometry(0.3, 0.45, 2.8, 6), y: 1.4, color: 0x6b5230 },
    { geom: new ConeGeometry(2.6, 1.3, 9), y: 3.4, color: 0x8a9a3a }
  ),
  // Low, dusty arid/tundra shrub.
  shrub: makeSpecies(
    { geom: new CylinderGeometry(0.16, 0.2, 0.5, 5), y: 0.25, color: 0x5a4a2a },
    { geom: new IcosahedronGeometry(0.9, 0), y: 0.85, color: 0x7a8a4a }
  ),
};

// Per-biome species mix (weights sum ≈ 1). Determines which trees grow where.
const BIOME_TREE_SPECIES = {
  forest:  [['conifer', 0.45], ['broadleaf', 0.45], ['birch', 0.10]],
  taiga:   [['conifer', 0.78], ['birch', 0.22]],
  plains:  [['broadleaf', 0.60], ['birch', 0.25], ['acacia', 0.15]],
  savanna: [['acacia', 0.70], ['broadleaf', 0.30]],
  desert:  [['shrub', 1.0]],
  tundra:  [['shrub', 0.60], ['birch', 0.40]],
  alpine:  [['conifer', 1.0]],
};
function pickSpecies(type, prng) {
  const table = BIOME_TREE_SPECIES[type] || BIOME_TREE_SPECIES.forest;
  const r = prng();
  let acc = 0;
  for (const [name, w] of table) { acc += w; if (r < acc) return name; }
  return table[table.length - 1][0];
}

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
  let h = landElevation(x, z);
  const seaStrength = smoothstep01(SEA_THRESHOLD_LOW, SEA_THRESHOLD_HIGH, seaMaskAt(x, z));
  h -= seaStrength * SEA_DEPTH;
  if (seaStrength < 0.3) {
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
  const prng = alea(seedKey(`scatter:${cx}:${cz}`));

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

  // Trees — accumulate per-species instance matrices, then build one
  // trunk+canopy InstancedMesh per species present in this chunk. Species is
  // chosen by biome (BIOME_TREE_SPECIES) so each region grows fitting trees.
  const bySpecies = {};
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
    const name = pickSpecies(b.type, prng);
    (bySpecies[name] || (bySpecies[name] = [])).push(_m.clone());
  }

  const castTreeShadows = !!gfx.settings.shadowTrees;
  for (const name of Object.keys(bySpecies)) {
    const mats = bySpecies[name];
    if (!mats.length) continue;
    const sp = SPECIES[name];
    const trunks = new InstancedMesh(sp.trunkGeom, sp.trunkMat, mats.length);
    const canopies = new InstancedMesh(sp.canopyGeom, sp.canopyMat, mats.length);
    trunks.castShadow = castTreeShadows;
    trunks.receiveShadow = true;
    canopies.castShadow = castTreeShadows;
    canopies.receiveShadow = true;
    for (let i = 0; i < mats.length; i++) {
      trunks.setMatrixAt(i, mats[i]);
      canopies.setMatrixAt(i, mats[i]);
    }
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    group.add(trunks, canopies);
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
