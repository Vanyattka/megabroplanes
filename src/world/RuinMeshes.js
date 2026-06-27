import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import alea from 'alea';
import {
  CHUNK_SIZE,
  CHUNK_RESOLUTION,
  RUIN_SINK,
  RUIN_COURT_MIN,
  RUIN_COURT_MAX,
  RUIN_GRAND_COURT_MIN,
  RUIN_GRAND_COURT_MAX,
  RUIN_GRAND_WALL_T,
} from '../config.js';
import { groundHeight } from './Ground.js';

// Monumental castle ruins in two tiers. SMALL (the original): a crumbling ring
// wall with crenellated corner towers, a half-collapsed keep, a gatehouse and
// scattered rubble. GRAND (v0.7): a much larger, slightly better-preserved
// fortress — a tall curtain with full crenellations, big cone-capped corner
// towers, half-round flanking bastions, a twin-towered barbican, an inner
// bailey, a three-storey keep on a stone plinth, a great hall, and a wide
// rubble field. Every piece is grounded individually — its base is sampled
// from the local terrain and sunk RUIN_SINK below it — so nothing floats on a
// peak's slope; walls step down the hillside like real masonry.
//
// All geometries are SHARED unit shapes scaled per mesh (a ruin is 60–180
// meshes but zero per-ruin geometry allocations); materials are a shared
// weathered-stone palette. Dispose is therefore scene-removal only.
const UNIT_BOX = new BoxGeometry(1, 1, 1);
const UNIT_TOWER = new CylinderGeometry(1, 1.12, 1, 8);
const UNIT_ROCK = new IcosahedronGeometry(1, 0);
const UNIT_CONE = new ConeGeometry(1, 1, 8); // slate roof caps on grand towers

// Grand pieces snap their ground samples to the terrain vertex grid so a large
// footprint on a slope can't hover above the linearly-interpolated mesh.
const VERTEX_GRID = CHUNK_SIZE / (CHUNK_RESOLUTION - 1);
function snapToGrid(v) {
  return Math.round(v / VERTEX_GRID) * VERTEX_GRID;
}

const CORNERS4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

const stoneMats = [
  new MeshStandardMaterial({ color: 0x9a938a, flatShading: true, roughness: 1 }),
  new MeshStandardMaterial({ color: 0x7e7770, flatShading: true, roughness: 1 }),
  new MeshStandardMaterial({ color: 0x5a544e, flatShading: true, roughness: 1 }),
  new MeshStandardMaterial({ color: 0x8b8575, flatShading: true, roughness: 1 }),
];
const darkStone = new MeshStandardMaterial({ color: 0x4a443e, flatShading: true, roughness: 1 });
const slateMat = new MeshStandardMaterial({ color: 0x3c4450, flatShading: true, roughness: 1 });

function pickMat(prng) {
  return stoneMats[Math.floor(prng() * stoneMats.length)];
}

const _IDENT = new Matrix4();

// Collapse a freshly-built ruin group (60–195 separate Mesh objects, all
// sharing ~6 materials and 4 unit geometries) into one InstancedMesh per
// (geometry, material, castShadow, receiveShadow) — a grand ruin drops to
// ~10-15 draw calls instead of 195, so installing it no longer spikes a frame.
// The build logic above is untouched; this just flattens the scene graph by
// reading each piece's already-composed local matrix (gable slabs live under a
// nested group, so parent matrices accumulate during the walk). Three.js
// auto-computes an instance-aware bounding sphere, so frustum culling is
// preserved. The InstancedMesh instance buffers are per-ruin → disposeRuinGroup
// frees them on unload.
function batchGroup(srcGroup) {
  const out = new Group();
  out.position.copy(srcGroup.position);
  out.quaternion.copy(srcGroup.quaternion);
  out.scale.copy(srcGroup.scale);

  const map = new Map();
  const walk = (obj, parentMat) => {
    obj.updateMatrix(); // compose pos/quat/scale → obj.matrix
    const world = new Matrix4().multiplyMatrices(parentMat, obj.matrix);
    if (obj.isMesh) {
      const key = `${obj.geometry.uuid}|${obj.material.uuid}|${obj.castShadow ? 1 : 0}|${obj.receiveShadow ? 1 : 0}`;
      let e = map.get(key);
      if (!e) {
        e = { geometry: obj.geometry, material: obj.material, cast: obj.castShadow, receive: obj.receiveShadow, mats: [] };
        map.set(key, e);
      }
      e.mats.push(world);
    }
    for (const c of obj.children) walk(c, world);
  };
  // srcGroup's own transform is carried by `out`, so its children start at identity.
  for (const c of srcGroup.children) walk(c, _IDENT);

  for (const e of map.values()) {
    const im = new InstancedMesh(e.geometry, e.material, e.mats.length);
    im.castShadow = e.cast;
    im.receiveShadow = e.receive;
    for (let i = 0; i < e.mats.length; i++) im.setMatrixAt(i, e.mats[i]);
    im.instanceMatrix.needsUpdate = true;
    out.add(im);
  }
  return out;
}

export function buildRuinGroup(ruin) {
  const group = new Group();
  const prng = alea(ruin.seed);
  const cosR = Math.cos(ruin.rot);
  const sinR = Math.sin(ruin.rot);
  const grand = ruin.tier === 'grand';

  // Base elevation (world y) of a piece at LOCAL (lx, lz): sample the real
  // terrain under its world position and sink it. Grand pieces snap the sample
  // to the vertex grid so the big footprint hugs the rendered surface.
  function baseAt(lx, lz) {
    let wx = ruin.x + lx * cosR + lz * sinR;
    let wz = ruin.z - lx * sinR + lz * cosR;
    if (grand) { wx = snapToGrid(wx); wz = snapToGrid(wz); }
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

  if (grand) {
    buildGrandCastle(group, prng, baseAt, piece);
  } else {
    buildSmallCastle(group, prng, baseAt, piece);
  }

  group.position.set(ruin.x, 0, ruin.z);
  group.rotation.y = ruin.rot;
  return batchGroup(group);
}

// ---------------------------------------------------------------------------
// SMALL tier — the original castle (unchanged).
// ---------------------------------------------------------------------------
function buildSmallCastle(group, prng, baseAt, piece) {
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
}

// ---------------------------------------------------------------------------
// GRAND tier — a monumental, better-preserved fortress (v0.7).
// ---------------------------------------------------------------------------
function buildGrandCastle(group, prng, baseAt, piece) {
  const C = RUIN_GRAND_COURT_MIN + prng() * (RUIN_GRAND_COURT_MAX - RUIN_GRAND_COURT_MIN); // 34–48
  const H = 9 + prng() * 4;             // tall curtain wall, 9–13 m
  const WALL_T = RUIN_GRAND_WALL_T;     // 2.4
  const gateSide = Math.floor(prng() * 4);
  const corners = [[-C, -C], [C, -C], [C, C], [-C, C]];

  // Raw box with its BASE at an explicit world y (used for stacked/plinth
  // pieces that must sit on a level surface rather than re-sample the slope).
  function box(mat, lx, lz, sx, sy, sz, baseY, rotY = 0) {
    const m = new Mesh(UNIT_BOX, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.scale.set(sx, sy, sz);
    m.position.set(lx, baseY + sy / 2, lz);
    m.rotation.y = rotY;
    group.add(m);
    return m;
  }

  // A merlon/crenel row along a wall top. (cx,cz) wall-segment center, `len`
  // the segment length, `rotY` its heading, `topY` the world y of the wall top.
  function crenellate(cx, cz, len, rotY, topY, mat) {
    const dirx = Math.cos(rotY);
    const dirz = -Math.sin(rotY);
    const unit = 2.4; // merlon + gap
    const n = Math.max(1, Math.floor(len / unit));
    const span = n * unit;
    for (let i = 0; i < n; i++) {
      const t = -span / 2 + unit * (i + 0.5);
      const mx = cx + dirx * t;
      const mz = cz + dirz * t;
      const m = new Mesh(UNIT_BOX, mat);
      m.castShadow = true;
      m.scale.set(1.2, 1.1, WALL_T * 0.92);
      m.position.set(mx, topY + 0.55, mz);
      m.rotation.y = rotY;
      group.add(m);
    }
  }

  // A stone plinth (motte) under a big single footprint: sample the four
  // corners, build a block from the lowest corner up past the highest, and
  // return the level top the building should sit on. Stops large flat
  // footprints from floating over the downhill corner.
  function plinth(lx, lz, halfX, halfZ, rotY, mat) {
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [sx, sz] of CORNERS4) {
      const ox = sx * halfX;
      const oz = sz * halfZ;
      const rx = lx + ox * c - oz * s;
      const rz = lz + ox * s + oz * c;
      const g = baseAt(rx, rz);
      if (g < lo) lo = g;
      if (g > hi) hi = g;
    }
    const ph = hi - lo + 2.5;
    box(mat, lx, lz, halfX * 2 * 1.08, ph, halfZ * 2 * 1.08, lo, rotY);
    return lo + ph; // level top surface
  }

  // --- Corner towers (big, cone-capped, well-preserved) -------------------
  for (const [tx, tz] of corners) {
    const r = 4.0 + prng() * 1.5;
    const intact = prng() < 0.88;
    const h = intact ? 16 + prng() * 8 : (16 + prng() * 8) * (0.5 + prng() * 0.3);
    const lean = intact ? 0 : (prng() - 0.5) * 0.08;
    piece(UNIT_TOWER, pickMat(prng), tx, tz, r, h, r, prng() * Math.PI, lean);
    const topY = baseAt(tx, tz) + h;
    if (intact) {
      // 8-merlon crown.
      const merlons = 8;
      for (let m = 0; m < merlons; m++) {
        const a = (m / merlons) * Math.PI * 2;
        const mx = tx + Math.cos(a) * r * 0.82;
        const mz = tz + Math.sin(a) * r * 0.82;
        const mm = new Mesh(UNIT_BOX, darkStone);
        mm.castShadow = true;
        mm.scale.set(1.1, 1.4, 1.1);
        mm.position.set(mx, topY + 0.7, mz);
        mm.rotation.y = a;
        group.add(mm);
      }
      // ~40% keep a conical slate roof rising from inside the crown.
      if (prng() < 0.4) {
        const coneH = r * 1.6;
        const cone = new Mesh(UNIT_CONE, slateMat);
        cone.castShadow = true;
        cone.scale.set(r * 1.02, coneH, r * 1.02);
        cone.position.set(tx, topY + coneH / 2, tz);
        group.add(cone);
      }
    }
  }

  // --- Curtain walls (5 segments/side, mostly intact, full crenellations) --
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
    const px = dx / sideLen;
    const pz = dz / sideLen;
    const nx = pz; // outward normal of this side (points away from courtyard)
    const nz = -px;
    const outSign = (from[0] + to[0]) / 2 * nx + (from[1] + to[1]) / 2 * nz >= 0 ? 1 : -1;
    const SEGS = 5;
    for (let seg = 0; seg < SEGS; seg++) {
      const isGate = s === gateSide && seg === 2;
      const t0 = (seg + 0.08) / SEGS;
      const t1 = (seg + 0.92) / SEGS;
      const mx = from[0] + dx * (t0 + t1) / 2;
      const mz = from[1] + dz * (t0 + t1) / 2;
      const segLen = sideLen * (t1 - t0);
      if (isGate) {
        buildBarbican(mx, mz, px, pz, nx * outSign, nz * outSign, rotY, H);
        continue;
      }
      if (prng() > 0.88) continue; // 12% crumbled away
      const hSeg = H * (0.7 + prng() * 0.3);
      piece(UNIT_BOX, pickMat(prng), mx, mz, segLen, hSeg, WALL_T, rotY, (prng() - 0.5) * 0.03);
      if (hSeg > H * 0.8) {
        crenellate(mx, mz, segLen, rotY, baseAt(mx, mz) + hSeg, darkStone);
      }
      // Half-round flanking bastion at the mid-segment of non-gate sides.
      if (seg === 2 && prng() < 0.55) {
        const bx = mx + nx * outSign * (WALL_T + 1.5);
        const bz = mz + nz * outSign * (WALL_T + 1.5);
        const br = 3.0;
        const bh = H + 4 + prng() * 3;
        piece(UNIT_TOWER, pickMat(prng), bx, bz, br, bh, br, prng() * Math.PI);
      }
    }
  }

  // --- Barbican (twin-towered gatehouse over the gate gap) -----------------
  function buildBarbican(mx, mz, px, pz, onx, onz, rotY, wallH) {
    const gapHalf = 4.5;
    const gtH = wallH + 5;
    // Two square gate towers flanking the passage.
    piece(UNIT_BOX, pickMat(prng), mx - px * gapHalf, mz - pz * gapHalf, 4.5, gtH, 4.5, rotY);
    piece(UNIT_BOX, pickMat(prng), mx + px * gapHalf, mz + pz * gapHalf, 4.5, gtH, 4.5, rotY);
    // Crowns on the gate towers.
    for (const sgn of [-1, 1]) {
      const gx = mx + px * gapHalf * sgn;
      const gz = mz + pz * gapHalf * sgn;
      const top = baseAt(gx, gz) + gtH;
      for (let m = 0; m < 4; m++) {
        const a = rotY + (m / 4) * Math.PI * 2;
        const cm = new Mesh(UNIT_BOX, darkStone);
        cm.castShadow = true;
        cm.scale.set(1.3, 1.5, 1.3);
        cm.position.set(gx + Math.cos(a) * 1.6, top + 0.75, gz + Math.sin(a) * 1.6);
        cm.rotation.y = rotY;
        group.add(cm);
      }
    }
    // Arched passage: two leaning jambs + a heavy keystone lintel.
    const jH = wallH + 1;
    piece(UNIT_BOX, pickMat(prng), mx - px * (gapHalf - 1.6), mz - pz * (gapHalf - 1.6), 1.6, jH, 2.6, rotY);
    piece(UNIT_BOX, pickMat(prng), mx + px * (gapHalf - 1.6), mz + pz * (gapHalf - 1.6), 1.6, jH, 2.6, rotY);
    const lintel = new Mesh(UNIT_BOX, darkStone);
    lintel.castShadow = true;
    lintel.scale.set(gapHalf * 2 + 1.0, 2.0, 3.0);
    lintel.position.set(mx, baseAt(mx, mz) + jH + 1.0, mz);
    lintel.rotation.y = rotY;
    group.add(lintel);
    // Two short forewall stubs reaching out from the gate towers.
    for (const sgn of [-1, 1]) {
      const fx = mx + px * gapHalf * sgn + onx * 5;
      const fz = mz + pz * gapHalf * sgn + onz * 5;
      piece(UNIT_BOX, pickMat(prng), fx, fz, WALL_T, wallH * 0.7, 8, Math.atan2(onx, onz) + Math.PI / 2);
    }
    // Drawbridge slab lying on the ground in front of the gate.
    const dbx = mx + onx * 6;
    const dbz = mz + onz * 6;
    const db = piece(UNIT_BOX, stoneMats[2], dbx, dbz, 5, 0.5, 7, rotY);
    db.position.y += 0.1;
  }

  // --- Inner bailey (low inner ring, one gap) ------------------------------
  {
    const bc = C * 0.5;
    const bCorners = [[-bc, -bc], [bc, -bc], [bc, bc], [-bc, bc]];
    const bSides = [
      { from: bCorners[0], to: bCorners[1] },
      { from: bCorners[1], to: bCorners[2] },
      { from: bCorners[2], to: bCorners[3] },
      { from: bCorners[3], to: bCorners[0] },
    ];
    const bGap = Math.floor(prng() * 4);
    for (let s = 0; s < 4; s++) {
      if (s === bGap) continue;
      const { from, to } = bSides[s];
      const dx = to[0] - from[0];
      const dz = to[1] - from[1];
      const len = Math.hypot(dx, dz);
      const rotY = Math.atan2(dx, dz) + Math.PI / 2;
      for (let seg = 0; seg < 2; seg++) {
        if (prng() > 0.8) continue;
        const t0 = (seg + 0.1) / 2;
        const t1 = (seg + 0.9) / 2;
        const mx = from[0] + dx * (t0 + t1) / 2;
        const mz = from[1] + dz * (t0 + t1) / 2;
        piece(UNIT_BOX, pickMat(prng), mx, mz, len * (t1 - t0), 3.5 + prng() * 1.5, WALL_T * 0.7, rotY);
      }
    }
  }

  // --- Keep (three-storey donjon on a plinth, corner stair-turrets) --------
  {
    const kw = 14 + prng() * 4;
    const kRot = prng() * Math.PI;
    const top0 = plinth(0, 0, kw * 0.6, kw * 0.6, kRot, pickMat(prng));
    const floors = prng() < 0.75 ? 3 : 2; // sometimes the top floor has fallen
    const fH = [9 + prng() * 2, 8 + prng() * 2, 6 + prng() * 2];
    const fScale = [1.0, 0.84, 0.64];
    let y = top0;
    let lastW = kw;
    for (let f = 0; f < floors; f++) {
      const fw = kw * fScale[f];
      const ox = f === floors - 1 ? (prng() - 0.5) * kw * 0.3 : 0;
      const oz = f === floors - 1 ? (prng() - 0.5) * kw * 0.3 : 0;
      box(pickMat(prng), ox, oz, fw, fH[f], fw * (0.92 + prng() * 0.16), y, kRot + (prng() - 0.5) * 0.06);
      y += fH[f];
      lastW = fw;
    }
    void lastW;
    // Four corner stair-turrets rising the full height.
    const turretH = y - top0 + 2;
    const tr = 2.2;
    const off = kw * 0.5;
    const c = Math.cos(kRot);
    const s = Math.sin(kRot);
    for (const [sx, sz] of CORNERS4) {
      const lx = (sx * off) * c - (sz * off) * s;
      const lz = (sx * off) * s + (sz * off) * c;
      const t = new Mesh(UNIT_TOWER, pickMat(prng));
      t.castShadow = true;
      t.receiveShadow = true;
      t.scale.set(tr, turretH, tr);
      t.position.set(lx, top0 + turretH / 2, lz);
      group.add(t);
      // tiny cone cap
      if (prng() < 0.6) {
        const cap = new Mesh(UNIT_CONE, slateMat);
        cap.castShadow = true;
        const ch = tr * 1.8;
        cap.scale.set(tr * 1.05, ch, tr * 1.05);
        cap.position.set(lx, top0 + turretH + ch / 2, lz);
        group.add(cap);
      }
    }
  }

  // --- Great hall (long roofed building along one side of the bailey) ------
  // Gable roof helper — a nested group so the Y-heading and the slope tilt
  // compose cleanly. ridgeLen along local X, span ±halfSpan in local Z.
  function gableRoof(cx, cz, baseY, ridgeLen, halfSpan, peakH, rotY, mat) {
    const g = new Group();
    const slopeLen = Math.hypot(halfSpan, peakH);
    const tilt = Math.atan2(halfSpan, peakH); // slab tilt from horizontal
    for (const sign of [-1, 1]) {
      const slab = new Mesh(UNIT_BOX, mat);
      slab.castShadow = true;
      slab.receiveShadow = true;
      slab.scale.set(ridgeLen, 0.4, slopeLen);
      slab.position.set(0, peakH / 2, (sign * halfSpan) / 2);
      slab.rotation.x = sign * tilt;
      g.add(slab);
    }
    g.position.set(cx, baseY, cz);
    g.rotation.y = rotY;
    group.add(g);
  }
  {
    const hw = 18 + prng() * 4;   // length (along ridge)
    const hd = 11 + prng() * 2;   // depth
    const hh = 7 + prng() * 2;    // eaves height
    const hRot = prng() * Math.PI;
    // Place it in a quadrant between keep and curtain, away from the gate.
    const quad = (gateSide + 2) % 4;
    const qx = (quad === 0 || quad === 3) ? -C * 0.55 : C * 0.55;
    const qz = (quad === 0 || quad === 1) ? -C * 0.55 : C * 0.55;
    const top = plinth(qx, qz, hw * 0.5, hd * 0.5, hRot, pickMat(prng));
    box(pickMat(prng), qx, qz, hw, hh, hd, top, hRot);
    // Half-collapsed gable roof over the surviving ~60% of the length.
    gableRoof(qx, qz, top + hh, hw * 0.6, hd * 0.5, 3.2, hRot, slateMat);
    // A row of dark window voids along the front wall.
    const c = Math.cos(hRot);
    const s = Math.sin(hRot);
    for (let w = -1; w <= 1; w++) {
      const along = w * hw * 0.28;
      const lx = qx + along * c + (hd * 0.5) * s;
      const lz = qz - along * s + (hd * 0.5) * c;
      const win = new Mesh(UNIT_BOX, darkStone);
      win.scale.set(1.2, 2.2, 0.4);
      win.position.set(lx, top + hh * 0.5, lz);
      win.rotation.y = hRot;
      group.add(win);
    }
  }

  // --- Rubble field (wider, with fallen columns) ---------------------------
  const rubbleCount = 18 + Math.floor(prng() * 11);
  for (let i = 0; i < rubbleCount; i++) {
    const theta = prng() * Math.PI * 2;
    const r = C * (0.3 + prng() * 1.1);
    const size = 0.9 + prng() * 2.0;
    const lx = Math.cos(theta) * r;
    const lz = Math.sin(theta) * r;
    const geom = prng() < 0.5 ? UNIT_BOX : UNIT_ROCK;
    const m = piece(geom, pickMat(prng), lx, lz, size * 1.5, size, size * 1.2, prng() * Math.PI);
    m.rotation.x = (prng() - 0.5) * 0.6;
  }
  // A few fallen columns (toppled drums lying across the courtyard).
  const columns = 2 + Math.floor(prng() * 3);
  for (let i = 0; i < columns; i++) {
    const theta = prng() * Math.PI * 2;
    const r = C * (0.4 + prng() * 0.8);
    const lx = Math.cos(theta) * r;
    const lz = Math.sin(theta) * r;
    const len = 6 + prng() * 5;
    const col = piece(UNIT_TOWER, pickMat(prng), lx, lz, 1.1, len, 1.1, 0);
    col.rotation.z = Math.PI / 2; // lying down
    col.rotation.y = prng() * Math.PI;
    col.position.y = baseAt(lx, lz) + 1.1;
  }
}

// Geometries and materials are shared, but batchGroup() gave each ruin its own
// InstancedMesh instance buffers — free those on unload (the shared geom/mat
// stay alive).
export function disposeRuinGroup(group) {
  group.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
  });
}
