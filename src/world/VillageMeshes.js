import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import alea from 'alea';
import { RUNWAY_LENGTH, RUNWAY_WIDTH, RUNWAY_Y } from '../config.js';
import { getRunwayMaterial } from './Runway.js';
import { groundHeight } from './Ground.js';

// Shared house geometries (translated once at module load so meshes sit on
// y=0). Shared across every house of a given variant; never disposed.
const geom = (() => {
  const walls0 = new BoxGeometry(5, 3, 6);
  walls0.translate(0, 1.5, 0);
  const roof0 = new BoxGeometry(5.4, 1.2, 6.4);
  roof0.translate(0, 3.6, 0);
  const walls1 = new BoxGeometry(7, 4, 8);
  walls1.translate(0, 2, 0);
  const roof1 = new BoxGeometry(7.6, 1.8, 8.6);
  roof1.translate(0, 4.9, 0);
  const chimney = new BoxGeometry(0.5, 1.2, 0.5);
  chimney.translate(0, 0.6, 0);
  const door = new BoxGeometry(0.8, 1.6, 0.1);
  door.translate(0, 0.8, 0);
  return { walls0, roof0, walls1, roof1, chimney, door };
})();

const WALL_COLORS = [0xeadfc6, 0xd4cdbc, 0xc6b39a, 0xc9a28a, 0xb7c2c9, 0xd2c093, 0xd8b28a];
const ROOF_COLORS = [0x8a3320, 0x6a4b3a, 0x4a3a36, 0x884a2b, 0x5a4830];
const DOOR_COLOR = 0x3a2a1a;
const CHIMNEY_COLOR = 0x333333;
const ROAD_COLOR = 0x666058;

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

const SHARED_GEOMS = new Set([
  geom.walls0,
  geom.walls1,
  geom.roof0,
  geom.roof1,
  geom.chimney,
  geom.door,
]);

function buildHouse(house, prng) {
  const g = new Group();
  const variant = house.variant;
  const wallsGeom = variant === 0 ? geom.walls0 : geom.walls1;
  const roofGeom = variant === 0 ? geom.roof0 : geom.roof1;
  const wallMat = wallMaterials[Math.floor(prng() * wallMaterials.length)];
  const roofMat = roofMaterials[Math.floor(prng() * roofMaterials.length)];

  g.add(new Mesh(wallsGeom, wallMat));
  g.add(new Mesh(roofGeom, roofMat));

  // Door on the front face (local -Z so it faces the house's rotated forward).
  const door = new Mesh(geom.door, doorMat);
  const frontZ = variant === 0 ? -3.05 : -4.05;
  door.position.set(0, 0, frontZ);
  g.add(door);

  // Medium houses get a chimney.
  if (variant === 1) {
    const chim = new Mesh(geom.chimney, chimneyMat);
    chim.position.set(1.4, 5.4, -1.2);
    g.add(chim);
  }
  return g;
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

export function buildVillageGroup(village) {
  const group = new Group();
  const prng = alea(`village-mesh:${village.gcx}:${village.gcz}`);

  group.add(buildRunwayMeshFor(village));

  for (const h of village.houses) {
    const house = buildHouse(h, prng);
    const y = groundHeight(h.x, h.z);
    house.position.set(h.x, y, h.z);
    house.rotation.y = h.rot;
    group.add(house);
  }

  for (const r of village.roads) {
    const mesh = buildRoadStrip(r);
    if (mesh) group.add(mesh);
  }

  return group;
}

export function disposeVillageGroup(group) {
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.geometry && !SHARED_GEOMS.has(obj.geometry)) {
      obj.geometry.dispose();
    }
    // Materials: all per-village materials are shared module-level (wall/roof/
    // chimney/door/road/runway) — don't dispose them.
  });
}
