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
} from '../config.js';
import { groundHeight } from './Ground.js';
import { isInRunwayFlatZone } from './Runway.js';

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

function slopeAt(x, z) {
  const d = 2;
  const hx = (groundHeight(x + d, z) - groundHeight(x - d, z)) / (2 * d);
  const hz = (groundHeight(x, z + d) - groundHeight(x, z - d)) / (2 * d);
  return Math.sqrt(hx * hx + hz * hz);
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _pos = new Vector3();
const _scale = new Vector3();

// Build scatter (trees + rocks) for a single chunk. Deterministic per (cx,cz)
// so chunks look identical whether freshly built or revisited.
export function buildScatter(cx, cz) {
  const group = new Group();
  const prng = alea(`scatter:${cx}:${cz}`);

  const chunkOriginX = cx * CHUNK_SIZE;
  const chunkOriginZ = cz * CHUNK_SIZE;

  // Trees — trunk and top share the same per-instance matrix.
  const treeMatrices = [];
  for (let i = 0; i < TREES_PER_CHUNK; i++) {
    const x = chunkOriginX + prng() * CHUNK_SIZE;
    const z = chunkOriginZ + prng() * CHUNK_SIZE;
    if (isInRunwayFlatZone(x, z)) continue;
    const y = groundHeight(x, z);
    if (y < TREE_MIN_HEIGHT || y > TREE_MAX_HEIGHT) continue;
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
    if (isInRunwayFlatZone(x, z)) continue;
    const y = groundHeight(x, z);
    if (y < 0.3) continue;

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
    for (let i = 0; i < rockMatrices.length; i++) {
      rocks.setMatrixAt(i, rockMatrices[i]);
    }
    rocks.instanceMatrix.needsUpdate = true;
    group.add(rocks);
  }

  return group;
}

// Release per-chunk instance buffers. Shared geometry/material stay alive.
export function disposeScatter(group) {
  for (const child of group.children) {
    if (child.isInstancedMesh) child.dispose();
  }
}
