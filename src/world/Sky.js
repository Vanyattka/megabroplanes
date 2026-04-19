import {
  AmbientLight,
  BackSide,
  Color,
  DirectionalLight,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import {
  FOG_FAR_MAX,
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
  uniform float uSunIntensity;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    t = pow(t, 0.55);
    vec3 col = mix(uHorizon, uZenith, t);
    float sd = max(dot(dir, uSunDir), 0.0);
    col += uSunColor * pow(sd, 1024.0) * 5.0 * uSunIntensity;
    col += uSunColor * pow(sd, 8.0) * 0.35 * uSunIntensity;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Sky owns the sky dome + the scene's directional & ambient lights. DayNight
// mutates these each frame. Exposing the lights directly (instead of letting
// DayNight create them) keeps everything attached to the same scene graph
// and avoids drift between sky color and actual lighting.
export class Sky {
  constructor(scene) {
    this.scene = scene;

    const radius = FOG_FAR_MAX * 1.3;
    this.geometry = new SphereGeometry(radius, 32, 16);
    const sunDir = new Vector3(...SUN_DIRECTION).normalize();

    this.material = new ShaderMaterial({
      uniforms: {
        uHorizon: { value: new Color(HORIZON_COLOR) },
        uZenith: { value: new Color(ZENITH_COLOR) },
        uSunDir: { value: sunDir.clone() },
        uSunColor: { value: new Color(SUN_COLOR) },
        uSunIntensity: { value: 1.0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);

    // Use AmbientLight instead of HemisphereLight so DayNight's keyframe
    // interpolation has a simple color/intensity to drive. Hemi's sky/ground
    // pair makes the night look wrong (ground lit more than sky).
    this.ambient = new AmbientLight(0xffffff, 0.85);
    scene.add(this.ambient);

    this.sun = new DirectionalLight(0xfff1c8, 1.1);
    this.sun.position.copy(sunDir).multiplyScalar(500);
    scene.add(this.sun);
  }

  // Keep the sky centered on the camera so the horizon stays at infinity.
  update(camera) {
    this.mesh.position.copy(camera.position);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.scene.remove(this.ambient);
    this.scene.remove(this.sun);
    this.geometry.dispose();
    this.material.dispose();
  }
}
