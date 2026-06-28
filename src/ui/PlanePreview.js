import {
  Box3,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { buildPlaneMesh, disposePlaneMesh } from '../plane/PlaneMesh.js';

const _box = new Box3();
const _sphere = new Sphere();
const _ctr = new Vector3();

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
      200
    );

    this.scene.add(new HemisphereLight(0xcbe8ff, 0x445544, 0.85));
    const sun = new DirectionalLight(0xfff1c8, 1.1);
    sun.position.set(5, 10, 7);
    this.scene.add(sun);

    this.mesh = buildPlaneMesh(type, color);
    this.scene.add(this.mesh);
    this._frame();

    this.rot = Math.random() * Math.PI * 2;
  }

  // Pull the camera back far enough that the plane's whole bounding sphere
  // fits the (vertical) frustum — so a wide wingspan never gets clipped at the
  // sides as it spins. The sphere covers every Y rotation, so this holds for
  // the full turn.
  _frame() {
    _box.setFromObject(this.mesh);
    if (_box.isEmpty()) return;
    _box.getBoundingSphere(_sphere);
    _box.getCenter(_ctr);
    const r = _sphere.radius;
    const vfov = (this.camera.fov * Math.PI) / 180;
    const dist = (r / Math.sin(vfov / 2)) * 1.06; // just enough breathing room
    this.camera.position.set(0, _ctr.y + r * 0.32, dist);
    this.camera.lookAt(0, _ctr.y, 0);
    this.camera.updateProjectionMatrix();
  }

  setType(type) {
    if (type === this.type) return;
    this.scene.remove(this.mesh);
    disposePlaneMesh(this.mesh);
    this.type = type;
    this.mesh = buildPlaneMesh(this.type, this.color);
    this.scene.add(this.mesh);
    this._frame();
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
