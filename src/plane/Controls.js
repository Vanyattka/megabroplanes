import {
  PITCH_RATE,
  ROLL_RATE,
  YAW_RATE,
  CONTROL_RESPONSIVENESS,
  THROTTLE_RATE,
} from '../config.js';

function clamp(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

export function applyControls(plane, input, dt, touch) {
  // Keyboard axes keep their existing (empirically-tuned) sign conventions:
  // positive pitchInput = nose down, positive rollInput = roll left (A key).
  const keyPitch = input.getAxis('KeyS', 'KeyW');
  const keyRoll = input.getAxis('KeyA', 'KeyD');
  const keyYaw = input.getAxis('KeyQ', 'KeyE');

  // Joystick maps so pushing "up" on the stick pitches nose up and pushing
  // right rolls right — matches standard flight-sim feel.
  const joyPitch = touch && touch.enabled ? -touch.joyY : 0;
  const joyRoll = touch && touch.enabled ? -touch.joyX : 0;
  const joyYaw =
    touch && touch.enabled
      ? (touch.yawRight ? 1 : 0) - (touch.yawLeft ? 1 : 0)
      : 0;

  // Wait — that's backwards because + rollInput means roll left.
  // Pushing stick right should roll right (opposite of A key), so the stick's
  // rollInput contribution must be -touch.joyX. Same for pitch: joy-up should
  // match W (nose-up), which is rollInput negative. Both already correct.

  const pitchInput = clamp(keyPitch + joyPitch);
  const rollInput = clamp(keyRoll + joyRoll);
  const yawInput = clamp(keyYaw + joyYaw);

  const targetPitch = pitchInput * PITCH_RATE;
  const targetRoll = rollInput * ROLL_RATE;
  const targetYaw = yawInput * YAW_RATE;

  plane.angularVelocity.x +=
    (targetPitch - plane.angularVelocity.x) * CONTROL_RESPONSIVENESS;
  plane.angularVelocity.z +=
    (targetRoll - plane.angularVelocity.z) * CONTROL_RESPONSIVENESS;
  plane.angularVelocity.y +=
    (targetYaw - plane.angularVelocity.y) * CONTROL_RESPONSIVENESS;

  // Throttle: on touch, the slider sets throttle directly. Otherwise the
  // keyboard rate-drives it via Shift/Ctrl.
  if (touch && touch.enabled && touch.throttleActive) {
    plane.throttle = touch.throttle;
  } else {
    const throttleInput = input.getAxis('ShiftLeft', 'ControlLeft');
    plane.throttle = Math.max(
      0,
      Math.min(1, plane.throttle + throttleInput * THROTTLE_RATE * dt)
    );
  }
}
