import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import alea from 'alea';
import {
  PLANE_BOTTOM_OFFSET,
  RUNWAY_LENGTH,
  RUNWAY_WIDTH,
  RUNWAY_Y,
  RUNWAY_LIGHT_SPACING,
  ROOF_GABLE_RISE,
  ROOF_HIP_RISE,
  ROOF_PYRAMID_RISE,
  ROOF_FLAT_RISE,
  ROOF_OVERHANG,
  ROOF_SNOW_COLOR,
  VILLAGE_STYLES,
  PLAZA_COLOR,
} from '../config.js';
import { getRunwayMaterial } from './Runway.js';
import { buildPlaneMesh, disposePlaneMesh } from '../plane/PlaneMesh.js';
import { seedKey } from './WorldSeed.js';
import { RUNWAY_LIGHT_GEOM, runwayLightMat, windowMat } from './NightLights.js';
import { makeShadowTexture } from './Shadow.js';
import { gfx } from '../ui/GraphicsSettings.js';
import { buildVillageProps } from './VillageProps.js';

// ---------------------------------------------------------------------------
// Shared geometries — module-level, NEVER disposed per chunk. Every reusable
// geometry goes through shared() so it lands in SHARED_GEOMS automatically —
// forgetting one would let disposeVillageGroup free a buffer still used by
// another village (the class of bug the parked-plane comment documents).
const SHARED_GEOMS = new Set();
function shared(g) { SHARED_GEOMS.add(g); return g; }
function box(w, h, d, y = h / 2) { const g = new BoxGeometry(w, h, d); g.translate(0, y, 0); return shared(g); }
function cyl(rt, rb, h, s, y = h / 2) { const g = new CylinderGeometry(rt, rb, h, s); g.translate(0, y, 0); return shared(g); }
function cone(r, h, s, y = h / 2) { const g = new ConeGeometry(r, h, s); g.translate(0, y, 0); return shared(g); }

// House wall boxes (base at y=0). Kept identical to the legacy footprints.
const geom = {
  walls0: box(5, 3, 6), walls1: box(7, 4, 8), walls2: box(6, 6, 7), walls3: box(20, 13.5, 9),
  lwing: box(4.6, 4, 4.6),
  chimney: box(0.5, 1.4, 0.5, 0.7),
  door: (() => { const g = new BoxGeometry(0.8, 1.6, 0.1); g.translate(0, 0.8, 0); return shared(g); })(),
  window: shared(new BoxGeometry(0.65, 0.9, 0.08)),
  unitBox: shared(new BoxGeometry(1, 1, 1)),       // flat roofs (scaled — box normals stay correct)
  porchSlab: box(1, 1, 1, 0.5),                    // unit height — scaled per house (sy sets thickness)
  porchPost: cyl(0.1, 0.1, 1, 6),                  // scaled per house
};

// Footprint dims (must match the wall boxes). frontZ = door placement.
const WALL_DIMS = {
  0: { W: 5, L: 6, top: 3, frontZ: -3.05 },
  1: { W: 7, L: 8, top: 4, frontZ: -4.05 },
  2: { W: 6, L: 7, top: 6, frontZ: -3.55 },
  3: { W: 20, L: 9, top: 13.5, frontZ: -4.55 },
  4: { W: 7, L: 8, top: 4, frontZ: -4.05 }, // L-house shares the footprint-1 body
};

// --- Roof geometry builders (dims BAKED so non-uniform instance scaling never
// skews the normals — pitched roofs need correct facet lighting). Eave line at
// y=0; the house builder places the roof at wall-top height.
function makeGable(W, L, rise) {
  const hw = (W + 2 * ROOF_OVERHANG) / 2, hl = (L + 2 * ROOF_OVERHANG) / 2;
  const FL = [-hw, 0, -hl], FR = [hw, 0, -hl], BL = [-hw, 0, hl], BR = [hw, 0, hl];
  const RF = [0, rise, -hl], RB = [0, rise, hl];
  const tri = (a, b, c) => [...a, ...b, ...c];
  const pos = [
    ...tri(FL, BL, RB), ...tri(FL, RB, RF), // left slope
    ...tri(FR, RF, RB), ...tri(FR, RB, BR), // right slope
    ...tri(FL, RF, FR),                     // front gable
    ...tri(BL, BR, RB),                     // back gable
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return shared(g);
}
function makePyramid(W, L, rise) {
  const hw = (W + 2 * ROOF_OVERHANG) / 2, hl = (L + 2 * ROOF_OVERHANG) / 2;
  const c0 = [-hw, 0, -hl], c1 = [hw, 0, -hl], c2 = [hw, 0, hl], c3 = [-hw, 0, hl];
  const ap = [0, rise, 0];
  const tri = (a, b, c) => [...a, ...b, ...c];
  // base ring CCW from above (c0→c1→c2→c3); outward side = (next, current, apex)
  const pos = [
    ...tri(c1, c0, ap), ...tri(c2, c1, ap), ...tri(c3, c2, ap), ...tri(c0, c3, ap),
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return shared(g);
}
// roofGeoms[footprint][type] for footprints with pitched roofs (0,1,2).
const roofGeoms = {};
for (const fp of [0, 1, 2]) {
  const d = WALL_DIMS[fp];
  roofGeoms[fp] = {
    gable: makeGable(d.W, d.L, ROOF_GABLE_RISE),
    hip: makePyramid(d.W, d.L, ROOF_HIP_RISE),
    pyramid: makePyramid(d.W, d.L, ROOF_PYRAMID_RISE),
  };
}
function roofKeyForFootprint(fp) { return fp === 4 ? 1 : fp; }

// Airport structures (city tier only).
const airportGeom = {
  terminal: box(14, 5, 8), tower: box(4, 5, 4), towerTop: box(5, 1.4, 5, 0.7), hangar: box(22, 8, 14),
};

// --- Landmark part geometries (one-off per village → plain Meshes of SHARED
// geoms, no instancing needed). Dims baked → correct normals.
const lm = {
  churchNave: box(8, 5, 16), churchTower: box(3.2, 9, 3.2), churchSpire: cone(2.0, 6, 4),
  hallBody: box(16, 8, 12), hallTower: box(3.6, 5, 3.6), hallCap: cone(2.8, 2.2, 4),
  fountainBasin: cyl(3.0, 3.2, 0.8, 12, 0.4), fountainWater: cyl(2.6, 2.6, 0.16, 12, 0.7), fountainPed: cyl(0.4, 0.6, 1.6, 8, 0.8),
  wellRing: cyl(1.2, 1.3, 1.2, 10, 0.6), wellPost: box(0.22, 2.0, 0.22), wellRoof: cone(1.5, 1.0, 4, 0),
  towerLeg: cyl(0.3, 0.35, 12, 6, 6), tankBody: cyl(4, 4, 5, 12, 2.5), tankCap: cone(4.3, 2, 12, 0),
  millTower: cyl(2.2, 3.2, 9, 8, 4.5), millCap: cone(2.6, 2.0, 8, 0), millBlade: box(0.3, 8, 0.18, 0),
  domeDrum: cyl(2.8, 2.8, 1.4, 10, 0.7),
  domeCap: (() => { const g = new SphereGeometry(3.0, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); return shared(g); })(),
  mastPole: cyl(0.35, 0.6, 15, 6, 7.5), mastTop: shared(new SphereGeometry(0.5, 8, 6)),
  barnBody: box(12, 6, 18), barnRoof: null, barnDoor: box(3.4, 4.2, 0.3, 2.1),
  siloBody: cyl(2.2, 2.2, 10, 14, 5), siloCap: shared(new SphereGeometry(2.3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)),
  lhSeg: cyl(1.5, 1.8, 3.2, 10, 1.6), lhLantern: cyl(1.3, 1.3, 1.8, 8, 0.9), lhCap: cone(1.6, 1.4, 8, 0),
  lhGlow: shared(new SphereGeometry(0.9, 10, 8)),
};
lm.barnRoof = makeGable(12, 18, 4.2); // baked gable for the barn

// Contact shadow disc — shared "fake AO" under every building.
const CONTACT_SHADOW_GEOM = (() => { const g = new PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return shared(g); })();
const contactShadowTex = makeShadowTexture();
const contactShadowMat = new MeshBasicMaterial({ map: contactShadowTex, transparent: true, depthWrite: false, opacity: 0.55 });

// ---------------------------------------------------------------------------
// Materials. Per-style wall + roof pools built once from VILLAGE_STYLES.
const stdMat = (c, extra = {}) => new MeshStandardMaterial({ color: c, flatShading: true, roughness: 1, ...extra });
const styleWallMats = {};
const styleRoofMats = {};
for (const key of Object.keys(VILLAGE_STYLES)) {
  styleWallMats[key] = VILLAGE_STYLES[key].walls.map((c) => stdMat(c));
  styleRoofMats[key] = VILLAGE_STYLES[key].roofColors.map((c) => stdMat(c));
}
const apartmentWallMats = [0xb0b0a8, 0xc5c5b5, 0xa0a0a0, 0xb8b0a0, 0xc0b098, 0xa8a8b0].map((c) => stdMat(c));
const apartmentRoofMats = [0x3a3a3a, 0x2a2a2a, 0x4a4a40, 0x5a4830].map((c) => stdMat(c));
const roofSnowMat = stdMat(ROOF_SNOW_COLOR, { roughness: 0.9 });
const doorMat = stdMat(0x3a2a1a);
const chimneyMat = stdMat(0x333333);
const porchMat = stdMat(0x7a6346);
const roadMat = new MeshStandardMaterial({
  color: 0x666058, roughness: 1, metalness: 0,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});
const plazaMat = new MeshStandardMaterial({
  color: PLAZA_COLOR, roughness: 1, metalness: 0,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});
const terminalMat = stdMat(0xd8d0c0, { roughness: 0.85 });
const hangarMat = stdMat(0x70787e, { roughness: 0.6, metalness: 0.3 });
const towerAccentMat = stdMat(0xb84040, { roughness: 0.8 });
// Landmark materials.
const stoneMat = stdMat(0xe6e2d8);
const slateMat = stdMat(0x44505a);
const brickMat = stdMat(0x9a3a2a);
const metalMat = stdMat(0x8a9098, { metalness: 0.3, roughness: 0.6 });
const woodMat = stdMat(0x7a5a38);
const goldMat = stdMat(0xd8b048, { metalness: 0.2 });
const waterMat = new MeshBasicMaterial({ color: 0x3a78b0, transparent: true, opacity: 0.7 });
const beaconMat = new MeshBasicMaterial({ color: 0xff5530, toneMapped: false });
const whiteBandMat = stdMat(0xf0eee8);
const redBandMat = stdMat(0xcc4030);

// ---------------------------------------------------------------------------
// Window placement (local frame), reused for the village-wide InstancedMesh.
const VARIANTS = {
  0: { halfX: 2.5, halfZ: 3.0, floors: [1.5], chimney: null },
  1: { halfX: 3.5, halfZ: 4.0, floors: [2.2], chimney: { x: 1.4, y: 5.0, z: -1.2 } },
  2: { halfX: 3.0, halfZ: 3.5, floors: [1.7, 4.4], chimney: { x: 1.3, y: 7.0, z: -1.2 } },
  3: { halfX: 10, halfZ: 4.5, floors: [1.4, 4.7, 8.0, 11.3], chimney: null,
       fbXPositions: [-7.8, -3.3, 3.3, 7.8], sideZPositions: [-2.8, 2.8] },
  4: { halfX: 3.5, halfZ: 4.0, floors: [2.2], chimney: { x: 1.4, y: 5.0, z: -1.2 } },
};
function windowLocalPlacements(variant) {
  const dims = VARIANTS[variant] || VARIANTS[0];
  const fbXs = dims.fbXPositions || [-1.35, 1.35];
  const sideZs = dims.sideZPositions || [0];
  const out = [];
  for (const y of dims.floors) {
    for (const x of fbXs) {
      out.push({ x, y, z: -(dims.halfZ + 0.05), side: false });
      out.push({ x, y, z: dims.halfZ + 0.05, side: false });
    }
    for (const z of sideZs) {
      out.push({ x: -(dims.halfX + 0.05), y, z, side: true });
      out.push({ x: dims.halfX + 0.05, y, z, side: true });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Instanced batcher — collapse every repeated house/roof/detail part into one
// InstancedMesh per (geometry, material, shadow flags). A 48-house city goes
// from hundreds of Mesh objects to ~30 InstancedMeshes.
class Batcher {
  constructor() { this.map = new Map(); }
  add(geometry, material, matrix, cast, receive) {
    const key = `${geometry.uuid}|${material.uuid}|${cast ? 1 : 0}|${receive ? 1 : 0}`;
    let e = this.map.get(key);
    if (!e) { e = { geometry, material, cast, receive, mats: [] }; this.map.set(key, e); }
    e.mats.push(matrix.clone());
  }
  flush(group) {
    for (const e of this.map.values()) {
      if (!e.mats.length) continue;
      const im = new InstancedMesh(e.geometry, e.material, e.mats.length);
      im.castShadow = e.cast;
      im.receiveShadow = e.receive;
      for (let i = 0; i < e.mats.length; i++) im.setMatrixAt(i, e.mats[i]);
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
    }
  }
}

// Scratch matrices.
const _hp = new Vector3();
const _hq = new Quaternion();
const _one = new Vector3(1, 1, 1);
const _houseMat = new Matrix4();
const _lp = new Vector3();
const _lq = new Quaternion();
const _ls = new Vector3();
const _localMat = new Matrix4();
const _out = new Matrix4();
const _yAxis = new Vector3(0, 1, 0);
const _zAxis = new Vector3(0, 0, 1);

function localMat(x, y, z, rotY, sx = 1, sy = 1, sz = 1) {
  _lp.set(x, y, z); _lq.setFromAxisAngle(_yAxis, rotY); _ls.set(sx, sy, sz);
  return _localMat.compose(_lp, _lq, _ls);
}
function localMatZ(x, y, z, rotZ, sx, sy, sz) {
  _lp.set(x, y, z); _lq.setFromAxisAngle(_zAxis, rotZ); _ls.set(sx, sy, sz);
  return _localMat.compose(_lp, _lq, _ls);
}

function emitHouse(h, padY, batch, contactMats) {
  const fp = h.variant;
  const wd = WALL_DIMS[fp];
  const style = VILLAGE_STYLES[h.style] ? h.style : 'classic';

  // Materials from the biome style (apartments use the urban concrete pool).
  const wallPool = fp === 3 ? apartmentWallMats : styleWallMats[style];
  const roofPool = fp === 3 ? apartmentRoofMats : styleRoofMats[style];
  const wallMat = wallPool[Math.floor(h.colorSeed * wallPool.length) % wallPool.length];
  const pitched = h.roof === 'gable' || h.roof === 'hip' || h.roof === 'pyramid';
  // Snow caps on the cold-climate styles. Driven off the per-house colorSeed
  // (already drawn — no new prng) instead of padY: villages are sited below
  // ~55 m elevation, so the old `padY > SNOW_LINE - margin` test could never
  // fire and snowy roofs never appeared at all.
  const snow = (style === 'chalet' || style === 'logSteep') && pitched && h.colorSeed > 0.4;
  const roofMat = snow ? roofSnowMat : roofPool[Math.floor(h.colorSeed * roofPool.length) % roofPool.length];

  _hp.set(h.x, padY, h.z); _hq.setFromAxisAngle(_yAxis, h.rot);
  _houseMat.compose(_hp, _hq, _one);
  const place = (geometry, material, lm, cast, receive) => {
    _out.multiplyMatrices(_houseMat, lm);
    batch.add(geometry, material, _out, cast, receive);
  };

  // Walls (+ L wing).
  const wallsGeom = fp === 0 ? geom.walls0 : fp === 2 ? geom.walls2 : fp === 3 ? geom.walls3 : geom.walls1;
  place(wallsGeom, wallMat, localMat(0, 0, 0, 0), true, true);
  if (h.lshape) place(geom.lwing, wallMat, localMat(wd.W / 2 - 0.5, 0, wd.L / 2 - 0.5, 0), true, true);

  // Roof.
  if (h.roof === 'flat' || fp === 3) {
    place(geom.unitBox, roofMat,
      localMat(0, wd.top + ROOF_FLAT_RISE / 2, 0, 0, wd.W + 2 * ROOF_OVERHANG, ROOF_FLAT_RISE, wd.L + 2 * ROOF_OVERHANG),
      true, true);
  } else {
    const rg = roofGeoms[roofKeyForFootprint(fp)][h.roof] || roofGeoms[roofKeyForFootprint(fp)].gable;
    place(rg, roofMat, localMat(0, wd.top, 0, 0), true, true);
  }
  if (h.lshape) {
    // wing gets a low flat cap
    place(geom.unitBox, roofMat, localMat(wd.W / 2 - 0.5, 4 + 0.2, wd.L / 2 - 0.5, 0, 5, 0.4, 5), true, true);
  }

  // Door.
  place(geom.door, doorMat, localMat(0, 0, wd.frontZ), false, false);

  // Porch — a slab on two posts at the front door.
  if (h.porch) {
    const pz = wd.frontZ - 1.3;
    place(geom.porchSlab, porchMat, localMat(0, 2.3, pz, 0, wd.W * 0.62, 0.22, 2.4), true, false);
    place(geom.porchPost, porchMat, localMat(-wd.W * 0.28, 0, pz - 1.0, 0, 1, 2.3, 1), true, false);
    place(geom.porchPost, porchMat, localMat(wd.W * 0.28, 0, pz - 1.0, 0, 1, 2.3, 1), true, false);
  }

  // Chimney.
  const vchim = VARIANTS[fp] && VARIANTS[fp].chimney;
  if (h.chimney && vchim) {
    place(geom.chimney, chimneyMat, localMat(vchim.x, vchim.y, vchim.z), true, false);
  }

  // Windows.
  for (const w of windowLocalPlacements(fp)) {
    place(geom.window, windowMat, localMat(w.x, w.y, w.z, w.side ? Math.PI / 2 : 0), false, false);
  }

  // Contact-shadow disc (collected for a single render-ordered InstancedMesh).
  if (gfx.settings.contactShadows) {
    const sx = wd.W + 2.5, sz = wd.L + 2.5;
    _out.multiplyMatrices(_houseMat, localMat(0, 0.08, 0, 0, sx, 1, sz));
    contactMats.push(_out.clone());
  }
}

// ---------------------------------------------------------------------------
// Landmarks. Each returns a Group placed at (x, padY, z) rot. Plain Meshes of
// SHARED geoms (one-off per village; the geoms are never disposed).
function meshAt(geometry, material, x, y, z, rotY = 0, cast = true, receive = true) {
  const m = new Mesh(geometry, material);
  m.position.set(x, y, z);
  if (rotY) m.rotation.y = rotY;
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

function buildLandmark(L, padY) {
  const g = new Group();
  g.position.set(L.x, padY, L.z);
  g.rotation.y = L.rot || 0;
  switch (L.kind) {
    case 'church': {
      g.add(meshAt(lm.churchNave, stoneMat, 0, 0, 0));
      g.add(meshAt(makeGableRef(8, 16, 4.5), slateMat, 0, 5, 0)); // roof (cached)
      g.add(meshAt(lm.churchTower, stoneMat, 0, 0, -7.2));
      g.add(meshAt(lm.churchSpire, slateMat, 0, 9, -7.2));
      break;
    }
    case 'townhall': {
      g.add(meshAt(lm.hallBody, stoneMat, 0, 0, 0));
      g.add(meshAt(makeGableRef(16, 12, 3.0), slateMat, 0, 8, 0));
      g.add(meshAt(lm.hallTower, stoneMat, 0, 8, -4.5));
      g.add(meshAt(lm.hallCap, slateMat, 0, 13, -4.5));
      break;
    }
    case 'fountain': {
      g.add(meshAt(lm.fountainBasin, stoneMat, 0, 0, 0));
      g.add(meshAt(lm.fountainWater, waterMat, 0, 0, 0, 0, false, false));
      g.add(meshAt(lm.fountainPed, stoneMat, 0, 0.8, 0));
      break;
    }
    case 'well': {
      g.add(meshAt(lm.wellRing, stoneMat, 0, 0, 0));
      g.add(meshAt(lm.wellPost, woodMat, -0.9, 0, 0));
      g.add(meshAt(lm.wellPost, woodMat, 0.9, 0, 0));
      g.add(meshAt(lm.wellRoof, woodMat, 0, 2.0, 0));
      break;
    }
    case 'watertower': {
      for (const [dx, dz] of [[-3.2, -3.2], [3.2, -3.2], [-3.2, 3.2], [3.2, 3.2]]) {
        g.add(meshAt(lm.towerLeg, metalMat, dx, 0, dz));
      }
      g.add(meshAt(lm.tankBody, metalMat, 0, 12, 0));
      g.add(meshAt(lm.tankCap, metalMat, 0, 17, 0));
      break;
    }
    case 'windmill': {
      g.add(meshAt(lm.millTower, stoneMat, 0, 0, 0));
      g.add(meshAt(lm.millCap, slateMat, 0, 9, 0));
      // Static 4-blade cross on the front (rolled to one angle).
      const hub = new Group();
      hub.position.set(0, 8.5, -2.6);
      hub.rotation.z = 0.5;
      for (let i = 0; i < 4; i++) {
        const b = meshAt(lm.millBlade, woodMat, 0, 0, 0);
        b.rotation.z = i * Math.PI / 2;
        hub.add(b);
      }
      g.add(hub);
      break;
    }
    case 'dome': {
      g.add(meshAt(lm.churchNave, stoneMat, 0, 0, 0, 0));
      g.add(meshAt(lm.domeDrum, stoneMat, 0, 5, 0));
      g.add(meshAt(lm.domeCap, goldMat, 0, 6.4, 0));
      break;
    }
    case 'mast': {
      g.add(meshAt(lm.mastPole, metalMat, 0, 0, 0));
      g.add(meshAt(lm.mastTop, beaconMat, 0, 15, 0, 0, false, false));
      break;
    }
    case 'barn': {
      g.add(meshAt(lm.barnBody, brickMat, 0, 0, 0));
      g.add(meshAt(lm.barnRoof, slateMat, 0, 6, 0));
      g.add(meshAt(lm.barnDoor, woodMat, 0, 0, -9.05));
      break;
    }
    case 'silo': {
      g.add(meshAt(lm.siloBody, metalMat, 0, 0, 0));
      g.add(meshAt(lm.siloCap, metalMat, 0, 10, 0));
      break;
    }
    case 'lighthouse': {
      for (let i = 0; i < 4; i++) {
        g.add(meshAt(lm.lhSeg, i % 2 ? redBandMat : whiteBandMat, 0, i * 3.2, 0));
      }
      g.add(meshAt(lm.lhLantern, metalMat, 0, 12.8, 0));
      g.add(meshAt(lm.lhCap, slateMat, 0, 14.6, 0));
      g.add(meshAt(lm.lhGlow, beaconMat, 0, 13.5, 0, 0, false, false));
      break;
    }
    default: break;
  }
  return g;
}
// Cache landmark gable roofs by (W,L,rise) so repeated landmarks share geom.
const _gableCache = new Map();
function makeGableRef(W, L, rise) {
  const key = `${W}:${L}:${rise}`;
  let g = _gableCache.get(key);
  if (!g) { g = makeGable(W, L, rise); _gableCache.set(key, g); }
  return g;
}

// ---------------------------------------------------------------------------
function buildRoadStrip(road, padY, width = 4.5) {
  const dx = road.x2 - road.x1, dz = road.z2 - road.z1;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < 1) return null;
  const geo = new PlaneGeometry(length, width);
  geo.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geo, roadMat);
  mesh.position.set((road.x1 + road.x2) / 2, padY + RUNWAY_Y, (road.z1 + road.z2) / 2);
  mesh.rotation.y = -Math.atan2(dz, dx);
  mesh.receiveShadow = true;
  return mesh;
}

function buildPlazaQuad(village) {
  const p = village.plaza;
  const geo = new PlaneGeometry(p.half * 2, p.half * 2);
  geo.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geo, plazaMat);
  mesh.position.set(p.x, (village.padY || 0) + RUNWAY_Y, p.z);
  mesh.rotation.y = village.angle;
  mesh.receiveShadow = true;
  return mesh;
}

function buildAirportStructures(village) {
  if (village.sizeName !== 'city') return [];
  const out = [];
  const fx = Math.cos(village.angle), fz = Math.sin(village.angle);
  const px = -Math.sin(village.angle), pz = Math.cos(village.angle);
  const s = village.sideSign;
  const pad = village.padY || 0;
  const worldPos = (along, perp) => ({
    x: village.airportX + fx * along + px * s * perp,
    z: village.airportZ + fz * along + pz * s * perp,
  });
  const shadowed = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  {
    const p = worldPos(-210, 42);
    const terminal = shadowed(new Mesh(airportGeom.terminal, terminalMat));
    terminal.position.set(p.x, pad, p.z); terminal.rotation.y = village.angle; out.push(terminal);
    const tower = shadowed(new Mesh(airportGeom.tower, terminalMat));
    tower.position.set(p.x, pad + 5, p.z); tower.rotation.y = village.angle; out.push(tower);
    const towerTop = shadowed(new Mesh(airportGeom.towerTop, towerAccentMat));
    towerTop.position.set(p.x, pad + 10, p.z); towerTop.rotation.y = village.angle; out.push(towerTop);
  }
  {
    const p = worldPos(-160, 50);
    const hangar = shadowed(new Mesh(airportGeom.hangar, hangarMat));
    hangar.position.set(p.x, pad, p.z); hangar.rotation.y = village.angle; out.push(hangar);
  }
  for (let i = 0; i < 2; i++) {
    const p = worldPos(-120 + i * 18, 42);
    const plane = buildPlaneMesh();
    plane.position.set(p.x, pad + PLANE_BOTTOM_OFFSET, p.z);
    plane.rotation.y = -Math.PI / 2 - village.angle;
    plane.userData.parkedPlane = true; // freed via disposePlaneMesh (shared plane geoms)
    out.push(plane);
  }
  return out;
}

function buildRunwayLights(parent) {
  const perSide = Math.floor(RUNWAY_LENGTH / RUNWAY_LIGHT_SPACING) + 1;
  const mesh = new InstancedMesh(RUNWAY_LIGHT_GEOM, runwayLightMat, perSide * 2);
  mesh.frustumCulled = false;
  const m = new Matrix4();
  let i = 0;
  for (const side of [-1, 1]) {
    for (let j = 0; j < perSide; j++) {
      m.makeTranslation(-RUNWAY_LENGTH / 2 + j * RUNWAY_LIGHT_SPACING, 0.35, side * (RUNWAY_WIDTH / 2 + 1.2));
      mesh.setMatrixAt(i++, m);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  parent.add(mesh);
}

function buildRunwayMeshFor(village) {
  const geo = new PlaneGeometry(RUNWAY_LENGTH, RUNWAY_WIDTH);
  geo.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geo, getRunwayMaterial());
  // Receive shadows — without this a plane parked on the strip cast its shadow
  // onto the terrain BELOW the runway plane, which then drew on top and hid it,
  // so the plane looked shadowless on the runway (roads/plaza/structures
  // already receive; the runway was the one surface that didn't).
  mesh.receiveShadow = true;
  mesh.position.set(village.airportX, (village.padY || 0) + RUNWAY_Y, village.airportZ);
  mesh.rotation.y = village.angle;
  buildRunwayLights(mesh);
  return mesh;
}

export function buildVillageGroup(village) {
  const group = new Group();
  const padY = village.padY || 0;
  const propPrng = alea(seedKey(`village-props:${village.gcx}:${village.gcz}`));

  group.add(buildRunwayMeshFor(village));
  for (const m of buildAirportStructures(village)) group.add(m);
  if (village.plaza) group.add(buildPlazaQuad(village));

  // Houses → batched.
  const batch = new Batcher();
  const contactMats = [];
  for (const h of village.houses) emitHouse(h, padY, batch, contactMats);
  batch.flush(group);
  if (contactMats.length) {
    const im = new InstancedMesh(CONTACT_SHADOW_GEOM, contactShadowMat, contactMats.length);
    im.renderOrder = 1;
    im.castShadow = false; im.receiveShadow = false;
    for (let i = 0; i < contactMats.length; i++) im.setMatrixAt(i, contactMats[i]);
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  }

  // Landmarks + roads + props.
  if (village.landmarks) for (const L of village.landmarks) group.add(buildLandmark(L, padY));
  for (const r of village.roads) { const m = buildRoadStrip(r, padY); if (m) group.add(m); }
  for (const m of buildVillageProps(village, propPrng)) group.add(m);

  return group;
}

export function disposeVillageGroup(group) {
  // Parked planes share the GLOBAL plane-geometry pool — free via disposePlaneMesh
  // (per-instance materials only) BEFORE the generic pass so the shared plane
  // buffers (used by the player/remotes/preview/reflection) are never disposed.
  const parked = [];
  group.traverse((obj) => { if (obj.userData && obj.userData.parkedPlane) parked.push(obj); });
  for (const p of parked) { if (p.parent) p.parent.remove(p); disposePlaneMesh(p); }
  group.traverse((obj) => {
    if (obj.isInstancedMesh) { obj.dispose(); return; }
    if (!obj.isMesh) return;
    // Only unique per-village geoms (road/runway/plaza planes) are disposed;
    // every reusable geom is in SHARED_GEOMS via shared().
    if (obj.geometry && !SHARED_GEOMS.has(obj.geometry)) obj.geometry.dispose();
  });
}
