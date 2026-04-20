import {
  AmbientLight,
  BackSide,
  Color,
  DirectionalLight,
  Mesh,
  Object3D,
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
  SHADOW_FRUSTUM_HALF,
  SHADOW_CAMERA_DISTANCE,
  SHADOW_BIAS,
  SHADOW_NORMAL_BIAS,
} from '../config.js';
import { worldTime } from './WorldTime.js';
import { AtmosphericSky } from './AtmosphericSky.js';

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
    // Sun sharpness lowered and multiplier clamped so the dome itself
    // never crosses the bloom threshold — the sun still reads as bright
    // due to the halo, but the horizon doesn't bleed out.
    col += uSunColor * pow(sd, 800.0) * 1.4 * uSunIntensity;
    col += uSunColor * pow(sd, 10.0) * 0.25 * uSunIntensity;
    // Hard ceiling keeps the whole sky in LDR range.
    col = clamp(col, 0.0, 0.95);
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
    // Shadow camera — tight ortho frustum that follows the plane. Configured
    // up front so the only per-frame work is moving position + target.
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = SHADOW_CAMERA_DISTANCE * 2.2;
    this.sun.shadow.camera.left = -SHADOW_FRUSTUM_HALF;
    this.sun.shadow.camera.right = SHADOW_FRUSTUM_HALF;
    this.sun.shadow.camera.top = SHADOW_FRUSTUM_HALF;
    this.sun.shadow.camera.bottom = -SHADOW_FRUSTUM_HALF;
    this.sun.shadow.bias = SHADOW_BIAS;
    this.sun.shadow.normalBias = SHADOW_NORMAL_BIAS;
    this.sun.shadow.camera.updateProjectionMatrix();
    // The DirectionalLight needs its `target` added to the scene if we want
    // to move it each frame — otherwise the shadow camera ignores target
    // updates after the first frame.
    this.sunTarget = new Object3D();
    scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    scene.add(this.sun);
    this._sunDir = sunDir.clone();

    // Optional atmospheric dome — enabled by the graphics settings. When
    // visible, it sits behind the gradient dome, which we hide so only the
    // atmospheric version drives the sky.
    this.atmospheric = new AtmosphericSky(scene);
    this._atmoEnabled = false;
  }

  setAtmospheric(on) {
    this._atmoEnabled = !!on;
    this.atmospheric.setEnabled(this._atmoEnabled);
    // The gradient dome is skipped when atmospheric is active — otherwise
    // the two would blend into washed-out gray.
    this.mesh.visible = !this._atmoEnabled;
  }

  // Plug in new shadow-map resolution from the graphics settings. Zero = off.
  setShadowMapSize(size) {
    if (!this.sun) return;
    this.sun.castShadow = size > 0;
    if (size > 0) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null; // rebuild on next render
      }
    }
  }

  // Shadow camera frustum half-size in world units. Wider = shadows on
  // farther objects but softer edges per texel.
  setShadowFrustumHalf(h) {
    if (!this.sun) return;
    const c = this.sun.shadow.camera;
    c.left = -h;
    c.right = h;
    c.top = h;
    c.bottom = -h;
    c.updateProjectionMatrix();
  }

  // Keep the sky centered on the camera so the horizon stays at infinity.
  // Also slide the sun's shadow frustum to follow the plane so shadows stay
  // crisp near the player without needing CSMs.
  update(camera, planePos) {
    this.mesh.position.copy(camera.position);
    if (this._atmoEnabled) {
      this.atmospheric.update(camera, worldTime.sunDir);
    }
    if (planePos && this.sun) {
      // worldTime.sunDir is the authoritative sun direction (written each
      // frame by DayNight). We place the light above the plane in that
      // direction so the shadow frustum stays centered on the player.
      this._sunDir.copy(worldTime.sunDir);
      this.sun.position
        .copy(this._sunDir)
        .multiplyScalar(SHADOW_CAMERA_DISTANCE)
        .add(planePos);
      this.sunTarget.position.copy(planePos);
      this.sun.shadow.camera.updateProjectionMatrix();
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.scene.remove(this.ambient);
    this.scene.remove(this.sun);
    this.geometry.dispose();
    this.material.dispose();
  }
}
