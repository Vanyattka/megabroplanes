import { Object3D, Quaternion, SpotLight, Vector3 } from 'three';
import { buildPlaneMesh, disposePlaneMesh } from './PlaneMesh.js';
import { step as physicsStep } from './Physics.js';
import { applyControls } from './Controls.js';
import { getSpawnPose } from '../world/Runway.js';
import {
  PLANE_TYPES,
  DEFAULT_PLANE_TYPE,
  DEFAULT_BODY_COLOR,
  NAV_TAIL_BLINK_HZ,
  LANDING_LIGHT_INTENSITY,
  LANDING_LIGHT_RANGE,
  LANDING_LIGHT_ANGLE,
  LANDING_LIGHT_PENUMBRA,
  LANDING_LIGHT_COLOR,
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

    // Tail strobe timer + landing light state. Light itself is a SpotLight
    // that follows the plane's mesh, so it aims wherever the nose points.
    this._blinkT = 0;
    this.landingLightOn = false;
    this._landingLight = null;
    this._landingTarget = null;

    this.mesh = buildPlaneMesh(this.type, this.color);
    this._installLandingLight();
    if (this.scene) this.scene.add(this.mesh);
    this.reset();
  }

  _installLandingLight() {
    const anchor = this.mesh.getObjectByName('landing-anchor');
    if (!anchor) return;
    const light = new SpotLight(
      LANDING_LIGHT_COLOR,
      0, // off by default
      LANDING_LIGHT_RANGE,
      LANDING_LIGHT_ANGLE,
      LANDING_LIGHT_PENUMBRA,
      1.8
    );
    light.castShadow = false;
    anchor.add(light);
    // SpotLight needs a target — place it ahead of the plane (down the nose)
    // and attach to the same anchor so it inherits the plane's transform.
    const target = new Object3D();
    target.position.set(0, -3, -60);
    anchor.add(target);
    light.target = target;
    this._landingLight = light;
    this._landingTarget = target;
  }

  toggleLandingLight() {
    this.landingLightOn = !this.landingLightOn;
    if (this._landingLight) {
      this._landingLight.intensity = this.landingLightOn
        ? LANDING_LIGHT_INTENSITY
        : 0;
    }
    return this.landingLightOn;
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
    // Re-attach the SpotLight so it stays on after a loadout swap.
    const wasOn = this.landingLightOn;
    this._landingLight = null;
    this._landingTarget = null;
    this._installLandingLight();
    if (this._landingLight) {
      this._landingLight.intensity = wasOn ? LANDING_LIGHT_INTENSITY : 0;
    }
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

    // Tail strobe — blink the white nav light twice a second.
    this._blinkT += dt;
    const tail = this.mesh.getObjectByName('nav-tail');
    if (tail) {
      tail.visible = (Math.floor(this._blinkT * NAV_TAIL_BLINK_HZ) % 2) === 0;
    }
  }
}
