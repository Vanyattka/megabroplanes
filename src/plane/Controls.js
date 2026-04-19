import {
  PITCH_RATE,
  ROLL_RATE,
  YAW_RATE,
  CONTROL_RESPONSIVENESS,
  THROTTLE_RATE,
  DEFAULT_TYPE_CONFIG,
} from '../config.js';

function clamp(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

export function applyControls(plane, input, dt, touch) {
  // Keyboard axes
  const keyPitchRaw = input.getAxis('KeyS', 'KeyW');
  const keyRollRaw = input.getAxis('KeyA', 'KeyD');
  const keyYaw = input.getAxis('KeyQ', 'KeyE');

  // Joystick (touch)
  const joyPitchRaw = touch && touch.enabled ? touch.joyY : 0;
  const joyRollRaw = touch && touch.enabled ? -touch.joyX : 0;
  const joyYaw =
    touch && touch.enabled
      ? (touch.yawLeft ? 1 : 0) - (touch.yawRight ? 1 : 0)
      : 0;

  // Wheels are on the ground — you can't tilt a plane that's sitting on them.
  // Only yaw works (for taxi steering).
  const onGround = !!plane.onGround;
  const pitchInput = onGround ? 0 : clamp(keyPitchRaw + joyPitchRaw);
  const rollInput = onGround ? 0 : clamp(keyRollRaw + joyRollRaw);
  const yawInput = clamp(keyYaw + joyYaw);

  // Stash raw intent on the plane so the visual control surfaces know what
  // angle to deflect to, even though ground ignores pitch/roll for physics.
  if (!plane.controlInputs) plane.controlInputs = { pitch: 0, roll: 0, yaw: 0 };
  plane.controlInputs.pitch = onGround ? 0 : clamp(keyPitchRaw + joyPitchRaw);
  plane.controlInputs.roll = onGround ? 0 : clamp(keyRollRaw + joyRollRaw);
  plane.controlInputs.yaw = yawInput;

  const tc = plane.typeConfig || DEFAULT_TYPE_CONFIG;
  const targetPitch = pitchInput * PITCH_RATE * tc.pitchRateMult;
  const targetRoll = rollInput * ROLL_RATE * tc.rollRateMult;
  const targetYaw = yawInput * YAW_RATE * tc.yawRateMult;

  plane.angularVelocity.x +=
    (targetPitch - plane.angularVelocity.x) * CONTROL_RESPONSIVENESS;
  plane.angularVelocity.z +=
    (targetRoll - plane.angularVelocity.z) * CONTROL_RESPONSIVENESS;
  plane.angularVelocity.y +=
    (targetYaw - plane.angularVelocity.y) * CONTROL_RESPONSIVENESS;

  // Throttle: slider overrides rate-based keys when active.
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
