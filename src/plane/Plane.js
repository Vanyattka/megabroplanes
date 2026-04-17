import { Vector3, Quaternion } from 'three';
import { buildPlaneMesh } from './PlaneMesh.js';
import { step as physicsStep } from './Physics.js';
import { applyControls } from './Controls.js';
import { getSpawnPose } from '../world/Runway.js';

export class Plane {
  constructor() {
    this.position = new Vector3();
    this.velocity = new Vector3();
    this.quaternion = new Quaternion();
    this.angularVelocity = new Vector3();
    this.throttle = 0;
    this.onGround = true;
    this.crashed = false;
    this.crashImpact = null;

    this.mesh = buildPlaneMesh();
    this.reset();
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

  update(dt, input, getHeight, isOnRunway, crashesEnabled) {
    if (this.crashed) return;
    applyControls(this, input, dt);
    const braking = input.isPressed('Space');
    physicsStep(this, dt, getHeight, isOnRunway, braking, crashesEnabled);
    this.syncMesh();

    const prop = this.mesh.getObjectByName('propeller');
    if (prop) prop.rotation.z += this.throttle * 30 * dt;
  }
}
