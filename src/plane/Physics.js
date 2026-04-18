import { Vector3, Quaternion } from 'three';
import {
  GRAVITY,
  MASS,
  MAX_THRUST,
  LIFT_COEFFICIENT,
  LIFT_REFERENCE_SPEED,
  DRAG_COEFFICIENT,
  VELOCITY_ALIGN_RATE,
  VELOCITY_ALIGN_LOW_SPEED,
  VELOCITY_ALIGN_HIGH_SPEED,
  STALL_PITCH_SPEED,
  STALL_PITCH_RATE,
  STALL_PITCH_NOSE_UP_BIAS,
  ROLLING_FRICTION,
  COUPLING_COEFF,
  ANGULAR_DAMPING,
  PLANE_BOTTOM_OFFSET,
  BRAKE_STRENGTH,
  CRASH_MIN_SPEED,
} from '../config.js';

const _forward = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _thrust = new Vector3();
const _lift = new Vector3();
const _drag = new Vector3();
const _gravity = new Vector3();
const _total = new Vector3();
const _accel = new Vector3();
const _deltaQ = new Quaternion();
const _axis = new Vector3();
const _worldUp = new Vector3(0, 1, 0);

export function step(plane, dt, getHeight, isOnRunway, braking, crashesEnabled) {
  if (plane.crashed) return;
  _forward.set(0, 0, -1).applyQuaternion(plane.quaternion);
  _up.set(0, 1, 0).applyQuaternion(plane.quaternion);
  _right.set(1, 0, 0).applyQuaternion(plane.quaternion);

  // Forces
  _thrust.copy(_forward).multiplyScalar(MAX_THRUST * plane.throttle);

  const forwardSpeed = plane.velocity.dot(_forward);
  // Clamp the speed used for lift so it saturates — a real wing stalls past
  // its max coefficient of lift. Arcade version: lift grows with speed up to
  // LIFT_REFERENCE_SPEED, then stays flat. Prevents runaway climbing.
  const liftSpeed = Math.min(Math.abs(forwardSpeed), LIFT_REFERENCE_SPEED);
  const liftMag = LIFT_COEFFICIENT * liftSpeed * liftSpeed;
  _lift.copy(_up).multiplyScalar(liftMag);

  const speed = plane.velocity.length();
  if (speed > 0.01) {
    _drag
      .copy(plane.velocity)
      .normalize()
      .multiplyScalar(-DRAG_COEFFICIENT * speed * speed);
  } else {
    _drag.set(0, 0, 0);
  }

  _gravity.set(0, -GRAVITY * MASS, 0);

  _total.copy(_thrust).add(_lift).add(_drag).add(_gravity);
  _accel.copy(_total).divideScalar(MASS);

  // Semi-implicit Euler
  plane.velocity.addScaledVector(_accel, dt);

  // Velocity alignment: bleed the component of velocity that's perpendicular
  // to the nose, so the plane actually moves where it's pointed. Only apply
  // in the air — on the ground the runway constrains motion.
  if (!plane.onGround) {
    const speedNow = plane.velocity.length();
    // Only apply alignment if the plane is flying forward fast enough. Below
    // stall speed, gravity takes over and the plane drops.
    const alignT =
      (forwardSpeed - VELOCITY_ALIGN_LOW_SPEED) /
      (VELOCITY_ALIGN_HIGH_SPEED - VELOCITY_ALIGN_LOW_SPEED);
    const alignFactor = Math.max(0, Math.min(1, alignT));
    if (speedNow > 0.01 && alignFactor > 0) {
      const blend = Math.min(1, VELOCITY_ALIGN_RATE * alignFactor * dt);
      plane.velocity.x += (_forward.x * speedNow - plane.velocity.x) * blend;
      plane.velocity.y += (_forward.y * speedNow - plane.velocity.y) * blend;
      plane.velocity.z += (_forward.z * speedNow - plane.velocity.z) * blend;
    }
  }

  plane.position.addScaledVector(plane.velocity, dt);

  // Roll-to-yaw coupling
  const rollAngle = Math.asin(Math.max(-1, Math.min(1, _right.y)));
  plane.angularVelocity.y += Math.sin(rollAngle) * COUPLING_COEFF * dt;

  // Stall pitch-down: below STALL_PITCH_SPEED a bias torque pulls the nose
  // down. Strength ramps linearly from 0 at the threshold up to full at zero
  // airspeed, and is amplified when the nose is already pitched up — so
  // hanging the plane by its nose quickly tips it forward into a recovery
  // dive instead of hovering unrealistically.
  if (!plane.onGround) {
    const stallT = Math.max(0, 1 - forwardSpeed / STALL_PITCH_SPEED);
    if (stallT > 0) {
      const noseUp = Math.max(0, _forward.y);
      const strength = 0.3 + noseUp * STALL_PITCH_NOSE_UP_BIAS;
      plane.angularVelocity.x += STALL_PITCH_RATE * stallT * strength * dt;
    }
  }

  // Angular damping
  plane.angularVelocity.multiplyScalar(Math.max(0, 1 - ANGULAR_DAMPING * dt));

  // Angular integration
  const omegaMag = plane.angularVelocity.length();
  if (omegaMag > 1e-6) {
    _axis.copy(plane.angularVelocity).normalize();
    const angle = omegaMag * dt;
    _deltaQ.setFromAxisAngle(_axis, angle);
    plane.quaternion.multiply(_deltaQ);
    plane.quaternion.normalize();
  }

  // Ground interaction
  const groundY = getHeight(plane.position.x, plane.position.z);
  const floor = groundY + PLANE_BOTTOM_OFFSET;

  if (plane.position.y <= floor) {
    plane.position.y = floor;

    const onRunway = isOnRunway(plane.position.x, plane.position.z);
    const levelEnough = _up.dot(_worldUp) > 0.9;
    const slowVertical = Math.abs(plane.velocity.y) < 5;

    if (onRunway && levelEnough && slowVertical) {
      plane.velocity.y = Math.max(plane.velocity.y, 0);
      const frictionRate = ROLLING_FRICTION + (braking ? BRAKE_STRENGTH : 0);
      plane.velocity.multiplyScalar(Math.max(0, 1 - frictionRate * dt));
      plane.angularVelocity.x *= 0.1;
      plane.angularVelocity.z *= 0.1;
      plane.onGround = true;
    } else {
      // Any high-speed impact outside a safe landing zone = crash. This
      // catches both steep dives AND horizontal slams into a hillside (where
      // total speed is high but vertical speed is low). A slow bump still
      // just rough-stops the plane.
      const speed = plane.velocity.length();
      const isCrashImpact = speed >= CRASH_MIN_SPEED;

      if (crashesEnabled && isCrashImpact) {
        plane.crashed = true;
        plane.crashImpact = {
          position: plane.position.clone(),
          velocity: plane.velocity.clone(),
        };
        plane.velocity.set(0, 0, 0);
        plane.angularVelocity.set(0, 0, 0);
      } else {
        plane.velocity.set(0, 0, 0);
        plane.angularVelocity.set(0, 0, 0);
        plane.onGround = true;
        if (!plane._roughLogged) {
          console.warn('Rough landing at', plane.position.toArray());
          plane._roughLogged = true;
        }
      }
    }
  } else {
    plane.onGround = false;
    plane._roughLogged = false;
  }
}
