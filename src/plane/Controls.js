import {
  PITCH_RATE,
  ROLL_RATE,
  YAW_RATE,
  CONTROL_RESPONSIVENESS,
  THROTTLE_RATE,
} from '../config.js';

export function applyControls(plane, input, dt) {
  const pitchInput = input.getAxis('KeyW', 'KeyS');
  const rollInput = input.getAxis('KeyD', 'KeyA');
  const yawInput = input.getAxis('KeyE', 'KeyQ');

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
