import { Matrix4, DoubleSide } from 'three';
import { buildPlaneMesh, disposePlaneMesh } from '../plane/PlaneMesh.js';
import { WATER_LEVEL } from '../config.js';

// A real reflection of the player's plane on the water — a mirrored clone of
// the plane mesh, flipped across the water plane (y = WATER_LEVEL). It replaces
// the old "body-color glint disc", which read as a coloured halo following the
// plane rather than a reflection.
//
// How it composites correctly:
//   - The water material has depthWrite:false and renders at renderOrder 0.
//   - This clone renders right after (renderOrder 1), transparent, depthTest
//     ON. Terrain is opaque and writes depth, so the (deep, below-water) clone
//     is occluded everywhere there's land — it only shows through actual water
//     bodies, where the seabed is far below it. No explicit "am I over water"
//     test needed; the depth buffer does it.
const REFLECT = new Matrix4().makeScale(1, -1, 1);
REFLECT.elements[13] = 2 * WATER_LEVEL; // y' = 2*WATER_LEVEL - y

const FADE_ALT = 260; // reflection fades out by this altitude over the water

export class WaterReflection {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.type = null;
    this.color = null;
  }

  _build(type, color) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      disposePlaneMesh(this.mesh);
    }
    const m = buildPlaneMesh(type, color);
    m.matrixAutoUpdate = false;     // we drive .matrix directly from the mirror
    m.renderOrder = 1;              // after the water surface
    m.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      // Clone so we can make the reflection translucent + double-sided (the
      // mirror matrix flips winding) without touching the real plane's mats.
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = 0.8;
      o.material.depthWrite = false;
      o.material.side = DoubleSide;
      o.castShadow = false;
      o.receiveShadow = false;
    });
    m.visible = false;
    this.scene.add(m);
    this.mesh = m;
    this.type = type;
    this.color = color;
  }

  update(plane) {
    if (!plane) return;
    if (!this.mesh || this.type !== plane.type || this.color !== plane.color) {
      this._build(plane.type, plane.color);
    }
    const altOverWater = plane.position.y - WATER_LEVEL;
    const show = !plane.crashed && altOverWater > 0.5 && altOverWater < FADE_ALT;
    this.mesh.visible = show;
    if (!show) return;

    // Mirror the plane's current world transform across the water plane.
    plane.mesh.updateMatrixWorld();
    this.mesh.matrix.multiplyMatrices(REFLECT, plane.mesh.matrixWorld);

    // Fade with altitude — a reflection from high up should read as faint.
    const fade = 1 - altOverWater / FADE_ALT;
    const op = 0.85 * fade;
    this.mesh.traverse((o) => {
      if (o.isMesh && o.material) o.material.opacity = op;
    });
  }

  setVisible(on) {
    if (this.mesh && !on) this.mesh.visible = false;
  }
}
