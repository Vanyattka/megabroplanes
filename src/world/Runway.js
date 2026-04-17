import {
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  CanvasTexture,
  Quaternion,
  Vector3,
  RepeatWrapping,
} from 'three';
import {
  RUNWAY_LENGTH,
  RUNWAY_WIDTH,
  RUNWAY_MARGIN,
  RUNWAY_Y,
  PLANE_BOTTOM_OFFSET,
} from '../config.js';

export function isInRunwayFlatZone(x, z) {
  const halfL = RUNWAY_LENGTH / 2 + RUNWAY_MARGIN;
  const halfW = RUNWAY_WIDTH / 2 + RUNWAY_MARGIN;
  return Math.abs(x) <= halfL && Math.abs(z) <= halfW;
}

export function isOnRunway(x, z) {
  const halfL = RUNWAY_LENGTH / 2;
  const halfW = RUNWAY_WIDTH / 2;
  return Math.abs(x) <= halfL && Math.abs(z) <= halfW;
}

function makeRunwayTexture() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 128;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, c.width, c.height);

  ctx.fillStyle = '#eeeeee';
  for (let x = 60; x < c.width - 60; x += 120) {
    ctx.fillRect(x, 60, 60, 8);
  }

  for (let i = 0; i < 8; i++) {
    ctx.fillRect(20 + i * 14, 20, 8, 88);
    ctx.fillRect(c.width - 28 - i * 14, 20, 8, 88);
  }

  const tex = new CanvasTexture(c);
  tex.anisotropy = 4;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  return tex;
}

export function buildRunwayMesh() {
  const geo = new PlaneGeometry(RUNWAY_LENGTH, RUNWAY_WIDTH);
  geo.rotateX(-Math.PI / 2);
  // Texture was drawn with length along canvas X; our runway length is on world X.
  // After rotateX(-PI/2), PlaneGeometry's X maps to world X, so UVs align naturally.
  const mat = new MeshStandardMaterial({
    map: makeRunwayTexture(),
    roughness: 0.9,
    metalness: 0.0,
  });
  const mesh = new Mesh(geo, mat);
  mesh.position.set(0, RUNWAY_Y, 0);
  return mesh;
}

export function getSpawnPose() {
  const position = new Vector3(-RUNWAY_LENGTH / 2 + 50, PLANE_BOTTOM_OFFSET, 0);
  // Plane nose points toward local -Z. Rotating -Z around +Y by +π/2 gives -X,
  // which would face the plane off the runway. Use -π/2 so the nose faces +X,
  // lined up with the full length of the runway ahead.
  const quaternion = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    -Math.PI / 2
  );
  return { position, quaternion };
}
