import { Vector3, Quaternion } from 'three';
import {
  CAMERA_OFFSET,
  CAMERA_LERP,
  MOUSE_LOOK_SENSITIVITY,
  MOUSE_LOOK_RECENTER,
  MOUSE_LOOK_PITCH_LIMIT,
} from '../config.js';

const _offset = new Vector3();
const _desired = new Vector3();
const _qYaw = new Quaternion();
const _qPitch = new Quaternion();
const _axisY = new Vector3(0, 1, 0);
const _axisX = new Vector3(1, 0, 0);

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.initialized = false;
    this.yaw = 0;
    this.pitch = 0;
  }

  // Call once per render frame. `input` drives mouse look; `dt` in seconds.
  update(plane, input, dt) {
    if (input) {
      const { dx, dy } = input.consumeMouseDelta();
      this.yaw -= dx * MOUSE_LOOK_SENSITIVITY;
      this.pitch -= dy * MOUSE_LOOK_SENSITIVITY;
      this.pitch = Math.max(
        -MOUSE_LOOK_PITCH_LIMIT,
        Math.min(MOUSE_LOOK_PITCH_LIMIT, this.pitch)
      );
      if (!input.mouseDown) {
        const decay = Math.max(0, 1 - MOUSE_LOOK_RECENTER * dt);
        this.yaw *= decay;
        this.pitch *= decay;
      }
    }

    // Base offset in plane's local frame, rotated by mouse-look yaw/pitch.
    _offset.set(CAMERA_OFFSET[0], CAMERA_OFFSET[1], CAMERA_OFFSET[2]);
    _qYaw.setFromAxisAngle(_axisY, this.yaw);
    _qPitch.setFromAxisAngle(_axisX, this.pitch);
    _offset.applyQuaternion(_qPitch).applyQuaternion(_qYaw);
    _offset.applyQuaternion(plane.quaternion);

    _desired.copy(plane.position).add(_offset);

    if (!this.initialized) {
      this.camera.position.copy(_desired);
      this.initialized = true;
    } else {
      this.camera.position.lerp(_desired, CAMERA_LERP);
    }
    this.camera.lookAt(plane.position);
  }
}
