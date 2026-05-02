# Physics model

Arcade-level flight simulation. Priorities, in order:
1. Stable (doesn't explode numerically).
2. Feels like a plane (banking turns, stalls, accelerates during a dive).
3. Three personalities — Cessna (forgiving), Piper (balanced), Jet (sharp + fast).
4. Can take off, land, crash. Can be set to non-crash mode (`crashesEnabled`).

Not modelled: realistic aerodynamics, rotors, wind, weather, engine warm-up, fuel.

## Plane state

```js
{
  position:        Vector3,    // world-space (m)
  velocity:        Vector3,    // world-space (m/s)
  quaternion:      Quaternion, // orientation
  angularVelocity: Vector3,    // local-space rad/s (x=pitch, y=yaw, z=roll)
  throttle:        0..1,
  onGround:        boolean,
  crashed:         boolean,
  crashImpact:     { position, velocity } | null,

  // For the chase camera + visual interpolation only — physics never reads these.
  renderPosition:   Vector3,
  renderQuaternion: Quaternion,
  _prevPosition:    Vector3,
  _prevQuaternion:  Quaternion,

  // Type-specific multipliers (resolved from PLANE_TYPES on setLoadout).
  type:  'cessna' | 'piper' | 'jet',
  color: <hex int>,
  // Each type scales: thrustMult, dragMult, liftMult, liftRefMult,
  // pitchRateMult, rollRateMult, yawRateMult, couplingMult.
}
```

## Plane types

Multipliers in `PLANE_TYPES` are layered on top of the global constants in `config.js`. Current values:

| | Cessna | Piper | Jet |
|---|---|---|---|
| Thrust | × 0.55 | × 1.0 | × 2.5 |
| Drag | × 1.4 | × 1.0 | × 0.7 |
| Lift | × 1.1 | × 1.0 | × 0.85 |
| Lift-ref speed | × 0.95 | × 1.0 | × 1.2 |
| Pitch / Roll / Yaw rate | × 0.80 / 0.70 / 0.80 | × 1.0 | × 1.40 / 1.70 / 1.20 |
| Roll-yaw coupling | × 1.00 | × 1.0 | × 0.80 |

The Jet is also the only type that gets the engine PointLight, exhaust plume, and contrails.

## Per-step update (fixed `dt = 1/60`)

The substeps run in this order. Skipped entirely while `gameState === 'menu'` or `photoMode === true`.

### 1. Local axes in world space

```js
const forward = new Vector3(0, 0, -1).applyQuaternion(plane.quaternion);
const up      = new Vector3(0, 1, 0).applyQuaternion(plane.quaternion);
const right   = new Vector3(1, 0, 0).applyQuaternion(plane.quaternion);
```

Convention: nose points local `-Z`. The mesh in `PlaneMesh.js` is built to that convention.

### 2. Forces (world-space)

**Thrust** along the nose, scaled by throttle and the plane type:
```js
const thrust = forward.clone().multiplyScalar(MAX_THRUST * thrustMult * plane.throttle);
```

**Lift** along local up. Magnitude depends on `forwardSpeed²`, capped at `LIFT_REFERENCE_SPEED²` so cruise doesn't balloon upward, and a `STALL_LIFT_CUTOFF` smoothstep collapses it toward zero at low airspeed:
```js
const forwardSpeed = velocity.dot(forward);
const speedForLift = Math.min(Math.abs(forwardSpeed), LIFT_REFERENCE_SPEED * liftRefMult);
const stallFactor = smoothstep(STALL_LIFT_CUTOFF * 0.6, STALL_LIFT_CUTOFF, Math.abs(forwardSpeed));
const liftMag = LIFT_COEFFICIENT * liftMult * speedForLift * speedForLift * stallFactor;
const lift = up.clone().multiplyScalar(liftMag);
```

**Drag** opposes velocity, proportional to v²:
```js
const speed = velocity.length();
const drag = speed > 0.01
  ? velocity.clone().normalize().multiplyScalar(-DRAG_COEFFICIENT * dragMult * speed * speed)
  : new Vector3();
```

**Gravity** world-space down:
```js
const gravity = new Vector3(0, -GRAVITY * MASS, 0);
```

**Sum and integrate (semi-implicit Euler):**
```js
plane.velocity.add(totalForce.divideScalar(MASS).multiplyScalar(dt));
plane.position.add(plane.velocity.clone().multiplyScalar(dt));
```

### 3. Velocity-aligns-with-nose torque

Without this, you can point the nose somewhere and the velocity vector keeps drifting in its old direction — the plane "skids". Real planes don't do that. We bend velocity toward the forward direction at a rate that ramps up between `VELOCITY_ALIGN_LOW_SPEED` (≈22 m/s — barely flying) and `VELOCITY_ALIGN_HIGH_SPEED` (≈42 m/s — full authority):

```js
const authority = smoothstep(VELOCITY_ALIGN_LOW_SPEED, VELOCITY_ALIGN_HIGH_SPEED, Math.abs(forwardSpeed));
const target = forward.clone().multiplyScalar(velocity.length());
plane.velocity.lerp(target, 1 - Math.exp(-dt * VELOCITY_ALIGN_RATE * authority));
```

Below `LOW_SPEED` the plane is stalled — gravity dominates and pitching nose-up does nothing useful. That's intentional.

### 4. Stall pitch-down

When forward speed drops below `STALL_PITCH_SPEED` and the nose is pointing above horizon, apply a pitch-down torque proportional to (a) how slow you are and (b) how nose-up you are. Re-enters flying speed automatically.

```js
if (forwardSpeed < STALL_PITCH_SPEED && forward.y > 0) {
  const stallness = 1 - forwardSpeed / STALL_PITCH_SPEED;
  const noseUpFactor = forward.y;
  plane.angularVelocity.x -= STALL_PITCH_RATE * stallness * (1 + STALL_PITCH_NOSE_UP_BIAS * noseUpFactor) * dt;
}
```

### 5. Angular integration

```js
const omega = plane.angularVelocity;
const omegaMag = omega.length();
if (omegaMag > 1e-6) {
  const axis = omega.clone().normalize();
  const angle = omegaMag * dt;
  const deltaQ = new Quaternion().setFromAxisAngle(axis, angle);
  plane.quaternion.multiply(deltaQ).normalize();   // local-space composition
}
```

### 6. Roll → yaw coupling

Banking turns the plane:
```js
const rollAngle = Math.asin(right.y);   // positive when banked right
plane.angularVelocity.y += Math.sin(rollAngle) * COUPLING_COEFF * couplingMult;
```

### 7. Angular damping

After controls update, before integration:
```js
plane.angularVelocity.multiplyScalar(1 - ANGULAR_DAMPING * dt);
```
Prevents perpetual spin.

### 8. Ground interaction

`Ground.physicsFloor(x, z)` returns the terrain height at the plane's XZ. Floor = `groundHeight + PLANE_BOTTOM_OFFSET`.

Three landing outcomes:
1. **On runway, level, slow** → safe taxi/landing. Pin `position.y = floor`, clamp roll/pitch angular velocity, apply `ROLLING_FRICTION`.
2. **Off runway, but flat ground (nose level, gentle vertical speed)** → safe rough landing — same as above but with extra ground friction. Lets you land in a meadow without exploding.
3. **Steep / fast / nose-down impact** → crash, if `crashesEnabled`. Recorded as `plane.crashImpact` so `main.js` can trigger an explosion.

Crash criteria (all must be true):
- `total speed ≥ CRASH_MIN_SPEED` (35 m/s)
- `downward velocity ≥ CRASH_MIN_DOWN_SPEED` (18 m/s)
- `dive angle ≥ CRASH_MIN_DIVE_DOT` (≈30° below horizon)

`crashesEnabled` is the toggle in the menu / on screen. When off, all impacts collapse to the "rough landing" branch.

## Controls mapping (in `Controls.js`)

```js
const pitchInput = input.getAxis('KeyW', 'KeyS');   // W = dive, S = climb
const rollInput  = input.getAxis('KeyD', 'KeyA');
const yawInput   = input.getAxis('KeyE', 'KeyQ');

const targetPitch = pitchInput * PITCH_RATE * pitchRateMult;
const targetRoll  = rollInput  * ROLL_RATE  * rollRateMult;
const targetYaw   = yawInput   * YAW_RATE   * yawRateMult;

plane.angularVelocity.x += (targetPitch - plane.angularVelocity.x) * CONTROL_RESPONSIVENESS;
plane.angularVelocity.z += (targetRoll  - plane.angularVelocity.z) * CONTROL_RESPONSIVENESS;
plane.angularVelocity.y += (targetYaw   - plane.angularVelocity.y) * CONTROL_RESPONSIVENESS;

const throttleInput = input.getAxis('ShiftLeft', 'ControlLeft');
plane.throttle = clamp(plane.throttle + throttleInput * THROTTLE_RATE * dt, 0, 1);
```

The same code path also reads `touch.{pitch, roll, yaw, throttle, brake}` — the on-screen joystick + slider feed identical axes.

Mouse drag is purely for the camera, not for plane controls. See `ChaseCamera.js`.

## Render-side: visual interpolation

Physics ticks at 60 Hz. Render runs at whatever `requestAnimationFrame` gives (often 120 Hz on modern displays). Naively, you'd see the plane jump every other render frame whenever physics didn't tick. The fix is in `Plane.js` / `Clock.js`:

- `Plane.update()` snapshots `_prevPosition / _prevQuaternion` *before* mutating.
- `Clock.tick(physics, render)` passes `alpha = accumulator / FIXED_STEP` to render.
- `Plane.updateRender(alpha)` lerps `(_prevPosition, position)` and slerps `(_prevQuaternion, quaternion)` into `renderPosition` / `renderQuaternion`, and copies them to the mesh.
- Camera, water, and shadow read `renderPosition`. Physics still reads `position`.

In photo mode the snapshots are collapsed (`_prevPosition := position`) so the lerp is a no-op while physics is paused.

## Current coefficients

| Constant | Value | Note |
|---|---|---|
| `MASS` | 1000 kg | |
| `GRAVITY` | 9.81 m/s² | |
| `MAX_THRUST` | 15 000 N | × thrustMult per type |
| `LIFT_COEFFICIENT` | 6.0 | weight equals lift at ~40 m/s on the Piper |
| `LIFT_REFERENCE_SPEED` | 45 m/s | speed cap fed to lift |
| `STALL_LIFT_CUTOFF` | 28 m/s | smoothstep above which lift "engages" |
| `STALL_PITCH_SPEED` | 38 m/s | pitch-down kicks in below |
| `STALL_PITCH_RATE` | 2.2 rad/s² | |
| `STALL_PITCH_NOSE_UP_BIAS` | 2.5 | extra torque scaling with `forward.y` |
| `DRAG_COEFFICIENT` | 1.8 | full-throttle cruise ≈ 90 m/s on the Piper |
| `VELOCITY_ALIGN_RATE` | 2.0 / s | half-life ≈ 0.35 s |
| `VELOCITY_ALIGN_LOW_SPEED` | 22 m/s | below: no align (gravity wins) |
| `VELOCITY_ALIGN_HIGH_SPEED` | 42 m/s | above: full align |
| `ROLLING_FRICTION` | 0.05 | tire friction on runway |
| `BRAKE_STRENGTH` | 1.5 | extra friction with Space |
| `PITCH_RATE` | 1.5 rad/s | × pitchRateMult |
| `ROLL_RATE` | 2.5 rad/s | × rollRateMult |
| `YAW_RATE` | 0.8 rad/s | × yawRateMult |
| `CONTROL_RESPONSIVENESS` | 0.1 | lerp factor toward input target |
| `ANGULAR_DAMPING` | 2.0 / s | |
| `COUPLING_COEFF` | 1.0 | × couplingMult |
| `THROTTLE_RATE` | 0.5 / s | full sweep in 2 s |
| `PLANE_BOTTOM_OFFSET` | 0.5 m | half fuselage |
| `CRASH_MIN_SPEED` | 35 m/s | |
| `CRASH_MIN_DOWN_SPEED` | 18 m/s | |
| `CRASH_MIN_DIVE_DOT` | 0.5 | ≈ 30° below horizon |

These were tuned empirically. If you change one, expect to re-tune at least one neighbour. The comments in `config.js` document the rationale per value (e.g. why `DRAG_COEFFICIENT` was raised from 0.3 → 1.8).

### Tuning guide

With current values, expect roughly:
- Cessna takeoff at ~50 m/s after 350 m of runway, full throttle.
- Piper takeoff at ~40 m/s after 250 m.
- Jet takeoff at ~35 m/s after 200 m, then climb out aggressively.
- Cruise at ~70–90 m/s for piston types, 200+ m/s for the Jet.
- Stall pitch-down kicks in below 38 m/s and recovers automatically as long as you're not yanking back hard.

If a change makes flight feel wrong, the problem is almost always a *ratio* (lift vs weight, thrust vs drag, alignment authority vs gravity), not one constant in isolation.

## Pitfalls

- **Lift from descending.** If lift uses `velocity.length()`, a stalled plane falling straight down generates lift from its falling speed. We use `velocity.dot(forward)`.
- **Quaternion drift.** Normalize every step. Without this, accumulated FP error warps the plane.
- **Local vs world angular velocity.** `angularVelocity` is local-space. Compose with `quaternion.multiply(deltaQ)` (right-multiply, local) — *not* `premultiply`.
- **Division by zero.** Guard `velocity.normalize()` calls with `length > 0.01`.
- **Timestep.** Always pass `FIXED_STEP` into `Plane.update`, never `clock.getDelta()`. The accumulator handles wall-clock variability.
- **Visual interpolation skipped on crash.** `updateRender(alpha)` early-outs when `crashed` so the wreck stays put after impact instead of sliding.
- **Photo mode and physics.** `physicsStep` early-returns. The snapshot collapse in `setPhotoMode(true)` keeps the rendered mesh from "drifting between two stale snapshots" while paused.
