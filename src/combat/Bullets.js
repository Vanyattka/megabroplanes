import {
  BoxGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
  Color,
} from 'three';
import {
  BULLET_SPEED,
  BULLET_LIFE,
  BULLET_MAX,
  BULLET_HIT_RADIUS,
  BULLET_COLOR,
} from '../config.js';

// Visible tracer projectiles for race-mode combat. One InstancedMesh pool of
// elongated glowing boxes (HDR color → blooms). Bullets are simulated locally;
// only the LOCAL player's bullets do hit-testing (against remote planes), and
// on a hit we fire a callback so the net layer can claim it (the server is the
// HP authority). Remote players' tracers are spawned from relayed `fire`
// events purely for show.
const _o = new Object3D();
const _seg = new Vector3();
const _toTarget = new Vector3();
const _proj = new Vector3();

export class Bullets {
  constructor(scene, localId) {
    this.scene = scene;
    this.localId = localId;
    const geo = new BoxGeometry(0.18, 0.18, 3.2);
    const mat = new MeshBasicMaterial({ color: new Color(BULLET_COLOR), toneMapped: false });
    this.mesh = new InstancedMesh(geo, mat, BULLET_MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = BULLET_MAX;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);

    this.pool = [];
    for (let i = 0; i < BULLET_MAX; i++) {
      this.pool.push({
        active: false,
        pos: new Vector3(),
        prev: new Vector3(),
        vel: new Vector3(),
        life: 0,
        owner: null,
      });
    }
    this._hideAll();
    this.onHit = null; // (targetId) => void
  }

  setLocalId(id) { this.localId = id; }

  _hideAll() {
    _o.position.set(0, -100000, 0);
    _o.scale.set(0.001, 0.001, 0.001);
    _o.updateMatrix();
    for (let i = 0; i < BULLET_MAX; i++) this.mesh.setMatrixAt(i, _o.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  // Spawn a tracer. `vel0` is the firing plane's velocity so bullets inherit
  // forward speed (no slow-motion bullets at jet speeds).
  spawn(origin, dir, ownerId, vel0 = null) {
    const b = this.pool.find((p) => !p.active);
    if (!b) return;
    b.active = true;
    b.owner = ownerId;
    b.life = BULLET_LIFE;
    b.pos.copy(origin);
    b.prev.copy(origin);
    b.vel.copy(dir).normalize().multiplyScalar(BULLET_SPEED);
    if (vel0) b.vel.add(vel0);
  }

  clear() {
    for (const b of this.pool) b.active = false;
    this._hideAll();
  }

  // targets: [{ id, position: Vector3 }] — remote planes to test against.
  update(dt, targets) {
    let dirty = false;
    for (let i = 0; i < this.pool.length; i++) {
      const b = this.pool[i];
      if (!b.active) continue;
      b.prev.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;

      // Hit-test only our own bullets, swept against the step segment so fast
      // tracers don't tunnel through planes.
      if (b.owner === this.localId && targets) {
        for (const t of targets) {
          if (this._segHit(b.prev, b.pos, t.position)) {
            b.active = false;
            if (this.onHit) this.onHit(t.id);
            break;
          }
        }
      }

      if (b.life <= 0) { b.active = false; }

      if (b.active) {
        _o.position.copy(b.pos);
        _o.lookAt(_proj.copy(b.pos).add(b.vel)); // orient along travel
        _o.scale.set(1, 1, 1);
        _o.updateMatrix();
        this.mesh.setMatrixAt(i, _o.matrix);
      } else {
        _o.position.set(0, -100000, 0);
        _o.scale.set(0.001, 0.001, 0.001);
        _o.updateMatrix();
        this.mesh.setMatrixAt(i, _o.matrix);
      }
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  // Distance from point `c` to segment a→b within BULLET_HIT_RADIUS.
  _segHit(a, b, c) {
    _seg.subVectors(b, a);
    const segLen2 = _seg.lengthSq();
    let t = segLen2 > 1e-6 ? _toTarget.subVectors(c, a).dot(_seg) / segLen2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    _proj.copy(a).addScaledVector(_seg, t);
    return _proj.distanceToSquared(c) <= BULLET_HIT_RADIUS * BULLET_HIT_RADIUS;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
