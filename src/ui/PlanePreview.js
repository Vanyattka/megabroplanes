import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { buildPlaneMesh, disposePlaneMesh } from '../plane/PlaneMesh.js';

const _box = new Box3();
const _sphere = new Sphere();
const _ctr = new Vector3();
const _noz = new Vector3();
const _back = new Vector3();

const EXHAUST_N = 200; // particle pool size

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
    this._pr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(this._pr);
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

    this._initExhaust();
    this._refreshExhaust();

    this.rot = Math.random() * Math.PI * 2;
  }

  // Pull the camera back far enough that the plane's whole bounding sphere
  // fits the (vertical) frustum — so a wide wingspan never gets clipped at the
  // sides as it spins. The sphere covers every Y rotation, so this holds for
  // the full turn. Also remembers the rear nozzle point for the jet exhaust.
  _frame() {
    _box.setFromObject(this.mesh);
    if (_box.isEmpty()) return;
    _box.getBoundingSphere(_sphere);
    _box.getCenter(_ctr);
    const r = _sphere.radius;
    const vfov = (this.camera.fov * Math.PI) / 180;
    const dist = (r / Math.sin(vfov / 2)) * 1.03; // big as possible without clipping the spin
    this.camera.position.set(0, _ctr.y + r * 0.3, dist);
    this.camera.lookAt(0, _ctr.y, 0);
    this.camera.updateProjectionMatrix();
    // Nose points -Z, so the tail/nozzle sits at +max.z.
    this._nozLocal = new Vector3(0, _ctr.y, _box.max.z * 0.96);
    this._exhaustScale = this.canvas.height * this._pr * 0.62;
  }

  setType(type) {
    if (type === this.type) return;
    this.scene.remove(this.mesh);
    disposePlaneMesh(this.mesh);
    this.type = type;
    this.mesh = buildPlaneMesh(this.type, this.color);
    this.scene.add(this.mesh);
    this._frame();
    this._refreshExhaust();
  }

  setColor(color) {
    if (color === this.color) return;
    this.scene.remove(this.mesh);
    disposePlaneMesh(this.mesh);
    this.color = color;
    this.mesh = buildPlaneMesh(this.type, this.color);
    this.scene.add(this.mesh);
  }

  // --- Jet exhaust ---------------------------------------------------------
  // A pool of additive fire particles emitted in WORLD space at the spinning
  // nozzle. Because old particles stay put while new ones spawn at the moved
  // nozzle, the plume trails and curves as the jet rotates — its signature
  // tail with a bit of inertia.
  _initExhaust() {
    this._exPos = new Float32Array(EXHAUST_N * 3);
    this._exCol = new Float32Array(EXHAUST_N * 3);
    this._exAlpha = new Float32Array(EXHAUST_N);
    this._exSize = new Float32Array(EXHAUST_N);
    this._exVel = new Float32Array(EXHAUST_N * 3);
    this._exAge = new Float32Array(EXHAUST_N).fill(1e9);
    this._exLife = new Float32Array(EXHAUST_N).fill(1);
    this._exHead = 0;

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this._exPos, 3));
    geo.setAttribute('aColor', new BufferAttribute(this._exCol, 3));
    geo.setAttribute('aAlpha', new BufferAttribute(this._exAlpha, 1));
    geo.setAttribute('aSize', new BufferAttribute(this._exSize, 1));
    geo.setDrawRange(0, EXHAUST_N);
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      uniforms: { uScale: { value: 800 } },
      vertexShader: `
        attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
        varying vec3 vColor; varying float vAlpha; uniform float uScale;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.001, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        precision mediump float;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - vec2(0.5));
          float a = smoothstep(0.5, 0.04, r) * vAlpha;
          if (a <= 0.002) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
    });
    this._exGeo = geo;
    this._exhaust = new Points(geo, mat);
    this._exhaust.frustumCulled = false;
    this._exhaust.renderOrder = 2;
    this.scene.add(this._exhaust);
  }

  // Show/hide + reset the exhaust when the plane type changes.
  _refreshExhaust() {
    const on = this.type === 'jet';
    if (this._exhaust) this._exhaust.visible = on;
    if (on && this._exhaust) {
      this._exhaust.material.uniforms.uScale.value = this._exhaustScale || 800;
      this._exAge.fill(1e9); // clear any stale particles
      this._exAlpha.fill(0);
    }
  }

  _fire(t, i3) {
    // t: 0 (fresh, white-hot) → 1 (cold, deep red)
    let r, g, b;
    if (t < 0.35) { const k = t / 0.35; r = 1; g = 0.96 - 0.4 * k; b = 0.72 - 0.55 * k; }
    else { const k = (t - 0.35) / 0.65; r = 1 - 0.28 * k; g = 0.56 - 0.42 * k; b = 0.17 - 0.11 * k; }
    this._exCol[i3] = r; this._exCol[i3 + 1] = g; this._exCol[i3 + 2] = b;
  }

  _updateExhaust(dt) {
    this.mesh.updateMatrixWorld();
    _noz.copy(this._nozLocal).applyMatrix4(this.mesh.matrixWorld);
    // Backward (away from the plane) = +Z in the plane's frame.
    _back.set(0, 0, 1).applyQuaternion(this.mesh.quaternion).normalize();

    // Emit a burst at the nozzle.
    const emit = 7;
    for (let e = 0; e < emit; e++) {
      const i = this._exHead;
      this._exHead = (this._exHead + 1) % EXHAUST_N;
      const i3 = i * 3;
      this._exAge[i] = 0;
      this._exLife[i] = 0.42 + Math.random() * 0.32;
      this._exPos[i3] = _noz.x + (Math.random() - 0.5) * 0.18;
      this._exPos[i3 + 1] = _noz.y + (Math.random() - 0.5) * 0.18;
      this._exPos[i3 + 2] = _noz.z + (Math.random() - 0.5) * 0.18;
      // Mostly straight back, a little sideways jitter; modest speed so the
      // rotation sweep visibly curves the plume (the inertia look).
      const sp = 2.6 + Math.random() * 1.6;
      this._exVel[i3] = _back.x * sp + (Math.random() - 0.5) * 0.7;
      this._exVel[i3 + 1] = _back.y * sp + (Math.random() - 0.5) * 0.7 + 0.2;
      this._exVel[i3 + 2] = _back.z * sp + (Math.random() - 0.5) * 0.7;
      this._exSize[i] = 1.15 + Math.random() * 0.5;
    }

    for (let i = 0; i < EXHAUST_N; i++) {
      if (this._exAge[i] >= this._exLife[i]) { this._exAlpha[i] = 0; continue; }
      this._exAge[i] += dt;
      const t = Math.min(1, this._exAge[i] / this._exLife[i]);
      const i3 = i * 3;
      this._exPos[i3] += this._exVel[i3] * dt;
      this._exPos[i3 + 1] += this._exVel[i3 + 1] * dt;
      this._exPos[i3 + 2] += this._exVel[i3 + 2] * dt;
      this._fire(t, i3);
      this._exAlpha[i] = (1 - t) * (1 - t) * 0.95;
      this._exSize[i] *= (1 - dt * 0.55);
    }

    this._exGeo.attributes.position.needsUpdate = true;
    this._exGeo.attributes.aColor.needsUpdate = true;
    this._exGeo.attributes.aAlpha.needsUpdate = true;
    this._exGeo.attributes.aSize.needsUpdate = true;
  }

  animate(dt) {
    this.rot += dt * 0.5;
    this.mesh.rotation.y = this.rot;
    // Gentle tilt for a more dynamic preview.
    this.mesh.rotation.x = Math.sin(this.rot * 0.6) * 0.08;
    const prop = this.mesh.getObjectByName('propeller');
    if (prop) prop.rotation.z += dt * 20;
    if (this._exhaust && this._exhaust.visible) this._updateExhaust(dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    disposePlaneMesh(this.mesh);
    if (this._exGeo) this._exGeo.dispose();
    if (this._exhaust) this._exhaust.material.dispose();
    this.renderer.dispose();
  }
}
