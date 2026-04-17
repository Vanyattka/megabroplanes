// All tunable constants. No magic numbers in logic files.

// Timing
export const FIXED_STEP = 1 / 60;
export const MAX_FRAME_DT = 0.1;

// World
export const CHUNK_SIZE = 128;
export const CHUNK_RESOLUTION = 33;
export const VIEW_DISTANCE_CHUNKS = 4;
export const NOISE_SCALE = 0.005;
export const HEIGHT_AMPLITUDE = 30;
export const NOISE_SEED = 'plane-mvp-seed';

// Runway
export const RUNWAY_LENGTH = 600;
export const RUNWAY_WIDTH = 30;
export const RUNWAY_MARGIN = 20;
export const RUNWAY_CHUNK = { cx: 0, cz: 0 };
export const RUNWAY_Y = 0.02;

// Physics
export const GRAVITY = 9.81;
export const MASS = 1000;
export const MAX_THRUST = 15000;
// Tuned from starting value 2.0: weight is MASS*GRAVITY = 9810 N, and we want
// lift to equal weight at ~40 m/s. 9810 / 40^2 ≈ 6.1, so 6.0 gives takeoff ~40 m/s.
export const LIFT_COEFFICIENT = 6.0;
export const DRAG_COEFFICIENT = 0.3;
export const ROLLING_FRICTION = 0.5;

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

// Fog / lighting
export const FOG_COLOR = 0x88bbee;
export const FOG_NEAR = 150;
export const FOG_FAR = 420;

// Camera
export const CAMERA_FOV = 70;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = FOG_FAR * 1.5;
export const CAMERA_OFFSET = [0, 3, 12]; // behind and above in plane's local frame
export const CAMERA_LERP = 0.1;
