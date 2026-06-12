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
// the plane mesh, flipped across the water plane (y = WATER_LEVEL).
//
// v0.6.1: the mirror is deliberately IMPERFECT, like real wind-ruffled water.
// Two tricks, both shader-free:
//   1. The mirror transform wobbles — a small time-varying XZ drift plus a
//      vertical squash, so the reflection swims and stretches with the ripple.
//   2. A second fainter "ghost" clone lags on an offset phase, doubling the
//      image into a soft smear instead of a crisp mirror. Its materials are
//      tinted toward the water color and its HDR light meshes are hidden so
//      the nav strobes don't double-bloom.
//
// The plane's *light sources* (jet engine glow, landing lamp) are real lights
// on the aircraft, so the main reflection still shows them glowing.
//
// Compositing: the water material has depthWrite:false at renderOrder 0; the
// clones render right after (renderOrder 1) with depthTest on, so terrain
// occludes them everywhere except over actual water.
const FADE_ALT = 260; // reflection fades out by this altitude over the water

// Ripple wobble tuning.
const RIPPLE_XZ = 0.34;        // metres of horizontal swim
const RIPPLE_SQUASH = 0.055;   // ± vertical squash around ~0.94
const GHOST_PHASE = 2.1;       // ghost wobbles out of phase with the main image
const MAIN_OPACITY = 0.55;
const GHOST_OPACITY = 0.26;
const WATER_TINT = new Color(0x2e4f6e);

// Local positions of the light sources on the plane mesh (approx, shared
// across types — the reflection is small/dim so exact per-type offsets don't
// matter). Nose points -Z; the engine/exhaust sits behind at +Z.
const ENGINE_Z = 6.0;
const LAMP_Z = -4.3;

// Names of HDR light meshes that must not appear twice (once is enough).
const HDR_PART_NAMES = new Set([
  'nav-left', 'nav-right', 'nav-tail', 'beacon', 'ab-core', 'ab-outer',
]);

const _R = new Matrix4();

// Mirror across the water plane with a squash factor s and an XZ drift:
// y' = WL·(1+s) − s·y  (s=1 → perfect mirror about WL).
function mirrorMatrix(out, s, ox, oz) {
  out.makeScale(1, -s, 1);
  const e = out.elements;
  e[12] = ox;
  e[13] = WATER_LEVEL * (1 + s);
  e[14] = oz;
  return out;
}

export class WaterReflection {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;       // main reflection clone
    this.ghost = null;      // fainter out-of-phase smear copy
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

  // One mirrored clone. Materials are per-clone copies (disposable), softened
  // toward the water color so the reflection reads as seen THROUGH water.
  _makeClone(type, color, hideHdrParts) {
    const m = buildPlaneMesh(type, color);
    m.matrixAutoUpdate = false;     // we drive .matrix directly from the mirror
    m.renderOrder = 1;              // after the water surface
    m.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      if (hideHdrParts && HDR_PART_NAMES.has(o.name)) { o.visible = false; return; }
      o.material = o.material.clone();
      if (o.material.color) o.material.color.lerp(WATER_TINT, 0.22);
      o.material.transparent = true;
      o.material.opacity = 0;
      o.material.depthWrite = false;
      o.material.side = DoubleSide;
      o.castShadow = false;
      o.receiveShadow = false;
    });
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
    if (this.ghost) {
      this.scene.remove(this.ghost);
      disposePlaneMesh(this.ghost);
    }
    this.mesh = this._makeClone(type, color, false);
    // Glow blobs for the plane's light sources, mirrored along with the body.
    this.engineGlow = this._makeGlow(JET_LIGHT_COLOR, 0.95, ENGINE_Z);
    this.lampGlow = this._makeGlow(LANDING_LIGHT_COLOR, 0.55, LAMP_Z);
    this.mesh.add(this.engineGlow, this.lampGlow);
    this.scene.add(this.mesh);

    this.ghost = this._makeClone(type, color, true);
    this.scene.add(this.ghost);

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
    this.ghost.visible = show;
    if (!show) return;

    plane.mesh.updateMatrixWorld();
    const t = performance.now() * 0.001;

    // Main image: mirror with a gentle swim + squash (the ripple).
    const s1 = 0.94 + RIPPLE_SQUASH * Math.sin(t * 2.3);
    mirrorMatrix(
      _R,
      s1,
      Math.sin(t * 1.7) * RIPPLE_XZ,
      Math.cos(t * 1.1) * RIPPLE_XZ
    );
    this.mesh.matrix.multiplyMatrices(_R, plane.mesh.matrixWorld);

    // Ghost: out of phase, drifting a touch wider — the soft double image.
    const s2 = 0.91 + RIPPLE_SQUASH * Math.sin(t * 1.9 + GHOST_PHASE);
    mirrorMatrix(
      _R,
      s2,
      Math.sin(t * 1.4 + GHOST_PHASE) * RIPPLE_XZ * 1.5,
      Math.cos(t * 0.9 + GHOST_PHASE) * RIPPLE_XZ * 1.5
    );
    this.ghost.matrix.multiplyMatrices(_R, plane.mesh.matrixWorld);

    // Fade with altitude — a reflection from high up should read as faint.
    const fade = 1 - altOverWater / FADE_ALT;
    const opMain = MAIN_OPACITY * fade;
    const opGhost = GHOST_OPACITY * fade;
    this.mesh.traverse((o) => {
      if (o.isMesh && o.material && !o.userData.glow) o.material.opacity = opMain;
    });
    this.ghost.traverse((o) => {
      if (o.isMesh && o.material) o.material.opacity = opGhost;
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
    if (!on) {
      if (this.mesh) this.mesh.visible = false;
      if (this.ghost) this.ghost.visible = false;
    }
  }
}
