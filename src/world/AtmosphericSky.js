import { Vector3 } from 'three';
import { Sky as ThreeSky } from 'three/addons/objects/Sky.js';
import { FOG_FAR_MAX } from '../config.js';

// Thin wrapper around Three's Preetham `Sky`. We reuse one instance and
// parent it into the scene behind the existing gradient-dome mesh so the
// Sky class can swap between them via enabled/disabled visibility. At day
// it's crisp and blue; at dawn/dusk it paints a physically-plausible warm
// horizon and a violet zenith automatically.
export class AtmosphericSky {
  constructor(scene) {
    this.scene = scene;
    this.mesh = new ThreeSky();
    this.mesh.scale.setScalar(FOG_FAR_MAX * 4);
    // The canonical three.js example runs Preetham at ~0.5 toneMappingExposure
    // because its HDR output is extremely bright. Our scene needs ~1.0
    // exposure to keep the terrain lit, so we pick parameters at the bottom
    // of the sensible range — the sky reads as a natural blue gradient
    // instead of a blinding white dome.
    this.mesh.material.uniforms.turbidity.value = 2.0;
    this.mesh.material.uniforms.rayleigh.value = 0.7;
    this.mesh.material.uniforms.mieCoefficient.value = 0.002;
    this.mesh.material.uniforms.mieDirectionalG.value = 0.75;
    this.mesh.material.uniforms.sunPosition.value = new Vector3(0, 1, 0);
    this.mesh.renderOrder = -2; // draw before everything, behind gradient dome too
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setEnabled(on) {
    this.mesh.visible = !!on;
  }

  // `sunDir` is world-space; we scale it by a large radius so the sun sits
  // on the atmospheric dome regardless of camera position.
  update(camera, sunDir) {
    this.mesh.position.copy(camera.position);
    const sp = this.mesh.material.uniforms.sunPosition.value;
    sp.copy(sunDir).multiplyScalar(1.0);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.material.dispose();
    this.mesh.geometry.dispose();
  }
}
