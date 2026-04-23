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
  GODRAYS_SAMPLES,
  GODRAYS_DENSITY,
  GODRAYS_WEIGHT,
  GODRAYS_DECAY,
  GODRAYS_EXPOSURE,
  GODRAYS_STRENGTH,
  LENS_FLARE_STRENGTH,
  LENS_FLARE_STREAK_STRENGTH,
} from '../config.js';

// Volumetric god-rays + lens-flare combined pass. Operates on the
// already-bloomed frame, so "bright pixels" means the sun disc (the
// single thing in the scene guaranteed to cross the bloom threshold).
// The radial blur accumulates those bright samples into streaks that
// appear to emanate from the sun's screen-space position. A second
// chunk of the shader paints anamorphic lens-flare ghosts along the
// line from sun → screen centre — the classic cheap-but-effective trick.
//
// Activation is per-frame from main.js: uEnabled=0 when the sun is
// below the horizon or behind the camera, so the pass does a zero-cost
// passthrough every frame the sun isn't in view.
const GODRAYS_SHADER = {
  defines: {
    SAMPLES: GODRAYS_SAMPLES,
  },
  uniforms: {
    tDiffuse: { value: null },
    uSunScreenPos: { value: new Vector2(0.5, 0.5) },
    uStrength: { value: 0 },
    uDensity: { value: GODRAYS_DENSITY },
    uWeight: { value: GODRAYS_WEIGHT },
    uDecay: { value: GODRAYS_DECAY },
    uExposure: { value: GODRAYS_EXPOSURE },
    uFlareStrength: { value: 0 },
    uFlareStreakStrength: { value: 0 },
    uAspect: { value: 1.0 },
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
    uniform vec2 uSunScreenPos;
    uniform float uStrength;
    uniform float uDensity;
    uniform float uWeight;
    uniform float uDecay;
    uniform float uExposure;
    uniform float uFlareStrength;
    uniform float uFlareStreakStrength;
    uniform float uAspect;
    varying vec2 vUv;

    // Isolate bright pixels so rays only pick up the sun (bloomed above
    // the rest of the scene) and not whatever sky/terrain is beneath.
    float brightness(vec3 c) {
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      return smoothstep(0.90, 1.25, lum);
    }

    // A soft circular blob centered at \`center\` used for lens-flare ghosts.
    // Aspect-corrected so ghosts look round, not oval, at non-1:1 screens.
    float ghost(vec2 uv, vec2 center, float radius) {
      vec2 d = uv - center;
      d.x *= uAspect;
      float r = length(d);
      return smoothstep(radius, 0.0, r);
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);

      // Zero-strength fast path — sun below horizon or behind camera.
      if (uStrength <= 0.001 && uFlareStrength <= 0.001) {
        gl_FragColor = base;
        return;
      }

      // ---- God rays: radial blur from sun position sampling bright pixels.
      vec2 texCoord = vUv;
      vec2 delta = (texCoord - uSunScreenPos) * (uDensity / float(SAMPLES));
      float illum = 1.0;
      vec3 rays = vec3(0.0);
      for (int i = 0; i < SAMPLES; i++) {
        texCoord -= delta;
        vec3 s = texture2D(tDiffuse, texCoord).rgb;
        s *= brightness(s) * illum * uWeight;
        rays += s;
        illum *= uDecay;
      }
      rays *= uExposure * uStrength;

      // ---- Lens flare: anamorphic horizontal streak through the sun, plus
      // a few ghost discs along the line sun → screen-centre. Each ghost
      // samples a tiny bright-only chunk of the frame, so they only light
      // up when the sun is actually in the shot.
      vec3 flare = vec3(0.0);
      if (uFlareStrength > 0.001) {
        vec2 toCenter = vec2(0.5) - uSunScreenPos;
        // Ghost positions are the classic "mirror through screen centre"
        // layout: each k shifts the sample further along the sun↔center axis.
        vec2 g1 = uSunScreenPos + toCenter * 0.35;
        vec2 g2 = uSunScreenPos + toCenter * 0.75;
        vec2 g3 = uSunScreenPos + toCenter * 1.20;
        vec2 g4 = uSunScreenPos + toCenter * 1.70;
        vec3 s1 = texture2D(tDiffuse, g1).rgb;
        vec3 s2 = texture2D(tDiffuse, g2).rgb;
        vec3 s3 = texture2D(tDiffuse, g3).rgb;
        vec3 s4 = texture2D(tDiffuse, g4).rgb;
        // Tint ghosts subtly (warm gold → cool cyan) for the characteristic
        // rainbow-ish lens-coating look. Weight by distance from sun so
        // nearest ghost dominates.
        flare += s1 * brightness(s1) * vec3(1.0, 0.85, 0.65) * ghost(vUv, g1, 0.10);
        flare += s2 * brightness(s2) * vec3(0.80, 1.0, 0.85) * ghost(vUv, g2, 0.07) * 0.8;
        flare += s3 * brightness(s3) * vec3(0.75, 0.80, 1.0) * ghost(vUv, g3, 0.14) * 0.6;
        flare += s4 * brightness(s4) * vec3(1.0, 0.75, 0.95) * ghost(vUv, g4, 0.09) * 0.5;

        // Anamorphic horizontal streak — a long thin ellipse centered on
        // the sun. Classic sci-fi lens-flare signature.
        vec2 streakD = vUv - uSunScreenPos;
        float streak = exp(-abs(streakD.y) * 180.0) *
                       exp(-abs(streakD.x) * 2.0);
        // Sample the sun brightness at the sun position to gate the streak
        // (so it vanishes when the sun is occluded or out of frame).
        vec3 sunColor = texture2D(tDiffuse, uSunScreenPos).rgb;
        float sunBright = brightness(sunColor);
        flare += sunColor * streak * sunBright * uFlareStreakStrength;

        flare *= uFlareStrength;
      }

      gl_FragColor = vec4(base.rgb + rays + flare, base.a);
    }
  `,
};

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

    // God rays + lens flare. Must run AFTER bloom so the sun is
    // already bright enough to stand out as "the" bright pixel source.
    this.godraysPass = new ShaderPass(GODRAYS_SHADER);
    this.composer.addPass(this.godraysPass);

    this.vignettePass = new ShaderPass(VIGNETTE_SHADER);
    this.composer.addPass(this.vignettePass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.bloomEnabled = true;
    this.vignetteEnabled = true;
    this.godraysEnabled = true;
    this._enabled = true;

    // Aspect uniform starts correct — ShaderPass doesn't get resize events
    // so we sync here and in setSize().
    const s = renderer.getSize(new Vector2());
    this.godraysPass.uniforms.uAspect.value = s.x / Math.max(1, s.y);
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
    this.godraysPass.uniforms.uAspect.value = w / Math.max(1, h);
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

  setGodraysEnabled(on) {
    this.godraysEnabled = !!on;
    this.godraysPass.enabled = this.godraysEnabled;
    this._refreshAnyOn();
  }

  // Drive god-rays + lens-flare per frame. main.js computes the sun's
  // screen-space position from the camera and sunDir, plus an intensity
  // that fades out when the sun is below the horizon / behind the camera
  // / off-screen, and passes everything in here.
  setSunScreenPos(x, y, raysStrength, flareStrength, flareStreakStrength) {
    const u = this.godraysPass.uniforms;
    u.uSunScreenPos.value.set(x, y);
    u.uStrength.value = raysStrength;
    u.uFlareStrength.value = flareStrength;
    u.uFlareStreakStrength.value = flareStreakStrength;
  }

  _refreshAnyOn() {
    this._enabled =
      this.bloomEnabled || this.vignetteEnabled || this.godraysEnabled;
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
