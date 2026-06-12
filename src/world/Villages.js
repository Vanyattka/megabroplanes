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
  VILLAGE_STYLES,
  VILLAGE_BIOME_STYLE,
  VILLAGE_JITTER_ALONG,
  VILLAGE_JITTER_PERP,
  VILLAGE_JITTER_ROT,
  VILLAGE_L_SHAPE_CHANCE,
  VILLAGE_DORMER_CHANCE,
  VILLAGE_PLAZA_HALF,
  FARM_CHANCE,
  COASTAL_RING_PAD,
  COASTAL_SEAHITS_MIN,
  COASTAL_SEAHITS_MAX,
} from '../config.js';
import { seaMaskAt } from './SeaMask.js';
import { landElevation, riverWaterLevelAt, biomeAt } from './TerrainShape.js';
import { seedKey } from './WorldSeed.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Style key for a world position (biome → architectural style).
function styleAt(x, z) {
  return VILLAGE_BIOME_STYLE[biomeAt(x, z).type] || 'classic';
}

// Weighted roof-type pick for a house. Apartments (variant 3) are restricted
// to flat/mansard so they read urban; everyone else uses the style's weights.
function pickRoof(styleKey, variant, prng) {
  if (variant === 3) return 'flat'; // apartments read urban with a flat roof
  const w = (VILLAGE_STYLES[styleKey] || VILLAGE_STYLES.classic).roofWeights;
  const keys = Object.keys(w);
  const r = prng();
  let acc = 0;
  for (const k of keys) { acc += w[k]; if (r < acc) return k; }
  return keys[keys.length - 1];
}

// Place a landmark at rect-local (along, perp), clamped inside the rect minus
// its footprint radius so it always lands on the flat pad and off the runway.
function placeInRect(rect, along, perp, footR) {
  const a = clamp(along, -(rect.halfL - footR), rect.halfL - footR);
  const p = clamp(perp, -(rect.halfW - footR), rect.halfW - footR);
  const c = Math.cos(rect.angle), s = Math.sin(rect.angle);
  return { x: rect.cx + a * c - p * s, z: rect.cz + a * s + p * c };
}

// A point is "wet" if it's in the sea, below the global waterline, or under a
// river's LOCAL water level (rivers carry stepped pools above sea level).
function isWetAt(x, z) {
  if (seaMaskAt(x, z) >= SEA_THRESHOLD_LOW) return true;
  const h = landElevation(x, z);
  if (h < WATER_LEVEL + 1) return true;
  const rw = riverWaterLevelAt(x, z);
  return rw != null && h < rw + 1;
}

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
    // IMPORTANT: candidates must stay inside cell (0,0)'s GEOMETRIC bounds
    // ([0..1800]² — the origin is the cell's corner, not its centre). The
    // home village is cached under cell (0,0); when the search picked a spot
    // with negative coordinates, the airport physically sat in a NEIGHBOUR
    // cell, so the per-chunk village enumeration (villagesAffectingArea)
    // never found it — chunks rendered UNflattened terrain over the runway
    // while physics (3×3 cell scan around the query point) still saw the
    // pad: the "runway buried under a thin layer of earth" bug. Kept well
    // under SPAWN_FLAT_RADIUS so the strip stays in the level dry clearing.
    const candidates = [];
    for (let dx = 120; dx <= 680; dx += 140) {
      for (let dz = 120; dz <= 680; dz += 140) {
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
      if (h > MOUNTAIN_HEIGHT_LIMIT) return null;
      if (isWetAt(sx, sz)) return null;
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
        if (isWetAt(airportX + afx * la + apx * pw, airportZ + afz * la + apz * pw)) return null;
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
      if (isWetAt(sx, sz)) waterHits++;
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
      if (isWetAt(villageCx + fx * la + px * pw, villageCz + fz * la + pz * pw)) return null;
    }
  }

  const houseCount =
    size.housesMin +
    Math.floor(prng() * (size.housesMax - size.housesMin + 1));

  // Parallel main streets. Offsets centered on the village.
  const streetOffsets = computeStreetOffsets(size.streets);
  const spacing = size.spacing;
  // Central square (medium+): an open plaza at the village center that hosts
  // the centerpiece landmark. Houses landing inside it are skipped.
  const plazaHalf = VILLAGE_PLAZA_HALF[sizeName] || 0;

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
      // Jitter (3 draws, fixed order) breaks up the surveyed-rows look without
      // letting houses collide or leave the rect.
      const jAlong = (prng() * 2 - 1) * VILLAGE_JITTER_ALONG;
      const jPerp = (prng() * 2 - 1) * VILLAGE_JITTER_PERP;
      const jRot = (prng() * 2 - 1) * VILLAGE_JITTER_ROT;
      const along = rowStart + slot * spacing + jAlong;
      const offsetFromStreet = sideOfStreet * VILLAGE_STREET_SIDE_OFFSET;
      const totalPerp = streetOffset + offsetFromStreet + jPerp;
      const hx = villageCx + fx * along + px * sideSign * totalPerp;
      const hz = villageCz + fz * along + pz * sideSign * totalPerp;
      const K = sideSign * sideOfStreet;
      const rot = Math.atan2(px * K, pz * K) + jRot;

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

      // Style/roof/features (drawn in a fixed order so the village stays
      // deterministic). Style follows the LOCAL biome so transition towns mix.
      const styleKey = styleAt(hx, hz);
      const def = VILLAGE_STYLES[styleKey] || VILLAGE_STYLES.classic;
      const roof = pickRoof(styleKey, variant, prng);
      const lshape = variant === 1 && prng() < VILLAGE_L_SHAPE_CHANCE;
      const porch = (variant === 0 || variant === 1 || lshape) && prng() < def.porchChance;
      const dormer = (roof === 'gable' || roof === 'hip') && prng() < VILLAGE_DORMER_CHANCE;
      const chimney = (variant === 1 || variant === 2) && prng() < def.chimneyChance;
      const colorSeed = prng();

      // Keep the central square open.
      if (plazaHalf > 0) {
        const ddx = hx - villageCx, ddz = hz - villageCz;
        if (ddx * ddx + ddz * ddz < (plazaHalf + 5) * (plazaHalf + 5)) continue;
      }

      houses.push({ x: hx, z: hz, rot, variant, style: styleKey, roof, lshape, porch, dormer, chimney, colorSeed });
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

  const villageRect = { cx: villageCx, cz: villageCz, halfL: size.halfL, halfW: size.halfW, angle };

  // --- v0.5 content: biome flavour, coastal/farm flags, plaza, landmarks ---
  const biome = biomeAt(villageCx, villageCz).type;
  const style = VILLAGE_BIOME_STYLE[biome] || 'classic';

  // Coastal: count sea hits on a ring just past the settlement. A village
  // partly ringed by sea (not fully, not none) sits on a real coastline.
  let coastal = false;
  let seaDir = 0;
  {
    const ringR = perpOffset + size.halfL + COASTAL_RING_PAD;
    let hits = 0, sx = 0, sz = 0;
    const N = 12;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const dxs = Math.cos(a), dzs = Math.sin(a);
      if (seaMaskAt(airportX + dxs * ringR, airportZ + dzs * ringR) >= SEA_THRESHOLD_LOW) {
        hits++; sx += dxs; sz += dzs;
      }
    }
    if (hits >= COASTAL_SEAHITS_MIN && hits <= COASTAL_SEAHITS_MAX) {
      coastal = true;
      seaDir = Math.atan2(sz, sx);
    }
  }

  // Farm hamlet: a small/medium plains/savanna village, by a coin flip.
  const farm = !isHome && (sizeName === 'small' || sizeName === 'medium') &&
    (biome === 'plains' || biome === 'savanna') && prng() < FARM_CHANCE;

  const plaza = plazaHalf > 0 ? { x: villageCx, z: villageCz, half: plazaHalf } : null;

  // Landmarks — world coords, clamped inside the rect minus their footprint so
  // they always land on the flat pad and clear of the runway. One-off per
  // village; the mesh builder draws them from shared geoms (no instancing).
  const landmarks = [];
  const tierRank = { small: 0, medium: 1, large: 2, city: 3 }[sizeName];
  if (plaza) {
    landmarks.push({ kind: tierRank >= 2 ? 'fountain' : 'well', x: plaza.x, z: plaza.z, rot: angle });
  }
  if (tierRank >= 1) {
    const anchorKind = tierRank >= 2 ? 'townhall'
      : style === 'adobe' ? 'dome' : style === 'outpost' ? 'mast' : 'church';
    const p = placeInRect(villageRect, -size.halfL * 0.55, size.halfW * 0.45, 12);
    landmarks.push({ kind: anchorKind, x: p.x, z: p.z, rot: angle });
  }
  if (tierRank >= 2 || (tierRank === 1 && prng() < 0.5)) {
    const windmill = (biome === 'plains' || biome === 'savanna') && prng() < 0.5;
    const p = placeInRect(villageRect, size.halfL * 0.6, -size.halfW * 0.55, 8);
    landmarks.push({ kind: windmill ? 'windmill' : 'watertower', x: p.x, z: p.z, rot: angle });
  }
  if (farm) {
    const p = placeInRect(villageRect, size.halfL * 0.5, -size.halfW * 0.4, 12);
    landmarks.push({ kind: 'barn', x: p.x, z: p.z, rot: angle });
    const ns = 1 + Math.floor(prng() * 3);
    for (let s = 0; s < ns; s++) {
      const sp = placeInRect(villageRect, size.halfL * 0.5 + 9, -size.halfW * 0.4 + 6 + s * 5, 3);
      landmarks.push({ kind: 'silo', x: sp.x, z: sp.z, rot: angle });
    }
  }
  if (coastal) {
    // Lighthouse on the seaward edge of the pad (a beacon, not over water).
    const c = Math.cos(angle), s = Math.sin(angle);
    const sdx = Math.cos(seaDir), sdz = Math.sin(seaDir);
    const lAlong = sdx * c + sdz * s;     // seaward component along rect L
    const lPerp = -sdx * s + sdz * c;     // along rect W
    const p = placeInRect(villageRect, lAlong * size.halfL, lPerp * size.halfW, 6);
    landmarks.push({ kind: 'lighthouse', x: p.x, z: p.z, rot: seaDir });
  }

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
    villageRect,
    biome,
    style,
    coastal,
    seaDir,
    farm,
    plaza,
    landmarks,
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
