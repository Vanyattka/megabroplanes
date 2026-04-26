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
  // Landing light reflection — the cone of light from the player's plane
  // hitting water below. Position is the world XZ where the cone axis
  // crosses the water plane; intensity fades with cone height.
  uniform vec3  uLandingPos;
  uniform vec3  uLandingColor;
  uniform float uLandingIntensity;
  // Plane glint — a soft tinted disc directly below the player, in the
  // plane's body color. Stands in for a true planar reflection (which
  // would need a full mirrored render pass). Fades with altitude over
  // water so it only appears on low passes.
  uniform vec3  uPlanePos;
  uniform vec3  uPlaneColor;
  uniform float uPlaneIntensity;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;

  // Multi-octave analytic ripple. Three layers stacked at increasing
  // frequencies, each drifting along its own wind vector so the surface
  // looks alive rather than periodic. The high-frequency layer adds the
  // "fine sparkle" that makes large bodies of water read as actual water
  // and not a flat blue plane.
  vec3 rippleNormal(vec2 p, float t) {
    // Slow swell — the underlying wave structure
    vec2 q1 = p + vec2(0.06, 0.04) * t;
    float a1 = sin(q1.x * 0.32 + t * 1.1) + sin(q1.y * 0.28 - t * 0.9);
    float b1 = sin((q1.x + q1.y) * 0.42 - t * 1.3) + sin((q1.x - q1.y) * 0.31 + t * 0.7);

    // Mid-frequency wind chop, drifting against the swell
    vec2 q2 = p * 1.8 + vec2(-0.18, 0.12) * t;
    float a2 = sin(q2.x * 0.7  + t * 2.3) + sin(q2.y * 0.6 - t * 1.7);
    float b2 = sin((q2.x * 0.7 + q2.y * 0.6) - t * 1.9);

    // High-frequency surface sparkle — short wavelength, faster drift
    vec2 q3 = p * 4.5 + vec2(0.22, -0.06) * t;
    float a3 = sin(q3.x * 1.4 + t * 4.1);
    float b3 = sin((q3.x + q3.y) * 1.1 - t * 3.5);

    float nx = (a1 + b1) * 0.030
             + (a2 + b2) * 0.014
             + (a3 + b3) * 0.006;
    float nz = (a1 - b1) * 0.030
             + (a2 - b2) * 0.014
             + (a3 - b3) * 0.006;
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

    // Landing-light reflection — same Blinn-Phong trick but with the cone
    // origin (the plane's nose-mounted SpotLight) as the light source.
    // The ground-cone-impact point already lives where the bright pool
    // is; falloff radius is wider than the jet so it reads as a flood-
    // style headlight, not a hot pinprick.
    if (uLandingIntensity > 0.02) {
      vec3 toLight = uLandingPos - vWorldPos;
      float lDist = length(toLight);
      if (lDist < 200.0) {
        vec3 toLightN = toLight / lDist;
        vec3 halfL = normalize(viewDir + toLightN);
        float specL = pow(max(dot(n, halfL), 0.0), 60.0);
        // Wide soft pool — much broader than jet's tight hotspot
        float pool = 1.0 - smoothstep(0.0, 60.0, lDist);
        float attenuation = pool + (1.0 - smoothstep(50.0, 200.0, lDist)) * 0.3;
        col += uLandingColor * specL * 2.4 * attenuation * uLandingIntensity;
      }
    }

    // Plane body-color glint on the water below — a soft tinted disc that
    // stands in for a real planar reflection. Only shows up at low altitude
    // (uPlaneIntensity falls to 0 by ~300 m) so it reads as "the plane is
    // skimming over the lake" without needing a separate render pass.
    if (uPlaneIntensity > 0.001) {
      vec2 planeXZ = uPlanePos.xz;
      float planeR = length(vWorldPos.xz - planeXZ);
      if (planeR < 40.0) {
        // Soft elliptical disc, brighter under the centerline. Modulate
        // by the ripple normal so it shimmers with the wave pattern
        // instead of looking like a flat painted decal.
        float disc = 1.0 - smoothstep(6.0, 35.0, planeR);
        float shimmer = 0.55 + 0.45 * (n.y); // 0.1..1.0 across waves
        col += uPlaneColor * disc * shimmer * uPlaneIntensity * 1.2;
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
        uLandingPos: { value: new Vector3() },
        uLandingColor: { value: new Color(0xfff8cc) },
        uLandingIntensity: { value: 0 },
        uPlanePos: { value: new Vector3() },
        uPlaneColor: { value: new Color(0xffffff) },
        uPlaneIntensity: { value: 0 },
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
  // extras (optional): {
  //   jet?: { position, intensity }      — hot orange exhaust pool
  //   landing?: { position, intensity }  — landing-light cone hit point
  //   plane?: { position, color, intensity } — body-color glint disc
  // }
  update(dt, planePos, worldTint, extras = null) {
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

    const jet = extras && extras.jet;
    if (jet && jet.intensity > 0.02) {
      u.uJetPos.value.copy(jet.position);
      u.uJetIntensity.value = jet.intensity;
    } else {
      u.uJetIntensity.value = 0;
    }

    const landing = extras && extras.landing;
    if (landing && landing.intensity > 0.02) {
      u.uLandingPos.value.copy(landing.position);
      u.uLandingIntensity.value = landing.intensity;
    } else {
      u.uLandingIntensity.value = 0;
    }

    const planeRefl = extras && extras.plane;
    if (planeRefl && planeRefl.intensity > 0.001) {
      u.uPlanePos.value.copy(planeRefl.position);
      if (planeRefl.color) u.uPlaneColor.value.copy(planeRefl.color);
      u.uPlaneIntensity.value = planeRefl.intensity;
    } else {
      u.uPlaneIntensity.value = 0;
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
