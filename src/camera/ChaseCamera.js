import { Vector3, Quaternion } from 'three';
import {
  CAMERA_OFFSET,
  CAMERA_FOLLOW_RATE,
  CAMERA_GROUND_MARGIN,
  CAMERA_COLLISION_RATE,
  MOUSE_LOOK_SENSITIVITY,
  MOUSE_LOOK_RECENTER,
  MOUSE_LOOK_PITCH_LIMIT,
} from '../config.js';

const MIN_BOOM = 0.15; // never collapse the camera fully onto the plane

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
    // Smoothed follow position (angle/lateral) — kept separate from the
    // collision boom-scale so the two ease independently.
    this._followPos = new Vector3();
    // Smoothed collision boom fraction (1 = full length, <1 = pulled in).
    this._collT = 1;
  }

  // Force the next update() to jump straight onto the plane instead of lerping
  // toward it. Call after any teleport (reset to runway, race spawn, post-death
  // respawn) — otherwise the camera swoops across the whole map to catch up.
  snap() {
    this.initialized = false;
    this.yaw = 0;
    this.pitch = 0;
    this._collT = 1;
  }

  // Call once per render frame. `input` drives mouse look; `dt` in seconds.
  // `getFloor(x,z)` (optional) returns the terrain-or-water surface height —
  // used to keep the camera from dipping under the world.
  update(plane, input, dt, getFloor) {
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
    // Read the interpolated render state — not raw plane.position —
    // so at high render framerates the camera isn't snapping every
    // other frame when physics ticks. Fall back to position/quaternion
    // for backward compat (e.g. the menu orbit camera passes a dummy).
    const planePos = plane.renderPosition || plane.position;
    const planeQuat = plane.renderQuaternion || plane.quaternion;
    _offset.applyQuaternion(planeQuat);

    _desired.copy(planePos).add(_offset);
    const clampedDt = Math.min(0.1, dt || 0);
    const firstFrame = !this.initialized;

    // Follow smoothing — eases the boom's ANGLE/lateral toward the desired
    // position at a consistent wall-clock rate (frame-rate independent).
    if (firstFrame) {
      this._followPos.copy(_desired);
      this.initialized = true;
    } else {
      const alpha = 1 - Math.exp(-clampedDt * CAMERA_FOLLOW_RATE);
      this._followPos.lerp(_desired, alpha);
    }

    // Surface collision — find the longest boom fraction (plane → follow pos)
    // that stays above the terrain/water surface, then EASE the live boom
    // length toward it. Smoothing the fraction (rather than snapping the
    // position) makes the pull-in/out glide; a hard floor below still
    // guarantees the camera never actually dips under the world.
    const dx = this._followPos.x - planePos.x;
    const dy = this._followPos.y - planePos.y;
    const dz = this._followPos.z - planePos.z;
    let safeT = 1;
    if (getFloor && this._followPos.y < getFloor(this._followPos.x, this._followPos.z) + CAMERA_GROUND_MARGIN) {
      const STEPS = 8;
      let okT = MIN_BOOM;
      for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS;
        if (planePos.y + dy * t < getFloor(planePos.x + dx * t, planePos.z + dz * t) + CAMERA_GROUND_MARGIN) break;
        okT = t;
      }
      safeT = Math.max(MIN_BOOM, okT);
    }
    if (firstFrame) this._collT = safeT;
    else {
      const cAlpha = 1 - Math.exp(-clampedDt * CAMERA_COLLISION_RATE);
      this._collT += (safeT - this._collT) * cAlpha;
    }

    // Final position: the follow boom scaled by the eased collision fraction,
    // then a hard floor so smoothing lag can never reveal under the surface.
    const cam = this.camera.position;
    cam.set(planePos.x + dx * this._collT, planePos.y + dy * this._collT, planePos.z + dz * this._collT);
    if (getFloor) {
      const fy = getFloor(cam.x, cam.z) + CAMERA_GROUND_MARGIN;
      if (cam.y < fy) cam.y = fy;
    }

    this.camera.lookAt(planePos);
  }
}
