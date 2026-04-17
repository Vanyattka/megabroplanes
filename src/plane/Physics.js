import { Vector3, Quaternion } from 'three';
import {
  GRAVITY,
  MASS,
  MAX_THRUST,
  LIFT_COEFFICIENT,
  DRAG_COEFFICIENT,
  ROLLING_FRICTION,
  COUPLING_COEFF,
  ANGULAR_DAMPING,
  PLANE_BOTTOM_OFFSET,
  BRAKE_STRENGTH,
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

export function step(plane, dt, getHeight, isOnRunway, braking) {
  _forward.set(0, 0, -1).applyQuaternion(plane.quaternion);
  _up.set(0, 1, 0).applyQuaternion(plane.quaternion);
  _right.set(1, 0, 0).applyQuaternion(plane.quaternion);

  // Forces
  _thrust.copy(_forward).multiplyScalar(MAX_THRUST * plane.throttle);

  const forwardSpeed = plane.velocity.dot(_forward);
  const liftMag = LIFT_COEFFICIENT * forwardSpeed * forwardSpeed;
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
  plane.position.addScaledVector(plane.velocity, dt);

  // Roll-to-yaw coupling
  const rollAngle = Math.asin(Math.max(-1, Math.min(1, _right.y)));
  plane.angularVelocity.y += Math.sin(rollAngle) * COUPLING_COEFF * dt;

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
      plane.velocity.set(0, 0, 0);
      plane.angularVelocity.set(0, 0, 0);
      plane.onGround = true;
      if (!plane._roughLogged) {
        console.warn('Rough landing at', plane.position.toArray());
        plane._roughLogged = true;
      }
    }
  } else {
    plane.onGround = false;
    plane._roughLogged = false;
  }
}
