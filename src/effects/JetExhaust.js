import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  AdditiveBlending,
} from 'three';
import {
  JET_EXHAUST_MAX,
  JET_EXHAUST_RATE,
  JET_EXHAUST_LIFE,
  JET_EXHAUST_SPEED,
  JET_EXHAUST_SPREAD,
  JET_EXHAUST_OFFSET_Z,
} from '../config.js';

// Throttle-scaled trail of orange particles streaming out of the jet's
// engine nozzle. Uses a single InstancedMesh with additive blending so the
// trail reads as "fire" against any background.

const HOT = new Color(0xffd96a);
const MID = new Color(0xff8c2a);
const COOL = new Color(0xff3a1a);

const _m = new Matrix4();
const _q = new Quaternion();
const _pos = new Vector3();
const _scale = new Vector3();
const _offset = new Vector3(0, 0, 0);
const _tmpColor = new Color();

export class JetExhaust {
  constructor(scene) {
    const geom = new BoxGeometry(0.55, 0.55, 0.55);
    const mat = new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new InstancedMesh(geom, mat, JET_EXHAUST_MAX);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.particles = [];
    for (let i = 0; i < JET_EXHAUST_MAX; i++) {
      this.particles.push({
        pos: new Vector3(),
        vel: new Vector3(),
        life: Infinity,
        maxLife: JET_EXHAUST_LIFE,
      });
      // Seed instanceColor attribute so setColorAt works later.
      this.mesh.setColorAt(i, _tmpColor.setHex(0xffffff));
    }
    this._hideAll();
    this._accum = 0;
    this._next = 0;
  }

  _hideAll() {
    _scale.set(0, 0, 0);
    _pos.set(0, 0, 0);
    _q.identity();
    for (let i = 0; i < JET_EXHAUST_MAX; i++) {
      _m.compose(_pos, _q, _scale);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (const p of this.particles) p.life = Infinity;
    this._hideAll();
    this.mesh.visible = false;
    this._accum = 0;
  }

  _spawn(plane) {
    const p = this.particles[this._next];
    this._next = (this._next + 1) % JET_EXHAUST_MAX;

    // Place at the engine nozzle in world space.
    _offset.set(0, 0, JET_EXHAUST_OFFSET_Z).applyQuaternion(plane.quaternion);
    p.pos.copy(plane.position).add(_offset);

    // Base velocity: plane's velocity minus forward direction (so particles
    // trail behind), plus jitter.
    _offset.set(0, 0, 1).applyQuaternion(plane.quaternion); // world +Z local = backward of the plane
    p.vel.copy(plane.velocity).addScaledVector(_offset, JET_EXHAUST_SPEED);
    p.vel.x += (Math.random() - 0.5) * JET_EXHAUST_SPREAD;
    p.vel.y += (Math.random() - 0.5) * JET_EXHAUST_SPREAD;
    p.vel.z += (Math.random() - 0.5) * JET_EXHAUST_SPREAD;

    p.life = 0;
    p.maxLife = JET_EXHAUST_LIFE * (0.75 + Math.random() * 0.5);
  }

  update(dt, plane) {
    if (!plane || plane.type !== 'jet' || plane.crashed) {
      if (this.mesh.visible) this.clear();
      return;
    }
    this.mesh.visible = true;

    // Emission rate scales with throttle.
    const rate = JET_EXHAUST_RATE * plane.throttle;
    this._accum += rate * dt;
    const toSpawn = Math.floor(this._accum);
    this._accum -= toSpawn;
    for (let i = 0; i < toSpawn; i++) this._spawn(plane);

    // Update all particles.
    let colorsChanged = false;
    for (let i = 0; i < JET_EXHAUST_MAX; i++) {
      const p = this.particles[i];
      if (p.life >= p.maxLife) {
        _m.compose(_pos.set(0, 0, 0), _q.identity(), _scale.set(0, 0, 0));
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      p.life += dt;
      p.pos.addScaledVector(p.vel, dt);
      // Air drag so particles decelerate; also some buoyancy so they rise
      // slightly like real hot exhaust.
      p.vel.multiplyScalar(Math.max(0, 1 - 1.4 * dt));
      p.vel.y += 1.8 * dt;

      const t = Math.min(1, p.life / p.maxLife);
      const size = 0.4 + (1 - t) * 1.4;
      _scale.set(size, size, size);
      _m.compose(p.pos, _q.identity(), _scale);
      this.mesh.setMatrixAt(i, _m);

      // Color curve: yellow-hot → orange → red → dark.
      if (t < 0.35) {
        _tmpColor.copy(HOT).lerp(MID, t / 0.35);
      } else if (t < 0.75) {
        _tmpColor.copy(MID).lerp(COOL, (t - 0.35) / 0.4);
      } else {
        _tmpColor.copy(COOL).multiplyScalar(Math.max(0.2, 1 - (t - 0.75) * 3));
      }
      this.mesh.setColorAt(i, _tmpColor);
      colorsChanged = true;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colorsChanged && this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
