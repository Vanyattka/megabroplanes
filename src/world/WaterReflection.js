import {
  Matrix4,
  DoubleSide,
  Mesh,
  SphereGeometry,
  MeshBasicMaterial,
  AdditiveBlending,
  Color,
} from 'three';
import { buildPlaneMesh, disposePlaneMesh } from '../plane/PlaneMesh.js';
import {
  WATER_LEVEL,
  JET_LIGHT_COLOR,
  JET_LIGHT_INTENSITY,
  LANDING_LIGHT_COLOR,
} from '../config.js';

// A real reflection of the player's plane on the water — a mirrored clone of
// the plane mesh, flipped across the water plane (y = WATER_LEVEL). It replaces
// the old "body-color glint disc".
//
// The plane's *light sources* (jet engine glow, landing lamp) are real lights
// on the aircraft, so the reflection must show them glowing too — otherwise a
// jet whose engine lights up the water has a dark-engined reflection, which
// looks wrong. We add additive glow blobs to the clone, driven by the live
// plane state (throttle for the jet, on/off for the landing light).
//
// Compositing: the water material has depthWrite:false at renderOrder 0; this
// clone renders right after (renderOrder 1) with depthTest on, so terrain
// occludes it everywhere except over actual water.
const REFLECT = new Matrix4().makeScale(1, -1, 1);
REFLECT.elements[13] = 2 * WATER_LEVEL; // y' = 2*WATER_LEVEL - y

const FADE_ALT = 260; // reflection fades out by this altitude over the water

// Local positions of the light sources on the plane mesh (approx, shared
// across types — the reflection is small/dim so exact per-type offsets don't
// matter). Nose points -Z; the engine/exhaust sits behind at +Z.
const ENGINE_Z = 6.0;
const LAMP_Z = -4.3;

export class WaterReflection {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.engineGlow = null;
    this.lampGlow = null;
    this.type = null;
    this.color = null;
  }

  _makeGlow(colorHex, radius, z) {
    const m = new Mesh(
      new SphereGeometry(radius, 10, 8),
      new MeshBasicMaterial({
        color: new Color(colorHex),
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    m.position.set(0, 0, z);
    m.renderOrder = 2;
    m.userData.glow = true; // excluded from the body opacity sweep
    m.visible = false;
    return m;
  }

  _build(type, color) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      disposePlaneMesh(this.mesh);
      if (this.engineGlow) { this.engineGlow.geometry.dispose(); this.engineGlow.material.dispose(); }
      if (this.lampGlow) { this.lampGlow.geometry.dispose(); this.lampGlow.material.dispose(); }
    }
    const m = buildPlaneMesh(type, color);
    m.matrixAutoUpdate = false;     // we drive .matrix directly from the mirror
    m.renderOrder = 1;              // after the water surface
    m.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = 0.8;
      o.material.depthWrite = false;
      o.material.side = DoubleSide;
      o.castShadow = false;
      o.receiveShadow = false;
    });
    // Glow blobs for the plane's light sources, mirrored along with the body.
    this.engineGlow = this._makeGlow(JET_LIGHT_COLOR, 0.95, ENGINE_Z);
    this.lampGlow = this._makeGlow(LANDING_LIGHT_COLOR, 0.55, LAMP_Z);
    m.add(this.engineGlow, this.lampGlow);

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
      if (o.isMesh && o.material && !o.userData.glow) o.material.opacity = op;
    });

    // Jet engine glow ∝ engine light (throttle-scaled); 0 for non-jets.
    const jetNorm = plane._jetLight ? plane._jetLight.intensity / JET_LIGHT_INTENSITY : 0;
    this.engineGlow.material.opacity = Math.min(1, jetNorm * 1.1) * fade;
    this.engineGlow.visible = jetNorm > 0.01;

    // Landing lamp glow when the light is on.
    const lampOn = !!plane.landingLightOn;
    this.lampGlow.material.opacity = lampOn ? 0.7 * fade : 0;
    this.lampGlow.visible = lampOn;
  }

  setVisible(on) {
    if (this.mesh && !on) this.mesh.visible = false;
  }
}
