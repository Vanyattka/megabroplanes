import { Color, Quaternion, Vector3 } from 'three';
import { buildPlaneMesh } from '../plane/PlaneMesh.js';

const LERP = 0.22;    // position lerp per render frame
const SLERP = 0.22;   // rotation slerp per render frame

// Materials we tint — any material currently white-ish (fuselage, wing, stab)
// picks up the player's hue; cockpit/prop/fin keep their fixed colors.
function tintMesh(group, hue) {
  const col = new Color().setHSL(hue, 0.7, 0.6);
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.material || !obj.material.color) return;
    if (obj.material.color.getHex() === 0xeeeeee) {
      const clone = obj.material.clone();
      clone.color = col.clone();
      obj.material = clone;
    }
  });
}

export class RemotePlaneManager {
  constructor(scene, client) {
    this.scene = scene;
    this.client = client;
    this.visuals = new Map(); // id -> { mesh, targetPos, targetQuat, throttle, crashed }
  }

  update(dt) {
    const seen = new Set();
    for (const [id, r] of this.client.remotes) {
      if (!r.pos || !r.quat) continue;
      seen.add(id);
      let v = this.visuals.get(id);
      if (!v) {
        const mesh = buildPlaneMesh();
        tintMesh(mesh, r.hue);
        mesh.position.fromArray(r.pos);
        mesh.quaternion.fromArray(r.quat);
        this.scene.add(mesh);
        v = {
          mesh,
          targetPos: new Vector3().fromArray(r.pos),
          targetQuat: new Quaternion().fromArray(r.quat),
          throttle: r.throttle || 0,
          crashed: !!r.crashed,
        };
        this.visuals.set(id, v);
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
        v.mesh.traverse((obj) => {
          if (obj.isMesh) {
            // Materials were cloned per-player — safe to dispose.
            if (obj.material) obj.material.dispose();
          }
        });
        this.visuals.delete(id);
      }
    }
  }
}
