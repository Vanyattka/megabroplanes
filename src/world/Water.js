import {
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { FOG_FAR, WATER_LEVEL, WATER_COLOR } from '../config.js';

// A big horizontal plane that follows the camera. Transparent enough to let
// the seabed show through in shallows, opaque enough to feel like water.
export class Water {
  constructor(scene) {
    const size = FOG_FAR * 3;
    const geo = new PlaneGeometry(size, size);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshStandardMaterial({
      color: WATER_COLOR,
      transparent: true,
      opacity: 0.82,
      roughness: 0.25,
      metalness: 0.3,
    });
    this.mesh = new Mesh(geo, mat);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.renderOrder = 0;
    scene.add(this.mesh);
  }

  update(cameraPos) {
    this.mesh.position.x = cameraPos.x;
    this.mesh.position.z = cameraPos.z;
  }
}
