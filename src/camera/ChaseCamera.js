import { Vector3 } from 'three';
import { CAMERA_OFFSET, CAMERA_LERP } from '../config.js';

const _offset = new Vector3();
const _desired = new Vector3();

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.initialized = false;
  }

  update(plane) {
    _offset
      .set(CAMERA_OFFSET[0], CAMERA_OFFSET[1], CAMERA_OFFSET[2])
      .applyQuaternion(plane.quaternion);
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
