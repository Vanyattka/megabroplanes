// All tunable constants. No magic numbers in logic files.

// ---------------------------------------------------------------------------
// Version + release notes (main menu → RELEASE NOTES).
// Scheme: v0.x while pre-1.0 (pre-release). Each release gets a NATO phonetic
// codename (Alpha, Bravo, Charlie, …) — fitting for an aviation game.
// On every update: bump GAME_VERSION/GAME_CODENAME and add a new entry to the
// TOP of CHANGELOG (newest first).
// ---------------------------------------------------------------------------
export const GAME_VERSION = '0.6.8';
export const GAME_CODENAME = 'Foxtrot';
export const GAME_CHANNEL = 'PRE-RELEASE';
export const CHANGELOG = [
  {
    version: '0.6.8',
    codename: 'Foxtrot',
    channel: 'PRE-RELEASE',
    date: '2026-06-14',
    notes: [
      'The chase camera no longer slips under the ground or water — when you try to look up from below, it now pulls in toward the plane and stays above the surface.',
    ],
  },
  {
    version: '0.6.7',
    codename: 'Foxtrot',
    channel: 'PRE-RELEASE',
    date: '2026-06-14',
    notes: [
      'The moon now lays a soft silver path across the water at night, just like the sun\'s golden one by day.',
    ],
  },
  {
    version: '0.6.6',
    codename: 'Foxtrot',
    channel: 'PRE-RELEASE',
    date: '2026-06-14',
    notes: [
      'Fixed: your water reflection now matches your landing gear — it used to always show the wheels down even with gear retracted.',
    ],
  },
  {
    version: '0.6.5',
    codename: 'Foxtrot',
    channel: 'PRE-RELEASE',
    date: '2026-06-14',
    notes: [
      'Fixed: a plane parked on a runway now casts a proper shadow onto the strip (the runway surface wasn\'t catching shadows before).',
    ],
  },
  {
    version: '0.6.4',
    codename: 'Foxtrot',
    channel: 'PRE-RELEASE',
    date: '2026-06-14',
    notes: [
      'Multiplayer no longer drops you mid-session: a heartbeat keeps your connection alive even when the tab is backgrounded (alt-tabbing for 20+ seconds used to kick you), and if the network does blip, a quick reconnect resumes the SAME race with your progress intact instead of dumping you to free flight as a new player. This was the cause of the random "frozen in the air / kicked to singleplayer / out of the lobby" hangs.',
    ],
  },
  {
    version: '0.6.3',
    codename: 'Foxtrot',
    channel: 'PRE-RELEASE',
    date: '2026-06-12',
    notes: [
      'Mobile racers get a proper FIRE button — a big red trigger appears next to the throttle during races, so phones shoot just like desktops (it was hidden inside the BRK button before; BRK is now brakes only).',
    ],
  },
  {
    version: '0.6.2',
    codename: 'Foxtrot',
    channel: 'PRE-RELEASE',
    date: '2026-06-12',
    notes: [
      'Race respawns are fair now: after a crash, shoot-down or R, you restart at the LAST ring you cleared (facing the next one) — respawning can no longer teleport you ahead and shortcut the course.',
      'After a race everyone lands back in a live lobby together — vote and launch the next race right away. Leaving the lobby properly returns you to free flight with the RACE LOBBY button intact (it used to strand you in a dead lobby with no way to race again).',
    ],
  },
  {
    version: '0.6.1',
    codename: 'Foxtrot',
    channel: 'PRE-RELEASE',
    date: '2026-06-12',
    notes: [
      'Photo mode keeps the Jet\'s engines burning — the exhaust plume and afterburner now stream from the nozzle while the world is frozen (they used to vanish the moment you pressed P).',
      'Water reflections are no longer a perfect mirror: they shimmer, drift and softly double like real wind-ruffled water.',
    ],
  },
  {
    version: '0.6',
    codename: 'Foxtrot',
    channel: 'PRE-RELEASE',
    date: '2026-06-12',
    notes: [
      'All three aircraft rebuilt in far more detail: the Cessna got its signature high wing on V-struts, the Piper a sleek low-wing airframe with a cabin stripe, and the Jet a pointed nose, bubble canopy, side intakes, swept wings and an engine nozzle.',
      'Retractable landing gear! Press G (or the new touch button) to raise/lower the wheels. Extended gear drags a little — clean up for top speed, drop it for landing. A HUD light shows DOWN / transit / UP, and other players see your gear too.',
      'Planes are alive in the air: ailerons deflect when you roll, the elevator and rudder move with your inputs, the propeller spins on its cone — and everything casts real sun shadows now.',
      'Better lighting: glossier paint with real sun highlights, glowing cockpit glass at night, and a red rotating beacon blinking opposite the white tail strobe.',
      'The Jet\'s signature exhaust got an upgrade — a blazing afterburner cone ignites past ~65% throttle and stretches with thrust.',
    ],
  },
  {
    version: '0.5',
    codename: 'Echo',
    channel: 'PRE-RELEASE',
    date: '2026-06-12',
    notes: [
      'Villages & cities are far more varied and alive — no two settlements feel the same now.',
      'Real roofs! Houses get pitched (gabled), hipped, pyramid and flat roofs instead of identical boxes — and roofs in cold regions wear snow caps.',
      'Regional architecture: desert adobe, sun-bleached savanna, classic plains, timber forest & taiga log cabins, stone alpine chalets, and bleak tundra outposts — each with its own colours, roof styles and signature touches.',
      'Landmarks to spot from the air: churches & town halls, a fountain or well on the town square, water towers, windmills, desert domes, coastal lighthouses, and barns + silos on farm hamlets.',
      'Streets feel lived-in: yard trees & hedges, woodpiles, vegetable gardens, hay bales, benches — and street lamps that glow at night (windows light up at dusk too).',
      'Houses no longer stand in ruler-straight rows — they sit at natural angles, some L-shaped, some with porches, around an open central square in bigger towns.',
      'Fixes: village plane models near cities no longer cause a brief flicker; the porch awnings render at the right thickness.',
    ],
  },
  {
    version: '0.4.1',
    codename: 'Delta',
    channel: 'PRE-RELEASE',
    date: '2026-06-12',
    notes: [
      'Minimap now matches the world: fixed it drawing ocean where there\'s actually land (and other biome mismatches) — the map now reads the real terrain height instead of a rough sea estimate.',
      'You can set your name on the main menu — it shows up in the race lobby, leaderboard and results instead of "P3".',
      'In a race the control hint now reminds you that SPACE fires your guns and R respawns at your next gate (it used to only mention braking).',
    ],
  },
  {
    version: '0.4',
    codename: 'Delta',
    channel: 'PRE-RELEASE',
    date: '2026-06-12',
    notes: [
      'Race checkpoints now count reliably — a gate registers the instant you fly through it, even on a laggy connection or at high speed. No more "the ring didn\'t count" while racing a friend.',
      'Crashing into the ground mid-race now respawns you at your next gate (like being shot down) instead of leaving you stuck with no way back.',
      'Touch / mobile players can finally fire their guns in combat races.',
      'Race & lobby stability: you can no longer be yanked out of a running race, a forming lobby can\'t hijack a race already in progress, the host can reliably solo-start, and a dropped connection cleanly leaves the race instead of stranding you in a ghost course.',
      'The chase camera no longer swoops across the whole map when you respawn or reset — it snaps straight to the plane.',
      'Fixed a bug where flying near a city could corrupt aircraft models (your own, other players\', and the menu preview).',
      'Graphics-quality changes now correctly re-apply to the post-processing, so switching presets no longer leaves a blurry or mismatched image.',
      'World fixes: no more dry carved riverbeds near the spawn area, the minimap compass now points the right way on east/west headings, and smoother chunk streaming.',
    ],
  },
  {
    version: '0.3.4',
    codename: 'Charlie',
    channel: 'PRE-RELEASE',
    date: '2026-06-10',
    notes: [
      'Rivers are about half as frequent and ~2.5× wider, with longer lazier meanders. Bridges span the wider waterways.',
    ],
  },
  {
    version: '0.3.3',
    codename: 'Charlie',
    channel: 'PRE-RELEASE',
    date: '2026-06-10',
    notes: [
      'Bugfix: river pools no longer render as huge floating water sheets at river mouths or out over the open ocean — the local river water now fades out exactly where the sea takes over.',
    ],
  },
  {
    version: '0.3.2',
    codename: 'Charlie',
    channel: 'PRE-RELEASE',
    date: '2026-06-10',
    notes: [
      'Rivers now carry their own local water level: the water follows the land in stepped pools (a cascade of level reaches), so rivers high above sea level are no longer dry gullies. Water is rendered per pool; the plane lands on it, bridges clear it, and trees avoid it.',
    ],
  },
  {
    version: '0.3.1',
    codename: 'Charlie',
    channel: 'PRE-RELEASE',
    date: '2026-06-10',
    notes: [
      'Rivers are proper valleys now — a wide gentle depression with low meadows and a broad waterway, instead of a slot canyon with a creek at the bottom.',
      'Fixed the real cause of runways/roads "buried under earth": on some seeds the home airport settled outside its own grid cell, so terrain chunks never applied its flat pad while physics did. Verified flat on both build paths.',
      'Village dirt streets no longer sink underground on elevated village pads (they sat at a fixed world height).',
    ],
  },
  {
    version: '0.3',
    codename: 'Charlie',
    channel: 'PRE-RELEASE',
    date: '2026-06-10',
    notes: [
      'Rivers! Winding channels now carve through the lowlands (visible on the minimap too). Villages keep their distance from the banks.',
      'Bridges — when a road meets a river it crosses on a proper deck with piers; only genuinely wide water (lakes, sea) still blocks a road.',
      'Monumental ruins — mountain peaks now carry real castle ruins: crumbling ring walls with crenellated towers, a half-collapsed keep, a gatehouse and rubble, each stone grounded into the slope (nothing floats).',
      'Fixed runways and roads "buried under a thin layer of earth" (depth-buffer fighting at grazing angles).',
      'Fixed roads flickering in and out near clustered villages — roads now stream by your distance to them instead of being tied to faraway terrain chunks.',
    ],
  },
  {
    version: '0.2.3',
    codename: 'Bravo',
    channel: 'PRE-RELEASE',
    date: '2026-06-10',
    notes: [
      'Worldgen fixes: the home spawn is now always a flat, dry clearing (no spawning on a hillside, in a pit, or on a coastal platform — for any seed).',
      'Villages no longer generate on or over water — the whole settlement must sit on dry land (no half-submerged or floating houses).',
      'Roads now run alongside runways (to the apron) instead of crossing them.',
    ],
  },
  {
    version: '0.2.2',
    codename: 'Bravo',
    channel: 'PRE-RELEASE',
    date: '2026-06-10',
    notes: [
      'Bugfix: the home airport now picks the flattest nearby ground (not just the lowest), so a regenerated seed no longer spawns you on the slope/edge of a hill with the runway cutting into it.',
    ],
  },
  {
    version: '0.2.1',
    codename: 'Bravo',
    channel: 'PRE-RELEASE',
    date: '2026-06-09',
    notes: [
      'Bugfix: airports now level the ground to the local terrain height (a flush plateau) instead of carving down to zero — a regenerated seed no longer leaves the runway sunk in a pit "under a hill".',
    ],
  },
  {
    version: '0.2',
    codename: 'Bravo',
    channel: 'PRE-RELEASE',
    date: '2026-06-09',
    notes: [
      'Water reflections — the jet engine glow and the landing lamp now show in your reflection too (no more dark-engined reflection).',
      'Landing light (L) is much brighter on every aircraft.',
      'More tree species — conifer, broadleaf, birch, savanna acacia and arid shrub — spread across the biomes for a more varied world.',
      'Singleplayer: a REGENERATE SEED button (Settings) rebuilds the whole world from a new random seed. Multiplayer still shares one world.',
    ],
  },
  {
    version: '0.1',
    codename: 'Alpha',
    channel: 'PRE-RELEASE',
    date: '2026-06-09',
    notes: [
      'First public pre-release — expect rough edges, things will change.',
      'World — realistic procedural terrain: flat plains, ridged mountain ranges, and climate biomes (desert · savanna · plains · forest · taiga · tundra · alpine), with beaches, snow lines, oceans, villages, ruins and roads.',
      'Flight — three aircraft (Cessna · Piper · Jet) with arcade physics, chase + free-look camera, and a photo mode (P).',
      'Looks — day/night cycle with pink sunrises/sunsets, water with real plane reflections, clouds, god rays, bloom, a cinematic color grade and FXAA. Low / Medium / High presets.',
      'Multiplayer — fly together in free flight, or open the RACE LOBBY: vote the plane, time of day and flag count (8 / 16 / 32), then race an isolated checkpoint course.',
      'Combat races — SPACE fires your guns; every plane has a hull bar; shoot rivals down and respawn at your next gate.',
    ],
  },
];

// Timing
export const FIXED_STEP = 1 / 60;
// Cap on how much sim time a single frame can absorb. Previously 0.1s meant
// a 100 ms stall (GC, chunk build) let physics run 6 substeps and teleport
// the plane ~9 m — the camera couldn't keep up and visibly snapped. 50 ms
// is 3 substeps, barely perceptible.
export const MAX_FRAME_DT = 0.05;

// World
export const CHUNK_SIZE = 128;
export const CHUNK_RESOLUTION = 33;
export const VIEW_DISTANCE_CHUNKS = 4;
// Dynamic view scales with altitude — higher flights unlock bigger view.
// Actual values come from the current VIEW_DISTANCE_PRESET; these two
// constants stay as fallbacks for modules that import them directly.
export const VIEW_DISTANCE_MIN = 4;
export const VIEW_DISTANCE_MAX = 7;
export const VIEW_ALT_SCALE = 600;
// Menu-selectable chunk streaming distance, independent of graphics preset.
// Mins are now "generous" so even at ground level the horizon feels open;
// altitude stretches a bit further. Fog range in main.js scales with these
// so the terrain edge is always hidden exactly where fog ends.
// Each step roughly doubles the chunk count in the grid — and rendering
// cost scales nearly linearly with chunk count (even with frustum culling,
// the scene graph / shadow pass / GC all grow). The jump from max=13 to
// max=22 was too aggressive — it rendered 2000+ chunks without any LOD,
// halving FPS even on M3. These values keep draw distance generous while
// staying within GPU budget for a moderate-geometry Three.js scene.
export const VIEW_DISTANCE_PRESETS = {
  short:  { label: 'Short',      min: 4,  max: 6  },
  medium: { label: 'Medium',     min: 6,  max: 9  },
  high:   { label: 'High',       min: 8,  max: 11 },
  xhigh:  { label: 'Extra High', min: 10, max: 14 },
  ultra:  { label: 'Ultra',      min: 12, max: 17 },
};
export const DEFAULT_VIEW_PRESET = 'high';
export const NOISE_SCALE = 0.005;
export const HEIGHT_AMPLITUDE = 30;
export const NOISE_SEED = 'plane-mvp-seed';

// Runway
export const RUNWAY_LENGTH = 600;
export const RUNWAY_WIDTH = 30;
export const RUNWAY_MARGIN = 20;
// Distance beyond the flat zone over which terrain height ramps from 0 to
// full noise. Prevents a sudden wall of hills at the runway ends.
// Longer blend distance = gentler transition from flat runway to natural
// terrain. 150 m produced a near-vertical wall where mountains meet the
// flat zone (60 m height / 150 m horizontal = 22° slope). 300 m halves
// the slope and makes the transition look natural without extending the
// flat zone into territory you'd actually fly over.
export const RUNWAY_BLEND = 300;
// Village flatten uses a much tighter blend than the runway. The runway
// strip needs a long gentle ramp (300 m) so pilots can line up with the
// horizon, but the village pad is just wide enough for houses and roads
// to sit flat — 80 m blend keeps nearby mountains from losing their
// natural profile to the village footprint.
export const VILLAGE_BLEND = 80;
// Lift above the (perfectly coplanar) flat-zone terrain. Combined with a
// polygonOffset on the runway material — 0.02 alone was inside the depth
// buffer's error at grazing angles, so distant terrain z-fought over the
// strip and the runway looked "buried under a thin layer of earth".
export const RUNWAY_Y = 0.06;

// Villages — one village per grid cell. Size tiers vary house count, streets,
// and rect size so settlements range from hamlets to small towns.
export const VILLAGE_CELL_SIZE = 1800;          // meters per cell
export const VILLAGE_CHANCE = 0.75;             // probability of non-home cell having a village
// Village sits alongside the runway, not around it. Its flat zone touches the
// airport's so the connector road never leaves flat ground.
export const VILLAGE_PERP_OFFSET = 80;          // distance (m) from runway centerline to village center
export const VILLAGE_STREET_SIDE_OFFSET = 12;   // house row distance from street centerline
export const VILLAGE_HOUSE_SPACING = 14;        // distance between adjacent houses in the same row
export const VILLAGE_STREET_SEPARATION = 48;    // distance between the two parallel streets in a large village
export const VILLAGE_VIEW_CELLS = 1;            // cells around plane kept in scene
// Size tiers. `streets` = number of parallel main streets (1 or 2).
// `tallChance` = probability a house is a 2-story variant 2.
// `apartmentChance` = probability a slot is a 4-floor khrushchevka (variant 3).
// `spacing` = distance between adjacent houses along the same street.
export const VILLAGE_SIZES = {
  small:  { housesMin: 4,  housesMax: 6,  halfL: 55,  halfW: 32,  streets: 1, tallChance: 0.00, apartmentChance: 0.00, spacing: 14 },
  medium: { housesMin: 7,  housesMax: 12, halfL: 100, halfW: 45,  streets: 1, tallChance: 0.20, apartmentChance: 0.00, spacing: 14 },
  large:  { housesMin: 14, housesMax: 22, halfL: 130, halfW: 60,  streets: 2, tallChance: 0.40, apartmentChance: 0.00, spacing: 14 },
  city:   { housesMin: 28, housesMax: 48, halfL: 230, halfW: 140, streets: 4, tallChance: 0.25, apartmentChance: 0.35, spacing: 24 },
};
// Per-cell size distribution. Must sum to 1. Cities are rare landmarks.
export const VILLAGE_SIZE_WEIGHTS = { small: 0.28, medium: 0.47, large: 0.20, city: 0.05 };

// ---------------------------------------------------------------------------
// Village content (v0.5 "Echo") — variety + liveliness. Houses gain roof types
// + biome architectural styles; settlements gain jitter, central squares,
// landmarks/POIs and instanced street props. All of this is main-thread
// cosmetic content INSIDE the flat village pad — it never reaches the terrain
// worker (villageToWorkerData only carries the airport + rect), so it can't
// affect chunk seams or determinism beyond its own seeded streams.
// ---------------------------------------------------------------------------
// Roof geometry (unit roofs, scaled per house). Rises are fractions of the
// footprint scaled at build time.
export const ROOF_GABLE_RISE = 1.9;
export const ROOF_HIP_RISE = 1.6;
export const ROOF_PYRAMID_RISE = 2.6;
export const ROOF_MANSARD_RISE = 2.4;
export const ROOF_FLAT_RISE = 0.5;
export const ROOF_OVERHANG = 0.35;          // eaves spill this far past the walls (m)
export const ROOF_SNOW_COLOR = 0xeae8ea;    // pitched roofs above the snow line in cold styles
export const ROOF_SNOW_MARGIN = 40;         // padY > SNOW_LINE - this → snowy roof

// Biome architectural styles. Each: wall colors, roof-type weights, roof
// colors, porch/chimney chances, and the centerpiece landmark kind. Materials
// are built once from this table (like the legacy WALL_COLORS).
export const VILLAGE_STYLES = {
  adobe:    { walls: [0xd8c098, 0xcaa878, 0xc89a6a, 0xe0c9a0, 0xd2b48c],
              roofWeights: { flat: 0.7, pyramid: 0.2, hip: 0.1 },
              roofColors: [0xeee8dc, 0xd8c8a8, 0xcaa878], porchChance: 0.10, chimneyChance: 0.0, landmark: 'dome' },
  colonial: { walls: [0xe8e0d0, 0xd2c093, 0xd8b28a, 0xe0d4b8],
              roofWeights: { hip: 0.5, gable: 0.3, flat: 0.2 },
              roofColors: [0x8a3320, 0x884a2b, 0x7a4a30], porchChance: 0.55, chimneyChance: 0.30, landmark: 'church' },
  classic:  { walls: [0xeadfc6, 0xe8c8d2, 0xc4d4e8, 0xd4e4b8, 0xe8e0d0, 0xd8c8b0],
              roofWeights: { gable: 0.6, hip: 0.25, flat: 0.15 },
              roofColors: [0x8a3320, 0x6b3a3a, 0x3a4f5c, 0x6a4b3a], porchChance: 0.30, chimneyChance: 0.50, landmark: 'church' },
  cabin:    { walls: [0x6b4a2a, 0x7a5a30, 0x8a6a40, 0x9a7a50, 0x6b6a4a],
              roofWeights: { gable: 0.7, hip: 0.2, flat: 0.1 },
              roofColors: [0x3a4f3a, 0x2f3a30, 0x4a3a30], porchChance: 0.40, chimneyChance: 0.70, landmark: 'church' },
  logSteep: { walls: [0x5a4530, 0x6b4a2a, 0x4a3a2a, 0x7a5a3a],
              roofWeights: { gable: 0.6, hip: 0.2, pyramid: 0.2 },
              roofColors: [0x3a3030, 0x2a2422, 0x3a4040], porchChance: 0.20, chimneyChance: 0.70, landmark: 'church' },
  outpost:  { walls: [0x8a8a7a, 0x9a9488, 0x7a7468, 0xa0a090],
              roofWeights: { gable: 0.4, flat: 0.4, hip: 0.2 },
              roofColors: [0x3a4048, 0x4a4a44, 0x2a3038], porchChance: 0.10, chimneyChance: 0.50, landmark: 'mast' },
  chalet:   { walls: [0xb8b0a4, 0xd8c8a8, 0xc8b89a, 0xa8a090],
              roofWeights: { gable: 0.7, hip: 0.3 },
              roofColors: [0x4a3a30, 0x3a3030, 0x5a4838], porchChance: 0.30, chimneyChance: 0.60, landmark: 'church' },
};
export const VILLAGE_BIOME_STYLE = {
  desert: 'adobe', savanna: 'colonial', plains: 'classic',
  forest: 'cabin', taiga: 'logSteep', tundra: 'outpost', alpine: 'chalet',
};

// Layout variety. Jitter de-rigidifies the surveyed rows; the plaza opens a
// central square for medium+ tiers (hosts the centerpiece landmark).
export const VILLAGE_JITTER_ALONG = 2.0;   // ± m along the street
export const VILLAGE_JITTER_PERP = 1.5;    // ± m toward/away from the street
export const VILLAGE_JITTER_ROT = 0.12;    // ± rad on the house heading
export const VILLAGE_L_SHAPE_CHANCE = 0.18; // chance a footprint-1 house gets an L wing
export const VILLAGE_DORMER_CHANCE = 0.25;  // reserved: the per-house dormer roll exists (kept for a stable PRNG stream) but dormer meshes aren't built yet
export const VILLAGE_PLAZA_HALF = { small: 0, medium: 14, large: 20, city: 30 };
export const PLAZA_COLOR = 0x9a948a;

// Landmarks + special cases.
export const FARM_CHANCE = 0.40;            // chance a small/medium plains/savanna village is a farm
export const COASTAL_RING_PAD = 130;        // sample this far past the village for sea
export const COASTAL_SEAHITS_MIN = 2;       // of 12 ring samples in the sea → coastal
export const COASTAL_SEAHITS_MAX = 9;

// Street props (instanced per village). Density + caps keep cities cozy not
// cluttered; the MIX shifts urban↔rural per tier (cities favor lamps/benches,
// hamlets favor gardens/woodpiles).
export const VILLAGE_LAMP_SPACING = { small: 0, medium: 0, large: 22, city: 16 };
export const VILLAGE_PROP_PAD_MARGIN = 6;   // keep props this far inside the rect
export const VILLAGE_MAX_PROPS = { small: 90, medium: 180, large: 320, city: 460 };
export const VILLAGE_LAMP_GLOW_FULL = [2.6, 2.2, 1.2]; // HDR warm — blooms at night
export const VILLAGE_WINDOW_NIGHT_EMISSIVE = 0.95;     // window emissive at full night (day ≈ 0.32)

// Ruins — monumental castle ruins on mountain peaks: crumbling ring walls
// with crenellations, corner towers, a keep, a gatehouse and rubble. Every
// piece is generated a little sunk into the ground (and follows the local
// slope) so nothing floats on a peak.
export const RUIN_CELL_SIZE = 2400;
export const RUIN_CHANCE = 0.55;     // of a cell containing an eligible mountain peak
export const RUIN_MIN_HEIGHT = 95;   // groundHeight must exceed this for a ruin to spawn (high peaks only)
export const RUIN_SINK = 1.1;        // how deep each piece is buried below local ground (m)
export const RUIN_COURT_MIN = 16;    // castle courtyard half-size range (m)
export const RUIN_COURT_MAX = 26;

// Physics
export const GRAVITY = 9.81;
export const MASS = 1000;
export const MAX_THRUST = 15000;
// Weight is MASS*GRAVITY = 9810 N; lift equals weight when
// LIFT_COEFFICIENT * forwardSpeed² ≈ 9810, so at LIFT=6 that's ~40 m/s takeoff.
export const LIFT_COEFFICIENT = 6.0;
// Cap the forward speed fed into the lift term. Without this, lift grows
// quadratically forever and the plane balloons upward at cruise no matter how
// hard you pitch down. At 45 m/s, lift maxes at 6*45² ≈ 12150 N ≈ 1.24× weight,
// so level flight holds altitude and pitching down actually descends.
export const LIFT_REFERENCE_SPEED = 45;
// Starting value 0.3 gave terminal speed ~225 m/s at full throttle — way too
// fast for a calm sim. 1.8 puts full-throttle cruise around 90 m/s, half
// throttle around 65 m/s.
export const DRAG_COEFFICIENT = 1.8;
// Rate at which velocity bends to follow the nose direction. Without this, the
// plane can point one way and drift another — pulling the nose down doesn't
// feel like diving. 2.0/s means velocity half-aligns with forward in ~0.35s.
export const VELOCITY_ALIGN_RATE = 2.0;
// Alignment authority ramps up between these forward-speed thresholds. Below
// LOW, the plane is effectively stalled and gravity dominates — the nose-up
// attitude no longer pulls velocity upward, so the plane actually falls.
export const VELOCITY_ALIGN_LOW_SPEED = 22;
export const VELOCITY_ALIGN_HIGH_SPEED = 42;
// Stall pitch-down: when lift falls below weight, the nose naturally drops so
// the plane dives back to flying speed. Bias that ramps up the slower you go.
export const STALL_PITCH_SPEED = 38;   // m/s (~74 kt) — stall zone starts here
export const STALL_PITCH_RATE = 2.2;   // rad/s² base torque at zero airspeed
export const STALL_PITCH_NOSE_UP_BIAS = 2.5; // extra torque scaling with how nose-up the plane is
// Below this airspeed lift collapses toward zero (smoothstep). Without this
// the v² curve still generates enough lift at 40–60 kt to glide forever.
export const STALL_LIFT_CUTOFF = 28;   // m/s (~54 kt)
// Starting value from docs was 0.5, but that caps rolling speed at ~30 m/s —
// below takeoff speed (~40 m/s), so the plane can never lift off the runway.
// 0.05 is closer to real aircraft tire friction and still slows the plane on
// landing (brakes add BRAKE_STRENGTH on top of this).
export const ROLLING_FRICTION = 0.05;

// Angular controls
export const PITCH_RATE = 1.5;
export const ROLL_RATE = 2.5;
export const YAW_RATE = 0.8;
export const CONTROL_RESPONSIVENESS = 0.1;
export const ANGULAR_DAMPING = 2.0;
export const COUPLING_COEFF = 1.0;

// Throttle
export const THROTTLE_RATE = 0.5;

// Plane
// Raised from 0.5 in v0.6: the detailed models stand on real landing-gear legs,
// so the origin sits higher above the ground. Gear geometry is authored so the
// wheel bottoms reach exactly -PLANE_BOTTOM_OFFSET when extended.
export const PLANE_BOTTOM_OFFSET = 0.95;
export const BRAKE_STRENGTH = 1.5;

// Landing gear (v0.6) — retractable on G. Extended gear adds a little drag
// (slightly lower top speed), retracting cleans the plane up.
export const GEAR_ANIM_SPEED = 1.6;     // gearT units/sec (~0.6 s transit)
export const GEAR_DRAG_FRAC = 0.18;     // drag multiplier at full extension (+18%)

// Aircraft types. Each multiplier scales the global constant above for
// physics / control, and selects a mesh silhouette.
export const DEFAULT_TYPE_CONFIG = {
  thrustMult: 1,
  dragMult: 1,
  liftMult: 1,
  liftRefMult: 1,
  pitchRateMult: 1,
  rollRateMult: 1,
  yawRateMult: 1,
  couplingMult: 1,
};
export const PLANE_TYPES = {
  cessna: {
    name: 'Cessna',
    description: 'Slow and forgiving. Perfect for relaxing flights.',
    tagline: 'Grandma-approved. Warning: may induce naps.',
    thrustMult: 0.55,
    dragMult: 1.4,
    liftMult: 1.1,
    liftRefMult: 0.95,
    pitchRateMult: 0.80,
    rollRateMult: 0.70,
    yawRateMult: 0.80,
    couplingMult: 1.00,
  },
  piper: {
    name: 'Piper',
    description: 'Balanced all-rounder. The classic sim plane.',
    tagline: 'Works on my machine. Should work on yours too.',
    thrustMult: 1.0,
    dragMult: 1.0,
    liftMult: 1.0,
    liftRefMult: 1.0,
    pitchRateMult: 1.0,
    rollRateMult: 1.0,
    yawRateMult: 1.0,
    couplingMult: 1.0,
  },
  jet: {
    name: 'Jet',
    description: 'Hot fighter. Huge thrust, sharp controls.',
    tagline: 'No brakes. Only regrets and afterburner.',
    thrustMult: 2.5,
    dragMult: 0.7,
    liftMult: 0.85,
    liftRefMult: 1.2,
    pitchRateMult: 1.40,
    rollRateMult: 1.70,
    yawRateMult: 1.20,
    couplingMult: 0.80,
  },
};
export const DEFAULT_PLANE_TYPE = 'piper';

// Body colors offered in the menu. First entry is the default.
export const BODY_COLORS = [
  { name: 'white',   hex: 0xeeeeee },
  { name: 'red',     hex: 0xcc3333 },
  { name: 'blue',    hex: 0x3377cc },
  { name: 'yellow',  hex: 0xffcc33 },
  { name: 'pink',    hex: 0xff88bb },
  { name: 'green',   hex: 0x55aa55 },
  { name: 'orange',  hex: 0xff8833 },
  { name: 'purple',  hex: 0x9966cc },
  { name: 'black',   hex: 0x444444 },
];
export const DEFAULT_BODY_COLOR = 0xeeeeee;

// Sky / fog / lighting
export const HORIZON_COLOR = 0xcfe2f3; // warm pale blue, matches fog
export const ZENITH_COLOR = 0x3b72c4;  // deeper overhead blue
export const SUN_DIRECTION = [0.35, 0.45, -0.5]; // normalized in Sky.js
export const SUN_COLOR = 0xfff1c8;
export const FOG_COLOR = HORIZON_COLOR;
// Fog kept well outside the runway. Push further so near-camera objects
// (plane, runway) never pick up any haze.
export const FOG_NEAR = 600;
export const FOG_FAR = 1300;
export const FOG_FAR_MIN = 1300;
export const FOG_FAR_MAX = 2200;

// Terrain coloring — slope threshold (vertex normal.y below this = rock).
export const SLOPE_ROCK_THRESHOLD = 0.72;

// Biomes — a low-frequency noise field selects between lake/forest/hills/
// mountain. Parameters blend smoothly across boundaries.
export const BIOME_SCALE = 0.0006;              // biome feature size (~1700m across)
export const MAX_TREE_FACTOR = 2.8;             // forest peak tree-density multiplier
export const MAX_ROCK_FACTOR = 3.6;             // alpine peak rock-density multiplier

// ---------------------------------------------------------------------------
// Terrain shape — realistic multi-layer landform model (TerrainShape.js).
// Replaces the old "uniform 3-octave noise × biome.amp" approach. Terrain is
// composed analytically (no stateful per-chunk passes, so chunk seams stay
// invisible and the worker output is bit-identical to the main thread):
//   plains  = gentle low-amplitude undulation everywhere
//   uplands = broad swells/plateaus where "continentalness" is high
//   ranges  = ridged multifractal mountains, gated by a mountain-mask noise,
//             so peaks form actual ridgelined ranges instead of round blobs.
// Coordinates are domain-warped first so nothing looks grid-aligned.
// ---------------------------------------------------------------------------
export const TERRAIN_WARP_SCALE = 0.00055;   // domain-warp feature size
export const TERRAIN_WARP_AMP = 130;         // meters of coordinate warp
export const CONTINENT_SCALE = 0.00021;      // ~4800 m continents/uplands
export const UPLAND_HEIGHT = 34;             // broad highland plateau lift (m)
export const MOUNTAIN_MASK_SCALE = 0.0003;   // ~3300 m mountain ranges
export const MOUNTAIN_MASK_LOW = 0.44;       // mask below this = no mountains
export const MOUNTAIN_MASK_HIGH = 0.70;      // mask above this = full mountains
export const MOUNTAIN_BASE_RISE = 60;        // broad massif lift under a range (m)
export const MOUNTAIN_HEIGHT = 135;          // ridge height above the massif (m)
export const RIDGE_SCALE = 0.0011;           // base ridge spacing (wider = broader peaks)
export const RIDGE_OCTAVES = 4;
export const RIDGE_LACUNARITY = 2.0;
export const RIDGE_GAIN = 0.45;              // lower = less spiky high-frequency detail
export const RIDGE_EXP = 0.85;               // <1 rounds ridgelines into broad massifs
// Smooth dome blended in with the ridges so peaks read as big mountains with
// rounded shoulders rather than thin needles. 0 = pure ridges, 1 = pure dome.
export const RIDGE_DOME_MIX = 0.4;
export const PLAINS_SCALE = 0.0042;          // flatland undulation feature size
export const PLAINS_OCTAVES = 3;
export const PLAINS_AMP = 7.5;               // gentle ± on the flats (m)
export const FOOTHILL_AMP = 42;              // rolling hills in the transition band
// Mountains are suppressed within this radius of the world origin so takeoff
// from the home runway is always over open plains, with ranges in the distance.
export const SPAWN_FLAT_RADIUS = 1500;
export const SPAWN_FLAT_BLEND = 900;

// Climate — two independent warped low-frequency fields drive biome choice.
export const CLIMATE_SCALE = 0.00019;        // ~5300 m climate zones
export const CLIMATE_WARP = 0.0006;

// Rivers — winding channels carved where a low-frequency noise crosses zero
// (|n| < width). They cut below WATER_LEVEL so the global water plane fills
// them. Faded out on high ground (no canyon-rivers through mountains), near
// the world origin (dry spawn clearing), and inside the sea.
// Halving the field frequency makes rivers ~2× rarer AND ~2× physically
// wider at the same noise width (width ≈ W/|∇n|, gradient ∝ scale) — with
// longer, lazier meanders as a bonus.
export const RIVER_SCALE = 0.00045;       // meander wavelength ~2–4 km
export const RIVER_WIDTH_N = 0.026;       // |noise| half-width of the channel
// Rivers carry their own LOCAL water level. The global water plane sits at
// WATER_LEVEL (-4), but rivers often run through land well above it — carving
// to a fixed depth left dry gullies up high. Instead the river's water level
// follows a SMOOTH base of the terrain (the continental swell), quantized to
// RIVER_STEP-metre pools, so a river descends to the sea as a cascade of
// level reaches with small ledges between them — no weird sloping water.
// All targets are RELATIVE to that local level; a per-chunk water surface
// renders the pools (see TerrainCompute/Terrain).
export const RIVER_STEP = 5;              // pool quantization step (m)
export const RIVER_LOCAL_DROP = 3;        // water sits this far below the smooth base
export const RIVER_BED_DEPTH = 2.8;       // channel bed below the local water level
export const RIVER_MEADOW_RISE = 1.6;     // valley meadows above the local water level
// Fade rivers out where the land towers over the would-be water (ridges,
// foothills) — rivers flow through plains and plateaus, not over mountains.
export const RIVER_RELIEF_LO = 14;
export const RIVER_RELIEF_HI = 26;
export const RIVER_VALLEY_MULT = 3.2;     // valley half-width = WIDTH_N × this
export const RIVER_CHANNEL_MULT = 1.3;    // waterway half-width = WIDTH_N × this
// U-shaped channel profile: carve saturates to full depth once the bank mask
// passes BANK_HIGH, so most of the channel floor sits below the water line.
export const RIVER_BANK_LOW = 0.18;
export const RIVER_BANK_HIGH = 0.6;
export const RIVER_MAX_LAND = 16;         // rivers fade out as land rises to this
export const RIVER_FADE_LAND = 30;        // fully gone above this elevation

// Snow / alpine coloring thresholds (meters).
export const SNOW_LINE = 130;                // base snow elevation
export const SNOW_LINE_VARIATION = 28;       // noise jitter on the snow line
export const SNOW_SCALE = 0.0011;            // snow-line wobble feature size
export const BEACH_HEIGHT = 2.6;             // sand band height above water level
// Elevation proxies used by biomeAt() to pick alpine/highland vs lowland.
export const ALPINE_ELEV = 98;
export const HIGHLAND_ELEV = 52;

// Climate-biome definitions. `color` is the base ground RGB (0..1); `trees`
// and `rocks` are scatter-density factors (normalized by MAX_TREE_FACTOR /
// MAX_ROCK_FACTOR in Scatter.js). Coloring (snow/beach/rock strata) is layered
// on top per-vertex in TerrainShape.surfaceColor.
export const BIOME_DEFS = {
  desert:   { color: [0.80, 0.71, 0.49], trees: 0.04, rocks: 1.1 },
  savanna:  { color: [0.66, 0.61, 0.33], trees: 0.55, rocks: 0.6 },
  plains:   { color: [0.44, 0.57, 0.28], trees: 0.32, rocks: 0.4 },
  forest:   { color: [0.22, 0.42, 0.19], trees: 2.7,  rocks: 0.5 },
  taiga:    { color: [0.27, 0.42, 0.32], trees: 1.9,  rocks: 0.9 },
  tundra:   { color: [0.57, 0.59, 0.50], trees: 0.12, rocks: 1.5 },
  alpine:   { color: [0.50, 0.48, 0.46], trees: 0.05, rocks: 3.4 },
};

// Fog range factors — fog_near starts at VIEW_DISTANCE_M × FOG_NEAR_FRAC and
// fades to full at VIEW_DISTANCE_M × FOG_FAR_FRAC. Keeps the terrain edge
// tucked inside full fog regardless of preset, so you never see a hard line
// where chunks stop.
export const FOG_NEAR_FRAC = 0.45;
export const FOG_FAR_FRAC = 0.92;

// Aerial perspective — the Rayleigh-haze depth cue for distant terrain.
// A little (desaturation + horizon-tint) starts much earlier than fog and
// is much weaker, giving mid-distance mountains a subtle blue/pink shift
// well before fog fully takes over. Without this, mid-range mountains
// read as flat saturated colour and the world looks like a cardboard
// cutout; with it you get the depth you'd see from a real cockpit.
export const AERIAL_NEAR = 250;           // m: effect starts here
export const AERIAL_FAR = 1800;           // m: full strength at/past here
export const AERIAL_STRENGTH = 0.55;      // 0..1 mix toward horizon colour
export const AERIAL_DESATURATION = 0.65;  // 0..1 mix toward grayscale

// Water — shader-based reflective surface. Follows the camera horizontally,
// sized to outlast fog on all sides.
export const WATER_LEVEL = -4;
// Sea mask — a very low-frequency noise layer on top of the biome system.
// Where its value is high, terrain gets pushed down by up to SEA_DEPTH, so
// multi-kilometer seas open up regardless of per-cell biome choice. The
// smoothstep thresholds give shores a natural curve instead of a hard edge.
export const SEA_SCALE = 0.00016;          // feature size ~6000m
export const SEA_THRESHOLD_LOW = 0.58;     // no sea below this mask value
export const SEA_THRESHOLD_HIGH = 0.80;    // fully deep sea at or above
export const SEA_DEPTH = 45;               // max extra depth in meters
// Water plane diameter. Must exceed 2 × fog_far at the LARGEST view-distance
// preset so its edge is always hidden inside full fog — otherwise a hard
// "water ends here" line is visible at low altitude as the player flies. The
// old formula used the legacy VIEW_DISTANCE_CHUNKS=4 default and produced
// only 1843 m, well below the ~2 km fog_far on Ultra. 6000 m gives 3000 m
// radius, comfortably outside fog at every preset.
export const WATER_SIZE = 6000;
export const WATER_COLOR_SHALLOW = 0x77c5e5;
export const WATER_COLOR_DEEP = 0x123a5a;
export const WATER_NORMAL_SCROLL_SPEED = 0.25; // animated ripple time scale
export const WATER_OPACITY = 0.86;
// Legacy alias kept for any old imports we might have missed.
export const WATER_COLOR = WATER_COLOR_SHALLOW;

// Clouds — instanced camera-facing quads, deterministic per-cell so flying
// back shows the same clouds. Drift is a global wind offset, so the same
// cells still appear identically scattered — just translated in world space.
export const CLOUD_CELL_SIZE = 500;
export const CLOUD_MIN_PER_CELL = 1;
export const CLOUD_MAX_PER_CELL = 3;
export const CLOUD_MIN_ALT = 200;
export const CLOUD_MAX_ALT = 600;
export const CLOUD_VIEW_RADIUS = 1500;   // cells outside this radius aren't spawned
export const CLOUD_SIZE_MIN = 80;
export const CLOUD_SIZE_MAX = 180;
export const CLOUD_DRIFT_SPEED = 2.0;    // m/s along CLOUD_DRIFT_DIR
export const CLOUD_DRIFT_DIR = [1.0, 0.0, 0.35]; // normalized in Clouds.js
export const CLOUD_OPACITY = 0.9;
export const CLOUD_MAX_INSTANCES = 96;   // InstancedMesh pool upper bound

// Shadows
export const PLANE_SHADOW_SIZE = 14;
export const PLANE_SHADOW_OPACITY = 0.5;
export const PLANE_SHADOW_FADE_ALT = 400; // shadow fades to 0 by this altitude above ground
export const CLOUD_SHADOW_OPACITY = 0.28;

// Crashes — only trigger on steep, fast impacts so normal takeoff/landing and
// shallow "rough landings" stay non-fatal.
export const CRASH_ENABLED_DEFAULT = true;
export const CRASH_MIN_SPEED = 35;        // total speed (m/s)
export const CRASH_MIN_DOWN_SPEED = 18;   // downward component of velocity
export const CRASH_MIN_DIVE_DOT = 0.5;    // -velY / |vel|  — 0.5 ≈ 30° below horizon

// Explosion particles
export const EXPLOSION_PARTICLE_COUNT = 80;   // particles seeded per blast
// Total shared particle pool — bigger than one blast so several near-
// simultaneous deaths (a busy combat race) each get a full burst from free
// slots instead of stomping each other's still-burning particles. ~3 blasts.
export const EXPLOSION_POOL_COUNT = 240;
export const EXPLOSION_GRAVITY = 12;
export const EXPLOSION_DRAG = 0.9;
export const EXPLOSION_LIFE_MIN = 0.9;
export const EXPLOSION_LIFE_MAX = 2.0;

// Jet exhaust
export const JET_EXHAUST_MAX = 160;    // particle pool size
export const JET_EXHAUST_RATE = 110;   // particles/sec at full throttle
export const JET_EXHAUST_LIFE = 0.55;  // seconds per particle
export const JET_EXHAUST_SPEED = 22;   // backward speed relative to plane
export const JET_EXHAUST_SPREAD = 2.0; // velocity jitter
// Local +Z distance behind the plane. Engine block spans z ≈ 4.25–5.75 on
// the jet variant; offset 6.4 puts the spawn point clearly past the tail.
// Particles grow to ~0.5 m at peak so this offset keeps them from visually
// sneaking into the fuselage near the cockpit during tight turns.
export const JET_EXHAUST_OFFSET_Z = 6.4;

// Contrails — long-lived white condensation streaks behind a jet at
// altitude. Gated on both altitude and throttle so low-altitude passes
// stay clean and the effect only appears in true "cruise" situations.
// Pool is shared between the left/right trails; at 4/s spawn rate per side
// × 28 s life × 2 sides = 224 max live — pool of 240 leaves headroom.
export const CONTRAIL_MAX = 240;
export const CONTRAIL_RATE = 8;           // TOTAL spawns/sec (split evenly L/R)
export const CONTRAIL_LIFE = 28;          // seconds per particle
export const CONTRAIL_MIN_ALT = 400;      // below this, no contrails at all
export const CONTRAIL_FULL_ALT = 700;     // full-strength at/above
export const CONTRAIL_MIN_THROTTLE = 0.4; // throttle below this, no emission
export const CONTRAIL_SIDE_OFFSET = 2.2;  // meters from plane centerline
export const CONTRAIL_BACK_OFFSET = 5.8;  // local +Z behind cockpit
export const CONTRAIL_PEAK_SIZE = 4.5;    // puff diameter at mid-life (m)

// Jet exhaust illuminates nearby geometry. PointLight attached behind the
// plane; intensity scales with throttle. Water shader reads the same values
// so the plume streak on water lights up when the jet is low.
export const JET_LIGHT_COLOR = 0xff6820;
export const JET_LIGHT_INTENSITY = 18;  // peak at full throttle
export const JET_LIGHT_DISTANCE = 90;   // falls off to zero by this range
export const JET_LIGHT_DECAY = 1.6;

// Scatter density per chunk — these are candidate counts. Biome acceptance
// filters them down; a pure forest keeps nearly all candidates, mountains
// reject most trees but keep most rocks.
// Forest density bumped — 160 candidates gives roughly 150 trees per chunk
// in a pure forest biome (biome acceptance is ~1.0 there). Slope/water
// rejection still trims the count on steep or wet ground so the extra cost
// is mostly paid where it shows up visually.
export const TREES_PER_CHUNK = 160;
export const ROCKS_PER_CHUNK = 32;

// Streaming budget — the BASE number of milliseconds a chunks.update() call
// is allowed to spend building new chunks. The effective budget is adaptive:
// when there's a big backlog (initial load / huge view distance increase)
// it climbs to CHUNK_BUILD_BUDGET_MAX_MS so the world fills in quickly;
// when the backlog is small (normal flight) it drops back toward the base
// value so frame rate stays smooth.
// Budget — single ceiling of 8 ms per update(). buildChunk measures ≈ 2.2 ms
// on M3, so a frame that actually does work builds ~3 chunks (~13 ms wall
// total incl. render). primeAll() handles the heavy startup load before
// the first frame, so we never need a mid-flight "burst" mode: any burst
// ceiling above 8 ms creates visible 25–30 ms stalls the moment the
// backlog gets large enough to trigger it (which, on altitude changes at
// high VD, happens regularly).
//
// If altitude increases add a ring of 20–40 new chunks, those fill over
// 10–15 frames at 8 ms each (~200 ms total) — invisible because fog hides
// the outer ring and the player moves < 10 m in that window.
export const CHUNK_BUILD_BUDGET_MS = 4;
export const CHUNK_BUILD_BUDGET_MAX_MS = 10;
export const CHUNK_BUILD_BUDGET_PER_PENDING_MS = 0.15;
// primeAll radius (in chunks) used at startup. Too large (e.g. full VD of
// 441 chunks) and the first ~20 s of play stutters at 45 fps while 100s of
// VBOs upload to the GPU. Too small and the visible world looks "small"
// until outer rings stream in. 5 = 121 chunks ≈ 1400 m initial horizon,
// which is close to full fog_far at medium preset — feels immediately
// "loaded" at Start without swamping the GPU (prime blocks ~350 ms, which
// happens once on Start before the first frame so the player doesn't see it).
export const PRIME_RADIUS_CHUNKS = 5;

// ---------------------------------------------------------------------------
// Debug profiler — auto-ON in `npm run dev`, auto-OFF in production builds
// (Vite replaces import.meta.env.DEV with a literal at build time). Fly around
// for ~30 s crossing chunk boundaries, then check the DevTools console.
// A summary prints every DEBUG_PROFILER_REPORT_INTERVAL_MS; every frame
// longer than DEBUG_PROFILER_LONG_FRAME_MS is logged inline with breakdown.
// Zero runtime cost when off. Hardcode `true` to force-profile a prod build.
// ---------------------------------------------------------------------------
export const DEBUG_PROFILER = !!(import.meta.env && import.meta.env.DEV);
export const DEBUG_PROFILER_LONG_FRAME_MS = 20;
export const DEBUG_PROFILER_REPORT_INTERVAL_MS = 5000;
export const VILLAGE_BUILD_BUDGET_MS = 3;
export const RUIN_BUILD_BUDGET_MS = 2;
export const TREE_MIN_HEIGHT = 1.5;
export const TREE_MAX_HEIGHT = 90;    // treeline — forests climb the uplands + lower slopes
export const TREE_MAX_SLOPE = 0.45;   // tan of slope: reject steep spots

// Camera
export const CAMERA_FOV = 70;
export const CAMERA_NEAR = 0.1;
// Must accommodate the widest possible preset: Extra High max = 14 chunks ×
// CHUNK_SIZE = 1792 m. Multiplier gives headroom for clouds and sky dome.
export const CAMERA_FAR = 14 * CHUNK_SIZE * 1.6;
export const CAMERA_OFFSET = [0, 3, 12]; // behind and above in plane's local frame
// Raw per-frame lerp kept for reference; the actual follow uses a dt-based
// exponential so the camera tracks at the same rate regardless of whether a
// frame took 8 ms or 40 ms.
export const CAMERA_LERP = 0.1;
export const CAMERA_FOLLOW_RATE = 6.2; // exponential smoothing rate in 1/s
// Chase-camera surface collision: keep the camera at least this far above the
// terrain/water surface. When the boom would punch below it (low pass, or
// mouse-look aimed under the plane), the camera is pulled IN toward the plane
// so you never see under the ground/water.
export const CAMERA_GROUND_MARGIN = 2.2;

// Mouse look
export const MOUSE_LOOK_SENSITIVITY = 0.003; // radians per pixel of drag
export const MOUSE_LOOK_RECENTER = 3.0; // 1/s decay toward zero when not dragging
export const MOUSE_LOOK_PITCH_LIMIT = Math.PI / 2 - 0.1;

// ---------------------------------------------------------------------------
// Day / night cycle
// ---------------------------------------------------------------------------
// Full dawn→noon→dusk→midnight cycle duration in real seconds. 600 = 10 min.
export const DAY_LENGTH_SECONDS = 600;
// Starting phase in [0,1]. 0.5 = noon.
export const DAY_TIME_START = 0.5;
// Menu-selectable fixed times of day. `auto` advances normally; everything
// else freezes `timeOfDay` at the listed phase.
export const TIME_PRESETS = {
  auto:    { label: 'Auto',    t: null },
  sunrise: { label: 'Sunrise', t: 0.24 },
  morning: { label: 'Morning', t: 0.36 },
  day:     { label: 'Day',     t: 0.5  },
  sunset:  { label: 'Sunset',  t: 0.76 },
  night:   { label: 'Night',   t: 0.0  },
};
export const DEFAULT_TIME_PRESET = 'auto';

// Graphics presets — picked from the main menu, persisted in localStorage.
// Each preset collapses a handful of individual toggles into a single choice
// so players on weaker GPUs can drop quality without hunting in sub-menus.
export const GRAPHICS_PRESETS = {
  low: {
    label: 'Low',
    shadows: 0,
    shadowTrees: false,
    shadowTerrain: false,
    shadowFrustumHalf: 360,
    bloom: false,
    bloomStrength: 0,
    vignette: false,
    atmoSky: false,
    contactShadows: false,
    terrainDetail: false,
    godrays: false,
    fxaa: true,        // cheap edge AA — worth it even on Low
    colorGrade: true,  // cinematic grade is ~free
    pixelRatio: 1.0,
    toneMappingExposure: 1.0,
  },
  medium: {
    label: 'Medium',
    shadows: 1024,
    shadowTrees: false,
    shadowTerrain: true,   // mountains/hills throw shadows on valleys
    shadowFrustumHalf: 420,
    bloom: true,
    bloomStrength: 0.35,
    vignette: true,
    atmoSky: false,
    contactShadows: true,
    terrainDetail: true,
    godrays: true,
    fxaa: true,
    colorGrade: true,
    pixelRatio: 1.0,
    toneMappingExposure: 1.0,
  },
  high: {
    label: 'High',
    shadows: 4096,
    shadowTrees: true,
    shadowTerrain: true,
    shadowFrustumHalf: 720,
    bloom: true,
    bloomStrength: 0.5,
    vignette: true,
    atmoSky: true,
    contactShadows: true,
    terrainDetail: true,
    godrays: true,
    fxaa: true,
    colorGrade: true,
    pixelRatio: Math.min(
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      1.75
    ),
    toneMappingExposure: 1.06,
  },
};
export const DEFAULT_GFX_PRESET = 'medium';
// Sun shadow camera tracks the plane — orthographic frustum half-size.
export const SHADOW_FRUSTUM_HALF = 560;
export const SHADOW_CAMERA_DISTANCE = 900;
export const SHADOW_BIAS = -0.0005;
// Normal bias gets a bump — terrain is flat-shaded so neighbouring triangles
// disagree sharply about their normals, which makes self-shadowing acne
// very visible without a healthy offset along the geometric normal.
export const SHADOW_NORMAL_BIAS = 0.08;
// Bloom operates purely in HDR — threshold 2.0 is above the max luminance a
// plain lit MeshStandardMaterial can reach, so accidental self-blooming of
// the plane/terrain can't happen. Everything we DO want to bloom (sun disc,
// runway lamps, nav lights, explosion fire, jet exhaust) is boosted to HDR
// colors above this threshold. Radius kept tight so the sun disc doesn't
// spread its halo across the whole upper screen.
export const BLOOM_STRENGTH = 0.45;
export const BLOOM_RADIUS = 0.35;
export const BLOOM_THRESHOLD = 2.0;
// Adaptive bloom threshold: the HDR cutoff drops toward dusk/dawn so low sun
// + warm sky glow bloom more (golden-hour bloom), then climbs back at noon so
// the daytime scene stays crisp. Driven per-frame from sun intensity (main.js).
export const BLOOM_THRESHOLD_DAY = 2.0;
export const BLOOM_THRESHOLD_DUSK = 1.25;
// Vignette strength (0 = off, ~0.35 is subtle).
export const VIGNETTE_STRENGTH = 0.32;

// Cinematic color grade — a final display-space pass (contrast + saturation +
// gentle filmic shoulder + a touch of warmth). Cheap, runs on every preset.
export const GRADE_CONTRAST = 1.07;
export const GRADE_SATURATION = 1.14;
export const GRADE_LIFT = 0.012;        // raise the blacks slightly (filmic)
export const GRADE_TINT = [1.015, 1.0, 0.985]; // subtle warm cast

// Volumetric god-rays (screen-space radial blur of bright pixels) and
// lens flare — combined post-fx pass. SAMPLES is a shader `#define` so
// it needs to be a literal integer; don't wire this to settings live.
// DENSITY controls ray length (bigger = longer streaks). DECAY makes
// each sample darker than the last — < 1 means "rays taper off".
// STRENGTH is the overall output multiplier; main.js fades it to zero
// when the sun is off-screen / below horizon so the pass effectively
// disables itself without a JS toggle.
export const GODRAYS_SAMPLES = 60;
export const GODRAYS_DENSITY = 0.75;
export const GODRAYS_WEIGHT = 0.22;
export const GODRAYS_DECAY = 0.955;
export const GODRAYS_EXPOSURE = 0.9;
export const GODRAYS_STRENGTH = 0.7;     // overall multiplier when sun visible
export const LENS_FLARE_STRENGTH = 0.55; // ghost disc brightness
export const LENS_FLARE_STREAK_STRENGTH = 0.9; // anamorphic horizontal streak
// Run-time multiplier — allows speed-of-day tweaking without code edits.
export const DAY_TIME_MULT = 1.0;
// Keyframes interpolated (in t order) to colour the sky, fog, and lights.
// Values at t=0 and t=1 must match (seamless loop).
// Keyframes decouple horizonColor (sky dome gradient) from fogColor (the
// haze tint). Day fog is a saturated blue so distant objects read distinctly
// against the horizon instead of bleaching to white.
export const DAY_NIGHT_KEYFRAMES = [
  // midnight
  { t: 0.00, skyColor: 0x0a1530, horizonColor: 0x182940, fogColor: 0x182940, sunColor: 0x6e80a0, sunIntensity: 0.22, ambientColor: 0x4a5878, ambientIntensity: 0.40, starsOpacity: 1.0 },
  // deep pre-dawn — cool blues with a hint of violet
  { t: 0.17, skyColor: 0x1d234a, horizonColor: 0x413055, fogColor: 0x2e2542, sunColor: 0x6a6aa8, sunIntensity: 0.24, ambientColor: 0x4a4a6e, ambientIntensity: 0.42, starsOpacity: 0.70 },
  // twilight — magenta zenith, pink horizon catching first light
  { t: 0.21, skyColor: 0x463566, horizonColor: 0xa0506a, fogColor: 0x6c3e58, sunColor: 0xe08278, sunIntensity: 0.42, ambientColor: 0x7a5c6e, ambientIntensity: 0.50, starsOpacity: 0.25 },
  // sunrise — the whole sky blushes pink, burning coral at the horizon
  { t: 0.25, skyColor: 0x6f4a8e, horizonColor: 0xff8058, fogColor: 0xd97050, sunColor: 0xff7a3c, sunIntensity: 0.90, ambientColor: 0xc07c78, ambientIntensity: 0.64, starsOpacity: 0.0 },
  // post-sunrise — pink thinning, sky warming toward blue
  { t: 0.29, skyColor: 0x6a78b2, horizonColor: 0xf4a888, fogColor: 0xcea088, sunColor: 0xffba80, sunIntensity: 0.95, ambientColor: 0xd4b29c, ambientIntensity: 0.62, starsOpacity: 0.0 },
  // golden hour morning — warm gold, sky settled into blue
  { t: 0.34, skyColor: 0x4e7cb4, horizonColor: 0xf0b080, fogColor: 0xc8a080, sunColor: 0xffcf90, sunIntensity: 0.98, ambientColor: 0xd8bfa6, ambientIntensity: 0.62, starsOpacity: 0.0 },
  // noon — cool blue sky; sun + ambient trimmed so the overhead scene
  // isn't uniformly near-white (crisper contrast, no bloom whiteout).
  { t: 0.5,  skyColor: 0x2a62b4, horizonColor: 0x7aa5c9, fogColor: 0x7da0be, sunColor: 0xfff4d0, sunIntensity: 1.00, ambientColor: 0xffffff, ambientIntensity: 0.55, starsOpacity: 0.0 },
  // golden hour afternoon — warm gold
  { t: 0.66, skyColor: 0x4870aa, horizonColor: 0xf0a870, fogColor: 0xc89070, sunColor: 0xffc880, sunIntensity: 0.98, ambientColor: 0xd4b296, ambientIntensity: 0.62, starsOpacity: 0.0 },
  // pre-sunset — pink creeping into the zenith
  { t: 0.72, skyColor: 0x6a5c98, horizonColor: 0xf48a50, fogColor: 0xc87048, sunColor: 0xff7a30, sunIntensity: 0.90, ambientColor: 0xc08470, ambientIntensity: 0.60, starsOpacity: 0.0 },
  // sunset — whole sky pink-magenta, burning orange-red at the horizon
  { t: 0.75, skyColor: 0x7a3a86, horizonColor: 0xff5430, fogColor: 0xb0402e, sunColor: 0xff3c10, sunIntensity: 0.85, ambientColor: 0x9a4838, ambientIntensity: 0.60, starsOpacity: 0.05 },
  // after-sunset — hot pink band against a deepening purple sky
  { t: 0.78, skyColor: 0x4a2868, horizonColor: 0xc03868, fogColor: 0x822e52, sunColor: 0xdd4880, sunIntensity: 0.50, ambientColor: 0x7a5068, ambientIntensity: 0.52, starsOpacity: 0.25 },
  // civil twilight — violet fading into night
  { t: 0.82, skyColor: 0x1e1f4a, horizonColor: 0x4a2d5a, fogColor: 0x2e2442, sunColor: 0x7070b4, sunIntensity: 0.26, ambientColor: 0x4e486c, ambientIntensity: 0.44, starsOpacity: 0.65 },
  // midnight (loop close)
  { t: 1.00, skyColor: 0x0a1530, horizonColor: 0x182940, fogColor: 0x182940, sunColor: 0x6e80a0, sunIntensity: 0.22, ambientColor: 0x4a5878, ambientIntensity: 0.40, starsOpacity: 1.0 },
];
export const STARS_COUNT = 600;
export const STARS_RADIUS = 800; // dome radius around the camera

// Night lights — runway edge lamps + plane nav lights + landing light.
// `nightFactor` in worldTime is computed from sun intensity and drives both
// the shared light materials (via NightLights.js) and the plane lights.
export const NIGHT_SUN_FULL_DAY = 0.95;   // sunIntensity ≥ this: fully daytime
export const NIGHT_SUN_FULL_NIGHT = 0.32; // sunIntensity ≤ this: fully night
export const RUNWAY_LIGHT_SPACING = 24;   // meters between runway edge lights
export const RUNWAY_LIGHT_COLOR = 0xffe080;
export const RUNWAY_LIGHT_RADIUS = 0.36;
export const NAV_LIGHT_RADIUS = 0.15;
export const NAV_LIGHT_COLOR_LEFT = 0xff2222;
export const NAV_LIGHT_COLOR_RIGHT = 0x22ff22;
export const NAV_LIGHT_COLOR_TAIL = 0xffffff;
export const NAV_TAIL_BLINK_HZ = 1.2;
// Landing light — a SpotLight attached to the player's plane nose, toggled by L.
// Intensity bumped: at 4 the cone barely lit the runway threshold and was
// invisible past ~80 m; at 12 it actually does its job — a clear bright
// pool ahead of the plane during night approaches.
export const LANDING_LIGHT_INTENSITY = 26.0;     // brighter on every plane (v0.2)
export const LANDING_LIGHT_RANGE = 340;
export const LANDING_LIGHT_ANGLE = Math.PI / 5.5; // slightly wider half-cone
export const LANDING_LIGHT_PENUMBRA = 0.4;
export const LANDING_LIGHT_COLOR = 0xfff8cc;

// ---------------------------------------------------------------------------
// Roads between villages — procedural ribbons on top of terrain.
// ---------------------------------------------------------------------------
export const ROAD_WIDTH = 8;
export const ROAD_COLOR = 0x6d5a43;                     // gravel/compacted dirt — visible from altitude
// 7 m sampling drapes the ribbon closely over the 4 m terrain grid — at the
// old 14 m, terrain bulges between samples poked through the road surface.
export const ROAD_SAMPLE_STEP = 7;                      // meters between centerline samples
export const ROAD_MAX_VILLAGE_LINK_DISTANCE = 3600;     // don't attempt roads longer than this
export const ROAD_MAX_SLOPE = 0.42;                     // |dy| / step; higher = too steep
export const ROAD_RUNWAY_DISTANCE = 3000;               // spur-to-home-runway threshold
export const ROAD_Y_OFFSET = 0.3;                       // lift above ground (plus material polygonOffset)
// Roads are streamed by distance to the PLAYER (not tied to terrain-chunk
// lifetime — that made a road vanish whenever the far-away chunk that "owned"
// it unloaded). Build within VIEW, dispose past VIEW × HYSTERESIS.
export const ROAD_VIEW_DISTANCE = 4200;                 // build roads with an endpoint within this
export const ROAD_VIEW_HYSTERESIS = 1.25;               // dispose only beyond view × this
export const ROAD_BUILDS_PER_UPDATE = 2;                // per-frame build cap (each build samples terrain)

// Bridges — when a road crosses a river it continues over the water on a
// deck with piers. Stretches of water longer than BRIDGE_MAX_SPAN still
// reject the route (that's a lake/sea, not a river crossing).
export const BRIDGE_MAX_SPAN = 220;                     // longest waterway a road will bridge (m) — rivers are ~2× wider since v0.3.4
export const BRIDGE_DECK_CLEARANCE = 2.4;               // deck height above water level (m)
export const BRIDGE_ARCH = 1.2;                         // extra rise at mid-span (m)
export const BRIDGE_PIER_SPACING = 3;                   // pier every N wet samples
// Road shape: deterministic gentle curve instead of a dead-straight line.
// N control points between the two endpoints, each offset perpendicularly
// by up to CURVE_AMPLITUDE fraction of the total length.
export const ROAD_CURVE_CONTROLS = 3;                   // interior control points
export const ROAD_CURVE_AMPLITUDE = 0.12;               // fraction of length

// ---------------------------------------------------------------------------
// Multiplayer race mode — checkpoint gates rendered in-world. The course
// itself (gate positions + radius) is authored server-side and streamed to
// every client; these are just the client-side visuals + pass tolerance.
// ---------------------------------------------------------------------------
export const RACE_RING_TUBE = 4.5;          // torus tube thickness (m)
export const RACE_PASS_RADIUS = 75;         // distance to count a gate as cleared (m)
export const RACE_BEACON_HEIGHT = 600;      // height of the "next gate" light pillar (m)
export const RACE_GATE_OPTIONS = [8, 16, 32]; // votable flag counts in the lobby
export const RACE_COLOR_NEXT = 0xffd23a;    // the gate you're heading for (gold, blooms)
export const RACE_COLOR_FUTURE = 0x39c6ff;  // upcoming gates (cyan)
export const RACE_COLOR_DONE = 0x39ff8a;    // gates already cleared (green)

// Combat (race mode) — guns + HP. Damage/HP are server-authoritative; these
// are the client-side feel (fire rate, tracer visuals, local hit tolerance).
export const PLANE_MAX_HP = 100;
export const GUN_FIRE_INTERVAL = 0.1;     // seconds between shots
export const BULLET_SPEED = 460;          // m/s (added to plane velocity)
export const BULLET_LIFE = 1.5;           // seconds before a tracer expires
export const BULLET_MAX = 320;            // tracer pool size
export const BULLET_HIT_RADIUS = 8;       // m from a plane center = hit
export const BULLET_COLOR = 0xfff070;     // tracer color (HDR, blooms)
export const GUN_MUZZLE_OFFSET = [0.9, -0.1, -4.4]; // local nose offset (wing guns mirror on X)
export const RACE_RESPAWN_MS = 3500;      // matches server; downed → respawn delay

// ---------------------------------------------------------------------------
// Audio — procedural engine + wind through the Web Audio API.
// ---------------------------------------------------------------------------
export const AUDIO_MASTER_VOLUME = 0.55;
// Much lower than the old saw-at-340Hz, which sounded like an angry dentist
// drill. A real light-aircraft idle is ~30 Hz, full throttle ~100 Hz; we
// push that up slightly so cheap laptop speakers actually reproduce it.
export const ENGINE_MIN_PITCH = 50;
export const ENGINE_MAX_PITCH = 150;
export const ENGINE_MIN_GAIN = 0.04;
export const ENGINE_MAX_GAIN = 0.22;
// Low-pass cutoff range — kept very low so harmonics above ~450 Hz die off.
export const ENGINE_FILTER_MIN_HZ = 180;
export const ENGINE_FILTER_MAX_HZ = 500;
export const WIND_MIN_GAIN = 0.00;
export const WIND_MAX_GAIN = 0.26;
export const WIND_MIN_FILTER_HZ = 320;
export const WIND_MAX_FILTER_HZ = 2400;
export const WIND_REF_SPEED = 90;        // airspeed (m/s) that maps to WIND_MAX
export const AUDIO_SMOOTHING_TIME = 0.15; // seconds for setTargetAtTime
