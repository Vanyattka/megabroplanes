import { Vector3, Quaternion } from 'three';
import {
  CAMERA_OFFSET,
  CAMERA_FOLLOW_RATE,
  CAMERA_GROUND_MARGIN,
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

  // Force the next update() to jump straight onto the plane instead of lerping
  // toward it. Call after any teleport (reset to runway, race spawn, post-death
  // respawn) — otherwise the camera swoops across the whole map to catch up.
  snap() {
    this.initialized = false;
    this.yaw = 0;
    this.pitch = 0;
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

    if (!this.initialized) {
      this.camera.position.copy(_desired);
      this.initialized = true;
    } else {
      // Frame-rate independent exponential smoothing. With a fixed `dt`
      // coefficient the camera would drift back visibly on slow frames
      // (the plane catches up via multiple physics substeps but the
      // camera only lerps by 10% once) — producing the "zooms out then
      // back in" pattern every second or two. This converges at a
      // consistent wall-clock rate regardless of frame time.
      const clampedDt = Math.min(0.1, dt || 0);
      const alpha = 1 - Math.exp(-clampedDt * CAMERA_FOLLOW_RATE);
      this.camera.position.lerp(_desired, alpha);
    }

    // Surface collision — never let the camera slip under terrain/water. If the
    // smoothed position is below the surface (+margin), pull the camera IN
    // along the boom (plane → camera) to the furthest point still above it, so
    // it "approaches" the plane instead of clipping through the ground/water.
    if (getFloor) {
      const cam = this.camera.position;
      if (cam.y < getFloor(cam.x, cam.z) + CAMERA_GROUND_MARGIN) {
        const dx = cam.x - planePos.x, dy = cam.y - planePos.y, dz = cam.z - planePos.z;
        const STEPS = 8;
        let okT = 0;
        for (let i = 1; i <= STEPS; i++) {
          const t = i / STEPS;
          const sy = planePos.y + dy * t;
          if (sy < getFloor(planePos.x + dx * t, planePos.z + dz * t) + CAMERA_GROUND_MARGIN) break;
          okT = t;
        }
        // Keep a little boom so the camera never collapses onto the plane.
        okT = Math.max(okT, 0.15);
        const fx = planePos.x + dx * okT, fz = planePos.z + dz * okT;
        cam.set(fx, Math.max(planePos.y + dy * okT, getFloor(fx, fz) + CAMERA_GROUND_MARGIN), fz);
      }
    }

    this.camera.lookAt(planePos);
  }
}
