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

// HDR exhaust — only the HOT core crosses the bloom threshold (2.0). MID
// and COOL stay below, so they read as orange/red color without glowing
// halos. Keeps the plume from turning into a giant bright blob at full
// throttle.
const HOT = new Color().setRGB(2.4, 1.9, 0.8);
const MID = new Color().setRGB(1.8, 0.9, 0.3);
const COOL = new Color().setRGB(1.3, 0.4, 0.2);

const _m = new Matrix4();
const _q = new Quaternion();
const _pos = new Vector3();
const _scale = new Vector3();
const _offset = new Vector3(0, 0, 0);
const _nozNow = new Vector3();
const _nozVel = new Vector3();
const _back = new Vector3();
const _tmpColor = new Color();

export class JetExhaust {
  constructor(scene) {
    // Smaller base cube — the old 0.55m particle was reading as a giant
    // flame at full throttle once we gave it HDR color.
    const geom = new BoxGeometry(0.38, 0.38, 0.38);
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
    // Nozzle world position last frame — lets us spawn along the path the
    // nozzle swept this frame (so the plume base doesn't tear off sideways
    // during a fast turn) and hand particles the nozzle's true velocity.
    this._prevNoz = new Vector3();
    this._hasPrevNoz = false;
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
    this._hasPrevNoz = false; // don't lerp from a stale nozzle after a respawn
  }

  // `frac` 0..1 = where along the nozzle's path this frame to spawn (so a burst
  // of particles fills the swept arc rather than all stacking at frame start).
  _spawn(frac) {
    const p = this.particles[this._next];
    this._next = (this._next + 1) % JET_EXHAUST_MAX;

    p.pos.lerpVectors(this._prevNoz, _nozNow, frac);
    // Inherit the nozzle's true velocity (covers the sideways sweep of a hard
    // turn that plane.velocity alone misses) plus the backward jet thrust.
    p.vel.copy(_nozVel).addScaledVector(_back, JET_EXHAUST_SPEED);
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

    // Current nozzle world position; its velocity = how far it moved this frame
    // (linear flight + the rotational sweep of the offset nozzle).
    _offset.set(0, 0, JET_EXHAUST_OFFSET_Z).applyQuaternion(plane.quaternion);
    _nozNow.copy(plane.position).add(_offset);
    if (!this._hasPrevNoz) this._prevNoz.copy(_nozNow);
    // A >60 m/frame jump is a teleport (respawn at a gate, dev TP), not flight —
    // fall back to plane.velocity so we don't fling the plume across the sky.
    const teleported = _nozNow.distanceToSquared(this._prevNoz) > 3600;
    if (this._hasPrevNoz && dt > 1e-5 && !teleported) {
      _nozVel.copy(_nozNow).sub(this._prevNoz).multiplyScalar(1 / dt);
    } else {
      _nozVel.copy(plane.velocity);
      if (teleported) this._prevNoz.copy(_nozNow); // base spawns at the new nozzle, no smear
    }
    _back.set(0, 0, 1).applyQuaternion(plane.quaternion); // world backward

    // Emission rate scales with throttle.
    const rate = JET_EXHAUST_RATE * plane.throttle;
    this._accum += rate * dt;
    const toSpawn = Math.floor(this._accum);
    this._accum -= toSpawn;
    for (let i = 0; i < toSpawn; i++) this._spawn(toSpawn > 1 ? (i + 1) / toSpawn : 1);
    this._prevNoz.copy(_nozNow);
    this._hasPrevNoz = true;

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
      // Smaller peak size so the particle's world-space AABB doesn't poke
      // into the fuselage near the cockpit on hard turns.
      const size = 0.35 + (1 - t) * 0.9;
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
