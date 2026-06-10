// Realistic terrain shape + climate biomes. Pure-JS, three-free, deterministic
// — shared bit-for-bit by the main thread and the chunk worker. NO Math.random
// / Date usage; every field is seeded simplex so the same (x,z) always yields
// the same land.
//
// Design (see config.js "Terrain shape"):
//   landElevation(x,z)  — natural land surface (pre village/sea), built from
//                         domain-warped coords + continental swell + ridged
//                         mountains gated by a mountain mask + gentle plains.
//   biomeAt(x,z)        — climate biome (elevation × temperature × moisture)
//                         returning {type, trees, rocks} for scatter/minimap.
//   surfaceColor(...)   — per-vertex ground color: biome palette + beaches +
//                         snow line + rock strata on steep slopes.
//
// The old "uniform noise × biome.amp + biome.offset" model produced terrain
// that was hilly and identical everywhere because a biome only *scaled* one
// shared noise field. Here each landform class has a genuinely different shape.

import { createNoise2D } from 'simplex-noise';
import alea from 'alea';
import {
  TERRAIN_WARP_SCALE,
  TERRAIN_WARP_AMP,
  CONTINENT_SCALE,
  UPLAND_HEIGHT,
  MOUNTAIN_MASK_SCALE,
  MOUNTAIN_MASK_LOW,
  MOUNTAIN_MASK_HIGH,
  MOUNTAIN_BASE_RISE,
  MOUNTAIN_HEIGHT,
  RIDGE_SCALE,
  RIDGE_OCTAVES,
  RIDGE_LACUNARITY,
  RIDGE_GAIN,
  RIDGE_EXP,
  RIDGE_DOME_MIX,
  PLAINS_SCALE,
  PLAINS_OCTAVES,
  PLAINS_AMP,
  FOOTHILL_AMP,
  SPAWN_FLAT_RADIUS,
  SPAWN_FLAT_BLEND,
  CLIMATE_SCALE,
  CLIMATE_WARP,
  RIVER_SCALE,
  RIVER_WIDTH_N,
  RIVER_STEP,
  RIVER_LOCAL_DROP,
  RIVER_BED_DEPTH,
  RIVER_MEADOW_RISE,
  RIVER_RELIEF_LO,
  RIVER_RELIEF_HI,
  RIVER_VALLEY_MULT,
  RIVER_CHANNEL_MULT,
  RIVER_BANK_LOW,
  RIVER_BANK_HIGH,
  SNOW_LINE,
  SNOW_LINE_VARIATION,
  SNOW_SCALE,
  BEACH_HEIGHT,
  ALPINE_ELEV,
  HIGHLAND_ELEV,
  BIOME_DEFS,
  WATER_LEVEL,
  SLOPE_ROCK_THRESHOLD,
} from '../config.js';
import { profiler } from '../debug/Profiler.js';
import { seedKey } from './WorldSeed.js';
import { seaMaskAt } from './SeaMask.js';
import { SEA_THRESHOLD_LOW } from '../config.js';

// Distinct seeds → independent fields. Derived from the current world seed via
// seedKey() so reseedTerrain() can rebuild them for a new world. Same seed on
// every thread → identical terrain (the worker calls reseedTerrain() when the
// build message carries a new seed).
let warpA, warpB, contNoise, mtnMaskNoise, ridgeNoise, plainsNoise,
  foothillNoise, tempNoise, moistNoise, snowNoise, riverNoise;
function buildNoise() {
  warpA = createNoise2D(alea(seedKey('ts-warp-a')));
  warpB = createNoise2D(alea(seedKey('ts-warp-b')));
  contNoise = createNoise2D(alea(seedKey('ts-continent')));
  mtnMaskNoise = createNoise2D(alea(seedKey('ts-mtn-mask')));
  ridgeNoise = createNoise2D(alea(seedKey('ts-ridge')));
  plainsNoise = createNoise2D(alea(seedKey('ts-plains')));
  foothillNoise = createNoise2D(alea(seedKey('ts-foothill')));
  tempNoise = createNoise2D(alea(seedKey('ts-temp')));
  moistNoise = createNoise2D(alea(seedKey('ts-moist')));
  snowNoise = createNoise2D(alea(seedKey('ts-snow')));
  riverNoise = createNoise2D(alea(seedKey('ts-river')));
}
buildNoise();
// Rebuild all fields for the current world seed (call after setWorldSeed).
export function reseedTerrain() { buildNoise(); }

function smoothstep(edge0, edge1, x) {
  if (x <= edge0) return 0;
  if (x >= edge1) return 1;
  const t = (x - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
}
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function mix(a, b, t) {
  return a + (b - a) * t;
}

// Standard fractal-Brownian noise in roughly [-1, 1]. octaves must be >= 1.
function fbm(noise, x, z, octaves, scale) {
  if (octaves < 1) return 0;
  let amp = 1;
  let freq = scale;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq, z * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// Ridged multifractal in [0, 1]. Each octave is 1 - |noise|, squared and
// weighted by the previous octave so detail collects on ridgelines — the
// classic recipe for sharp mountain crests instead of round bumps.
function ridged(x, z, octaves, scale, lacunarity, gain) {
  if (octaves < 1) return 0;
  let amp = 0.5;
  let freq = scale;
  let sum = 0;
  let prev = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(ridgeNoise(x * freq, z * freq));
    n = n * n;
    n *= prev;
    prev = n;
    sum += n * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// Domain warp: displace sample coords by a low-frequency vector field so
// ranges/coastlines meander naturally instead of sitting on noise-grid lines.
function warp(x, z) {
  const wx = x + warpA(x * TERRAIN_WARP_SCALE, z * TERRAIN_WARP_SCALE) * TERRAIN_WARP_AMP;
  const wz = z + warpB(x * TERRAIN_WARP_SCALE, z * TERRAIN_WARP_SCALE) * TERRAIN_WARP_AMP;
  return [wx, wz];
}

// 0 at the world origin, ramping to 1 past SPAWN_FLAT_RADIUS. Used to flatten
// (and dry out, in the height/sea code) the home region so the starting
// airport always has level, dry ground regardless of seed — no spawning on a
// hillside or a coastal platform.
export function spawnFlat01(x, z) {
  const d = Math.sqrt(x * x + z * z);
  return smoothstep(SPAWN_FLAT_RADIUS, SPAWN_FLAT_RADIUS + SPAWN_FLAT_BLEND, d);
}

// How "mountainous" a spot is, 0..1, after the mask threshold + spawn
// suppression. Shared by landElevation and the biome elevation proxy so they
// agree on where ranges are.
function mountainAmount(wx, wz, x, z) {
  const mask = mtnMaskNoise(wx * MOUNTAIN_MASK_SCALE, wz * MOUNTAIN_MASK_SCALE) * 0.5 + 0.5;
  const amt = smoothstep(MOUNTAIN_MASK_LOW, MOUNTAIN_MASK_HIGH, mask);
  return amt * spawnFlat01(x, z);
}

// Broad continental swell (uplands/plateaus), 0..UPLAND_HEIGHT-ish.
function continentSwell(wx, wz) {
  const cv = fbm(contNoise, wx, wz, 3, CONTINENT_SCALE); // -1..1
  return smoothstep(0.05, 0.85, cv * 0.5 + 0.5) * UPLAND_HEIGHT;
}

// Full natural land elevation (meters), before village flatten / sea carve.
export function landElevation(x, z) {
  if (profiler.enabled) profiler.counters.heightAt++;
  const [wx, wz] = warp(x, z);
  const sf = spawnFlat01(x, z); // 0 at origin → 1 far; flattens the home area

  // Gentle undulation everywhere — this is what genuine flat plains look like.
  // Damped near origin so the spawn clearing is genuinely level.
  const plains = fbm(plainsNoise, wx, wz, PLAINS_OCTAVES, PLAINS_SCALE) * PLAINS_AMP * (0.2 + 0.8 * sf);

  // Broad highland swells — suppressed near origin so spawn isn't on an upland.
  const upland = continentSwell(wx, wz) * sf;

  // Mountains: ridged crests sitting on a lifted massif, gated by the mask.
  const mtn = mountainAmount(wx, wz, x, z);
  let h = plains + upland;
  if (mtn > 0.001) {
    // Foothills roll up as we approach a range; full ridges inside it.
    const foothill = (foothillNoise(wx * RIDGE_SCALE * 0.5, wz * RIDGE_SCALE * 0.5) * 0.5 + 0.5) * FOOTHILL_AMP;
    let ridge = ridged(wx, wz, RIDGE_OCTAVES, RIDGE_SCALE, RIDGE_LACUNARITY, RIDGE_GAIN);
    ridge = Math.pow(ridge, RIDGE_EXP);
    // Blend the sharp ridges with a smooth low-frequency dome so peaks are
    // broad massifs with rounded shoulders, not thin needles.
    const dome = foothillNoise(wx * RIDGE_SCALE * 0.35 + 50, wz * RIDGE_SCALE * 0.35 - 50) * 0.5 + 0.5;
    const relief = ridge * (1 - RIDGE_DOME_MIX) + dome * RIDGE_DOME_MIX;
    const massif = MOUNTAIN_BASE_RISE + relief * MOUNTAIN_HEIGHT;
    h += mtn * (foothill * 0.55 + massif);
  }

  // Anti-fake-pond floor: stray land dips below the waterline are softly
  // compressed back up so random terrain noise never reads as ponds. This
  // MUST run before the river carve — it used to live in the height
  // functions AFTER it, which clamped riverbeds back above the water and
  // left every river channel dry.
  const LAND_FLOOR = WATER_LEVEL + 2;
  if (h < LAND_FLOOR) {
    h = LAND_FLOOR - 3 * (1 - Math.exp((h - LAND_FLOOR) / 20));
  }

  // Rivers — carve a winding channel below the water line wherever the river
  // field crosses zero. Faded out on rising ground (rivers stay in lowlands,
  // no canyons through ranges), near the origin (dry spawn clearing), and as
  // the sea begins (no river grooves etched into the ocean floor — the
  // channel hands over to the sea carve at the coast).
  // Because the carve lives inside landElevation, physics, the chunk worker,
  // scatter and village placement all see identical riverbeds.
  const rn = Math.abs(riverNoise(wx * RIVER_SCALE, wz * RIVER_SCALE));
  const valleyW = RIVER_WIDTH_N * RIVER_VALLEY_MULT;
  if (rn < valleyW) {
    // The river's LOCAL water level: the smooth continental base, quantized
    // to RIVER_STEP pools (so the water is always level, stepping down in
    // discrete reaches as the land descends — never a sloped water surface).
    const lw = riverLocalWater(wx, wz, x, z);
    const meadow = lw + RIVER_MEADOW_RISE;
    const bed = lw - RIVER_BED_DEPTH;
    // Fade where the land towers over the would-be water (ridges/foothills),
    // near the origin clearing, and as the sea takes over at the coast.
    const relief = 1 - smoothstep(RIVER_RELIEF_LO, RIVER_RELIEF_HI, h - meadow);
    const seaHandoff = 1 - smoothstep(SEA_THRESHOLD_LOW - 0.06, SEA_THRESHOLD_LOW, seaMaskAt(x, z));
    const fades = relief * sf * seaHandoff;
    if (fades > 0.001) {
      // 1) Valley: ease the land down to low meadows just above the water,
      //    over a wide gentle slope (this is what makes it read as a river
      //    valley instead of a slot canyon).
      const mv = 1 - smoothstep(0, valleyW, rn);
      if (h > meadow) {
        h = mix(h, meadow, smoothstep(0.12, 0.85, mv) * fades);
      }
      // 2) Channel: a U-shaped waterway dipping below the local waterline —
      //    full depth across most of its width so the water surface is wide.
      const mc = 1 - smoothstep(0, RIVER_WIDTH_N * RIVER_CHANNEL_MULT, rn);
      const u = smoothstep(RIVER_BANK_LOW, RIVER_BANK_HIGH, mc);
      if (u > 0.001) h = mix(h, bed, u * fades);
    }
  }
  return h;
}

// The local river water level at warped/world coords: smooth continental base
// (damped near origin like the carve), dropped a little and quantized to
// RIVER_STEP pools; never below the global sea level.
function riverLocalWater(wx, wz, x, z) {
  const base = continentSwell(wx, wz) * spawnFlat01(x, z);
  return Math.max(WATER_LEVEL, Math.round((base - RIVER_LOCAL_DROP) / RIVER_STEP) * RIVER_STEP);
}

// Public: the river water level at (x, z), or null when outside a channel.
// Callers decide "is there actually water" by comparing against the terrain
// height (water exists where ground < level). Used by the per-chunk water
// surface, physics floor, bridges, scatter and village siting.
export function riverWaterLevelAt(x, z) {
  const [wx, wz] = warp(x, z);
  const rn = Math.abs(riverNoise(wx * RIVER_SCALE, wz * RIVER_SCALE));
  if (rn >= RIVER_WIDTH_N * RIVER_CHANNEL_MULT) return null;
  return riverLocalWater(wx, wz, x, z);
}

// Cheap river test for the minimap (mask only — skips the lowland fade, so a
// faded-out mountain "river" can show a stray blue pixel; acceptable at 22 m
// per pixel). Uses the same warped coordinates as the real carve.
export function riverMaskAt(x, z) {
  const [wx, wz] = warp(x, z);
  const rn = Math.abs(riverNoise(wx * RIVER_SCALE, wz * RIVER_SCALE));
  if (rn >= RIVER_WIDTH_N) return 0;
  return (1 - smoothstep(0, RIVER_WIDTH_N, rn)) * spawnFlat01(x, z);
}

// --- Climate -------------------------------------------------------------
// Two warped low-frequency fields. Returned values are 0..1.
function climateAt(x, z) {
  const cx = x + warpA(x * CLIMATE_WARP, z * CLIMATE_WARP) * 600;
  const cz = z + warpB(x * CLIMATE_WARP, z * CLIMATE_WARP) * 600;
  const temp = tempNoise(cx * CLIMATE_SCALE, cz * CLIMATE_SCALE) * 0.5 + 0.5;
  const moist = moistNoise(cx * CLIMATE_SCALE + 1000, cz * CLIMATE_SCALE - 1000) * 0.5 + 0.5;
  return { temp, moist };
}

// Cheap elevation proxy for biome decisions (continent swell + mountain rise),
// without the full ridged detail — keeps biomeAt light for the ~700 calls/chunk
// the scatter pass makes.
function elevProxy(x, z) {
  const [wx, wz] = warp(x, z);
  const upland = continentSwell(wx, wz);
  const mtn = mountainAmount(wx, wz, x, z);
  return upland + mtn * (MOUNTAIN_BASE_RISE + 0.45 * MOUNTAIN_HEIGHT);
}

// Pick the biome type from climate + elevation.
function biomeType(temp, moist, elev) {
  if (elev > ALPINE_ELEV) return 'alpine';
  if (elev > HIGHLAND_ELEV) {
    // High but not peak: taiga where it's not too warm, otherwise it still
    // reads as the surrounding lowland type so transitions are smooth.
    if (temp < 0.55) return moist > 0.4 ? 'taiga' : 'tundra';
  }
  if (temp < 0.32) return moist > 0.45 ? 'taiga' : 'tundra';
  if (temp > 0.64 && moist < 0.36) return 'desert';
  if (temp > 0.58 && moist < 0.52) return 'savanna';
  if (moist > 0.58) return 'forest';
  return 'plains';
}

// Public biome lookup. {type, trees, rocks} — trees/rocks are scatter density
// factors. Used by Scatter, Minimap, Villages, Ruins.
export function biomeAt(x, z) {
  if (profiler.enabled) profiler.counters.biomeAt++;
  const { temp, moist } = climateAt(x, z);
  const elev = elevProxy(x, z);
  const type = biomeType(temp, moist, elev);
  const def = BIOME_DEFS[type];
  return { type, trees: def.trees, rocks: def.rocks };
}

const _sand = [0.86, 0.79, 0.58];
// Rock strata by elevation — dark talus low, gray mid, pale bedrock high.
function rockColor(y, out) {
  if (y < 30) { out[0] = 0.36; out[1] = 0.31; out[2] = 0.27; }
  else if (y < 70) {
    const t = (y - 30) / 40;
    out[0] = mix(0.36, 0.50, t); out[1] = mix(0.31, 0.47, t); out[2] = mix(0.27, 0.44, t);
  } else {
    const t = clamp01((y - 70) / 60);
    out[0] = mix(0.50, 0.64, t); out[1] = mix(0.47, 0.62, t); out[2] = mix(0.44, 0.60, t);
  }
}

const _base = [0, 0, 0];
const _rock = [0, 0, 0];

// Per-vertex ground color. `y` is the actual surface elevation; `slopeNy` is
// the surface normal's Y component (1 = flat, →0 = vertical). Returns a REUSED
// module-level [r,g,b] array — callers must read the values immediately (the
// terrain color pass does), never store the reference for later.
export function surfaceColor(x, z, y, slopeNy) {
  const { temp, moist } = climateAt(x, z);
  const type = biomeType(temp, moist, y);
  const def = BIOME_DEFS[type];
  let r = def.color[0], g = def.color[1], b = def.color[2];

  // Moisture darkens/greens grassy biomes a touch for variety.
  if (type === 'plains' || type === 'savanna' || type === 'forest') {
    const m = (moist - 0.5) * 0.18;
    r -= m * 0.5; g += m * 0.2; b -= m * 0.3;
  }

  // Beach: shallow sandy band just above the waterline.
  const beachTop = WATER_LEVEL + BEACH_HEIGHT;
  if (y < beachTop && slopeNy > 0.86) {
    const t = clamp01((beachTop - y) / (BEACH_HEIGHT + 1.5));
    r = mix(r, _sand[0], t); g = mix(g, _sand[1], t); b = mix(b, _sand[2], t);
  }

  // Rock on steep slopes (strata-colored) — independent of biome. The blend
  // ramps UP as the slope steepens (slopeNy falls from the threshold toward
  // the threshold-minus-band), so t = 1 - smoothstep(low, high, slopeNy).
  if (slopeNy < SLOPE_ROCK_THRESHOLD && y > 0.5) {
    rockColor(y, _rock);
    const t = 1 - smoothstep(SLOPE_ROCK_THRESHOLD - 0.18, SLOPE_ROCK_THRESHOLD, slopeNy);
    r = mix(r, _rock[0], t); g = mix(g, _rock[1], t); b = mix(b, _rock[2], t);
  }

  // Snow above a wobbling, climate-dependent snow line. Cold biomes get a
  // lower line; steep faces shed snow (less coverage).
  let snowLine = SNOW_LINE + snowNoise(x * SNOW_SCALE, z * SNOW_SCALE) * SNOW_LINE_VARIATION;
  snowLine -= (1 - temp) * 45; // colder → snow starts lower
  if (type === 'alpine' || type === 'tundra' || type === 'taiga') snowLine -= 18;
  if (y > snowLine - 25) {
    let snow = smoothstep(snowLine - 25, snowLine + 12, y);
    snow *= clamp01((slopeNy - 0.45) / 0.4); // little snow on near-vertical rock
    if (snow > 0) {
      r = mix(r, 0.95, snow); g = mix(g, 0.96, snow); b = mix(b, 0.99, snow);
    }
  }

  _base[0] = r; _base[1] = g; _base[2] = b;
  return _base;
}
