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

// Vertex: pass world position + view direction straight through. The water
// plane is flat — ripples are done in the fragment with analytic wave
// functions so we don't pay for a heavy normal map sample.
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

// Fragment: animated ripples (two crossed sine fields advected by uTime),
// Fresnel blend between shallow and deep colors, plus a sky-color reflection
// term. We intentionally skip Three's fog chunks here — a ShaderMaterial
// that uses them has to merge UniformsLib.fog itself, and getting that
// wrong throws during compile and kills the render loop. The water edge is
// well past `camera.far` on the horizon anyway, so fog isn't needed to hide
// it; we fade manually toward the horizon tint at grazing view angles.
const FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3  uShallow;
  uniform vec3  uDeep;
  uniform vec3  uSkyColor;
  uniform float uOpacity;
  uniform float uRippleAmp;
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

    vec3 baseCol = mix(uShallow, uDeep, clamp((1.0 - ndv) * 0.5, 0.0, 1.0));
    vec3 col = mix(baseCol, uSkyColor, fresnel);

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
        uOpacity: { value: WATER_OPACITY },
        uRippleAmp: { value: 1.0 },
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
    this._tint = new Color();
  }

  // planePos: Vector3-like — the water plane centers itself under the player
  // each frame so the finite mesh always fills the visible area.
  // worldTint (optional): current sky horizon tint for reflections; passed by
  // DayNight in main.js so reflections follow the time of day.
  update(dt, planePos, worldTint) {
    this._time += dt * WATER_NORMAL_SCROLL_SPEED;
    this.material.uniforms.uTime.value = this._time;

    if (planePos) {
      this.mesh.position.x = planePos.x;
      this.mesh.position.z = planePos.z;
    }

    if (worldTint) {
      this.material.uniforms.uSkyColor.value.copy(worldTint);
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
