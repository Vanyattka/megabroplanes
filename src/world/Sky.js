import {
  BackSide,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import {
  FOG_FAR,
  HORIZON_COLOR,
  ZENITH_COLOR,
  SUN_DIRECTION,
  SUN_COLOR,
} from '../config.js';

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vDir = worldPos.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    // t=0 at horizon, t=1 at zenith; bias so most of the gradient sits near the horizon.
    float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    t = pow(t, 0.55);
    vec3 col = mix(uHorizon, uZenith, t);
    float sd = max(dot(dir, uSunDir), 0.0);
    col += uSunColor * pow(sd, 1024.0) * 5.0;  // tight bright disc
    col += uSunColor * pow(sd, 8.0) * 0.35;    // soft halo
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Sky {
  constructor(scene) {
    const radius = FOG_FAR * 1.4;
    const geo = new SphereGeometry(radius, 32, 16);
    const sunDir = new Vector3(...SUN_DIRECTION).normalize();
    const mat = new ShaderMaterial({
      uniforms: {
        uHorizon: { value: new Color(HORIZON_COLOR) },
        uZenith: { value: new Color(ZENITH_COLOR) },
        uSunDir: { value: sunDir },
        uSunColor: { value: new Color(SUN_COLOR) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1; // draw before everything else
    scene.add(this.mesh);

    // Bright, flat sunny-day lighting: strong sky fill plus a warm sun.
    // No shadow maps — they're expensive with streaming chunks and we fake
    // shadows separately as ground decals.
    const hemi = new HemisphereLight(0xffffff, 0x3a4d2e, 0.85);
    scene.add(hemi);
    const sun = new DirectionalLight(0xfff1c8, 1.1);
    sun.position.copy(sunDir).multiplyScalar(500);
    scene.add(sun);
  }

  // Keep the sky centered on the camera so the horizon stays at infinity.
  update(camera) {
    this.mesh.position.copy(camera.position);
  }
}
