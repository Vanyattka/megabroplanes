import alea from 'alea';
import { Quaternion, Vector3 } from 'three';
import {
  VILLAGE_CELL_SIZE,
  VILLAGE_CHANCE,
  VILLAGE_STREET_SIDE_OFFSET,
  VILLAGE_STREET_SEPARATION,
  VILLAGE_SIZES,
  VILLAGE_SIZE_WEIGHTS,
  RUNWAY_LENGTH,
  RUNWAY_WIDTH,
  RUNWAY_MARGIN,
  RUNWAY_BLEND,
  VILLAGE_BLEND,
  PLANE_BOTTOM_OFFSET,
  SEA_THRESHOLD_LOW,
  WATER_LEVEL,
} from '../config.js';
import { seaMaskAt } from './SeaMask.js';
import { landElevation } from './TerrainShape.js';
import { seedKey } from './WorldSeed.js';

// Village center sits far enough from the runway that the village rect never
// overlaps the runway's flat zone. Without this, cities (halfW=140) place
// houses on the runway strip itself.
function perpOffsetFor(size) {
  return size.halfW + RUNWAY_WIDTH / 2 + RUNWAY_MARGIN + 5;
}

const villageCache = new Map();

// Smoothstep distance from a rotated rectangle: 0 inside, 1 once further
// than `blend` from the rect, smoothstep between. `blend` defaults to
// RUNWAY_BLEND for backward compat with older callers.
export function rectFlatFactor(x, z, cx, cz, angle, halfL, halfW, blend = RUNWAY_BLEND) {
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
  if (d >= blend) return 1;
  const t = d / blend;
  return t * t * (3 - 2 * t);
}

function computeStreetOffsets(n) {
  if (n <= 1) return [0];
  // Evenly spaced across the village width, centered. Spacing between streets
  // scales with street count so rows don't overlap.
  const sep = n === 2 ? VILLAGE_STREET_SEPARATION : VILLAGE_STREET_SEPARATION * 1.25;
  const total = (n - 1) * sep;
  const offsets = [];
  for (let i = 0; i < n; i++) offsets.push(-total / 2 + i * sep);
  return offsets;
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
  const prng = alea(seedKey(`village-data:${gcx}:${gcz}`));
  let airportX;
  let airportZ;
  let angle;
  if (isHome) {
    // Home airport: search a grid of candidate positions/orientations around
    // the origin and pick the FLATTEST footprint (smallest height spread), not
    // merely the lowest. Picking "lowest" landed the strip at the foot of a
    // slope, so its flat plateau cut a wedge into the rising hill and the
    // player spawned half-buried. Measuring the height range over the whole
    // runway-plus-blend footprint finds genuinely level ground. Runs once at
    // module load — cost is a few ms.
    const candidates = [];
    for (let dx = -600; dx <= 600; dx += 200) {
      for (let dz = -600; dz <= 600; dz += 200) {
        for (const a of [0, Math.PI / 2]) {
          candidates.push({ x: dx, z: dz, angle: a });
        }
      }
    }
    let best = candidates[0];
    let bestScore = Infinity;
    for (const c of candidates) {
      // Rotate probe offsets with candidate angle so we're measuring the
      // RUNWAY's flat zone, not a fixed axis-aligned one. Cover the full strip
      // length + blend ring so a hill just past the runway end is penalized.
      const fx = Math.cos(c.angle);
      const fz = Math.sin(c.angle);
      let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
      for (const along of [-450, -300, -150, 0, 150, 300, 450]) {
        for (const perp of [-250, 0, 250]) {
          const px = c.x + fx * along - fz * perp;
          const pz = c.z + fz * along + fx * perp;
          const h = landElevation(px, pz);
          if (h < lo) lo = h;
          if (h > hi) hi = h;
          sum += Math.max(0, h);
          n++;
        }
      }
      // Flatness dominates; a small lowness term breaks ties toward valleys.
      const score = (hi - lo) + 0.12 * (sum / n);
      if (score < bestScore) { bestScore = score; best = c; }
    }
    airportX = best.x;
    airportZ = best.z;
    angle = best.angle;
  } else {
    const margin = 300;
    const inner = VILLAGE_CELL_SIZE - 2 * margin;
    airportX = gcx * VILLAGE_CELL_SIZE + margin + prng() * inner;
    airportZ = gcz * VILLAGE_CELL_SIZE + margin + prng() * inner;
    angle = Math.floor(prng() * 4) * (Math.PI / 2);

    // Reject cells whose airport would land in the sea. Home (0,0) is
    // exempt so the starting airport is always reachable even if the mask
    // happens to peak at the origin.
    if (seaMaskAt(airportX, airportZ) >= SEA_THRESHOLD_LOW) return null;

    // Reject cells whose airport would sit on mountains or visibly sloped
    // ground. Height alone is the wrong test — flat uplands/plateaus (~35 m)
    // are perfectly good village sites (the pad levels to LOCAL height since
    // v0.2.1), and rejecting them culled half the world's villages. So:
    // reject genuine mountain elevations, UNEVEN footprints (a sloped site
    // would get a visible wedge cut by the flat zone), and wet spots (a
    // river channel under the strip).
    const MOUNTAIN_HEIGHT_LIMIT = 55;  // below MOUNTAIN_BASE_RISE — real ranges only
    const MAX_FOOTPRINT_SPREAD = 16;   // max height range across the strip (m)
    const probes = [
      [airportX, airportZ],
      [airportX + RUNWAY_LENGTH / 2, airportZ],
      [airportX - RUNWAY_LENGTH / 2, airportZ],
      [airportX, airportZ + 60],
      [airportX, airportZ - 60],
    ];
    let hLo = Infinity, hHi = -Infinity;
    for (const [sx, sz] of probes) {
      const h = landElevation(sx, sz);
      if (h > MOUNTAIN_HEIGHT_LIMIT || h < WATER_LEVEL + 1) return null;
      if (h < hLo) hLo = h;
      if (h > hHi) hHi = h;
    }
    if (hHi - hLo > MAX_FOOTPRINT_SPREAD) return null;
    // Reject if the runway flat zone (+margin) would touch the sea or a river
    // — a coastal/riverside airport otherwise raises a flat platform poking
    // out of the water.
    const afx = Math.cos(angle), afz = Math.sin(angle);
    const apx = -Math.sin(angle), apz = Math.cos(angle);
    const ahl = RUNWAY_LENGTH / 2 + RUNWAY_MARGIN + 40;
    const ahw = RUNWAY_WIDTH / 2 + RUNWAY_MARGIN + 40;
    for (const la of [-ahl, 0, ahl]) {
      for (const pw of [-ahw, 0, ahw]) {
        const cx = airportX + afx * la + apx * pw;
        const cz = airportZ + afz * la + apz * pw;
        if (seaMaskAt(cx, cz) >= SEA_THRESHOLD_LOW) return null;
        if (landElevation(cx, cz) < WATER_LEVEL + 1) return null;
      }
    }
  }

  // Home is always medium so spawn area feels consistent.
  const sizeName = isHome ? 'medium' : pickSize(prng);
  const size = VILLAGE_SIZES[sizeName];

  // Also reject if the ring of surrounding terrain (where houses and the
  // approach road would go) is mostly under sea. This catches villages that
  // land on a tiny coastal spit.
  if (!isHome) {
    let waterHits = 0;
    const samples = 8;
    const ringR = Math.max(size.halfL, size.halfW, perpOffsetFor(size) + 40);
    for (let k = 0; k < samples; k++) {
      const a = (k / samples) * Math.PI * 2;
      const sx = airportX + Math.cos(a) * ringR;
      const sz = airportZ + Math.sin(a) * ringR;
      if (seaMaskAt(sx, sz) >= SEA_THRESHOLD_LOW) waterHits++;
      else if (landElevation(sx, sz) < WATER_LEVEL + 1) waterHits++; // river channel
    }
    // Mostly-wet surroundings = a spit/islet — reject. (The precise "no house
    // in water" guarantee is the village-rect check further down; requiring a
    // fully dry ring here culled ~90% of all villages.)
    if (waterHits >= samples / 2) return null;
  }

  const fx = Math.cos(angle);
  const fz = Math.sin(angle);
  const px = -Math.sin(angle);
  const pz = Math.cos(angle);
  const sideSign = prng() < 0.5 ? 1 : -1;
  const perpOffset = perpOffsetFor(size);

  const villageCx = airportX + px * sideSign * perpOffset;
  const villageCz = airportZ + pz * sideSign * perpOffset;

  // The settlement rect itself must be fully dry — corners + center checked
  // against both the sea mask and river channels (landElevation below water).
  // This is the precise guard against half-submerged / floating houses.
  if (!isHome) {
    const m = 10; // small margin beyond the rect edge
    for (const [la, pw] of [[0, 0],
      [size.halfL + m, size.halfW + m], [size.halfL + m, -size.halfW - m],
      [-size.halfL - m, size.halfW + m], [-size.halfL - m, -size.halfW - m]]) {
      const sx = villageCx + fx * la + px * pw;
      const sz = villageCz + fz * la + pz * pw;
      if (seaMaskAt(sx, sz) >= SEA_THRESHOLD_LOW) return null;
      if (landElevation(sx, sz) < WATER_LEVEL + 1) return null;
    }
  }

  const houseCount =
    size.housesMin +
    Math.floor(prng() * (size.housesMax - size.housesMin + 1));

  // Parallel main streets. Offsets centered on the village.
  const streetOffsets = computeStreetOffsets(size.streets);
  const spacing = size.spacing;

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
    const rowStart = -((rowLen - 1) * spacing) / 2;
    for (let i = 0; i < n; i++) {
      const slot = Math.floor(i / 2);
      const sideOfStreet = i % 2 === 0 ? -1 : 1;
      const along = rowStart + slot * spacing;
      const offsetFromStreet = sideOfStreet * VILLAGE_STREET_SIDE_OFFSET;
      const totalPerp = streetOffset + offsetFromStreet;
      const hx = villageCx + fx * along + px * sideSign * totalPerp;
      const hz = villageCz + fz * along + pz * sideSign * totalPerp;
      const K = sideSign * sideOfStreet;
      const rot = Math.atan2(px * K, pz * K);

      // Variant pick — biased by size tier. Streets closer to the center bias
      // toward apartments (where applicable) to form a city core.
      const centerIdx = (streetOffsets.length - 1) / 2;
      const centerness = 1 - Math.abs(si - centerIdx) / Math.max(1, centerIdx);
      const apartmentProb = size.apartmentChance * (0.4 + 0.6 * centerness);
      let variant;
      const r = prng();
      if (r < apartmentProb) variant = 3;
      else if (r < apartmentProb + size.tallChance) variant = 2;
      else if (r < apartmentProb + size.tallChance + 0.45) variant = 0;
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
      (rowLen - 1) * spacing * 0.5 + 14,
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
  // Cross-links between streets. One through the middle spans all of them,
  // and cities also get a second cross-link offset along the runway direction.
  if (streetOffsets.length >= 2) {
    const a = streetOffsets[0];
    const b = streetOffsets[streetOffsets.length - 1];
    roads.push({
      x1: villageCx + px * sideSign * a,
      z1: villageCz + pz * sideSign * a,
      x2: villageCx + px * sideSign * b,
      z2: villageCz + pz * sideSign * b,
    });
    if (streetOffsets.length >= 3) {
      const along = spacing * 3;
      for (const sign of [-1, 1]) {
        roads.push({
          x1: villageCx + fx * sign * along + px * sideSign * a,
          z1: villageCz + fz * sign * along + pz * sideSign * a,
          x2: villageCx + fx * sign * along + px * sideSign * b,
          z2: villageCz + fz * sign * along + pz * sideSign * b,
        });
      }
    }
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

  // Pad height: the airport's flat zone levels terrain to the LOCAL natural
  // height at its center (a plateau flush with the surroundings), not to 0 —
  // otherwise an airport on an upland carves a deep pit and the runway ends up
  // "under a hill". Clamped above water so a coastal pad never sinks.
  const padY = Math.max(WATER_LEVEL + 2, landElevation(airportX, airportZ));

  return {
    gcx,
    gcz,
    airportX,
    airportZ,
    angle,
    sizeName,
    sideSign,
    perpOffset,
    padY,
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
    const prng = alea(seedKey(`village-skip:${gcx}:${gcz}`));
    if (prng() < VILLAGE_CHANCE) {
      v = buildVillage(gcx, gcz, false);
    }
  }
  villageCache.set(key, v);
  return v;
}

// Flat-factor around a village:
//   - Airport rect uses the full RUNWAY_BLEND (300 m) so pilots see a
//     gentle smooth horizon approaching the strip.
//   - Village rect uses the much tighter VILLAGE_BLEND (80 m) — just
//     enough to put a flat pad under the houses and roads without
//     chewing the bases of mountains within hundreds of metres of the
//     settlement. Using the same 300 m blend on both rectangles was
//     what sliced visible "walls" off nearby hills: the village rect
//     alone extended flat zone 300–400 m past the village footprint.
export function airportFlatFactorFor(x, z, v) {
  const airportHalfL = RUNWAY_LENGTH / 2 + RUNWAY_MARGIN;
  const airportHalfW = RUNWAY_WIDTH / 2 + RUNWAY_MARGIN;
  const fA = rectFlatFactor(x, z, v.airportX, v.airportZ, v.angle, airportHalfL, airportHalfW, RUNWAY_BLEND);
  if (fA === 0) return 0;
  const r = v.villageRect;
  const fV = rectFlatFactor(x, z, r.cx, r.cz, r.angle, r.halfL, r.halfW, VILLAGE_BLEND);
  return Math.min(fA, fV);
}

// The pad height of the village that produced the last flat-factor result.
// Read immediately after villageFlatFactor / villageFlatFactorFromList (single
// thread, so this scratch is safe and avoids per-call allocation).
let _flatPadY = 0;
export function lastFlatPadY() { return _flatPadY; }

export function villageFlatFactor(x, z) {
  const pcx = Math.floor(x / VILLAGE_CELL_SIZE);
  const pcz = Math.floor(z / VILLAGE_CELL_SIZE);
  let minF = 1;
  let padY = 0;
  for (let dcx = -1; dcx <= 1; dcx++) {
    for (let dcz = -1; dcz <= 1; dcz++) {
      const v = getVillage(pcx + dcx, pcz + dcz);
      if (!v) continue;
      const f = airportFlatFactorFor(x, z, v);
      if (f < minF) { minF = f; padY = v.padY || 0; }
      if (minF === 0) { _flatPadY = v.padY || 0; return 0; }
    }
  }
  _flatPadY = padY;
  return minF;
}

// Hot path for terrain chunk builds: given a chunk's world rect, return the
// short list of villages whose influence actually reaches it. Usually 0
// entries (no village near), occasionally 1–2. Per-vertex flat-factor can
// then iterate only those villages instead of doing a full 3×3 cell lookup
// 1089 times per chunk.
export function villagesAffectingArea(minX, maxX, minZ, maxZ) {
  // Smoothstep blend of RUNWAY_BLEND extends the influence past the runway
  // rect, so include a full blend margin.
  const pcxMin = Math.floor((minX - RUNWAY_BLEND) / VILLAGE_CELL_SIZE);
  const pcxMax = Math.floor((maxX + RUNWAY_BLEND) / VILLAGE_CELL_SIZE);
  const pczMin = Math.floor((minZ - RUNWAY_BLEND) / VILLAGE_CELL_SIZE);
  const pczMax = Math.floor((maxZ + RUNWAY_BLEND) / VILLAGE_CELL_SIZE);
  const out = [];
  for (let gcx = pcxMin; gcx <= pcxMax; gcx++) {
    for (let gcz = pczMin; gcz <= pczMax; gcz++) {
      const v = getVillage(gcx, gcz);
      if (!v) continue;
      // Conservative reject — covers BOTH the airport rect AND the village
      // rect (which can be offset from the airport by tens to hundreds of
      // meters AND rotated by an arbitrary angle). Previous version used
      // the per-axis max of airport/village halves as an AABB centered on
      // the airport, ignoring the village's offset and rotation. Two
      // adjacent chunks could then disagree on whether a village affects
      // them, leaving a vertical seam where one chunk had the flat-factor
      // ramp and its neighbour didn't — the "wall at the runway" bug.
      //
      // Worst-case radius from the airport center: airport's own diagonal,
      // OR village offset + village diagonal (both half-dims rotated).
      // Add RUNWAY_BLEND on top (the smoothstep influence radius). Using
      // this as an AABB half-size centered on the airport is slightly
      // generous — a few extra chunks get the village in their list —
      // but is always safe against seams.
      const airportHalfL = RUNWAY_LENGTH / 2 + RUNWAY_MARGIN;
      const airportHalfW = RUNWAY_WIDTH / 2 + RUNWAY_MARGIN;
      const airportDiag = Math.hypot(airportHalfL, airportHalfW);
      const vr = v.villageRect;
      const offset = Math.hypot(vr.cx - v.airportX, vr.cz - v.airportZ);
      const villageDiag = Math.hypot(vr.halfL, vr.halfW);
      const reach = Math.max(airportDiag, offset + villageDiag) + RUNWAY_BLEND;
      if (v.airportX + reach < minX || v.airportX - reach > maxX) continue;
      if (v.airportZ + reach < minZ || v.airportZ - reach > maxZ) continue;
      out.push(v);
    }
  }
  return out;
}

// Flat factor using a precomputed village list — same math, zero cell
// lookups per call. Typical chunks pass an empty list and this returns 1
// immediately.
export function villageFlatFactorFromList(x, z, villages) {
  if (villages.length === 0) { _flatPadY = 0; return 1; }
  let minF = 1;
  let padY = 0;
  for (let i = 0; i < villages.length; i++) {
    const v = villages[i];
    const f = airportFlatFactorFor(x, z, v);
    if (f < minF) { minF = f; padY = v.padY || 0; }
    if (minF === 0) { _flatPadY = v.padY || 0; return 0; }
  }
  _flatPadY = padY;
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
    (v.padY || 0) + PLANE_BOTTOM_OFFSET,
    v.airportZ + dirZ * offset
  );
  const yaw = -Math.PI / 2 - v.angle;
  const quaternion = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    yaw
  );
  return { position, quaternion };
}
