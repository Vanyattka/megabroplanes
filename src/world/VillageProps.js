import {
  BoxGeometry,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import {
  VILLAGE_MAX_PROPS,
  VILLAGE_LAMP_SPACING,
  VILLAGE_PROP_PAD_MARGIN,
} from '../config.js';
import { rectFlatFactor } from './Villages.js';
import { SPECIES } from './Scatter.js';
import { VILLAGE_LAMP_GEOM, villageLampMat } from './NightLights.js';
import { gfx } from '../ui/GraphicsSettings.js';

// ---------------------------------------------------------------------------
// Instanced street furniture + yard props for a village (v0.5). Everything is
// batched by (geometry, material) into one InstancedMesh per key, so a busy
// village adds only a handful of draw calls. Shared geoms/materials are
// module-level and never disposed; disposeVillageGroup frees each
// InstancedMesh's instance buffer via .dispose() (it handles isInstancedMesh
// before the geometry-dispose branch, so the shared geoms are safe).
// All props sit on the flat pad at y = padY — no per-prop groundHeight call.
// ---------------------------------------------------------------------------

// Shared geometries — authored so the base sits at local y=0.
function box(w, h, d, y) { const g = new BoxGeometry(w, h, d); g.translate(0, y, 0); return g; }
const hedgeGeom = box(2.8, 0.9, 0.3, 0.45);
const fenceGeom = box(2.8, 0.85, 0.12, 0.42);
const woodpileGeom = box(1.7, 0.7, 0.9, 0.35);
const hayGeom = (() => { const g = new CylinderGeometry(0.55, 0.55, 1.15, 8); g.rotateZ(Math.PI / 2); g.translate(0, 0.55, 0); return g; })();
const gardenGeom = (() => { const g = new PlaneGeometry(3.4, 2.6); g.rotateX(-Math.PI / 2); g.translate(0, 0.05, 0); return g; })();
const cropGeom = box(0.3, 0.5, 0.3, 0.25);
const lampPoleGeom = (() => { const g = new CylinderGeometry(0.09, 0.12, 4.2, 5); g.translate(0, 2.1, 0); return g; })();
const benchSeatGeom = box(1.5, 0.14, 0.46, 0.45);
const benchBackGeom = (() => { const g = new BoxGeometry(1.5, 0.42, 0.1); g.translate(0, 0.82, -0.18); return g; })();
const troughGeom = box(2.0, 0.55, 0.8, 0.28);

// Shared materials.
const M = (color, extra = {}) => new MeshStandardMaterial({ color, flatShading: true, roughness: 1, ...extra });
const hedgeMat = M(0x3a5a30);
const fenceMat = M(0x8a6a45);
const woodpileMat = M(0x6b4a2a);
const hayMat = M(0xc8a85a);
const cropMat = M(0x6a8a3a);
const lampPoleMat = M(0x33302c);
const benchMat = M(0x6b5535);
const troughMat = M(0x8a8276);
const soilMat = new MeshStandardMaterial({
  color: 0x5a4632, roughness: 1, metalness: 0,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});

// Scratch.
const _pos = new Vector3();
const _q = new Quaternion();
const _scl = new Vector3(1, 1, 1);
const _m = new Matrix4();
const _yAxis = new Vector3(0, 1, 0);

// Pick the yard "signature" species for a biome — reuses Scatter's shared geoms.
function yardSpeciesFor(biome) {
  if (biome === 'desert' || biome === 'tundra') return SPECIES.shrub;
  if (biome === 'taiga' || biome === 'alpine') return SPECIES.conifer;
  if (biome === 'savanna') return SPECIES.acacia;
  return SPECIES.broadleaf;
}

export function buildVillageProps(village, prng) {
  const pad = village.padY || 0;
  const sizeName = village.sizeName;
  const biome = village.biome || 'plains';
  const cap = VILLAGE_MAX_PROPS[sizeName] || 180;
  const isCity = sizeName === 'city';
  const r = village.villageRect;
  const innerL = Math.max(0, r.halfL - VILLAGE_PROP_PAD_MARGIN);
  const innerW = Math.max(0, r.halfW - VILLAGE_PROP_PAD_MARGIN);
  const inside = (x, z) => rectFlatFactor(x, z, r.cx, r.cz, r.angle, innerL, innerW) === 0;

  // (geom,mat,cast) → { geom, mat, cast, mats:[] }
  const batches = new Map();
  let count = 0;
  const cast = !!gfx.settings.shadowTrees;
  function add(geom, mat, x, z, rotY, casts, y = pad, sx = 1, sz = 1) {
    if (count >= cap) return;
    if (!inside(x, z)) return;
    const key = geom.uuid + '|' + mat.uuid + '|' + (casts ? 1 : 0);
    let b = batches.get(key);
    if (!b) { b = { geom, mat, cast: casts, mats: [] }; batches.set(key, b); }
    _pos.set(x, y, z);
    _q.setFromAxisAngle(_yAxis, rotY);
    _scl.set(sx, 1, sz);
    _m.compose(_pos, _q, _scl);
    b.mats.push(_m.clone());
    count++;
  }
  // A yard tree = trunk + canopy sharing one matrix (two batches).
  function addTree(sp, x, z, s) {
    if (count >= cap) return;
    if (!inside(x, z)) return;
    const rot = prng() * Math.PI * 2;
    addScaled(sp.trunkGeom, sp.trunkMat, x, z, rot, cast, s);
    addScaled(sp.canopyGeom, sp.canopyMat, x, z, rot, cast, s);
    count++;
  }
  function addScaled(geom, mat, x, z, rotY, casts, s) {
    const key = geom.uuid + '|' + mat.uuid + '|' + (casts ? 1 : 0);
    let b = batches.get(key);
    if (!b) { b = { geom, mat, cast: casts, mats: [] }; batches.set(key, b); }
    _pos.set(x, pad, z);
    _q.setFromAxisAngle(_yAxis, rotY);
    _scl.set(s, s, s);
    _m.compose(_pos, _q, _scl);
    b.mats.push(_m.clone());
  }

  // House local (lx,lz) → world, using the house's Y rotation.
  const l2w = (h, lx, lz, out) => {
    const c = Math.cos(h.rot), s = Math.sin(h.rot);
    out.x = h.x + lx * c + lz * s;
    out.z = h.z - lx * s + lz * c;
  };
  const _w = { x: 0, z: 0 };

  // --- Per-house yard pass (rural tiers; apartments + cities skip) ---------
  for (const h of village.houses) {
    if (count >= cap) break;
    if (h.variant === 3 || isCity) continue; // apartments / urban core stay clean
    // Front fence or hedge along the street edge.
    if (prng() < 0.55) {
      const useHedge = prng() < 0.5;
      l2w(h, 0, -5.4, _w);
      add(useHedge ? hedgeGeom : fenceGeom, useHedge ? hedgeMat : fenceMat, _w.x, _w.z, h.rot, false);
    }
    // A yard tree/bush at a back corner.
    if (prng() < 0.6) {
      const sx = prng() < 0.5 ? -1 : 1;
      l2w(h, sx * 4.6, 5.0, _w);
      addTree(yardSpeciesFor(biome), _w.x, _w.z, 0.7 + prng() * 0.5);
    }
    // Biome-signature back-yard prop.
    const cold = biome === 'taiga' || biome === 'alpine' || biome === 'tundra' || biome === 'forest';
    if (prng() < 0.5) {
      l2w(h, -3.2, 4.8, _w);
      if (cold) add(woodpileGeom, woodpileMat, _w.x, _w.z, h.rot + (prng() - 0.5), false);
      else if (biome === 'savanna' || biome === 'plains') {
        if (prng() < 0.5) add(hayGeom, hayMat, _w.x, _w.z, prng() * Math.PI, false);
        else {
          // small garden plot + a few crop tufts
          add(gardenGeom, soilMat, _w.x, _w.z, h.rot, false);
          for (let c = 0; c < 3; c++) {
            l2w(h, -3.2 + (c - 1) * 0.8, 4.8 + (prng() - 0.5) * 1.2, _w);
            add(cropGeom, cropMat, _w.x, _w.z, prng() * Math.PI, false);
          }
        }
      } else if (biome === 'desert') {
        add(troughGeom, troughMat, _w.x, _w.z, h.rot, false);
      }
    }
  }

  // --- Road-side furniture (lamps + benches), large/city only -------------
  const lampSpacing = VILLAGE_LAMP_SPACING[sizeName] || 0;
  if (lampSpacing > 0) {
    for (let ri = 0; ri < village.roads.length; ri++) {
      const rd = village.roads[ri];
      const dx = rd.x2 - rd.x1, dz = rd.z2 - rd.z1;
      const len = Math.hypot(dx, dz);
      if (len < 8) continue;
      const ux = dx / len, uz = dz / len;
      const px = -uz, pz = ux; // perpendicular
      let side = 1;
      for (let d = lampSpacing * 0.5; d < len; d += lampSpacing) {
        if (count >= cap) break;
        const offset = 3.4 * side;
        const lx = rd.x1 + ux * d + px * offset;
        const lz = rd.z1 + uz * d + pz * offset;
        add(lampPoleGeom, lampPoleMat, lx, lz, 0, false);
        // Glow bulb at the top — shared night material (blooms at night).
        add(VILLAGE_LAMP_GEOM, villageLampMat, lx, lz, 0, false, pad + 4.0);
        // Occasional bench facing the road.
        if (prng() < 0.28) {
          const benchRot = Math.atan2(px * side, pz * side);
          const bx = rd.x1 + ux * (d + lampSpacing * 0.4) - px * offset;
          const bz = rd.z1 + uz * (d + lampSpacing * 0.4) - pz * offset;
          add(benchSeatGeom, benchMat, bx, bz, benchRot, false);
          add(benchBackGeom, benchMat, bx, bz, benchRot, false);
        }
        side = -side;
      }
    }
  }

  // Flush batches → InstancedMeshes.
  const out = [];
  for (const b of batches.values()) {
    if (!b.mats.length) continue;
    const im = new InstancedMesh(b.geom, b.mat, b.mats.length);
    im.castShadow = b.cast;
    im.receiveShadow = true;
    im.frustumCulled = true;
    for (let i = 0; i < b.mats.length; i++) im.setMatrixAt(i, b.mats[i]);
    im.instanceMatrix.needsUpdate = true;
    out.push(im);
  }
  return out;
}
