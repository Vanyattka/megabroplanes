import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  NormalBlending,
} from 'three';
import {
  CONTRAIL_MAX,
  CONTRAIL_RATE,
  CONTRAIL_LIFE,
  CONTRAIL_MIN_ALT,
  CONTRAIL_FULL_ALT,
  CONTRAIL_SIDE_OFFSET,
  CONTRAIL_BACK_OFFSET,
  CONTRAIL_MIN_THROTTLE,
  CONTRAIL_PEAK_SIZE,
} from '../config.js';

// Long-lived white condensation trails behind a jet at cruise altitude.
// Two parallel trails (one per engine), spawned at fixed world positions
// that then DON'T move — real contrails hang in the air while the aircraft
// flies on, which gives the iconic parallel-stripes-across-the-sky look.
// Separate from JetExhaust: different lifetime (tens of seconds vs. half
// a second), different blending (normal transparency, not additive), and
// gated on altitude.

const _m = new Matrix4();
const _q = new Quaternion();
const _pos = new Vector3();
const _scale = new Vector3();
const _offset = new Vector3();
const _tmpColor = new Color();

const COLOR_WHITE = new Color(1.0, 1.0, 1.0);

export class Contrails {
  constructor(scene) {
    // Soft sphere-ish look via a cube is cheap and good enough at the
    // distances contrails typically sit at — they blur together into a
    // line. Tiny base size; particles are rescaled each frame.
    const geom = new BoxGeometry(1, 1, 1);
    const mat = new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      // Additive with low alpha would make them too glowy at sunset; normal
      // transparency with white × fading color reads as diffuse cloud vapor.
      blending: NormalBlending,
      opacity: 0.55,
    });
    this.mesh = new InstancedMesh(geom, mat, CONTRAIL_MAX);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.particles = [];
    for (let i = 0; i < CONTRAIL_MAX; i++) {
      this.particles.push({
        pos: new Vector3(),
        vel: new Vector3(),
        life: Infinity,
        maxLife: CONTRAIL_LIFE,
      });
      this.mesh.setColorAt(i, _tmpColor.copy(COLOR_WHITE));
    }
    this._hideAll();
    this._accum = 0;   // fractional particles queued for spawn
    this._next = 0;    // ring-buffer write index
    this._parity = 0;  // alternates 0/1 to spawn L/R side
  }

  _hideAll() {
    _scale.set(0, 0, 0);
    _pos.set(0, 0, 0);
    _q.identity();
    for (let i = 0; i < CONTRAIL_MAX; i++) {
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
    const side = this._parity === 0 ? -1 : 1;
    this._parity = 1 - this._parity;
    const p = this.particles[this._next];
    this._next = (this._next + 1) % CONTRAIL_MAX;

    // Place at engine exhaust, offset laterally so the two trails diverge
    // slightly as they expand. Small jitter keeps the trail from looking
    // like perfectly straight pixel-thin lines from behind.
    _offset.set(
      side * CONTRAIL_SIDE_OFFSET,
      0,
      CONTRAIL_BACK_OFFSET + (Math.random() - 0.5) * 0.4
    );
    // Anchor to the SAME interpolated transform the mesh (and JetExhaust) are
    // drawn with — NOT the raw post-physics plane.position/quaternion. The
    // post-physics transform leads the rendered airframe by up to one physics
    // step; with the side+back offset that lag spawned fresh puffs off to the
    // side/forward of the nozzle (near the wing root), reading as a SECOND
    // plume during turns/camera motion. (Exhaust was already fixed this way;
    // the contrail lag is what was still showing as the doubled trail.)
    const quat = plane.renderQuaternion || plane.quaternion;
    const pos = plane.renderPosition || plane.position;
    _offset.applyQuaternion(quat);
    p.pos.copy(pos).add(_offset);

    // Contrails in real life hang in place while the plane flies off — no
    // inherited plane velocity. Tiny random drift so they slowly diffuse
    // and expand as they age.
    p.vel.set(
      (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.2) * 0.3, // slight upward bias
      (Math.random() - 0.5) * 0.6
    );

    p.life = 0;
    p.maxLife = CONTRAIL_LIFE * (0.85 + Math.random() * 0.3);
  }

  update(dt, plane) {
    // Activation gate: only jets, only at altitude, only under throttle.
    // Below CONTRAIL_MIN_ALT the effect is off entirely; between MIN and
    // FULL it fades in proportionally.
    const isJetFlying = plane && plane.type === 'jet' && !plane.crashed;
    const altFactor = isJetFlying
      ? Math.max(
          0,
          Math.min(
            1,
            (plane.position.y - CONTRAIL_MIN_ALT) /
              Math.max(1, CONTRAIL_FULL_ALT - CONTRAIL_MIN_ALT)
          )
        )
      : 0;
    const throttleFactor = isJetFlying
      ? Math.max(0, (plane.throttle - CONTRAIL_MIN_THROTTLE) /
          Math.max(0.001, 1 - CONTRAIL_MIN_THROTTLE))
      : 0;
    const emitFactor = altFactor * throttleFactor;

    if (!this.mesh.visible) this.mesh.visible = true;

    // Spawn (possibly zero if emitFactor is 0).
    if (isJetFlying && emitFactor > 0) {
      this._accum += CONTRAIL_RATE * emitFactor * dt;
      const toSpawn = Math.floor(this._accum);
      this._accum -= toSpawn;
      for (let i = 0; i < toSpawn; i++) this._spawn(plane);
    } else {
      this._accum = 0;
    }

    // Update all particles. We always run this — even when emission is off,
    // the existing trail needs to keep ageing out instead of freezing in
    // the sky indefinitely.
    let colorsChanged = false;
    let anyLive = false;
    for (let i = 0; i < CONTRAIL_MAX; i++) {
      const p = this.particles[i];
      if (p.life >= p.maxLife) {
        _m.compose(_pos.set(0, 0, 0), _q.identity(), _scale.set(0, 0, 0));
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      anyLive = true;
      p.life += dt;
      p.pos.addScaledVector(p.vel, dt);

      const t = Math.min(1, p.life / p.maxLife);
      // Puffs expand as they age (diffusion), then shrink in the last 20%
      // so they fade away gracefully rather than disappearing mid-sky.
      let size;
      if (t < 0.8) {
        size = 0.6 + t * (CONTRAIL_PEAK_SIZE - 0.6);
      } else {
        const k = (t - 0.8) / 0.2;
        size = CONTRAIL_PEAK_SIZE * (1 - k);
      }
      _scale.set(size, size, size);
      _m.compose(p.pos, _q.identity(), _scale);
      this.mesh.setMatrixAt(i, _m);

      // Fade color: bright white until half-life, then dim toward black.
      // With NormalBlending, darkening the color also darkens the pixel —
      // so it reads as alpha fade against the sky regardless of background.
      const bright = t < 0.4 ? 1.0 : Math.max(0, 1 - (t - 0.4) / 0.6);
      _tmpColor.setRGB(bright, bright, bright);
      this.mesh.setColorAt(i, _tmpColor);
      colorsChanged = true;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colorsChanged && this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
    // Hide the mesh when nothing's alive so we don't submit a fully-zero-scale
    // draw call forever.
    if (!anyLive && emitFactor === 0) this.mesh.visible = false;
  }
}
