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
// Distance beyond the flat zone over which terrain height ramps from 0 to
// full noise. Prevents a sudden wall of hills at the runway ends.
export const RUNWAY_BLEND = 150;
export const RUNWAY_CHUNK = { cx: 0, cz: 0 };
export const RUNWAY_Y = 0.02;

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

// Mouse look
export const MOUSE_LOOK_SENSITIVITY = 0.003; // radians per pixel of drag
export const MOUSE_LOOK_RECENTER = 3.0; // 1/s decay toward zero when not dragging
export const MOUSE_LOOK_PITCH_LIMIT = Math.PI / 2 - 0.1;
