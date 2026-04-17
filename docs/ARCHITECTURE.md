# Architecture

## File tree

```
plane-mvp/
├── index.html
├── package.json
├── vite.config.js
├── CLAUDE.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── PHYSICS.md
│   ├── WORLD.md
│   └── ROADMAP.md
└── src/
    ├── main.js                # entry point, game loop
    ├── config.js              # all tunable constants
    ├── core/
    │   ├── Renderer.js        # Three.js scene/camera/renderer wrapper
    │   ├── Input.js           # keyboard state
    │   └── Clock.js           # fixed-timestep accumulator
    ├── world/
    │   ├── Noise.js           # seeded simplex noise, heightAt(x, z)
    │   ├── Terrain.js         # builds one chunk mesh
    │   ├── ChunkManager.js    # streams chunks around the plane
    │   ├── Runway.js          # flat zone + visual runway mesh
    │   └── Sky.js             # background color, fog, lighting
    ├── plane/
    │   ├── Plane.js           # state + visual group
    │   ├── Physics.js         # pure force/torque functions, integration
    │   └── Controls.js        # Input → plane controls with smoothing
    ├── camera/
    │   └── ChaseCamera.js     # follows plane with lerp
    └── ui/
        └── Hud.js             # DOM overlay: speed, altitude, throttle
```

## Module responsibilities

### `main.js`

Entry point. Responsible for:
- Constructing all systems (Renderer, Input, Clock, Plane, ChunkManager, ChaseCamera, Hud).
- Wiring them together.
- Running the game loop via `Clock.tick(physicsCallback, renderCallback)`.

No gameplay logic here. This file should be short (under 100 lines).

### `config.js`

Single source of truth for tunable values. Exports named constants, grouped by domain:

```js
// World
export const CHUNK_SIZE = 128;
export const CHUNK_RESOLUTION = 33;
export const VIEW_DISTANCE_CHUNKS = 4;
export const NOISE_SCALE = 0.005;
export const HEIGHT_AMPLITUDE = 30;

// Runway
export const RUNWAY_LENGTH = 600;
export const RUNWAY_WIDTH = 30;
export const RUNWAY_CHUNK = { cx: 0, cz: 0 };

// Physics
export const GRAVITY = 9.81;
export const MASS = 1000;
export const MAX_THRUST = 15000;
export const LIFT_COEFFICIENT = 2.0;
export const DRAG_COEFFICIENT = 0.3;
export const PITCH_RATE = 1.5;
export const ROLL_RATE = 2.5;
export const YAW_RATE = 0.8;
export const CONTROL_RESPONSIVENESS = 0.1;
export const ROLLING_FRICTION = 0.5;

// Fog / lighting
export const FOG_COLOR = 0x88bbee;
export const FOG_NEAR = 150;
export const FOG_FAR = 450;
```

### `core/Renderer.js`

Wraps `THREE.WebGLRenderer`, `THREE.Scene`, `THREE.PerspectiveCamera`.
- Handles window resize.
- Sets fog from config.
- Exposes `scene`, `camera`, `render()`.
- Camera `far` must be larger than `FOG_FAR` (e.g., `FOG_FAR * 1.5`).

### `core/Input.js`

Keyboard state tracked via `keydown` / `keyup`.

API:
- `isPressed(key)` → boolean
- `getAxis(posKey, negKey)` → -1 / 0 / +1

Controls mapping:
| Key | Action |
|---|---|
| `W` / `S` | Pitch down / up |
| `A` / `D` | Roll left / right |
| `Q` / `E` | Yaw left / right |
| `Shift` / `Ctrl` | Throttle up / down |
| `Space` | Brake (when on ground) |

### `core/Clock.js`

Wraps `THREE.Clock`. Exposes:

```js
tick(physicsStep, renderStep) {
  accumulator += min(clock.getDelta(), 0.1);   // clamp spiral-of-death
  while (accumulator >= FIXED_STEP) {
    physicsStep(FIXED_STEP);
    accumulator -= FIXED_STEP;
  }
  renderStep();
}
```

`FIXED_STEP = 1/60`.

### `world/Noise.js`

Wraps `simplex-noise`. Seeded deterministically (e.g., seed `1`).

Exports `heightAt(worldX, worldZ)` which sums 2–3 octaves of noise. **Depends only on world coordinates, never on chunk coordinates.** This is what guarantees seamless chunk borders.

### `world/Terrain.js`

Builds a `THREE.Mesh` for one chunk at given `(cx, cz)`:
1. `PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, RES-1, RES-1)` rotated -90° around X.
2. For each vertex, set Y from `Noise.heightAt(worldX, worldZ)`.
3. If chunk is `RUNWAY_CHUNK`, force vertices in runway rectangle to Y=0 (with a margin).
4. Assign vertex colors by height/slope.
5. `computeVertexNormals()`.
6. Material: `MeshStandardMaterial({ vertexColors: true, flatShading: true })` for low-poly look.

### `world/ChunkManager.js`

Maintains `Map<"cx,cz", Mesh>` of active chunks.

Each frame (or every N frames):
1. Compute plane's current chunk coords.
2. Iterate `(2*VIEW_DISTANCE+1)²` grid around plane.
3. Add missing chunks (call `Terrain.build(cx, cz)` and add to scene).
4. Remove chunks outside range (scene.remove + `geometry.dispose()` + `material.dispose()`).

### `world/Runway.js`

Produces:
- The visual runway mesh (thin plane at y=0.01 with `CanvasTexture` drawn programmatically).
- `isOnRunway(x, z)` for physics ground check.
- Starting spawn pose (position + orientation) for the plane.

### `world/Sky.js`

- Sets `scene.background` to sky color.
- Adds `HemisphereLight` + `DirectionalLight` (no shadow maps for MVP).
- Fog color must match sky color exactly.

### `plane/Plane.js`

State:

```js
{
  position: Vector3,
  velocity: Vector3,            // world-space m/s
  quaternion: Quaternion,
  angularVelocity: Vector3,     // local-space rad/s (pitch, yaw, roll)
  throttle: 0..1,
  onGround: boolean,
  mesh: Group                   // built from primitives, see WORLD.md
}
```

Exposes `update(dt)` which calls `Physics.step(this, dt, terrain)` and syncs mesh transform.

### `plane/Physics.js`

Pure functions. No class. See `docs/PHYSICS.md` for the full model.

### `plane/Controls.js`

Reads `Input`, writes smoothed target values to `plane.angularVelocity` and `plane.throttle`.

### `camera/ChaseCamera.js`

Every render frame:
```
desiredPos = plane.position + (offset in plane's local frame)
camera.position.lerp(desiredPos, CAMERA_LERP)
camera.lookAt(plane.position)
```

Offset: roughly `(0, 3, 12)` in plane's local frame (behind and above).

### `ui/Hud.js`

Plain DOM `<div id="hud">` with inline styles, overlaid on canvas via `position: absolute`. Updated every render frame with speed (knots), altitude (feet), throttle percent.

## Data flow per frame

```
Clock.tick
├── physics step (fixed dt, possibly multiple iterations)
│   ├── Controls.apply(plane, input)
│   ├── Physics.step(plane, dt, getHeight)
│   └── ChunkManager.update(plane.position)
└── render step (once per frame)
    ├── ChaseCamera.update(plane)
    ├── Renderer.render(scene, camera)
    └── Hud.update(plane)
```

Note `ChunkManager.update` is in the physics step here because it depends on plane position, but it's fine to run it less often (every 10 frames) as a perf optimization later.
