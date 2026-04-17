import { Vector3, Quaternion } from 'three';
import { buildPlaneMesh } from './PlaneMesh.js';
import { step as physicsStep } from './Physics.js';
import { applyControls } from './Controls.js';
import { getSpawnPose } from '../world/Runway.js';

export class Plane {
  constructor() {
    const spawn = getSpawnPose();
    this.position = spawn.position.clone();
    this.velocity = new Vector3();
    this.quaternion = spawn.quaternion.clone();
    this.angularVelocity = new Vector3();
    this.throttle = 0;
    this.onGround = true;

    this.mesh = buildPlaneMesh();
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quaternion);
  }

  update(dt, input, getHeight, isOnRunway) {
    applyControls(this, input, dt);
    const braking = input.isPressed('Space');
    physicsStep(this, dt, getHeight, isOnRunway, braking);
    this.syncMesh();

    const prop = this.mesh.getObjectByName('propeller');
    if (prop) prop.rotation.z += this.throttle * 30 * dt;
  }
}
