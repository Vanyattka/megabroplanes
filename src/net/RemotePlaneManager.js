import { Color, Quaternion, Vector3 } from 'three';
import { buildPlaneMesh, disposePlaneMesh, applyGearPose } from '../plane/PlaneMesh.js';
import { JetExhaust } from '../effects/JetExhaust.js';
import { Contrails } from '../effects/Contrails.js';
import { DEFAULT_PLANE_TYPE, DEFAULT_BODY_COLOR, GEAR_ANIM_SPEED } from '../config.js';

const LERP = 0.22;
const SLERP = 0.22;
// Cap on the velocity we estimate from a remote's position deltas. A 20 Hz
// network snap (big jump in one packet) would otherwise yield a huge velocity
// that flings the jet's exhaust particles kilometres across the sky for a
// frame. ~400 m/s is well past any plane's real top speed.
const MAX_REMOTE_EST_SPEED = 400;

// Used only when the remote hasn't broadcast pt/pc yet — fall back to the
// hue the server assigned so the plane still has a distinct color.
function hueToHex(hue) {
  return new Color().setHSL(hue, 0.7, 0.6).getHex();
}

export class RemotePlaneManager {
  constructor(scene, client) {
    this.scene = scene;
    this.client = client;
    this.visuals = new Map();
  }

  _buildMesh(type, color) {
    return buildPlaneMesh(type || DEFAULT_PLANE_TYPE, color ?? DEFAULT_BODY_COLOR);
  }

  _rebuild(v, type, color) {
    this.scene.remove(v.mesh);
    disposePlaneMesh(v.mesh);
    v.mesh = this._buildMesh(type, color);
    v.mesh.position.copy(v.targetPos);
    v.mesh.quaternion.copy(v.targetQuat);
    applyGearPose(v.mesh, v.gearT ?? 1); // fresh mesh is gear-down by default
    this.scene.add(v.mesh);
    v.type = type;
    v.color = color;
    // Type changed → exhaust applicability may have changed too. Clear so
    // a piper-turned-jet doesn't carry a stale empty plume, and a jet-turned-
    // piper has its plume fade out instead of staying on.
    if (v.exhaust) v.exhaust.clear();
    if (v.contrails) v.contrails.clear();
  }

  // Build the synthetic plane object the JetExhaust + Contrails update
  // functions expect. We don't have authoritative velocity over the wire,
  // so we estimate it from successive position deltas — close enough for
  // the exhaust spawn velocity, and the trail will look correct at any
  // typical airspeed.
  _syntheticPlane(v) {
    return {
      type: v.type,
      crashed: v.crashed,
      throttle: v.throttle,
      position: v.mesh.position,
      quaternion: v.mesh.quaternion,
      velocity: v.estVel,
    };
  }

  // Lightweight list of live remote planes for combat hit-testing:
  // [{ id, position }]. Skips crashed/downed planes.
  listTargets() {
    const out = [];
    for (const [id, v] of this.visuals) {
      if (v.crashed) continue;
      out.push({ id, position: v.mesh.position });
    }
    return out;
  }

  update(dt) {
    const seen = new Set();
    for (const [id, r] of this.client.remotes) {
      if (!r.pos || !r.quat) continue;
      seen.add(id);

      // Prefer broadcast type/color; fall back to hue-derived color.
      const wantedType = r.type || DEFAULT_PLANE_TYPE;
      const wantedColor =
        r.color != null ? r.color : hueToHex(r.hue);

      let v = this.visuals.get(id);
      if (!v) {
        const mesh = this._buildMesh(wantedType, wantedColor);
        mesh.position.fromArray(r.pos);
        mesh.quaternion.fromArray(r.quat);
        this.scene.add(mesh);
        v = {
          mesh,
          targetPos: new Vector3().fromArray(r.pos),
          targetQuat: new Quaternion().fromArray(r.quat),
          throttle: r.throttle || 0,
          crashed: !!r.crashed,
          type: wantedType,
          color: wantedColor,
          // Velocity estimate, refreshed each frame from position deltas.
          // Used by JetExhaust to seed particle velocity at spawn.
          prevPos: new Vector3().fromArray(r.pos),
          estVel: new Vector3(),
          // Landing-gear extension, animated toward the broadcast state.
          gearT: r.gearDown === false ? 0 : 1,
          // Lazily-created jet effects — only allocated for jet remotes,
          // and reused even if the local frame doesn't include this remote.
          exhaust: null,
          contrails: null,
        };
        this.visuals.set(id, v);
      } else if (v.type !== wantedType || v.color !== wantedColor) {
        this._rebuild(v, wantedType, wantedColor);
      }

      v.targetPos.fromArray(r.pos);
      v.targetQuat.fromArray(r.quat);
      v.throttle = r.throttle || 0;
      v.crashed = !!r.crashed;

      // Track previous-frame position so we can derive a velocity for the
      // jet exhaust spawn. Use the smoothed mesh position (after lerp) so
      // the velocity estimate matches what the visual mesh is doing — not
      // the raw network target which can jitter at 20 Hz.
      v.prevPos.copy(v.mesh.position);

      v.mesh.position.lerp(v.targetPos, LERP);
      v.mesh.quaternion.slerp(v.targetQuat, SLERP);
      v.mesh.visible = !v.crashed;

      // Velocity ≈ (newPos - prevPos) / dt. dt can be 0 on the very first
      // frame; clamp to avoid an Infinity that the exhaust shader would
      // dutifully amplify into a 1-frame plume across the world.
      if (dt > 0) {
        v.estVel.subVectors(v.mesh.position, v.prevPos).divideScalar(dt);
        v.estVel.clampLength(0, MAX_REMOTE_EST_SPEED);
      }

      const prop = v.mesh.getObjectByName('propeller');
      if (prop) prop.rotation.z += v.throttle * 30 * dt;

      // Animate the remote's landing gear toward its broadcast state, same
      // transit speed as the local plane so everyone sees the same fold.
      const gearTarget = r.gearDown === false ? 0 : 1;
      if (v.gearT !== gearTarget) {
        const step = GEAR_ANIM_SPEED * dt;
        v.gearT = gearTarget > v.gearT
          ? Math.min(gearTarget, v.gearT + step)
          : Math.max(gearTarget, v.gearT - step);
        applyGearPose(v.mesh, v.gearT);
      }

      // Jet-only effects: lazily allocate and update the exhaust + contrail
      // for remote jets. Other plane types skip this entirely. JetExhaust's
      // own update() handles the "wrong type / crashed → clear" case, but
      // we early-out here too so we don't allocate a 160-particle pool for
      // a Cessna remote.
      if (wantedType === 'jet') {
        if (!v.exhaust) v.exhaust = new JetExhaust(this.scene);
        if (!v.contrails) v.contrails = new Contrails(this.scene);
        const synth = this._syntheticPlane(v);
        v.exhaust.update(dt, synth);
        v.contrails.update(dt, synth);
      } else if (v.exhaust || v.contrails) {
        // Player switched from jet to a non-jet — let any live particles
        // fade naturally by passing a non-jet object so the systems clear
        // themselves on next tick.
        const synth = this._syntheticPlane(v);
        if (v.exhaust) v.exhaust.update(dt, synth);
        if (v.contrails) v.contrails.update(dt, synth);
      }
    }
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        this.scene.remove(v.mesh);
        disposePlaneMesh(v.mesh);
        // JetExhaust / Contrails own their meshes — release them so the
        // remote's plume doesn't linger after they disconnect.
        if (v.exhaust) {
          v.exhaust.clear();
          this.scene.remove(v.exhaust.mesh);
          v.exhaust.mesh.geometry.dispose();
          v.exhaust.mesh.material.dispose();
        }
        if (v.contrails) {
          v.contrails.clear();
          this.scene.remove(v.contrails.mesh);
          v.contrails.mesh.geometry.dispose();
          v.contrails.mesh.material.dispose();
        }
        this.visuals.delete(id);
      }
    }
  }
}
