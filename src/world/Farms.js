import alea from 'alea';
import {
  CHUNK_SIZE,
  CHUNK_RESOLUTION,
  WATER_LEVEL,
  RUNWAY_LENGTH,
  RUNWAY_WIDTH,
  RUNWAY_MARGIN,
  FARM_CELL_SIZE,
  FARM_CELL_CHANCE,
  FARM_CELL_MARGIN,
  FARM_MAX_HEIGHT,
  FARM_MAX_SPREAD,
  FARM_VILLAGE_CLEARANCE,
  FARM_FARM_CLEARANCE,
  FARM_REACH_PAD,
  FARM_YARD_HALF,
  FARM_VARIANT_WEIGHTS,
  FARM_FIELD_SIZES,
  FARM_CROP_PALETTE,
} from '../config.js';
import { groundHeight } from './Ground.js';
import { biomeAt } from './TerrainShape.js';
import { isWetAt, villagesAffectingArea, rectFlatFactor } from './Villages.js';
import { seedKey } from './WorldSeed.js';

// Standalone farms + fields — a world layer SEPARATE from the village-farm
// modifier (which makes some villages agricultural). On a cell of low, gentle,
// arable land a feature may spawn: just a crop field, just a farmstead, or
// both. Like ruins and roads, fields and buildings DRAPE on the terrain
// (per-piece groundHeight) — they never flatten it and never touch the chunk
// worker. One feature per cell, fully contained in its cell, so the 3×3
// streaming window and the scatter reach-query are provably complete.

const VERTEX_GRID = CHUNK_SIZE / (CHUNK_RESOLUTION - 1);
function snapToGrid(v) {
  return Math.round(v / VERTEX_GRID) * VERTEX_GRID;
}

const FARM_LAYOUT_GAP = 6; // gap between field and yard (m)

// --- rotated-rectangle (OBB) overlap, via the separating-axis theorem -------
// Each rect is {cx, cz, halfL (local X), halfW (local Z), angle}. A point test
// (rectFlatFactor===0) misses edge-only overlap between two big footprints, so
// farm-vs-village / farm-vs-farm rejection needs the real SAT test.
export function rectsOverlapOBB(a, b) {
  const ca = Math.cos(a.angle), sa = Math.sin(a.angle);
  const cb = Math.cos(b.angle), sb = Math.sin(b.angle);
  const aX = { x: ca, z: sa }, aZ = { x: -sa, z: ca };
  const bX = { x: cb, z: sb }, bZ = { x: -sb, z: cb };
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  const sep = (ax) => {
    const ra =
      a.halfL * Math.abs(aX.x * ax.x + aX.z * ax.z) +
      a.halfW * Math.abs(aZ.x * ax.x + aZ.z * ax.z);
    const rb =
      b.halfL * Math.abs(bX.x * ax.x + bX.z * ax.z) +
      b.halfW * Math.abs(bZ.x * ax.x + bZ.z * ax.z);
    const dist = Math.abs(dx * ax.x + dz * ax.z);
    return dist > ra + rb; // a separating axis ⇒ no overlap
  };
  if (sep(aX) || sep(aZ) || sep(bX) || sep(bZ)) return false;
  return true;
}

function pickVariant(prng) {
  const r = prng();
  const w = FARM_VARIANT_WEIGHTS;
  if (r < w.field) return 'field';
  if (r < w.field + w.both) return 'both';
  return 'farm';
}

// Convert a local-frame rect to a world rect (rotation about the farm center).
function toWorldRect(cx, cz, angle, lx, lz, halfL, halfW) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return {
    cx: cx + lx * c - lz * s,
    cz: cz + lx * s + lz * c,
    halfL,
    halfW,
    angle,
  };
}

// A "candidate" is the farm's geometry from siting alone — biome, dryness,
// elevation, slope, and village clearance — WITHOUT the farm-vs-farm pass.
// Splitting it out this way makes the farm-vs-farm suppression recursion-safe:
// getFarm() resolves overlaps by comparing CANDIDATES of neighbour cells, and a
// candidate never looks at another farm. Cached (null included).
const candidateCache = new Map();

function buildCandidate(fcx, fcz) {
  const prng = alea(seedKey(`farm-data:${fcx}:${fcz}`));
  const inner = FARM_CELL_SIZE - 2 * FARM_CELL_MARGIN;
  const cx = snapToGrid(fcx * FARM_CELL_SIZE + FARM_CELL_MARGIN + prng() * inner);
  const cz = snapToGrid(fcz * FARM_CELL_SIZE + FARM_CELL_MARGIN + prng() * inner);
  const angle = prng() * Math.PI * 2;

  const biome = biomeAt(cx, cz).type;
  if (biome !== 'plains' && biome !== 'savanna') return null;

  const variant = pickVariant(prng);
  const F = FARM_FIELD_SIZES[variant];
  const fieldHalfL = F.L / 2;
  const fieldHalfW = F.W / 2;
  const yardHalf = FARM_YARD_HALF;
  const gap = FARM_LAYOUT_GAP;

  // Local layout: field at origin, yard adjacent on the -X side (variant
  // 'both'); 'farm' puts the yard at origin with a small kitchen garden on +X.
  let fieldLocal = null;
  let yardLocal = null;
  if (variant === 'field') {
    fieldLocal = { lx: 0, lz: 0, halfL: fieldHalfL, halfW: fieldHalfW };
  } else if (variant === 'both') {
    fieldLocal = { lx: 0, lz: 0, halfL: fieldHalfL, halfW: fieldHalfW };
    yardLocal = { lx: -(fieldHalfL + gap + yardHalf), lz: 0, halfL: yardHalf, halfW: yardHalf };
  } else {
    yardLocal = { lx: 0, lz: 0, halfL: yardHalf, halfW: yardHalf };
    fieldLocal = { lx: yardHalf + gap + fieldHalfL, lz: 0, halfL: fieldHalfL, halfW: fieldHalfW };
  }

  // Union local bounds (both sub-rects share the farm angle).
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of [fieldLocal, yardLocal]) {
    if (!p) continue;
    minX = Math.min(minX, p.lx - p.halfL);
    maxX = Math.max(maxX, p.lx + p.halfL);
    minZ = Math.min(minZ, p.lz - p.halfW);
    maxZ = Math.max(maxZ, p.lz + p.halfW);
  }
  const uLx = (minX + maxX) / 2;
  const uLz = (minZ + maxZ) / 2;
  const uHalfL = (maxX - minX) / 2;
  const uHalfW = (maxZ - minZ) / 2;

  const rect = toWorldRect(cx, cz, angle, uLx, uLz, uHalfL, uHalfW);
  const fieldRect = fieldLocal
    ? toWorldRect(cx, cz, angle, fieldLocal.lx, fieldLocal.lz, fieldLocal.halfL, fieldLocal.halfW)
    : null;
  const yardRect = yardLocal
    ? toWorldRect(cx, cz, angle, yardLocal.lx, yardLocal.lz, yardLocal.halfL, yardLocal.halfW)
    : null;

  // --- Siting gate: probe a 5×5 grid over the union footprint --------------
  const c = Math.cos(angle), s = Math.sin(angle);
  let lo = Infinity, hi = -Infinity;
  for (const la of [-1, -0.5, 0, 0.5, 1]) {
    for (const pw of [-1, -0.5, 0, 0.5, 1]) {
      const llx = la * rect.halfL;
      const llz = pw * rect.halfW;
      const wx = rect.cx + llx * c - llz * s;
      const wz = rect.cz + llx * s + llz * c;
      if (isWetAt(wx, wz)) return null;
      const h = groundHeight(wx, wz);
      if (h > FARM_MAX_HEIGHT) return null;
      if (h < WATER_LEVEL + 3) return null;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  if (hi - lo > FARM_MAX_SPREAD) return null;

  // --- Village / airport clearance (SAT, with a clearance pad) -------------
  const reachR = Math.hypot(rect.halfL, rect.halfW) + FARM_VILLAGE_CLEARANCE;
  const villages = villagesAffectingArea(
    rect.cx - reachR, rect.cx + reachR, rect.cz - reachR, rect.cz + reachR
  );
  const padded = {
    cx: rect.cx, cz: rect.cz,
    halfL: rect.halfL + FARM_VILLAGE_CLEARANCE,
    halfW: rect.halfW + FARM_VILLAGE_CLEARANCE,
    angle: rect.angle,
  };
  for (const v of villages) {
    const airportRect = {
      cx: v.airportX, cz: v.airportZ,
      halfL: RUNWAY_LENGTH / 2 + RUNWAY_MARGIN,
      halfW: RUNWAY_WIDTH / 2 + RUNWAY_MARGIN,
      angle: v.angle,
    };
    if (rectsOverlapOBB(padded, airportRect)) return null;
    if (rectsOverlapOBB(padded, v.villageRect)) return null;
  }

  const palette = FARM_CROP_PALETTE[biome] || FARM_CROP_PALETTE.plains;
  return {
    fcx, fcz, x: cx, z: cz, angle, biome, variant,
    rect, fieldRect, yardRect,
    crop: palette.crop,
    soilA: palette.soilA,
    soilB: palette.soilB,
    tuft: palette.tuft,
    seed: seedKey(`farm-mesh:${fcx}:${fcz}`),
  };
}

function getCandidate(fcx, fcz) {
  const key = `${fcx},${fcz}`;
  if (candidateCache.has(key)) return candidateCache.get(key);
  const prng = alea(seedKey(`farm-skip:${fcx}:${fcz}`));
  let cand = null;
  if (prng() < FARM_CELL_CHANCE) cand = buildCandidate(fcx, fcz);
  candidateCache.set(key, cand);
  return cand;
}

// Total order over cells — the lower-ordered cell wins an overlap dispute, so
// exactly one of any overlapping pair survives, the same way from either
// chunk's query → no suppression seam at a chunk boundary.
function cellOrder(fcx, fcz) {
  return fcx * 1e6 + fcz;
}

const farmCache = new Map();

// Resolved farm for a cell: the candidate, unless a LOWER-ordered neighbouring
// candidate overlaps it (then this one is suppressed). Pure + cached.
export function getFarm(fcx, fcz) {
  const key = `${fcx},${fcz}`;
  if (farmCache.has(key)) return farmCache.get(key);
  const cand = getCandidate(fcx, fcz);
  if (!cand) { farmCache.set(key, null); return null; }
  const order = cellOrder(fcx, fcz);
  const padded = {
    cx: cand.rect.cx, cz: cand.rect.cz,
    halfL: cand.rect.halfL + FARM_FARM_CLEARANCE,
    halfW: cand.rect.halfW + FARM_FARM_CLEARANCE,
    angle: cand.rect.angle,
  };
  let result = cand;
  for (let dx = -1; dx <= 1 && result; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      const n = getCandidate(fcx + dx, fcz + dz);
      if (!n) continue;
      if (cellOrder(fcx + dx, fcz + dz) >= order) continue; // only yield to lower-ordered
      if (rectsOverlapOBB(padded, n.rect)) { result = null; break; }
    }
  }
  farmCache.set(key, result);
  return result;
}

// Hot path for scatter: farms whose footprint could reach a chunk's rect.
export function farmsAffectingArea(minX, maxX, minZ, maxZ) {
  const PAD = FARM_REACH_PAD;
  const cMinX = Math.floor((minX - PAD) / FARM_CELL_SIZE);
  const cMaxX = Math.floor((maxX + PAD) / FARM_CELL_SIZE);
  const cMinZ = Math.floor((minZ - PAD) / FARM_CELL_SIZE);
  const cMaxZ = Math.floor((maxZ + PAD) / FARM_CELL_SIZE);
  const out = [];
  for (let fcx = cMinX; fcx <= cMaxX; fcx++) {
    for (let fcz = cMinZ; fcz <= cMaxZ; fcz++) {
      const f = getFarm(fcx, fcz);
      if (!f) continue;
      const r = f.rect;
      const reach = Math.hypot(r.halfL, r.halfW) + PAD;
      if (r.cx + reach < minX || r.cx - reach > maxX) continue;
      if (r.cz + reach < minZ || r.cz - reach > maxZ) continue;
      out.push(f);
    }
  }
  return out;
}

// True if (x,z) lies inside a farm's field or yard — scatter suppression uses
// this so trees/rocks don't grow through crops or the farmyard.
export function isInFarmAreaFast(x, z, farms) {
  if (!farms.length) return false;
  const pad = 4;
  for (const f of farms) {
    if (f.fieldRect) {
      const r = f.fieldRect;
      if (rectFlatFactor(x, z, r.cx, r.cz, r.angle, r.halfL + pad, r.halfW + pad) === 0) return true;
    }
    if (f.yardRect) {
      const y = f.yardRect;
      if (rectFlatFactor(x, z, y.cx, y.cz, y.angle, y.halfL + pad, y.halfW + pad) === 0) return true;
    }
  }
  return false;
}

// Non-list variant (3×3 cell lookup) for callers without a precomputed list.
export function isInFarmArea(x, z) {
  const fcx = Math.floor(x / FARM_CELL_SIZE);
  const fcz = Math.floor(z / FARM_CELL_SIZE);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const f = getFarm(fcx + dx, fcz + dz);
      if (f && isInFarmAreaFast(x, z, [f])) return true;
    }
  }
  return false;
}
