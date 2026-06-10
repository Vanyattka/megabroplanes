import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import alea from 'alea';
import { RUIN_SINK, RUIN_COURT_MIN, RUIN_COURT_MAX } from '../config.js';
import { groundHeight } from './Ground.js';

// Monumental castle ruins: a crumbling ring wall with crenellated corner
// towers, a half-collapsed keep, a gatehouse and scattered rubble. Every
// piece is grounded individually — its base is sampled from the local
// terrain and sunk RUIN_SINK below it — so nothing floats on a peak's slope;
// walls step down the hillside like real masonry.
//
// All geometries are SHARED unit shapes scaled per mesh (a ruin is ~60
// meshes but zero per-ruin geometry allocations); materials are a shared
// weathered-stone palette. Dispose is therefore scene-removal only.
const UNIT_BOX = new BoxGeometry(1, 1, 1);
const UNIT_TOWER = new CylinderGeometry(1, 1.12, 1, 8);
const UNIT_ROCK = new IcosahedronGeometry(1, 0);

const stoneMats = [
  new MeshStandardMaterial({ color: 0x9a938a, flatShading: true, roughness: 1 }),
  new MeshStandardMaterial({ color: 0x7e7770, flatShading: true, roughness: 1 }),
  new MeshStandardMaterial({ color: 0x5a544e, flatShading: true, roughness: 1 }),
  new MeshStandardMaterial({ color: 0x8b8575, flatShading: true, roughness: 1 }),
];
const darkStone = new MeshStandardMaterial({ color: 0x4a443e, flatShading: true, roughness: 1 });

function pickMat(prng) {
  return stoneMats[Math.floor(prng() * stoneMats.length)];
}

export function buildRuinGroup(ruin) {
  const group = new Group();
  const prng = alea(ruin.seed);
  const cosR = Math.cos(ruin.rot);
  const sinR = Math.sin(ruin.rot);

  // Base elevation (world y) of a piece at LOCAL (lx, lz): sample the real
  // terrain under its world position and sink it. Returns the y of the
  // piece's underground base.
  function baseAt(lx, lz) {
    const wx = ruin.x + lx * cosR + lz * sinR;
    const wz = ruin.z - lx * sinR + lz * cosR;
    return groundHeight(wx, wz) - RUIN_SINK;
  }

  // Add a scaled shared-geometry mesh whose base sits at baseAt(lx,lz).
  function piece(geom, mat, lx, lz, sx, sy, sz, rotY = 0, lean = 0) {
    const m = new Mesh(geom, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.scale.set(sx, sy, sz);
    m.position.set(lx, baseAt(lx, lz) + sy / 2, lz);
    m.rotation.y = rotY;
    if (lean) m.rotation.z = lean;
    group.add(m);
    return m;
  }

  const C = RUIN_COURT_MIN + prng() * (RUIN_COURT_MAX - RUIN_COURT_MIN); // courtyard half-size
  const H = 5 + prng() * 3;            // wall height
  const WALL_T = 1.5;
  const gateSide = Math.floor(prng() * 4); // this side gets the gatehouse

  // --- Corner towers -------------------------------------------------------
  const corners = [[-C, -C], [C, -C], [C, C], [-C, C]];
  for (const [tx, tz] of corners) {
    const r = 2.8 + prng() * 1.2;
    const intact = prng() < 0.8;
    const h = intact ? H + 4 + prng() * 4 : (H + 4) * (0.45 + prng() * 0.3);
    const lean = intact ? 0 : (prng() - 0.5) * 0.12;
    piece(UNIT_TOWER, pickMat(prng), tx, tz, r, h, r, prng() * Math.PI, lean);
    if (intact) {
      // Crenellations — merlon blocks around the parapet rim.
      const merlons = 5;
      for (let m = 0; m < merlons; m++) {
        const a = (m / merlons) * Math.PI * 2 + prng() * 0.3;
        const mx = tx + Math.cos(a) * r * 0.78;
        const mz = tz + Math.sin(a) * r * 0.78;
        const mm = new Mesh(UNIT_BOX, darkStone);
        mm.castShadow = true;
        mm.scale.set(0.8, 1.0, 0.8);
        mm.position.set(mx, baseAt(tx, tz) + h + 0.5, mz);
        mm.rotation.y = a;
        group.add(mm);
      }
    }
  }

  // --- Ring walls (3 segments per side, some crumbled away) ---------------
  const sides = [
    { from: corners[0], to: corners[1] },
    { from: corners[1], to: corners[2] },
    { from: corners[2], to: corners[3] },
    { from: corners[3], to: corners[0] },
  ];
  for (let s = 0; s < 4; s++) {
    const { from, to } = sides[s];
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const sideLen = Math.hypot(dx, dz);
    const rotY = Math.atan2(dx, dz) + Math.PI / 2;
    for (let seg = 0; seg < 3; seg++) {
      const isGate = s === gateSide && seg === 1;
      const t0 = (seg + 0.12) / 3;
      const t1 = (seg + 0.88) / 3;
      const mx = from[0] + dx * (t0 + t1) / 2;
      const mz = from[1] + dz * (t0 + t1) / 2;
      const segLen = sideLen * (t1 - t0);
      if (isGate) {
        // Gatehouse: two stout pillars and (usually) a surviving lintel.
        const gapHalf = 3.2;
        const px = dx / sideLen, pz = dz / sideLen;
        const pH = H + 1.5;
        piece(UNIT_BOX, pickMat(prng), mx - px * gapHalf, mz - pz * gapHalf, 2.2, pH, 2.2, rotY);
        piece(UNIT_BOX, pickMat(prng), mx + px * gapHalf, mz + pz * gapHalf, 2.2, pH, 2.2, rotY);
        if (prng() < 0.8) {
          const lintel = new Mesh(UNIT_BOX, darkStone);
          lintel.castShadow = true;
          lintel.scale.set(gapHalf * 2 + 2.2, 1.4, 2.4);
          lintel.position.set(mx, baseAt(mx, mz) + pH + 0.7, mz);
          lintel.rotation.y = rotY;
          group.add(lintel);
        }
        continue;
      }
      if (prng() > 0.78) continue; // this stretch has crumbled away entirely
      const hSeg = H * (0.55 + prng() * 0.45);
      piece(UNIT_BOX, pickMat(prng), mx, mz, segLen, hSeg, WALL_T, rotY, (prng() - 0.5) * 0.05);
      if (hSeg > H * 0.85) {
        // Parapet ridge along the top of well-preserved segments.
        const ridge = new Mesh(UNIT_BOX, darkStone);
        ridge.castShadow = true;
        ridge.scale.set(segLen, 0.7, WALL_T * 0.45);
        ridge.position.set(mx, baseAt(mx, mz) + hSeg + 0.35, mz);
        ridge.rotation.y = rotY;
        group.add(ridge);
      }
    }
  }

  // --- Keep (central stronghold, partially collapsed) ----------------------
  if (prng() < 0.78) {
    const kw = 8 + prng() * 4;
    const kh = H + 5 + prng() * 4;
    const kRot = prng() * Math.PI;
    piece(UNIT_BOX, pickMat(prng), 0, 0, kw, kh, kw * (0.8 + prng() * 0.3), kRot);
    // Surviving upper floor — smaller footprint shifted to one corner, so
    // the silhouette reads as a broken tower rather than a clean block.
    const uw = kw * 0.55;
    piece(
      UNIT_BOX, pickMat(prng),
      (prng() - 0.5) * kw * 0.4, (prng() - 0.5) * kw * 0.4,
      uw, kh * 0.5, uw, kRot + (prng() - 0.5) * 0.4
    );
  }

  // --- Rubble field ---------------------------------------------------------
  const rubbleCount = 10 + Math.floor(prng() * 7);
  for (let i = 0; i < rubbleCount; i++) {
    const theta = prng() * Math.PI * 2;
    const r = C * (0.25 + prng() * 1.45);
    const size = 0.7 + prng() * 1.6;
    const lx = Math.cos(theta) * r;
    const lz = Math.sin(theta) * r;
    const geom = prng() < 0.5 ? UNIT_BOX : UNIT_ROCK;
    const m = piece(geom, pickMat(prng), lx, lz, size * 1.4, size, size * 1.1, prng() * Math.PI);
    m.rotation.x = (prng() - 0.5) * 0.5;
  }

  group.position.set(ruin.x, 0, ruin.z);
  group.rotation.y = ruin.rot;
  return group;
}

// All geometries are shared unit shapes and all materials are shared — there
// is nothing per-ruin to free beyond removing the group from the scene.
export function disposeRuinGroup(group) {
  void group;
}
