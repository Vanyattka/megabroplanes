import alea from 'alea';
import { Quaternion, Vector3 } from 'three';
import {
  VILLAGE_CELL_SIZE,
  VILLAGE_CHANCE,
  VILLAGE_HOUSES_MIN,
  VILLAGE_HOUSES_MAX,
  VILLAGE_HOUSE_RING_MIN,
  VILLAGE_HOUSE_RING_MAX,
  RUNWAY_LENGTH,
  RUNWAY_WIDTH,
  RUNWAY_MARGIN,
  RUNWAY_BLEND,
  PLANE_BOTTOM_OFFSET,
} from '../config.js';

const villageCache = new Map();

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
    // Keep the airport comfortably inside the cell so neighboring cells don't
    // place villages touching each other.
    const margin = 300;
    const inner = VILLAGE_CELL_SIZE - 2 * margin;
    airportX = gcx * VILLAGE_CELL_SIZE + margin + prng() * inner;
    airportZ = gcz * VILLAGE_CELL_SIZE + margin + prng() * inner;
    // Snap runway orientation to 4 cardinals — keeps houses/roads easy to place.
    angle = Math.floor(prng() * 4) * (Math.PI / 2);
  }

  const houseCount =
    VILLAGE_HOUSES_MIN +
    Math.floor(prng() * (VILLAGE_HOUSES_MAX - VILLAGE_HOUSES_MIN + 1));

  const houses = [];
  const roads = [];
  for (let i = 0; i < houseCount; i++) {
    // Bias houses away from the runway axis so they don't sit on the strip.
    let theta;
    let ringRadius;
    let tries = 0;
    do {
      theta = prng() * Math.PI * 2;
      ringRadius =
        VILLAGE_HOUSE_RING_MIN +
        prng() * (VILLAGE_HOUSE_RING_MAX - VILLAGE_HOUSE_RING_MIN);
      tries++;
    } while (tries < 6 && houseTooCloseToRunway(theta, ringRadius, angle));

    const x = airportX + Math.cos(theta) * ringRadius;
    const z = airportZ + Math.sin(theta) * ringRadius;
    const rot = prng() * Math.PI * 2;
    const variant = prng() < 0.5 ? 0 : 1;
    houses.push({ x, z, rot, variant });

    // Road from the house toward the apron area near the runway.
    const apronR = Math.max(
      RUNWAY_WIDTH / 2 + RUNWAY_MARGIN + 10,
      VILLAGE_HOUSE_RING_MIN * 0.6
    );
    const sx = airportX + Math.cos(theta) * apronR;
    const sz = airportZ + Math.sin(theta) * apronR;
    roads.push({ x1: x, z1: z, x2: sx, z2: sz });
  }

  return { gcx, gcz, airportX, airportZ, angle, houses, roads, isHome };
}

// Reject house positions that would fall on the runway strip itself.
function houseTooCloseToRunway(theta, ringRadius, angle) {
  const x = Math.cos(theta) * ringRadius;
  const z = Math.sin(theta) * ringRadius;
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  const lx = x * c - z * s;
  const lz = x * s + z * c;
  return (
    Math.abs(lx) < RUNWAY_LENGTH / 2 + RUNWAY_MARGIN &&
    Math.abs(lz) < RUNWAY_WIDTH / 2 + RUNWAY_MARGIN + 8
  );
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

// Returns the flat-zone factor contribution from a specific village: 0 inside
// its runway zone, 1 outside the blend, smoothstep between.
function airportFlatFactorFor(x, z, v) {
  const dx = x - v.airportX;
  const dz = z - v.airportZ;
  const c = Math.cos(-v.angle);
  const s = Math.sin(-v.angle);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const halfL = RUNWAY_LENGTH / 2 + RUNWAY_MARGIN;
  const halfW = RUNWAY_WIDTH / 2 + RUNWAY_MARGIN;
  const distX = Math.max(0, Math.abs(lx) - halfL);
  const distZ = Math.max(0, Math.abs(lz) - halfW);
  const d = Math.sqrt(distX * distX + distZ * distZ);
  if (d <= 0) return 0;
  if (d >= RUNWAY_BLEND) return 1;
  const t = d / RUNWAY_BLEND;
  return t * t * (3 - 2 * t);
}

// Minimum over all nearby villages (3x3 cells). 1 = full noise, 0 = dead flat.
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

// True if (x,z) is inside any nearby village's built-up area (houses + airport).
// Used by scatter to avoid placing trees on roads/houses/runway.
export function isInVillageArea(x, z) {
  const pcx = Math.floor(x / VILLAGE_CELL_SIZE);
  const pcz = Math.floor(z / VILLAGE_CELL_SIZE);
  const r = VILLAGE_HOUSE_RING_MAX + 30;
  const r2 = r * r;
  for (let dcx = -1; dcx <= 1; dcx++) {
    for (let dcz = -1; dcz <= 1; dcz++) {
      const v = getVillage(pcx + dcx, pcz + dcz);
      if (!v) continue;
      const dx = x - v.airportX;
      const dz = z - v.airportZ;
      if (dx * dx + dz * dz < r2) return true;
    }
  }
  return false;
}

// Spawn pose at the home village (0,0), facing down its runway.
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
