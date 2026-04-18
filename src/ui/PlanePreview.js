import {
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { buildPlaneMesh, disposePlaneMesh } from '../plane/PlaneMesh.js';

// A tiny self-contained three.js scene that renders a rotating plane of the
// requested type/color into a single canvas. Used in the Choose Plane menu.
export class PlanePreview {
  constructor(canvas, type, color) {
    this.canvas = canvas;
    this.type = type;
    this.color = color;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.width, canvas.height, false);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(
      32,
      canvas.width / canvas.height,
      0.5,
      60
    );
    this.camera.position.set(0, 2.2, 14);
    this.camera.lookAt(0, 0.4, 0);

    this.scene.add(new HemisphereLight(0xcbe8ff, 0x445544, 0.85));
    const sun = new DirectionalLight(0xfff1c8, 1.1);
    sun.position.set(5, 10, 7);
    this.scene.add(sun);

    this.mesh = buildPlaneMesh(type, color);
    this.scene.add(this.mesh);

    this.rot = Math.random() * Math.PI * 2;
  }

  setType(type) {
    if (type === this.type) return;
    this.scene.remove(this.mesh);
    disposePlaneMesh(this.mesh);
    this.type = type;
    this.mesh = buildPlaneMesh(this.type, this.color);
    this.scene.add(this.mesh);
  }

  setColor(color) {
    if (color === this.color) return;
    this.scene.remove(this.mesh);
    disposePlaneMesh(this.mesh);
    this.color = color;
    this.mesh = buildPlaneMesh(this.type, this.color);
    this.scene.add(this.mesh);
  }

  animate(dt) {
    this.rot += dt * 0.5;
    this.mesh.rotation.y = this.rot;
    // Gentle tilt for a more dynamic preview.
    this.mesh.rotation.x = Math.sin(this.rot * 0.6) * 0.08;
    const prop = this.mesh.getObjectByName('propeller');
    if (prop) prop.rotation.z += dt * 20;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    disposePlaneMesh(this.mesh);
    this.renderer.dispose();
  }
}
