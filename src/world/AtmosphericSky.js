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
    // Preetham's HDR range is aggressive — at default parameters the sky
    // near the sun easily exceeds 2.0 luminance, which the bloom pass then
    // spreads across the whole upper screen. We use low parameters AND
    // patch the shader below so even the sun-facing dome is clamped under
    // the bloom threshold.
    this.mesh.material.uniforms.turbidity.value = 1.0;
    this.mesh.material.uniforms.rayleigh.value = 0.35;
    this.mesh.material.uniforms.mieCoefficient.value = 0.001;
    this.mesh.material.uniforms.mieDirectionalG.value = 0.70;

    // Hard LDR clamp injected into the fragment shader. Preetham's native
    // output can spike to 3+ HDR when the sun is near overhead; that
    // reliably blooms into a whiteout regardless of how we tune the
    // parameters. Clamp to 1.9 (just below our 2.0 bloom threshold) so the
    // atmosphere can never contribute any bloom energy.
    this.mesh.material.onBeforeCompile = (shader) => {
      const src = shader.fragmentShader;
      shader.fragmentShader = src.replace(
        /gl_FragColor\s*=\s*vec4\(\s*retColor\s*,\s*1\.0\s*\)\s*;/,
        'gl_FragColor = vec4( clamp(retColor, vec3(0.0), vec3(1.9)), 1.0 );'
      );
    };
    this.mesh.material.needsUpdate = true;
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
