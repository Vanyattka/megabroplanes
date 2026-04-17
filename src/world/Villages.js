import alea from 'alea';
import { Quaternion, Vector3 } from 'three';
import {
  VILLAGE_CELL_SIZE,
  VILLAGE_CHANCE,
  VILLAGE_HOUSES_MIN,
  VILLAGE_HOUSES_MAX,
  VILLAGE_PERP_OFFSET,
  VILLAGE_HALF_L,
  VILLAGE_HALF_W,
  VILLAGE_STREET_SIDE_OFFSET,
  VILLAGE_HOUSE_SPACING,
  RUNWAY_LENGTH,
  RUNWAY_WIDTH,
  RUNWAY_MARGIN,
  RUNWAY_BLEND,
  PLANE_BOTTOM_OFFSET,
} from '../config.js';

const villageCache = new Map();

// Smoothstep distance from a rotated rectangle: 0 inside, 1 once further than
// RUNWAY_BLEND from the rect, smoothstep between.
function rectFlatFactor(x, z, cx, cz, angle, halfL, halfW) {
  const dx = x - cx;
  const dz = z - cz;
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const distX = Math.max(0, Math.abs(lx) - halfL);
  const distZ = Math.max(0, Math.abs(lz) - halfW);
  const d = Math.sqrt(distX * distX + distZ * distZ);
  if (d <= 0) return 0;
  if (d >= RUNWAY_BLEND) return 1;
  const t = d / RUNWAY_BLEND;
  return t * t * (3 - 2 * t);
}

function buildVillage(gcx, gcz, isHome) {
  const prng = alea(`village-data:${gcx}:${gcz}`);
  let airportX;
  let airportZ;
  let angle;
  if (isHome) {
    airportX = 0;
    airportZ = 0;
    angle = 0;
  } else {
    const margin = 300;
    const inner = VILLAGE_CELL_SIZE - 2 * margin;
    airportX = gcx * VILLAGE_CELL_SIZE + margin + prng() * inner;
    airportZ = gcz * VILLAGE_CELL_SIZE + margin + prng() * inner;
    angle = Math.floor(prng() * 4) * (Math.PI / 2);
  }

  // Runway unit vectors
  const fx = Math.cos(angle);
  const fz = Math.sin(angle);
  const px = -Math.sin(angle); // perpendicular (CCW around +Y from forward)
  const pz = Math.cos(angle);
  // Which side of the runway does the village sit on?
  const sideSign = prng() < 0.5 ? 1 : -1;

  const villageCx = airportX + px * sideSign * VILLAGE_PERP_OFFSET;
  const villageCz = airportZ + pz * sideSign * VILLAGE_PERP_OFFSET;

  const houseCount =
    VILLAGE_HOUSES_MIN +
    Math.floor(prng() * (VILLAGE_HOUSES_MAX - VILLAGE_HOUSES_MIN + 1));

  // Houses line a main street parallel to the runway, alternating sides.
  const rowLen = Math.ceil(houseCount / 2);
  const rowStart = -((rowLen - 1) * VILLAGE_HOUSE_SPACING) / 2;
  const houses = [];
  for (let i = 0; i < houseCount; i++) {
    const slot = Math.floor(i / 2);
    const sideOfStreet = i % 2 === 0 ? -1 : 1; // alternating rows
    const along = rowStart + slot * VILLAGE_HOUSE_SPACING;
    const offsetPerp = sideOfStreet * VILLAGE_STREET_SIDE_OFFSET;
    const hx = villageCx + fx * along + px * sideSign * offsetPerp;
    const hz = villageCz + fz * along + pz * sideSign * offsetPerp;
    // Door faces the street: houseRot rotates local -Z onto the vector pointing
    // back toward street center.
    const signOffset = Math.sign(sideSign * offsetPerp) || 1;
    const rot = Math.atan2(px * signOffset, pz * signOffset);
    const variant = prng() < 0.55 ? 0 : 1;
    houses.push({ x: hx, z: hz, rot, variant });
  }

  // Main street (along runway direction) + connector to the runway apron.
  const streetHalfLen =
    Math.max((rowLen - 1) * VILLAGE_HOUSE_SPACING * 0.5 + 12, 20);
  const msx1 = villageCx - fx * streetHalfLen;
  const msz1 = villageCz - fz * streetHalfLen;
  const msx2 = villageCx + fx * streetHalfLen;
  const msz2 = villageCz + fz * streetHalfLen;

  // Connector stops at the edge of the runway flat zone so it never crosses.
  const apronPerp = RUNWAY_WIDTH / 2 + RUNWAY_MARGIN - 2;
  const cx1 = villageCx;
  const cz1 = villageCz;
  const cx2 = airportX + px * sideSign * apronPerp;
  const cz2 = airportZ + pz * sideSign * apronPerp;

  const roads = [
    { x1: msx1, z1: msz1, x2: msx2, z2: msz2 },
    { x1: cx1, z1: cz1, x2: cx2, z2: cz2 },
  ];

  return {
    gcx,
    gcz,
    airportX,
    airportZ,
    angle,
    houses,
    roads,
    villageRect: {
      cx: villageCx,
      cz: villageCz,
      halfL: VILLAGE_HALF_L,
      halfW: VILLAGE_HALF_W,
      angle,
    },
    isHome,
  };
}

export function getVillage(gcx, gcz) {
  const key = `${gcx},${gcz}`;
  if (villageCache.has(key)) return villageCache.get(key);

  let v = null;
  if (gcx === 0 && gcz === 0) {
    v = buildVillage(0, 0, true);
  } else {
    const prng = alea(`village-skip:${gcx}:${gcz}`);
    if (prng() < VILLAGE_CHANCE) {
      v = buildVillage(gcx, gcz, false);
    }
  }
  villageCache.set(key, v);
  return v;
}

function airportFlatFactorFor(x, z, v) {
  const halfL = RUNWAY_LENGTH / 2 + RUNWAY_MARGIN;
  const halfW = RUNWAY_WIDTH / 2 + RUNWAY_MARGIN;
  const fA = rectFlatFactor(x, z, v.airportX, v.airportZ, v.angle, halfL, halfW);
  if (fA === 0) return 0;
  const r = v.villageRect;
  const fV = rectFlatFactor(x, z, r.cx, r.cz, r.angle, r.halfL, r.halfW);
  return Math.min(fA, fV);
}

// Min flat factor across all nearby villages (airport + village rects).
export function villageFlatFactor(x, z) {
  const pcx = Math.floor(x / VILLAGE_CELL_SIZE);
  const pcz = Math.floor(z / VILLAGE_CELL_SIZE);
  let minF = 1;
  for (let dcx = -1; dcx <= 1; dcx++) {
    for (let dcz = -1; dcz <= 1; dcz++) {
      const v = getVillage(pcx + dcx, pcz + dcz);
      if (!v) continue;
      const f = airportFlatFactorFor(x, z, v);
      if (f < minF) minF = f;
      if (minF === 0) return 0;
    }
  }
  return minF;
}

export function isOnAnyRunway(x, z) {
  const pcx = Math.floor(x / VILLAGE_CELL_SIZE);
  const pcz = Math.floor(z / VILLAGE_CELL_SIZE);
  for (let dcx = -1; dcx <= 1; dcx++) {
    for (let dcz = -1; dcz <= 1; dcz++) {
      const v = getVillage(pcx + dcx, pcz + dcz);
      if (!v) continue;
      const dx = x - v.airportX;
      const dz = z - v.airportZ;
      const c = Math.cos(-v.angle);
      const s = Math.sin(-v.angle);
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      if (
        Math.abs(lx) <= RUNWAY_LENGTH / 2 &&
        Math.abs(lz) <= RUNWAY_WIDTH / 2
      ) {
        return true;
      }
    }
  }
  return false;
}

// Inside any nearby village's airport rect or village rect (plus a small pad).
// Used by scatter to skip trees/rocks there.
export function isInVillageArea(x, z) {
  const pcx = Math.floor(x / VILLAGE_CELL_SIZE);
  const pcz = Math.floor(z / VILLAGE_CELL_SIZE);
  const pad = 12;
  for (let dcx = -1; dcx <= 1; dcx++) {
    for (let dcz = -1; dcz <= 1; dcz++) {
      const v = getVillage(pcx + dcx, pcz + dcz);
      if (!v) continue;
      const hL = RUNWAY_LENGTH / 2 + RUNWAY_MARGIN + pad;
      const hW = RUNWAY_WIDTH / 2 + RUNWAY_MARGIN + pad;
      if (
        rectFlatFactor(x, z, v.airportX, v.airportZ, v.angle, hL, hW) === 0
      ) {
        return true;
      }
      const r = v.villageRect;
      if (
        rectFlatFactor(x, z, r.cx, r.cz, r.angle, r.halfL + pad, r.halfW + pad) ===
        0
      ) {
        return true;
      }
    }
  }
  return false;
}

export function getHomeSpawnPose() {
  const v = getVillage(0, 0);
  const offset = -RUNWAY_LENGTH / 2 + 50;
  const dirX = Math.cos(v.angle);
  const dirZ = Math.sin(v.angle);
  const position = new Vector3(
    v.airportX + dirX * offset,
    PLANE_BOTTOM_OFFSET,
    v.airportZ + dirZ * offset
  );
  const yaw = -Math.PI / 2 - v.angle;
  const quaternion = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    yaw
  );
  return { position, quaternion };
}
