import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import alea from 'alea';

// Weathered-stone palette. Shared materials across every ruin in the world.
const stoneMats = [
  new MeshStandardMaterial({ color: 0x9a938a, flatShading: true, roughness: 1 }),
  new MeshStandardMaterial({ color: 0x7e7770, flatShading: true, roughness: 1 }),
  new MeshStandardMaterial({ color: 0x5a544e, flatShading: true, roughness: 1 }),
  new MeshStandardMaterial({ color: 0x8b8575, flatShading: true, roughness: 1 }),
];

function pickMat(prng) {
  return stoneMats[Math.floor(prng() * stoneMats.length)];
}

export function buildRuinGroup(ruin) {
  const group = new Group();
  const prng = alea(ruin.seed);

  // Main tower — partial, always present.
  const towerSide = 2.4 + prng() * 1.2;
  const towerH = 5 + prng() * 5;
  const tower = new Mesh(
    new BoxGeometry(towerSide, towerH, towerSide),
    pickMat(prng)
  );
  tower.position.set(0, towerH / 2, 0);
  tower.rotation.y = (prng() - 0.5) * 0.3;
  group.add(tower);

  // Broken top chunk leaning off the tower.
  if (prng() < 0.75) {
    const chunkH = 1 + prng() * 1.5;
    const chunk = new Mesh(
      new BoxGeometry(towerSide * 0.65, chunkH, towerSide * 0.65),
      pickMat(prng)
    );
    chunk.position.set(
      (prng() - 0.5) * 1.5,
      towerH + chunkH / 2 - 0.3,
      (prng() - 0.5) * 1.5
    );
    chunk.rotation.y = prng() * Math.PI;
    chunk.rotation.z = (prng() - 0.5) * 0.4;
    group.add(chunk);
  }

  // Surrounding wall segments (ruined perimeter around the tower).
  const wallCount = 3 + Math.floor(prng() * 4);
  for (let i = 0; i < wallCount; i++) {
    const theta = (i / wallCount) * Math.PI * 2 + (prng() - 0.5) * 0.8;
    const r = 5 + prng() * 3.5;
    const wallLen = 2 + prng() * 3.5;
    const wallH = 1.5 + prng() * 2.2;
    const wall = new Mesh(
      new BoxGeometry(wallLen, wallH, 0.7),
      pickMat(prng)
    );
    wall.position.set(Math.cos(theta) * r, wallH / 2, Math.sin(theta) * r);
    wall.rotation.y = theta + Math.PI / 2;
    wall.rotation.z = (prng() - 0.5) * 0.18;
    group.add(wall);
  }

  // A handful of rubble blocks scattered around the base.
  const rubbleCount = 3 + Math.floor(prng() * 5);
  for (let i = 0; i < rubbleCount; i++) {
    const theta = prng() * Math.PI * 2;
    const r = 2.5 + prng() * 5.5;
    const size = 0.5 + prng() * 0.8;
    const rubble = new Mesh(
      new BoxGeometry(size * 1.5, size, size * 1.2),
      pickMat(prng)
    );
    rubble.position.set(Math.cos(theta) * r, size / 2, Math.sin(theta) * r);
    rubble.rotation.y = prng() * Math.PI;
    rubble.rotation.x = (prng() - 0.5) * 0.3;
    rubble.rotation.z = (prng() - 0.5) * 0.3;
    group.add(rubble);
  }

  group.position.set(ruin.x, ruin.y, ruin.z);
  group.rotation.y = ruin.rot;
  return group;
}

export function disposeRuinGroup(group) {
  // Geometries are unique per ruin — dispose them. Materials are shared and
  // must stay alive.
  group.traverse((obj) => {
    if (obj.isMesh && obj.geometry) obj.geometry.dispose();
  });
}
