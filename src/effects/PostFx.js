import { Vector2 } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import {
  BLOOM_STRENGTH,
  BLOOM_RADIUS,
  BLOOM_THRESHOLD,
  VIGNETTE_STRENGTH,
} from '../config.js';

// Minimal vignette that darkens the screen corners. Separate ShaderPass
// instead of part of the bloom because bloom ignores vignetted values.
const VIGNETTE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uStrength: { value: VIGNETTE_STRENGTH },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec2 c = vUv - 0.5;
      float d = dot(c, c) * 2.0; // 0 center .. 1 corner
      float v = smoothstep(0.3, 0.95, d) * uStrength;
      gl_FragColor = vec4(tex.rgb * (1.0 - v), tex.a);
    }
  `,
};

// Wraps EffectComposer so main.js can flip bloom/vignette on the fly from
// the graphics settings. Falls through to a plain renderer.render() call
// when all post effects are disabled, to save the composer's extra blit.
export class PostFx {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    const size = renderer.getSize(new Vector2());
    this.bloomPass = new UnrealBloomPass(
      size,
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD
    );
    this.composer.addPass(this.bloomPass);

    this.vignettePass = new ShaderPass(VIGNETTE_SHADER);
    this.composer.addPass(this.vignettePass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.bloomEnabled = true;
    this.vignetteEnabled = true;
    this._enabled = true;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
  }

  setBloomEnabled(on) {
    this.bloomEnabled = !!on;
    this.bloomPass.enabled = this.bloomEnabled;
    this._refreshAnyOn();
  }

  setBloomStrength(s) {
    this.bloomPass.strength = s;
  }

  setVignetteEnabled(on) {
    this.vignetteEnabled = !!on;
    this.vignettePass.enabled = this.vignetteEnabled;
    this._refreshAnyOn();
  }

  _refreshAnyOn() {
    this._enabled = this.bloomEnabled || this.vignetteEnabled;
  }

  render() {
    if (this._enabled) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose() {
    this.composer.dispose();
  }
}
