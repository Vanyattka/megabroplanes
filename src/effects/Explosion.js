import {
  BoxGeometry,
  Color,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import {
  EXPLOSION_PARTICLE_COUNT,
  EXPLOSION_GRAVITY,
  EXPLOSION_DRAG,
  EXPLOSION_LIFE_MIN,
  EXPLOSION_LIFE_MAX,
} from '../config.js';

const FIRE = [0xff7a28, 0xffbf3d, 0xff5020, 0xffd36b];
const DEBRIS = [0x2a2a2a, 0x444444, 0x5a3a20];

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _zero = new Vector3(0, 0, 0);

export class Explosion {
  constructor(scene) {
    const geo = new BoxGeometry(0.9, 0.9, 0.9);
    // MeshBasicMaterial ignores scene lighting, so fire colors stay vibrant
    // at night (when ambient is dim). The per-instance colors set via
    // setColorAt() drive the look directly — no need for emissive tricks.
    const mat = new MeshBasicMaterial({
      toneMapped: false,
    });
    this.mesh = new InstancedMesh(geo, mat, EXPLOSION_PARTICLE_COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.particles = [];
    const tmp = new Color();
    for (let i = 0; i < EXPLOSION_PARTICLE_COUNT; i++) {
      this.particles.push({
        pos: new Vector3(),
        vel: new Vector3(),
        rot: new Euler(),
        angVel: new Vector3(),
        life: Infinity,
        maxLife: 1,
        baseScale: 1,
        isFire: true,
      });
      // Ensure instanceColor attribute exists.
      this.mesh.setColorAt(i, tmp.setHex(0xffffff));
    }
    this.active = false;
    this._hideAll();
  }

  _hideAll() {
    for (let i = 0; i < EXPLOSION_PARTICLE_COUNT; i++) {
      _m.compose(_zero, _q.identity(), _s.set(0, 0, 0));
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  trigger(position, impactVelocity) {
    this.active = true;
    this.mesh.visible = true;
    const tmp = new Color();
    for (let i = 0; i < EXPLOSION_PARTICLE_COUNT; i++) {
      const p = this.particles[i];
      p.pos.copy(position);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 8 + Math.random() * 22;
      // Burst roughly hemispherical upward, with a nudge from the impact.
      p.vel.set(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.abs(Math.cos(phi)) * speed * 1.3 + 4,
        Math.sin(phi) * Math.sin(theta) * speed
      );
      p.vel.addScaledVector(impactVelocity, -0.15);
      p.rot.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );
      p.angVel.set(
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12
      );
      p.baseScale = 0.6 + Math.random() * 0.9;
      p.life = 0;
      p.maxLife =
        EXPLOSION_LIFE_MIN +
        Math.random() * (EXPLOSION_LIFE_MAX - EXPLOSION_LIFE_MIN);

      p.isFire = Math.random() < 0.7;
      const palette = p.isFire ? FIRE : DEBRIS;
      const hex = palette[Math.floor(Math.random() * palette.length)];
      this.mesh.setColorAt(i, tmp.setHex(hex));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.active = false;
    this.mesh.visible = false;
    for (const p of this.particles) p.life = Infinity;
    this._hideAll();
  }

  update(dt) {
    if (!this.active) return;
    let anyAlive = false;
    for (let i = 0; i < EXPLOSION_PARTICLE_COUNT; i++) {
      const p = this.particles[i];
      if (p.life >= p.maxLife) {
        _m.compose(_zero, _q.identity(), _s.set(0, 0, 0));
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      anyAlive = true;
      p.vel.y -= EXPLOSION_GRAVITY * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - EXPLOSION_DRAG * dt));
      p.pos.addScaledVector(p.vel, dt);
      p.rot.x += p.angVel.x * dt;
      p.rot.y += p.angVel.y * dt;
      p.rot.z += p.angVel.z * dt;
      p.life += dt;

      const fade = 1 - p.life / p.maxLife;
      // Fire puffs grow a bit then shrink; debris just shrinks slowly.
      const sizeCurve = p.isFire
        ? Math.sin(Math.min(1, p.life / p.maxLife) * Math.PI)
        : Math.max(0.1, fade);
      const s = p.baseScale * Math.max(0.05, sizeCurve * 1.1);
      _q.setFromEuler(p.rot);
      _s.set(s, s, s);
      _m.compose(p.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!anyAlive) {
      this.active = false;
      this.mesh.visible = false;
    }
  }
}
