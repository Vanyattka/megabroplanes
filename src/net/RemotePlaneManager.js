import { Color, Quaternion, Vector3 } from 'three';
import { buildPlaneMesh, disposePlaneMesh } from '../plane/PlaneMesh.js';
import { DEFAULT_PLANE_TYPE, DEFAULT_BODY_COLOR } from '../config.js';

const LERP = 0.22;
const SLERP = 0.22;

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
    this.scene.add(v.mesh);
    v.type = type;
    v.color = color;
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
        };
        this.visuals.set(id, v);
      } else if (v.type !== wantedType || v.color !== wantedColor) {
        this._rebuild(v, wantedType, wantedColor);
      }

      v.targetPos.fromArray(r.pos);
      v.targetQuat.fromArray(r.quat);
      v.throttle = r.throttle || 0;
      v.crashed = !!r.crashed;

      v.mesh.position.lerp(v.targetPos, LERP);
      v.mesh.quaternion.slerp(v.targetQuat, SLERP);
      v.mesh.visible = !v.crashed;

      const prop = v.mesh.getObjectByName('propeller');
      if (prop) prop.rotation.z += v.throttle * 30 * dt;
    }
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        this.scene.remove(v.mesh);
        disposePlaneMesh(v.mesh);
        this.visuals.delete(id);
      }
    }
  }
}
