import {
  ACESFilmicToneMapping,
  Color,
  Fog,
  PerspectiveCamera,
  PCFSoftShadowMap,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import {
  FOG_COLOR,
  FOG_NEAR,
  FOG_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_FAR,
} from '../config.js';

export class Renderer {
  constructor() {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // ACES filmic tone mapping + linear→sRGB output turns our basic
    // MeshStandardMaterial palette into something that reads as a "graded"
    // image — brights roll off, darks deepen, colors feel richer.
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // PCF soft shadows when the graphics preset enables them; the light
    // itself toggles castShadow so this is free when shadows are off.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    // Drive the shadow map manually (main.js) instead of re-rendering every
    // frame: the sun's shadow pass re-draws all ~440 visible terrain chunks, so
    // refreshing it only when the view/sun/world actually changed is the single
    // biggest steady GPU win. main.js sets shadowMap.needsUpdate when needed.
    this.renderer.shadowMap.autoUpdate = false;
    document.body.appendChild(this.renderer.domElement);

    this.scene = new Scene();
    this.scene.background = new Color(FOG_COLOR);
    this.scene.fog = new Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);

    this.camera = new PerspectiveCamera(
      CAMERA_FOV,
      window.innerWidth / window.innerHeight,
      CAMERA_NEAR,
      CAMERA_FAR
    );
    this.camera.position.set(0, 5, 15);
    this.camera.lookAt(0, 0, 0);

    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
