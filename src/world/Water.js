import {
  Color,
  DoubleSide,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import {
  WATER_LEVEL,
  WATER_SIZE,
  WATER_COLOR_SHALLOW,
  WATER_COLOR_DEEP,
  WATER_NORMAL_SCROLL_SPEED,
  WATER_OPACITY,
  HORIZON_COLOR,
} from '../config.js';
import { worldTime } from './WorldTime.js';

// Vertex passes world-space + view direction through. The water plane is
// flat — all the wave shapes are produced analytically in the fragment.
const VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vViewDir = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Fragment: analytic ripples → perturbed normal → Fresnel mix between water
// tones and reflected sky, plus a sun-glint specular term so sunsets produce
// the classic golden path across the water. Colors are time-of-day-aware
// (dark water at night, blue during the day) via uDayFactor.
const FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3  uShallow;
  uniform vec3  uDeep;
  uniform vec3  uSkyColor;
  uniform vec3  uDeepSkyColor; // overhead sky — reflected when looking straight down
  uniform float uOpacity;
  uniform float uRippleAmp;
  uniform float uDayFactor;    // 1 = full day, 0 = full night: scales base water tones
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform float uSunIntensity;
  uniform vec3  uJetPos;
  uniform vec3  uJetColor;
  uniform float uJetIntensity;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;

  vec3 rippleNormal(vec2 p, float t) {
    float a = sin(p.x * 0.32 + t * 1.1)         + sin(p.y * 0.28 - t * 0.9);
    float b = sin((p.x + p.y) * 0.42 - t * 1.3) + sin((p.x - p.y) * 0.31 + t * 0.7);
    float c = sin(p.x * 1.1  + t * 2.3)         + sin(p.y * 0.9 - t * 1.7);
    float d = sin((p.x * 0.7 + p.y * 0.6) - t * 1.9);
    float nx = (a + b) * 0.03 + c * 0.012 + d * 0.008;
    float nz = (a - b) * 0.03 + c * 0.012 - d * 0.008;
    return normalize(vec3(nx * uRippleAmp, 1.0, nz * uRippleAmp));
  }

  void main() {
    vec2 p = vWorldPos.xz * 0.08;
    vec3 n = rippleNormal(p, uTime);

    vec3 viewDir = normalize(vViewDir);
    float ndv = max(dot(viewDir, n), 0.0);
    float fresnel = pow(1.0 - ndv, 3.5);

    // Base water — shallow blended to deep based on view angle, darkened
    // according to time of day so night water reads black-blue, not the
    // daytime tropical blue.
    vec3 baseCol = mix(uShallow, uDeep, clamp((1.0 - ndv) * 0.5, 0.0, 1.0));
    baseCol *= mix(0.12, 1.0, uDayFactor);

    // Reflected sky — horizon color at grazing view, zenith-ish when
    // looking straight down. The water surface gets the same sky tint as
    // the rest of the scene, so lakes at dusk turn orange automatically.
    vec3 reflected = mix(uDeepSkyColor, uSkyColor, fresnel);

    vec3 col = mix(baseCol, reflected, fresnel);

    // Sun glint — Blinn-Phong specular using the half vector between view
    // and sun directions against the perturbed normal. Tight highlight that
    // smears across the rippled surface, producing the golden sunset path.
    // HDR multiplier pushes the brightest parts past the bloom threshold.
    if (uSunIntensity > 0.02) {
      vec3 halfVec = normalize(viewDir + uSunDir);
      float specBase = max(dot(n, halfVec), 0.0);
      float spec = pow(specBase, 180.0);
      float glow = pow(specBase, 14.0);
      col += uSunColor * (spec * 4.5 + glow * 0.35) * uSunIntensity;
    }

    // Jet engine reflection — falls off with distance from the engine, so
    // the hot orange smear only appears on water directly below a jet.
    if (uJetIntensity > 0.02) {
      vec3 toJet = uJetPos - vWorldPos;
      float jetDist = length(toJet);
      if (jetDist < 120.0) {
        vec3 toJetN = toJet / jetDist;
        vec3 halfJ = normalize(viewDir + toJetN);
        float specJ = pow(max(dot(n, halfJ), 0.0), 90.0);
        float attenuation = 1.0 - smoothstep(20.0, 120.0, jetDist);
        col += uJetColor * specJ * 3.0 * attenuation * uJetIntensity;
      }
    }

    gl_FragColor = vec4(col, uOpacity);
  }
`;

export class Water {
  constructor(scene) {
    this.scene = scene;

    const size = WATER_SIZE;
    const geo = new PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.geometry = geo;

    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uShallow: { value: new Color(WATER_COLOR_SHALLOW) },
        uDeep: { value: new Color(WATER_COLOR_DEEP) },
        uSkyColor: { value: new Color(HORIZON_COLOR) },
        uDeepSkyColor: { value: new Color(0x2a62b4) },
        uOpacity: { value: WATER_OPACITY },
        uRippleAmp: { value: 1.0 },
        uDayFactor: { value: 1.0 },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color(0xffffff) },
        uSunIntensity: { value: 1.0 },
        uJetPos: { value: new Vector3() },
        uJetColor: { value: new Color(0xff6820) },
        uJetIntensity: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.renderOrder = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this._time = 0;
  }

  // planePos: Vector3-like — water tracks under the player every frame.
  // worldTint: horizon color. Overhead / sun info come from worldTime so the
  // reflections match the same day/night cycle every other system uses.
  // jet (optional): { position: Vector3, intensity: number } — when a jet
  // plane is flying low its engine paints a hot orange reflection on the
  // water directly under/behind it.
  update(dt, planePos, worldTint, jet = null) {
    this._time += dt * WATER_NORMAL_SCROLL_SPEED;
    const u = this.material.uniforms;
    u.uTime.value = this._time;

    if (planePos) {
      this.mesh.position.x = planePos.x;
      this.mesh.position.z = planePos.z;
    }

    if (worldTint) u.uSkyColor.value.copy(worldTint);
    u.uDeepSkyColor.value.copy(worldTime.skyColor);
    const df = 1.0 - (worldTime.nightFactor ?? 0);
    u.uDayFactor.value = Math.max(0.05, df);
    u.uSunDir.value.copy(worldTime.sunDir);
    u.uSunColor.value.copy(worldTime.sunColor);
    u.uSunIntensity.value = worldTime.sunIntensity;

    if (jet && jet.intensity > 0.02) {
      u.uJetPos.value.copy(jet.position);
      u.uJetIntensity.value = jet.intensity;
    } else {
      u.uJetIntensity.value = 0;
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
