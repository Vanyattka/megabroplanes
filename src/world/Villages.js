import alea from 'alea';
import { Quaternion, Vector3 } from 'three';
import {
  VILLAGE_CELL_SIZE,
  VILLAGE_CHANCE,
  VILLAGE_PERP_OFFSET,
  VILLAGE_STREET_SIDE_OFFSET,
  VILLAGE_STREET_SEPARATION,
  VILLAGE_HOUSE_SPACING,
  VILLAGE_SIZES,
  VILLAGE_SIZE_WEIGHTS,
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

function pickSize(prng) {
  const r = prng();
  let acc = 0;
  for (const name of Object.keys(VILLAGE_SIZE_WEIGHTS)) {
    acc += VILLAGE_SIZE_WEIGHTS[name];
    if (r < acc) return name;
  }
  return 'medium';
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

  // Home is always medium so spawn area feels consistent.
  const sizeName = isHome ? 'medium' : pickSize(prng);
  const size = VILLAGE_SIZES[sizeName];

  const fx = Math.cos(angle);
  const fz = Math.sin(angle);
  const px = -Math.sin(angle);
  const pz = Math.cos(angle);
  const sideSign = prng() < 0.5 ? 1 : -1;

  const villageCx = airportX + px * sideSign * VILLAGE_PERP_OFFSET;
  const villageCz = airportZ + pz * sideSign * VILLAGE_PERP_OFFSET;

  const houseCount =
    size.housesMin +
    Math.floor(prng() * (size.housesMax - size.housesMin + 1));

  // Parallel main streets (1 for small/medium, 2 for large).
  const streetOffsets =
    size.streets === 2
      ? [-VILLAGE_STREET_SEPARATION / 2, VILLAGE_STREET_SEPARATION / 2]
      : [0];

  // Split houses across the streets.
  const streetHouseCounts = streetOffsets.map(() => 0);
  for (let i = 0; i < houseCount; i++) {
    streetHouseCounts[i % streetOffsets.length]++;
  }

  const houses = [];
  for (let si = 0; si < streetOffsets.length; si++) {
    const streetOffset = streetOffsets[si];
    const n = streetHouseCounts[si];
    const rowLen = Math.ceil(n / 2);
    const rowStart = -((rowLen - 1) * VILLAGE_HOUSE_SPACING) / 2;
    for (let i = 0; i < n; i++) {
      const slot = Math.floor(i / 2);
      const sideOfStreet = i % 2 === 0 ? -1 : 1;
      const along = rowStart + slot * VILLAGE_HOUSE_SPACING;
      const offsetFromStreet = sideOfStreet * VILLAGE_STREET_SIDE_OFFSET;
      const totalPerp = streetOffset + offsetFromStreet;
      const hx = villageCx + fx * along + px * sideSign * totalPerp;
      const hz = villageCz + fz * along + pz * sideSign * totalPerp;
      const K = sideSign * sideOfStreet;
      const rot = Math.atan2(px * K, pz * K);

      // Variant pick. Tall (variant 2) only appears if size permits; otherwise
      // split roughly half small / half medium.
      let variant;
      const r = prng();
      if (r < size.tallChance) variant = 2;
      else if (r < size.tallChance + 0.48) variant = 0;
      else variant = 1;

      houses.push({ x: hx, z: hz, rot, variant });
    }
  }

  // Roads: one along each street, plus a connector from village center to
  // the runway apron, plus a cross-link between streets for large villages.
  const roads = [];
  for (let si = 0; si < streetOffsets.length; si++) {
    const streetOffset = streetOffsets[si];
    const n = streetHouseCounts[si];
    const rowLen = Math.ceil(n / 2);
    const streetHalfLen = Math.max(
      (rowLen - 1) * VILLAGE_HOUSE_SPACING * 0.5 + 12,
      20
    );
    const streetCx = villageCx + px * sideSign * streetOffset;
    const streetCz = villageCz + pz * sideSign * streetOffset;
    roads.push({
      x1: streetCx - fx * streetHalfLen,
      z1: streetCz - fz * streetHalfLen,
      x2: streetCx + fx * streetHalfLen,
      z2: streetCz + fz * streetHalfLen,
    });
  }
  // Cross-link between the two streets for large villages.
  if (streetOffsets.length === 2) {
    const a = streetOffsets[0];
    const b = streetOffsets[1];
    roads.push({
      x1: villageCx + px * sideSign * a,
      z1: villageCz + pz * sideSign * a,
      x2: villageCx + px * sideSign * b,
      z2: villageCz + pz * sideSign * b,
    });
  }
  // Connector from village center to the airport apron (stops short of the
  // runway flat zone so it never crosses the strip).
  const apronPerp = RUNWAY_WIDTH / 2 + RUNWAY_MARGIN - 2;
  roads.push({
    x1: villageCx,
    z1: villageCz,
    x2: airportX + px * sideSign * apronPerp,
    z2: airportZ + pz * sideSign * apronPerp,
  });

  return {
    gcx,
    gcz,
    airportX,
    airportZ,
    angle,
    sizeName,
    houses,
    roads,
    villageRect: {
      cx: villageCx,
      cz: villageCz,
      halfL: size.halfL,
      halfW: size.halfW,
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

export function isOnFlatGround(x, z) {
  return villageFlatFactor(x, z) === 0;
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
