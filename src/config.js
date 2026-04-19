// All tunable constants. No magic numbers in logic files.

// Timing
export const FIXED_STEP = 1 / 60;
export const MAX_FRAME_DT = 0.1;

// World
export const CHUNK_SIZE = 128;
export const CHUNK_RESOLUTION = 33;
export const VIEW_DISTANCE_CHUNKS = 4;
// Dynamic view scales with altitude — higher flights unlock bigger view.
export const VIEW_DISTANCE_MIN = 4;
export const VIEW_DISTANCE_MAX = 7;
export const VIEW_ALT_SCALE = 600; // altitude (m) at which view reaches MAX
export const NOISE_SCALE = 0.005;
export const HEIGHT_AMPLITUDE = 30;
export const NOISE_SEED = 'plane-mvp-seed';

// Runway
export const RUNWAY_LENGTH = 600;
export const RUNWAY_WIDTH = 30;
export const RUNWAY_MARGIN = 20;
// Distance beyond the flat zone over which terrain height ramps from 0 to
// full noise. Prevents a sudden wall of hills at the runway ends.
export const RUNWAY_BLEND = 150;
export const RUNWAY_Y = 0.02;

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

// Ruins — old stone structures on mountain peaks.
export const RUIN_CELL_SIZE = 2400;
export const RUIN_CHANCE = 0.55;     // of a cell containing an eligible mountain peak
export const RUIN_MIN_HEIGHT = 32;   // groundHeight must exceed this for a ruin to spawn

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
export const PLANE_BOTTOM_OFFSET = 0.5;
export const BRAKE_STRENGTH = 1.5;

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
export const FOG_NEAR = 150;
export const FOG_FAR = 420;
// Dynamic fog bounds — scaled by altitude. FOG_FAR above is the base (ground).
export const FOG_FAR_MIN = 420;
export const FOG_FAR_MAX = 950;

// Terrain coloring — slope threshold (vertex normal.y below this = rock).
export const SLOPE_ROCK_THRESHOLD = 0.72;

// Biomes — a low-frequency noise field selects between lake/forest/hills/
// mountain. Parameters blend smoothly across boundaries.
export const BIOME_SCALE = 0.0006;              // biome feature size (~1700m across)
export const MAX_TREE_FACTOR = 2.8;             // forest peak tree-density multiplier
export const MAX_ROCK_FACTOR = 2.5;             // mountain peak rock-density multiplier

// Water — shader-based reflective surface. Follows the camera horizontally,
// sized to outlast fog on all sides.
export const WATER_LEVEL = -4;
export const WATER_SIZE = 2 * VIEW_DISTANCE_CHUNKS * CHUNK_SIZE * 1.8; // roomier than the minimum so fog hides the edge
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
export const EXPLOSION_PARTICLE_COUNT = 80;
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
export const JET_EXHAUST_OFFSET_Z = 5.5; // local +Z distance behind plane

// Scatter density per chunk — these are candidate counts. Biome acceptance
// filters them down; a pure forest keeps nearly all candidates, mountains
// reject most trees but keep most rocks.
export const TREES_PER_CHUNK = 140;
export const ROCKS_PER_CHUNK = 40;
export const TREE_MIN_HEIGHT = 1.5;
export const TREE_MAX_HEIGHT = 24;
export const TREE_MAX_SLOPE = 0.35;   // tan of slope: reject steep spots

// Camera
export const CAMERA_FOV = 70;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = FOG_FAR_MAX * 1.5; // matches the widest fog we'll use
export const CAMERA_OFFSET = [0, 3, 12]; // behind and above in plane's local frame
export const CAMERA_LERP = 0.1;

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
// Run-time multiplier — allows speed-of-day tweaking without code edits.
export const DAY_TIME_MULT = 1.0;
// Keyframes interpolated (in t order) to colour the sky, fog, and lights.
// Values at t=0 and t=1 must match (seamless loop).
export const DAY_NIGHT_KEYFRAMES = [
  // midnight
  { t: 0.00, skyColor: 0x05091a, horizonColor: 0x0b1226, fogColor: 0x0b1226, sunColor: 0x3a4e78, sunIntensity: 0.05, ambientColor: 0x222c44, ambientIntensity: 0.18, starsOpacity: 1.0 },
  // pre-dawn
  { t: 0.18, skyColor: 0x1c2340, horizonColor: 0x48394e, fogColor: 0x3e3448, sunColor: 0x8866aa, sunIntensity: 0.15, ambientColor: 0x3a3846, ambientIntensity: 0.25, starsOpacity: 0.6 },
  // dawn
  { t: 0.25, skyColor: 0x4a6ea8, horizonColor: 0xe6a378, fogColor: 0xe0a683, sunColor: 0xffb070, sunIntensity: 0.55, ambientColor: 0x9a7a70, ambientIntensity: 0.45, starsOpacity: 0.15 },
  // noon
  { t: 0.5,  skyColor: 0x3b72c4, horizonColor: 0xcfe2f3, fogColor: 0xcfe2f3, sunColor: 0xfff4d0, sunIntensity: 1.20, ambientColor: 0xffffff, ambientIntensity: 0.85, starsOpacity: 0.0 },
  // dusk
  { t: 0.75, skyColor: 0x2a3f7a, horizonColor: 0xf08a55, fogColor: 0xe28060, sunColor: 0xff6a2a, sunIntensity: 0.55, ambientColor: 0x8a5030, ambientIntensity: 0.45, starsOpacity: 0.15 },
  // post-dusk
  { t: 0.82, skyColor: 0x1c2340, horizonColor: 0x48394e, fogColor: 0x3e3448, sunColor: 0x8866aa, sunIntensity: 0.15, ambientColor: 0x3a3846, ambientIntensity: 0.25, starsOpacity: 0.6 },
  // midnight (loop close)
  { t: 1.00, skyColor: 0x05091a, horizonColor: 0x0b1226, fogColor: 0x0b1226, sunColor: 0x3a4e78, sunIntensity: 0.05, ambientColor: 0x222c44, ambientIntensity: 0.18, starsOpacity: 1.0 },
];
export const STARS_COUNT = 600;
export const STARS_RADIUS = 800; // dome radius around the camera

// ---------------------------------------------------------------------------
// Roads between villages — procedural ribbons on top of terrain.
// ---------------------------------------------------------------------------
export const ROAD_WIDTH = 6;
export const ROAD_COLOR = 0x4a453f;
export const ROAD_SAMPLE_STEP = 20;                     // meters between centerline samples
export const ROAD_MAX_VILLAGE_LINK_DISTANCE = 3600;     // don't attempt roads longer than this
export const ROAD_MAX_SLOPE = 0.55;                     // |dy| / step; higher = too steep
export const ROAD_RUNWAY_DISTANCE = 3000;               // spur-to-home-runway threshold
export const ROAD_Y_OFFSET = 0.18;                      // lift above ground to avoid z-fight

// ---------------------------------------------------------------------------
// Audio — procedural engine + wind through the Web Audio API.
// ---------------------------------------------------------------------------
export const AUDIO_MASTER_VOLUME = 0.55;
export const ENGINE_MIN_PITCH = 75;
export const ENGINE_MAX_PITCH = 340;
export const ENGINE_MIN_GAIN = 0.05;
export const ENGINE_MAX_GAIN = 0.32;
export const WIND_MIN_GAIN = 0.00;
export const WIND_MAX_GAIN = 0.26;
export const WIND_MIN_FILTER_HZ = 320;
export const WIND_MAX_FILTER_HZ = 2400;
export const WIND_REF_SPEED = 90;        // airspeed (m/s) that maps to WIND_MAX
export const AUDIO_SMOOTHING_TIME = 0.15; // seconds for setTargetAtTime
