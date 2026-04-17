# Physics model

Arcade-level flight simulation. Priorities, in order:
1. Stable (doesn't explode numerically).
2. Feels like a plane (banking turns, stalls, accelerates during dive).
3. Can take off from runway with enough speed.
4. Can land at low speed if approached level.

Not a priority: realistic aerodynamics, stall recovery, weather, engine modeling.

## Plane state

```js
{
  position: Vector3,         // world-space
  velocity: Vector3,         // world-space m/s
  quaternion: Quaternion,    // orientation
  angularVelocity: Vector3,  // LOCAL-space rad/s (x=pitch, y=yaw, z=roll)
  throttle: 0..1,
  onGround: boolean
}
```

## Per-step update (fixed dt = 1/60)

### 1. Compute local axes in world space

```js
const forward = new Vector3(0, 0, -1).applyQuaternion(plane.quaternion);
const up      = new Vector3(0, 1, 0).applyQuaternion(plane.quaternion);
const right   = new Vector3(1, 0, 0).applyQuaternion(plane.quaternion);
```

(Nose-toward-`-Z` convention; if the plane model points `+Z`, flip the first vector.)

### 2. Compute forces (world-space Vector3)

**Thrust** — along the plane's nose direction:
```js
const thrust = forward.clone().multiplyScalar(MAX_THRUST * plane.throttle);
```

**Lift** — along the plane's local up. Magnitude depends on forward airspeed squared, **not total velocity magnitude** (critical detail — see pitfalls):
```js
const forwardSpeed = velocity.dot(forward);
const liftMag = LIFT_COEFFICIENT * forwardSpeed * forwardSpeed;
const lift = up.clone().multiplyScalar(liftMag);
```

**Drag** — opposes velocity, proportional to v²:
```js
const speed = velocity.length();
const drag = speed > 0.01
  ? velocity.clone().normalize().multiplyScalar(-DRAG_COEFFICIENT * speed * speed)
  : new Vector3();
```

**Gravity** — world-space down:
```js
const gravity = new Vector3(0, -GRAVITY * MASS, 0);
```

**Sum and integrate (semi-implicit Euler):**
```js
const totalForce = thrust.add(lift).add(drag).add(gravity);
const acceleration = totalForce.divideScalar(MASS);
plane.velocity.add(acceleration.multiplyScalar(dt));
plane.position.add(plane.velocity.clone().multiplyScalar(dt));
```

### 3. Angular integration

Controls set `plane.angularVelocity` (local-space, see Controls section).
Apply it to the quaternion:

```js
const omega = plane.angularVelocity;
const omegaMag = omega.length();
if (omegaMag > 1e-6) {
  const axis = omega.clone().normalize();
  const angle = omegaMag * dt;
  const deltaQ = new Quaternion().setFromAxisAngle(axis, angle);
  plane.quaternion.multiply(deltaQ);  // LOCAL-space composition
  plane.quaternion.normalize();
}
```

### 4. Roll-to-yaw coupling (optional but feels right)

When banked, a plane naturally yaws into the turn. Add:
```js
const rollAngle = Math.asin(right.y);   // positive when banked right
plane.angularVelocity.y += Math.sin(rollAngle) * COUPLING_COEFF;
```
`COUPLING_COEFF ≈ 1.0`. Makes banking actually turn the plane without needing rudder.

### 5. Ground interaction

```js
const groundY = heightAt(plane.position.x, plane.position.z);
const floor = groundY + PLANE_BOTTOM_OFFSET;   // ~0.5m

if (plane.position.y <= floor) {
  plane.position.y = floor;

  const onRunway = isOnRunway(plane.position.x, plane.position.z);
  const levelEnough = up.dot(new Vector3(0, 1, 0)) > 0.9;
  const slowVertical = Math.abs(plane.velocity.y) < 5;

  if (onRunway && levelEnough && slowVertical) {
    // safe landing / taxiing
    plane.velocity.y = Math.max(plane.velocity.y, 0);
    // rolling friction
    plane.velocity.multiplyScalar(Math.max(0, 1 - ROLLING_FRICTION * dt));
    // clamp roll/pitch, only yaw allowed on ground
    plane.angularVelocity.x *= 0.1;
    plane.angularVelocity.z *= 0.1;
    plane.onGround = true;
  } else {
    // MVP: kill velocity and log. No crash state yet.
    plane.velocity.set(0, 0, 0);
    plane.angularVelocity.set(0, 0, 0);
    plane.onGround = true;
    console.warn('Rough landing at', plane.position.toArray());
  }
} else {
  plane.onGround = false;
}
```

## Controls mapping (in `Controls.js`)

```js
const pitchInput = input.getAxis('KeyW', 'KeyS');   // W = dive, S = climb
const rollInput  = input.getAxis('KeyD', 'KeyA');
const yawInput   = input.getAxis('KeyE', 'KeyQ');

const targetPitch = pitchInput * PITCH_RATE;
const targetRoll  = rollInput  * ROLL_RATE;
const targetYaw   = yawInput   * YAW_RATE;

// Smooth toward targets so controls feel weighty, not instant
plane.angularVelocity.x += (targetPitch - plane.angularVelocity.x) * CONTROL_RESPONSIVENESS;
plane.angularVelocity.z += (targetRoll  - plane.angularVelocity.z) * CONTROL_RESPONSIVENESS;
plane.angularVelocity.y += (targetYaw   - plane.angularVelocity.y) * CONTROL_RESPONSIVENESS;

// Throttle
const throttleInput = input.getAxis('ShiftLeft', 'ControlLeft');
plane.throttle = Math.max(0, Math.min(1,
  plane.throttle + throttleInput * THROTTLE_RATE * dt
));
```

Do NOT directly zero out `angularVelocity` when no input — the damping below handles that and creates a sense of inertia.

### Angular damping

After controls update but before integration:
```js
plane.angularVelocity.multiplyScalar(1 - ANGULAR_DAMPING * dt);
```
`ANGULAR_DAMPING ≈ 2.0`. Prevents the plane from spinning forever.

## Starting coefficients

Use these as a starting point and tune empirically. All go in `config.js`.

```js
MASS = 1000                      // kg
GRAVITY = 9.81                   // m/s²

MAX_THRUST = 15000               // N
LIFT_COEFFICIENT = 2.0           // force per m²/s² of forward speed
DRAG_COEFFICIENT = 0.3
ROLLING_FRICTION = 0.5

PITCH_RATE = 1.5                 // rad/s max
ROLL_RATE = 2.5
YAW_RATE = 0.8
CONTROL_RESPONSIVENESS = 0.1     // lerp factor
ANGULAR_DAMPING = 2.0
COUPLING_COEFF = 1.0             // roll-to-yaw

THROTTLE_RATE = 0.5              // full throttle change in 2s

PLANE_BOTTOM_OFFSET = 0.5        // m, half fuselage height
```

### Tuning guide

With these values, the plane should:
- Reach takeoff speed (~40 m/s) after ~300m of runway at full throttle.
- Cruise around 70–100 m/s at level flight, full throttle.
- Stall below ~25 m/s (gravity wins over lift).

If it takes off instantly: lower `LIFT_COEFFICIENT`.
If it never leaves the ground: raise `LIFT_COEFFICIENT` or `MAX_THRUST`.
If turning feels too sharp/floaty: tune `ROLL_RATE` and `COUPLING_COEFF`.
If controls feel twitchy: lower `CONTROL_RESPONSIVENESS`.
If controls feel mushy: raise it.

## Pitfalls

- **Lift from descending.** If lift uses `velocity.length()`, a stalled plane falling straight down generates lift from its falling speed. Always use `velocity.dot(forward)`.
- **Integration order.** Use semi-implicit Euler (update velocity first, then integrate position with new velocity). Regular Euler is less stable.
- **Quaternion drift.** Normalize `plane.quaternion` every step. Without this, accumulated floating-point error warps the plane over time.
- **Local vs world angular velocity.** This spec uses local-space `angularVelocity`. When composing with quaternion use `.multiply(deltaQ)` on the right (local composition), not `.premultiply()`.
- **Division by zero.** `velocity.normalize()` when velocity is zero gives NaN. Guard with `speed > 0.01`.
- **Timestep drift.** Always pass the fixed `dt` into `Physics.step`. Never use `clock.getDelta()` directly here.
- **Over-tuning one coefficient.** If flight feels bad, the problem is usually in two coefficients' ratio (lift vs weight, thrust vs drag), not one value alone.
