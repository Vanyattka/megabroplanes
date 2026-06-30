import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import {
  PLANE_SHADOW_SIZE,
  PLANE_SHADOW_OPACITY,
  PLANE_SHADOW_FADE_ALT,
} from '../config.js';

export function makeShadowTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

// Single horizontal disc that tracks the plane's XZ, sits just above the
// terrain, and fades out as the plane climbs.
export class PlaneShadow {
  constructor(scene, sharedTexture) {
    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mat = new MeshBasicMaterial({
      map: sharedTexture,
      transparent: true,
      depthWrite: false,
      opacity: PLANE_SHADOW_OPACITY,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.renderOrder = 1;
    this.mesh.scale.set(PLANE_SHADOW_SIZE, 1, PLANE_SHADOW_SIZE);
    scene.add(this.mesh);
  }

  update(plane, getHeight) {
    // Track the INTERPOLATED render position (what the mesh is drawn at), not
    // the post-physics position which only changes at the 60 Hz physics tick —
    // otherwise the blob snaps tick-by-tick under a smoothly-moving plane.
    const p = plane.renderPosition || plane.position;
    const ground = getHeight(p.x, p.z);
    const alt = Math.max(0, p.y - ground);
    const fade = Math.max(0, 1 - alt / PLANE_SHADOW_FADE_ALT);
    this.mat.opacity = PLANE_SHADOW_OPACITY * fade;
    this.mesh.visible = fade > 0.02;
    this.mesh.position.set(p.x, ground + 0.15, p.z);
  }
}
