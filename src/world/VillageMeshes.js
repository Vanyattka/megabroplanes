import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import alea from 'alea';
import { RUNWAY_LENGTH, RUNWAY_WIDTH, RUNWAY_Y } from '../config.js';
import { getRunwayMaterial } from './Runway.js';
import { groundHeight } from './Ground.js';

// ---------------------------------------------------------------------------
// Shared geometries (module-level, never disposed per chunk). Each variant's
// walls are translated so y=0 is the house base.

const geom = (() => {
  const walls0 = new BoxGeometry(5, 3, 6);
  walls0.translate(0, 1.5, 0);
  const roof0 = new BoxGeometry(5.4, 1.2, 6.4);
  roof0.translate(0, 3.6, 0);

  const walls1 = new BoxGeometry(7, 4, 8);
  walls1.translate(0, 2, 0);
  const roof1 = new BoxGeometry(7.6, 1.8, 8.6);
  roof1.translate(0, 4.9, 0);

  // Tall two-story house.
  const walls2 = new BoxGeometry(6, 6, 7);
  walls2.translate(0, 3, 0);
  const roof2 = new BoxGeometry(6.4, 2.0, 7.4);
  roof2.translate(0, 7.0, 0);

  const chimney = new BoxGeometry(0.5, 1.4, 0.5);
  chimney.translate(0, 0.7, 0);
  const door = new BoxGeometry(0.8, 1.6, 0.1);
  door.translate(0, 0.8, 0);
  const window_ = new BoxGeometry(0.65, 0.9, 0.08);
  return { walls0, roof0, walls1, roof1, walls2, roof2, chimney, door, window: window_ };
})();

// Set of shared geometries we must never dispose per chunk.
const SHARED_GEOMS = new Set([
  geom.walls0,
  geom.roof0,
  geom.walls1,
  geom.roof1,
  geom.walls2,
  geom.roof2,
  geom.chimney,
  geom.door,
  geom.window,
]);

// ---------------------------------------------------------------------------
// Palettes

const WALL_COLORS = [
  0xeadfc6, 0xd4cdbc, 0xc6b39a, 0xc9a28a, 0xb7c2c9, 0xd2c093, 0xd8b28a,
  0xe8c8d2, // soft pink
  0xc4d4e8, // pale blue
  0xd4e4b8, // sage green
  0xe8e0d0, // off-white
  0xb8a88a, // tan-brown
  0xd8c8b0, // cream
  0xc8d0b8, // muted sage
  0xe0c9a0, // straw
];

const ROOF_COLORS = [
  0x8a3320, // red-brown
  0x6a4b3a, // brown
  0x4a3a36, // dark brown
  0x884a2b, // rust
  0x5a4830, // olive-brown
  0x3a4f5c, // slate blue
  0x6b3a3a, // barn red
  0x3a5a3a, // forest green
  0x7a5a30, // mustard-brown
];

const DOOR_COLOR = 0x3a2a1a;
const CHIMNEY_COLOR = 0x333333;
const ROAD_COLOR = 0x666058;
const WINDOW_COLOR = 0x2a3a5a;
const WINDOW_EMISSIVE = 0x153060;

const wallMaterials = WALL_COLORS.map(
  (c) => new MeshStandardMaterial({ color: c, flatShading: true, roughness: 1 })
);
const roofMaterials = ROOF_COLORS.map(
  (c) => new MeshStandardMaterial({ color: c, flatShading: true, roughness: 1 })
);
const chimneyMat = new MeshStandardMaterial({ color: CHIMNEY_COLOR, flatShading: true });
const doorMat = new MeshStandardMaterial({ color: DOOR_COLOR, flatShading: true });
const roadMat = new MeshStandardMaterial({
  color: ROAD_COLOR,
  roughness: 1,
  metalness: 0,
});
const windowMat = new MeshStandardMaterial({
  color: WINDOW_COLOR,
  emissive: WINDOW_EMISSIVE,
  emissiveIntensity: 0.35,
  flatShading: true,
});

// ---------------------------------------------------------------------------
// Per-variant dimensions for positioning details (door, windows, chimney).

const VARIANTS = {
  0: { halfX: 2.5, halfZ: 3.0, floors: [1.5], frontZ: -3.05, chimney: null },
  1: { halfX: 3.5, halfZ: 4.0, floors: [2.2], frontZ: -4.05, chimney: { x: 1.4, y: 5.4, z: -1.2 } },
  2: { halfX: 3.0, halfZ: 3.5, floors: [1.7, 4.4], frontZ: -3.55, chimney: { x: 1.3, y: 7.5, z: -1.2 } },
};

function variantFor(v) { return VARIANTS[v] || VARIANTS[0]; }

function wallsGeomFor(v) {
  return v === 2 ? geom.walls2 : v === 1 ? geom.walls1 : geom.walls0;
}
function roofGeomFor(v) {
  return v === 2 ? geom.roof2 : v === 1 ? geom.roof1 : geom.roof0;
}

// ---------------------------------------------------------------------------
// Building

function buildHouse(house, prng) {
  const g = new Group();
  const v = house.variant;
  const dims = variantFor(v);
  const wallMat = wallMaterials[Math.floor(prng() * wallMaterials.length)];
  const roofMat = roofMaterials[Math.floor(prng() * roofMaterials.length)];

  g.add(new Mesh(wallsGeomFor(v), wallMat));
  g.add(new Mesh(roofGeomFor(v), roofMat));

  const door = new Mesh(geom.door, doorMat);
  door.position.set(0, 0, dims.frontZ);
  g.add(door);

  if (dims.chimney) {
    const chim = new Mesh(geom.chimney, chimneyMat);
    chim.position.set(dims.chimney.x, dims.chimney.y, dims.chimney.z);
    g.add(chim);
  }
  return g;
}

// Window matrices in the house's local frame. Returned as {pos, side} pairs so
// the village-level builder can compose with the house transform for the
// village-wide InstancedMesh.
function windowLocalPlacements(variant) {
  const dims = variantFor(variant);
  const out = [];
  for (const y of dims.floors) {
    // Front (-Z): 2 windows flanking the door
    out.push({ x: -1.35, y, z: -(dims.halfZ + 0.05), side: false });
    out.push({ x: +1.35, y, z: -(dims.halfZ + 0.05), side: false });
    // Back (+Z): 2 windows
    out.push({ x: -1.35, y, z: dims.halfZ + 0.05, side: false });
    out.push({ x: +1.35, y, z: dims.halfZ + 0.05, side: false });
    // Left (-X): 1 window
    out.push({ x: -(dims.halfX + 0.05), y, z: 0, side: true });
    // Right (+X): 1 window
    out.push({ x: dims.halfX + 0.05, y, z: 0, side: true });
  }
  return out;
}

function buildRoadStrip(road) {
  const dx = road.x2 - road.x1;
  const dz = road.z2 - road.z1;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < 1) return null;
  const geo = new PlaneGeometry(length, 4.5);
  geo.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geo, roadMat);
  mesh.position.set(
    (road.x1 + road.x2) / 2,
    RUNWAY_Y,
    (road.z1 + road.z2) / 2
  );
  mesh.rotation.y = -Math.atan2(dz, dx);
  return mesh;
}

function buildRunwayMeshFor(village) {
  const geo = new PlaneGeometry(RUNWAY_LENGTH, RUNWAY_WIDTH);
  geo.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geo, getRunwayMaterial());
  mesh.position.set(village.airportX, RUNWAY_Y, village.airportZ);
  mesh.rotation.y = village.angle;
  return mesh;
}

// Scratch objects for matrix composition.
const _housePos = new Vector3();
const _houseQ = new Quaternion();
const _one = new Vector3(1, 1, 1);
const _houseMat = new Matrix4();
const _winPos = new Vector3();
const _winQ = new Quaternion();
const _winMat = new Matrix4();
const _combined = new Matrix4();
const _yAxis = new Vector3(0, 1, 0);

export function buildVillageGroup(village) {
  const group = new Group();
  const prng = alea(`village-mesh:${village.gcx}:${village.gcz}`);

  group.add(buildRunwayMeshFor(village));

  const windowMatrices = [];

  for (const h of village.houses) {
    const house = buildHouse(h, prng);
    const y = groundHeight(h.x, h.z);
    house.position.set(h.x, y, h.z);
    house.rotation.y = h.rot;
    group.add(house);

    // Build window matrices in world space by composing the house transform
    // with each window's local placement. This keeps all windows in one
    // InstancedMesh per village instead of ~10 separate meshes per house.
    _housePos.set(h.x, y, h.z);
    _houseQ.setFromAxisAngle(_yAxis, h.rot);
    _houseMat.compose(_housePos, _houseQ, _one);

    for (const p of windowLocalPlacements(h.variant)) {
      _winPos.set(p.x, p.y, p.z);
      _winQ.setFromAxisAngle(_yAxis, p.side ? Math.PI / 2 : 0);
      _winMat.compose(_winPos, _winQ, _one);
      _combined.multiplyMatrices(_houseMat, _winMat);
      windowMatrices.push(_combined.clone());
    }
  }

  if (windowMatrices.length > 0) {
    const windows = new InstancedMesh(
      geom.window,
      windowMat,
      windowMatrices.length
    );
    for (let i = 0; i < windowMatrices.length; i++) {
      windows.setMatrixAt(i, windowMatrices[i]);
    }
    windows.instanceMatrix.needsUpdate = true;
    group.add(windows);
  }

  for (const r of village.roads) {
    const mesh = buildRoadStrip(r);
    if (mesh) group.add(mesh);
  }

  return group;
}

export function disposeVillageGroup(group) {
  group.traverse((obj) => {
    if (obj.isInstancedMesh) {
      obj.dispose();
      return;
    }
    if (!obj.isMesh) return;
    if (obj.geometry && !SHARED_GEOMS.has(obj.geometry)) {
      obj.geometry.dispose();
    }
  });
}
