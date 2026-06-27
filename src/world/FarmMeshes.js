import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import alea from 'alea';
import {
  CHUNK_SIZE,
  CHUNK_RESOLUTION,
  FARM_FIELD_SEG,
  FARM_FIELD_LIFT,
  FARM_ROW_PITCH,
  FARM_CROP_SPACING,
  FARM_FENCE_SPAN,
  FARM_SINK,
  FARM_MAX_CROPS,
} from '../config.js';
import { groundHeight } from './Ground.js';

// Farm + field meshes. Fields are draped subdivided planes (vertex-coloured
// furrows) that hug the terrain; crops, fences and buildings are shared-geom /
// instanced. Only the three draped planes (field, yard dirt, track) allocate
// unique geometry — everything else routes through shared(), so disposeFarmGroup
// frees only those plus the per-feature instance buffers.

const VERTEX_GRID = CHUNK_SIZE / (CHUNK_RESOLUTION - 1);
function snapToGrid(v) {
  return Math.round(v / VERTEX_GRID) * VERTEX_GRID;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// --- shared geometry registry (never disposed) -----------------------------
const SHARED_GEOMS = new Set();
function shared(g) { SHARED_GEOMS.add(g); return g; }

const UNIT_BOX = shared(new BoxGeometry(1, 1, 1));
const UNIT_CYL = shared(new CylinderGeometry(1, 1, 1, 14));
const UNIT_DOME = shared(new SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2));
const UNIT_BALL = shared(new IcosahedronGeometry(1, 0));
const CROP_GEOMS = {
  wheat: shared(new BoxGeometry(0.18, 0.55, 0.18).translate(0, 0.275, 0)),
  corn: shared(new BoxGeometry(0.2, 0.9, 0.2).translate(0, 0.45, 0)),
};
const fencePostGeom = shared(new BoxGeometry(0.14, 0.95, 0.14).translate(0, 0.475, 0));
const fenceRailGeom = shared(new BoxGeometry(1, 0.12, 0.1)); // unit length along X, scaled per span

// --- shared materials ------------------------------------------------------
const fieldMat = new MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: 1,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});
const soilMat = new MeshStandardMaterial({
  color: 0x6b5836, flatShading: true, roughness: 1,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});
const barnRedMat = new MeshStandardMaterial({ color: 0x9a3a2a, flatShading: true, roughness: 1 });
const creamMat = new MeshStandardMaterial({ color: 0xe6dcc2, flatShading: true, roughness: 1 });
const woodMat = new MeshStandardMaterial({ color: 0x6b4a2a, flatShading: true, roughness: 1 });
const roofMat = new MeshStandardMaterial({ color: 0x53412c, flatShading: true, roughness: 1 });
const siloMat = new MeshStandardMaterial({ color: 0xc6c2b4, flatShading: true, roughness: 1 });
const strawMat = new MeshStandardMaterial({ color: 0xc8a85a, flatShading: true, roughness: 1 });
const darkMat = new MeshStandardMaterial({ color: 0x2a2620, flatShading: true, roughness: 1 });
const whiteMat = new MeshStandardMaterial({ color: 0xe4e2d6, flatShading: true, roughness: 1 });

// crop-tuft colours vary by palette — cache one shared material per colour.
const tuftMats = new Map();
function tuftMat(hex) {
  let m = tuftMats.get(hex);
  if (!m) { m = new MeshStandardMaterial({ color: hex, flatShading: true, roughness: 1 }); tuftMats.set(hex, m); }
  return m;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _pos = new Vector3();
const _scale = new Vector3();

// --- local-frame building primitives (base at local y=0) -------------------
function addBox(g, mat, lx, lz, sx, sy, sz, rotY = 0) {
  const m = new Mesh(UNIT_BOX, mat);
  m.castShadow = true; m.receiveShadow = true;
  m.scale.set(sx, sy, sz);
  m.position.set(lx, sy / 2, lz);
  m.rotation.y = rotY;
  g.add(m);
  return m;
}
function addCyl(g, mat, lx, lz, r, h) {
  const m = new Mesh(UNIT_CYL, mat);
  m.castShadow = true; m.receiveShadow = true;
  m.scale.set(r, h, r);
  m.position.set(lx, h / 2, lz);
  g.add(m);
  return m;
}
function addDome(g, mat, lx, lz, r, baseY) {
  const m = new Mesh(UNIT_DOME, mat);
  m.castShadow = true; m.receiveShadow = true;
  m.scale.set(r, r, r);
  m.position.set(lx, baseY, lz);
  g.add(m);
  return m;
}
// Gable roof from two leaning slabs. ridge along local X, span ±halfSpan in Z.
function addGable(g, mat, lx, baseY, lz, ridgeLen, halfSpan, peakH) {
  const slopeLen = Math.hypot(halfSpan, peakH);
  const tilt = Math.atan2(halfSpan, peakH);
  for (const sign of [-1, 1]) {
    const slab = new Mesh(UNIT_BOX, mat);
    slab.castShadow = true; slab.receiveShadow = true;
    slab.scale.set(ridgeLen, 0.35, slopeLen);
    slab.position.set(lx, baseY + peakH / 2, lz + (sign * halfSpan) / 2);
    slab.rotation.x = sign * tilt;
    g.add(slab);
  }
}

// --- buildings (each a Group; base pieces at local y=0) --------------------
function makeBarn(prng) {
  const g = new Group();
  // Long axis along X so the ridge (addGable runs the ridge along local X)
  // aligns with the barn body and the door sits on a true triangular gable end.
  const len = 14 + prng() * 4; // X (ridge length, long axis)
  const w = 10 + prng() * 2;   // Z (gable width, short axis)
  const h = 5 + prng() * 1;
  addBox(g, barnRedMat, 0, 0, len, h, w);
  addGable(g, roofMat, 0, h, 0, len, w / 2 + 0.4, 2.6 + prng() * 0.8);
  // big sliding door + white X-brace on the +X gable end
  const door = addBox(g, whiteMat, 0, 0, 0.25, 4.2, 3.4);
  door.position.x = len / 2 + 0.05;
  for (const sgn of [-1, 1]) {
    const br = new Mesh(UNIT_BOX, woodMat);
    br.scale.set(0.12, 5.0, 0.18);
    br.position.set(len / 2 + 0.18, 2.2, 0);
    br.rotation.x = sgn * 0.6;
    g.add(br);
  }
  // little cupola on the ridge
  addBox(g, creamMat, 0, h + 2.4, 0, 1.0, 1.0, 1.0);
  return g;
}
function makeFarmhouse(prng) {
  const g = new Group();
  const w = 7, d = 5, h = 3.4;
  addBox(g, creamMat, 0, 0, w, h, d);
  addGable(g, roofMat, 0, h, 0, w, d / 2 + 0.3, 2.0 + prng() * 0.5);
  addBox(g, darkMat, 0, 0, 0.9, 1.7, 0.1).position.z = d / 2 + 0.02; // door
  for (const sgn of [-1, 1]) {
    const win = addBox(g, darkMat, sgn * 2.0, 0, 0.7, 0.9, 0.08);
    win.position.set(sgn * 2.0, 2.0, d / 2 + 0.02);
  }
  // chimney
  const ch = addBox(g, woodMat, w * 0.3, 0, 0, 0.5, 1.6, 0.5);
  ch.position.y = h + 1.3;
  return g;
}
function makeSilo(prng) {
  const g = new Group();
  const r = 2.0 + prng() * 0.4;
  const h = 9 + prng() * 3;
  addCyl(g, siloMat, 0, 0, r, h);
  addDome(g, creamMat, 0, 0, r * 1.02, h);
  return g;
}

function placeBuilding(parent, makeFn, prng, wx, wz, rot) {
  const g = makeFn(prng);
  const gy = groundHeight(snapToGrid(wx), snapToGrid(wz)) - FARM_SINK;
  g.position.set(wx, gy, wz);
  g.rotation.y = rot;
  parent.add(g);
}

// --- draped planes ---------------------------------------------------------
// Drape a subdivided plane over the terrain inside a rotated rect. Returns the
// PlaneGeometry (UNIQUE — caller disposes) with Y baked to ground + lift.
function drapeGeometry(rect, lift) {
  const W = rect.halfW * 2;
  const L = rect.halfL * 2;
  const segL = clamp(Math.round(L / FARM_FIELD_SEG), 6, 22);
  const segW = clamp(Math.round(W / FARM_FIELD_SEG), 6, 22);
  const geo = new PlaneGeometry(L, W, segL, segW);
  geo.rotateX(-Math.PI / 2); // into XZ; local X spans ±L/2, local Z spans ±W/2
  const pos = geo.attributes.position;
  const cos = Math.cos(rect.angle), sin = Math.sin(rect.angle);
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    const wx = snapToGrid(rect.cx + lx * cos - lz * sin);
    const wz = snapToGrid(rect.cz + lx * sin + lz * cos);
    pos.setY(i, groundHeight(wx, wz) + lift);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildField(farm) {
  const r = farm.fieldRect;
  const geo = drapeGeometry(r, FARM_FIELD_LIFT);
  // Furrow bands as vertex colours (alternating soil tones along local Z).
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cA = new Color(farm.soilA);
  const cB = new Color(farm.soilB);
  for (let i = 0; i < pos.count; i++) {
    const lz = pos.getZ(i);
    const band = Math.floor((lz + r.halfW) / FARM_ROW_PITCH);
    const c = band % 2 === 0 ? cA : cB;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  const mesh = new Mesh(geo, fieldMat);
  mesh.position.set(r.cx, 0, r.cz);
  mesh.rotation.y = r.angle;
  mesh.receiveShadow = true;
  return mesh;
}

function buildCrops(farm, group, prng) {
  if (!farm.fieldRect) return;
  const r = farm.fieldRect;
  const geom = CROP_GEOMS[farm.crop] || CROP_GEOMS.wheat;
  const mat = tuftMat(farm.tuft);
  const cos = Math.cos(r.angle), sin = Math.sin(r.angle);
  const max = FARM_MAX_CROPS[farm.variant] || 600;
  const mats = [];
  for (let lz = -r.halfW + 1.2; lz <= r.halfW - 1.2 && mats.length < max; lz += FARM_ROW_PITCH) {
    for (let lx = -r.halfL + 1.2; lx <= r.halfL - 1.2 && mats.length < max; lx += FARM_CROP_SPACING) {
      const jlx = lx + (prng() - 0.5) * 0.5;
      const jlz = lz + (prng() - 0.5) * 0.4;
      const wx = r.cx + jlx * cos - jlz * sin;
      const wz = r.cz + jlx * sin + jlz * cos;
      const y = groundHeight(snapToGrid(wx), snapToGrid(wz)) + FARM_FIELD_LIFT;
      const s = 0.8 + prng() * 0.5;
      _pos.set(wx, y, wz);
      _e.set(0, prng() * Math.PI * 2, 0);
      _q.setFromEuler(_e);
      _scale.set(s, s, s);
      _m.compose(_pos, _q, _scale);
      mats.push(_m.clone());
    }
  }
  if (!mats.length) return;
  const inst = new InstancedMesh(geom, mat, mats.length);
  inst.castShadow = false;
  inst.receiveShadow = true;
  for (let i = 0; i < mats.length; i++) inst.setMatrixAt(i, mats[i]);
  inst.instanceMatrix.needsUpdate = true;
  group.add(inst);
}

function buildFences(farm, group, prng) {
  if (!farm.fieldRect) return;
  const r = farm.fieldRect;
  const cos = Math.cos(r.angle), sin = Math.sin(r.angle);
  const corners = [
    [-r.halfL, -r.halfW], [r.halfL, -r.halfW], [r.halfL, r.halfW], [-r.halfL, r.halfW],
  ];
  // Gate gap on the edge facing the yard (variant both/farm), else a stable edge.
  let gateEdge = 0;
  if (farm.yardRect) {
    // local direction from field center to yard center → nearest edge
    const dlx = (farm.yardRect.cx - r.cx) * cos + (farm.yardRect.cz - r.cz) * sin;
    gateEdge = dlx < 0 ? 3 : 1; // -X edge (3) or +X edge (1)
  }
  const postMats = [];
  const railMats = [];
  for (let e = 0; e < 4; e++) {
    const a = corners[e];
    const b = corners[(e + 1) % 4];
    const elx = b[0] - a[0];
    const elz = b[1] - a[1];
    const len = Math.hypot(elx, elz);
    const n = Math.max(1, Math.round(len / FARM_FENCE_SPAN));
    const wdx = (elx / len) * cos - (elz / len) * sin;
    const wdz = (elx / len) * sin + (elz / len) * cos;
    const railRot = Math.atan2(-wdz, wdx);
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const llx = a[0] + elx * t;
      const llz = a[1] + elz * t;
      const wx = r.cx + llx * cos - llz * sin;
      const wz = r.cz + llx * sin + llz * cos;
      const gy = groundHeight(snapToGrid(wx), snapToGrid(wz));
      const inGate = e === gateEdge && t > 0.36 && t < 0.64;
      if (!inGate) {
        _pos.set(wx, gy, wz);
        _q.identity();
        _scale.set(1, 1, 1);
        _m.compose(_pos, _q, _scale);
        postMats.push(_m.clone());
      }
      if (prev && !(inGate || prev.gate)) {
        const mx = (wx + prev.wx) / 2;
        const mz = (wz + prev.wz) / 2;
        const span = Math.hypot(wx - prev.wx, wz - prev.wz);
        _pos.set(mx, (gy + prev.gy) / 2 + 0.55, mz);
        _e.set(0, railRot, 0);
        _q.setFromEuler(_e);
        _scale.set(span, 1, 1);
        _m.compose(_pos, _q, _scale);
        railMats.push(_m.clone());
      }
      prev = { wx, wz, gy, gate: inGate };
    }
  }
  if (postMats.length) {
    const posts = new InstancedMesh(fencePostGeom, woodMat, postMats.length);
    posts.castShadow = true; posts.receiveShadow = true;
    for (let i = 0; i < postMats.length; i++) posts.setMatrixAt(i, postMats[i]);
    posts.instanceMatrix.needsUpdate = true;
    group.add(posts);
  }
  if (railMats.length) {
    const rails = new InstancedMesh(fenceRailGeom, woodMat, railMats.length);
    rails.castShadow = true; rails.receiveShadow = true;
    for (let i = 0; i < railMats.length; i++) rails.setMatrixAt(i, railMats[i]);
    rails.instanceMatrix.needsUpdate = true;
    group.add(rails);
  }
}

function buildYard(farm, group, prng) {
  const y = farm.yardRect;
  const cos = Math.cos(y.angle), sin = Math.sin(y.angle);
  const toWorld = (lx, lz) => [y.cx + lx * cos - lz * sin, y.cz + lx * sin + lz * cos];
  // yard dirt skin (unique geom → disposed)
  const dirtGeo = drapeGeometry({ cx: y.cx, cz: y.cz, halfL: y.halfL, halfW: y.halfW, angle: y.angle }, 0.05);
  const dirt = new Mesh(dirtGeo, soilMat);
  dirt.position.set(y.cx, 0, y.cz);
  dirt.rotation.y = y.angle;
  dirt.receiveShadow = true;
  group.add(dirt);
  // barn, farmhouse, silo(s)
  const [bx, bz] = toWorld(-y.halfL * 0.4, y.halfW * 0.3);
  placeBuilding(group, makeBarn, prng, bx, bz, y.angle + (prng() - 0.5) * 0.2);
  const [hx, hz] = toWorld(y.halfL * 0.45, -y.halfW * 0.35);
  placeBuilding(group, makeFarmhouse, prng, hx, hz, y.angle + Math.PI / 2 + (prng() - 0.5) * 0.2);
  const silos = 1 + (prng() < 0.5 ? 1 : 0);
  for (let s = 0; s < silos; s++) {
    const [sx, sz] = toWorld(y.halfL * 0.1 + s * 5, y.halfW * 0.5);
    placeBuilding(group, makeSilo, prng, sx, sz, 0);
  }
}

function buildProps(farm, group, prng) {
  // Scarecrow in the field.
  if (farm.fieldRect) {
    const r = farm.fieldRect;
    const cos = Math.cos(r.angle), sin = Math.sin(r.angle);
    const llx = (prng() - 0.5) * r.halfL;
    const llz = (prng() - 0.5) * r.halfW;
    const wx = r.cx + llx * cos - llz * sin;
    const wz = r.cz + llx * sin + llz * cos;
    const gy = groundHeight(snapToGrid(wx), snapToGrid(wz)) - 0.1;
    const sc = new Group();
    addBox(sc, woodMat, 0, 0, 0.12, 2.2, 0.12);          // pole
    const arms = addBox(sc, woodMat, 0, 0, 1.6, 0.12, 0.12); arms.position.y = 1.5;
    const head = new Mesh(UNIT_BALL, strawMat); head.scale.set(0.28, 0.32, 0.28); head.position.y = 2.1; sc.add(head);
    const hat = addBox(sc, darkMat, 0, 0, 0.6, 0.18, 0.6); hat.position.y = 2.32;
    sc.position.set(wx, gy, wz);
    sc.rotation.y = prng() * Math.PI;
    group.add(sc);
  }
  // A couple of haystack bales near the yard (or field edge).
  const baseRect = farm.yardRect || farm.fieldRect;
  if (baseRect) {
    const cos = Math.cos(baseRect.angle), sin = Math.sin(baseRect.angle);
    const bales = 2 + Math.floor(prng() * 3);
    for (let i = 0; i < bales; i++) {
      const llx = (prng() - 0.5) * baseRect.halfL * 1.4;
      const llz = baseRect.halfW * (0.7 + prng() * 0.5) * (prng() < 0.5 ? -1 : 1);
      const wx = baseRect.cx + llx * cos - llz * sin;
      const wz = baseRect.cz + llx * sin + llz * cos;
      const gy = groundHeight(snapToGrid(wx), snapToGrid(wz));
      const g = new Group();
      addBox(g, strawMat, 0, 0, 1.5, 1.0, 1.0);
      g.position.set(wx, gy, wz);
      g.rotation.y = prng() * Math.PI;
      group.add(g);
    }
  }
}

function buildTrack(farm, group) {
  if (!farm.fieldRect || !farm.yardRect) return;
  const ax = farm.yardRect.cx, az = farm.yardRect.cz;
  const bx = farm.fieldRect.cx, bz = farm.fieldRect.cz;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 4) return;
  const angle = Math.atan2(dz, dx); // world heading of the track
  const trackRect = { cx: mx, cz: mz, halfL: len / 2, halfW: 1.6, angle: -angle };
  const geo = drapeGeometry(trackRect, 0.04);
  const m = new Mesh(geo, soilMat);
  m.position.set(mx, 0, mz);
  m.rotation.y = -angle;
  m.receiveShadow = true;
  group.add(m);
}

export function buildFarmGroup(farm) {
  const group = new Group();
  const prng = alea(farm.seed);
  if (farm.fieldRect) group.add(buildField(farm));
  if (farm.variant === 'both') buildTrack(farm, group);
  buildCrops(farm, group, prng);
  buildFences(farm, group, prng);
  if (farm.yardRect) buildYard(farm, group, prng);
  buildProps(farm, group, prng);
  return group;
}

// Free per-feature buffers: the three draped planes (unique geometry) and every
// instance buffer. All shared geoms (in SHARED_GEOMS) and all materials persist.
export function disposeFarmGroup(group) {
  group.traverse((o) => {
    if (o.isInstancedMesh) { o.dispose(); return; }
    if (o.isMesh && o.geometry && !SHARED_GEOMS.has(o.geometry)) o.geometry.dispose();
  });
}
