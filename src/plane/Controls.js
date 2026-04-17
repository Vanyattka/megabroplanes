import {
  PITCH_RATE,
  ROLL_RATE,
  YAW_RATE,
  CONTROL_RESPONSIVENESS,
  THROTTLE_RATE,
} from '../config.js';

export function applyControls(plane, input, dt) {
  // Inverted: S pitches nose down, W pitches nose up (flight-sim style).
  const pitchInput = input.getAxis('KeyS', 'KeyW');
  // D banks right, A banks left. The sign here comes out of empirical testing:
  // positive local angularVelocity.z rotates the plane such that pressing A rolls
  // right, which is backwards — so we flip by making A the positive key.
  const rollInput = input.getAxis('KeyA', 'KeyD');
  // Inverted: Q yaws right, E yaws left.
  const yawInput = input.getAxis('KeyQ', 'KeyE');

  const targetPitch = pitchInput * PITCH_RATE;
  const targetRoll = rollInput * ROLL_RATE;
  const targetYaw = yawInput * YAW_RATE;

  plane.angularVelocity.x +=
    (targetPitch - plane.angularVelocity.x) * CONTROL_RESPONSIVENESS;
  plane.angularVelocity.z +=
    (targetRoll - plane.angularVelocity.z) * CONTROL_RESPONSIVENESS;
  plane.angularVelocity.y +=
    (targetYaw - plane.angularVelocity.y) * CONTROL_RESPONSIVENESS;

  const throttleInput = input.getAxis('ShiftLeft', 'ControlLeft');
  plane.throttle = Math.max(
    0,
    Math.min(1, plane.throttle + throttleInput * THROTTLE_RATE * dt)
  );
}
