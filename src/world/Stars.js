import {
  BufferAttribute,
  BufferGeometry,
  Points,
  PointsMaterial,
} from 'three';
import alea from 'alea';
import { STARS_COUNT, STARS_RADIUS } from '../config.js';
import { worldTime } from './WorldTime.js';

// A simple Points-based starfield: uniform random points on the upper
// hemisphere of a sphere centered on the camera. Opacity is driven by the
// worldTime.starsOpacity keyframe so stars fade in at night and out at day.
export class Stars {
  constructor(scene) {
    this.scene = scene;

    const prng = alea('stars-seed');
    const positions = new Float32Array(STARS_COUNT * 3);
    const sizes = new Float32Array(STARS_COUNT);
    for (let i = 0; i < STARS_COUNT; i++) {
      // Uniform distribution on the upper hemisphere.
      const u = prng();
      const v = 0.05 + prng() * 0.95; // bias slightly away from the horizon
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(1 - v);
      const r = STARS_RADIUS;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      sizes[i] = 1 + prng() * 2.5;
    }

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.geometry.setAttribute('size', new BufferAttribute(sizes, 1));

    this.material = new PointsMaterial({
      color: 0xffffff,
      size: 1.6,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });

    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -1;
    scene.add(this.points);
  }

  // Follow the camera so stars always appear at infinity.
  update(camera) {
    this.points.position.copy(camera.position);
    this.material.opacity = worldTime.starsOpacity;
    this.material.visible = worldTime.starsOpacity > 0.01;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}
