import { Vector3, Quaternion } from 'three';
import { buildPlaneMesh, disposePlaneMesh } from './PlaneMesh.js';
import { step as physicsStep } from './Physics.js';
import { applyControls } from './Controls.js';
import { getSpawnPose } from '../world/Runway.js';
import {
  PLANE_TYPES,
  DEFAULT_PLANE_TYPE,
  DEFAULT_BODY_COLOR,
} from '../config.js';

export class Plane {
  constructor(scene) {
    this.scene = scene;
    this.position = new Vector3();
    this.velocity = new Vector3();
    this.quaternion = new Quaternion();
    this.angularVelocity = new Vector3();
    this.throttle = 0;
    this.onGround = true;
    this.crashed = false;
    this.crashImpact = null;

    this.type = DEFAULT_PLANE_TYPE;
    this.color = DEFAULT_BODY_COLOR;
    this.typeConfig = PLANE_TYPES[this.type];

    this.mesh = buildPlaneMesh(this.type, this.color);
    if (this.scene) this.scene.add(this.mesh);
    this.reset();
  }

  // Swap the visible mesh when the player picks a different plane / color.
  // Physics state (position, velocity, throttle) is preserved.
  setLoadout(type, color) {
    const nextType = PLANE_TYPES[type] ? type : DEFAULT_PLANE_TYPE;
    const nextColor = typeof color === 'number' ? color : DEFAULT_BODY_COLOR;
    if (nextType === this.type && nextColor === this.color) return;
    if (this.scene) this.scene.remove(this.mesh);
    disposePlaneMesh(this.mesh);
    this.type = nextType;
    this.color = nextColor;
    this.typeConfig = PLANE_TYPES[nextType];
    this.mesh = buildPlaneMesh(nextType, nextColor);
    if (this.scene) this.scene.add(this.mesh);
    this.syncMesh();
  }

  reset() {
    const spawn = getSpawnPose();
    this.position.copy(spawn.position);
    this.velocity.set(0, 0, 0);
    this.quaternion.copy(spawn.quaternion);
    this.angularVelocity.set(0, 0, 0);
    this.throttle = 0;
    this.onGround = true;
    this._roughLogged = false;
    this.crashed = false;
    this.crashImpact = null;
    this.mesh.visible = true;
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quaternion);
  }

  update(dt, input, getHeight, isOnRunway, crashesEnabled, touch) {
    if (this.crashed) return;
    applyControls(this, input, dt, touch);
    const braking = input.isPressed('Space') || !!(touch && touch.brake);
    physicsStep(this, dt, getHeight, isOnRunway, braking, crashesEnabled);
    this.syncMesh();

    const prop = this.mesh.getObjectByName('propeller');
    if (prop) prop.rotation.z += this.throttle * 30 * dt;

    // Animate control surfaces from the latest pilot input. Elevator pivots
    // about its leading edge (pitch), rudder about its leading edge (yaw).
    const ci = this.controlInputs;
    if (ci) {
      const elev = this.mesh.getObjectByName('elevator');
      if (elev) elev.rotation.x = ci.pitch * 0.4;
      const rudd = this.mesh.getObjectByName('rudder');
      if (rudd) rudd.rotation.y = ci.yaw * 0.4;
    }
  }
}
