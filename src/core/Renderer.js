import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Color,
  Fog,
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
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
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
