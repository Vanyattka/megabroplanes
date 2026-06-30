import { Object3D, PointLight, Quaternion, SpotLight, Vector3 } from 'three';
import { buildPlaneMesh, disposePlaneMesh, applyGearPose } from './PlaneMesh.js';
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
  JET_LIGHT_COLOR,
  JET_LIGHT_INTENSITY,
  JET_LIGHT_DISTANCE,
  JET_LIGHT_DECAY,
  JET_EXHAUST_OFFSET_Z,
  PLANE_MAX_HP,
  GEAR_ANIM_SPEED,
} from '../config.js';

export class Plane {
  constructor(scene) {
    this.scene = scene;
    this.position = new Vector3();
    this.velocity = new Vector3();
    this.quaternion = new Quaternion();
    this.angularVelocity = new Vector3();
    // Snapshot at the start of each physics step — the "previous" end
    // of the interpolation window used by the render pass.
    this._prevPosition = new Vector3();
    this._prevQuaternion = new Quaternion();
    // Interpolated state rendered this frame. The chase camera and any
    // visual consumer should read these (not position/quaternion) so
    // motion is smooth at render rates higher than the 60 Hz physics
    // rate. Starts equal to position/quaternion; updated by
    // updateRender(alpha) every render frame.
    this.renderPosition = new Vector3();
    this.renderQuaternion = new Quaternion();
    this.throttle = 0;
    this.onGround = true;
    this.crashed = false;
    this.crashImpact = null;
    // Combat (race mode). Full health outside combat.
    this.maxHp = PLANE_MAX_HP;
    this.hp = PLANE_MAX_HP;
    // Landing gear (v0.6). gearDown is the commanded state (G toggles it);
    // gearT is the animated extension 0..1 that physics reads for drag.
    this.gearDown = true;
    this.gearT = 1;

    this.type = DEFAULT_PLANE_TYPE;
    this.color = DEFAULT_BODY_COLOR;
    this.typeConfig = PLANE_TYPES[this.type];

    // Tail strobe timer + landing light state. Light itself is a SpotLight
    // that follows the plane's mesh, so it aims wherever the nose points.
    this._blinkT = 0;
    this.landingLightOn = false;
    this._landingLight = null;
    this._landingTarget = null;

    // Whether this plane casts into the real sun shadow map. The LOCAL plane
    // turns this off (setCastShadows(false)) and uses the soft blob shadow
    // instead — casting a fast mover into the perf-throttled shadow map made
    // its shadow snap/jerk and vanish under it when parked.
    this._castShadows = true;
    this.mesh = buildPlaneMesh(this.type, this.color);
    this._installLandingLight();
    this._installJetLight();
    this._applyCastShadow();
    if (this.scene) this.scene.add(this.mesh);
    this.reset();
  }

  setCastShadows(on) { this._castShadows = !!on; this._applyCastShadow(); }
  _applyCastShadow() {
    this.mesh.traverse((o) => { if (o.isMesh) o.castShadow = this._castShadows; });
  }

  _installJetLight() {
    // PointLight parented to the plane mesh so it follows automatically.
    // Only actually lit when the plane type is jet (otherwise intensity=0).
    const light = new PointLight(
      JET_LIGHT_COLOR,
      0,
      JET_LIGHT_DISTANCE,
      JET_LIGHT_DECAY
    );
    light.castShadow = false;
    // Sit the light just past the engine nozzle so it illuminates the wing
    // undersides, tail, and any ground/water within the falloff radius.
    light.position.set(0, 0, JET_EXHAUST_OFFSET_Z + 0.5);
    this.mesh.add(light);
    this._jetLight = light;
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

  // G key. Refuses to retract while the wheels are carrying the plane —
  // physically that's a belly-flop, and the floor offset assumes gear legs.
  toggleGear() {
    if (this.onGround && this.gearDown) return false;
    this.gearDown = !this.gearDown;
    return true;
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
    this._jetLight = null;
    this._installLandingLight();
    this._installJetLight();
    if (this._landingLight) {
      this._landingLight.intensity = wasOn ? LANDING_LIGHT_INTENSITY : 0;
    }
    // The fresh mesh is built gear-down; restore the live gear pose so a
    // loadout swap mid-flight doesn't visually drop the wheels.
    applyGearPose(this.mesh, this.gearT);
    this._applyCastShadow(); // the fresh mesh defaults to castShadow=true; re-apply our setting
    if (this.scene) this.scene.add(this.mesh);
    this.syncMesh();
  }

  reset() {
    const spawn = getSpawnPose();
    this.position.copy(spawn.position);
    this.velocity.set(0, 0, 0);
    this.quaternion.copy(spawn.quaternion);
    this.angularVelocity.set(0, 0, 0);
    this._prevPosition.copy(spawn.position);
    this._prevQuaternion.copy(spawn.quaternion);
    this.renderPosition.copy(spawn.position);
    this.renderQuaternion.copy(spawn.quaternion);
    this.throttle = 0;
    this.onGround = true;
    this._roughLogged = false;
    this.crashed = false;
    this.crashImpact = null;
    this.hp = this.maxHp;
    this.gearDown = true;
    this.gearT = 1;
    applyGearPose(this.mesh, 1);
    this.mesh.visible = true;
    this.syncMesh();
  }

  // Spawn already in flight (used for race starts and post-death respawns):
  // place at an arbitrary pose with an initial velocity and throttle, fully
  // healed and un-crashed.
  spawnAirborne(position, quaternion, velocity, throttle = 1) {
    this.position.copy(position);
    this.quaternion.copy(quaternion);
    this.velocity.copy(velocity);
    this.angularVelocity.set(0, 0, 0);
    this._prevPosition.copy(position);
    this._prevQuaternion.copy(quaternion);
    this.renderPosition.copy(position);
    this.renderQuaternion.copy(quaternion);
    this.throttle = throttle;
    this.onGround = false;
    this._roughLogged = false;
    this.crashed = false;
    this.crashImpact = null;
    this.hp = this.maxHp;
    // Airborne spawns (race start / respawn) come out clean, wheels up.
    this.gearDown = false;
    this.gearT = 0;
    applyGearPose(this.mesh, 0);
    this.mesh.visible = true;
    this.syncMesh();
  }

  syncMesh() {
    // After setLoadout/reset: snap mesh directly to authoritative state.
    // Normal per-frame updates go through updateRender(alpha) instead.
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quaternion);
  }

  // Interpolate between the previous and current physics state at
  // `alpha` (0..1, from Clock.tick). Called every render frame, lets
  // the plane move smoothly between 60 Hz physics ticks at e.g. 120 Hz
  // render. Must be called AFTER update() and BEFORE anything reads
  // renderPosition (chase camera, plane shadow, etc.).
  updateRender(alpha) {
    if (this.crashed) return;
    this.renderPosition.copy(this._prevPosition).lerp(this.position, alpha);
    this.renderQuaternion.copy(this._prevQuaternion).slerp(this.quaternion, alpha);
    this.mesh.position.copy(this.renderPosition);
    this.mesh.quaternion.copy(this.renderQuaternion);
  }

  update(dt, input, getHeight, isOnRunway, crashesEnabled, touch) {
    if (this.crashed) return;
    // Snapshot the "previous" state BEFORE we mutate position/quaternion.
    // updateRender(alpha) will interpolate from here to the new values.
    this._prevPosition.copy(this.position);
    this._prevQuaternion.copy(this.quaternion);
    applyControls(this, input, dt, touch);
    const braking = input.isPressed('Space') || !!(touch && touch.brake);
    physicsStep(this, dt, getHeight, isOnRunway, braking, crashesEnabled);
    // Don't syncMesh here — updateRender will position the mesh using
    // the interpolated render state. If we snapped the mesh to the raw
    // post-physics position, we'd get the 60 Hz step visible on screen.

    const prop = this.mesh.getObjectByName('propeller');
    if (prop) prop.rotation.z += this.throttle * 30 * dt;

    // Landing gear transit — gearT chases the commanded state; physics reads
    // gearT for the extra drag, the mesh legs fold via applyGearPose.
    const gearTarget = this.gearDown ? 1 : 0;
    if (this.gearT !== gearTarget) {
      const step = GEAR_ANIM_SPEED * dt;
      this.gearT = gearTarget > this.gearT
        ? Math.min(gearTarget, this.gearT + step)
        : Math.max(gearTarget, this.gearT - step);
      applyGearPose(this.mesh, this.gearT);
    }

    // Animate control surfaces from the latest pilot input. Elevator pivots
    // about its leading edge (pitch), rudder about its leading edge (yaw),
    // ailerons deflect opposite ways for roll.
    const ci = this.controlInputs;
    if (ci) {
      const elev = this.mesh.getObjectByName('elevator');
      if (elev) elev.rotation.x = ci.pitch * 0.4;
      const rudd = this.mesh.getObjectByName('rudder');
      if (rudd) rudd.rotation.y = ci.yaw * 0.4;
      const ailL = this.mesh.getObjectByName('aileron-left');
      const ailR = this.mesh.getObjectByName('aileron-right');
      if (ailL) ailL.rotation.x = ci.roll * 0.45;
      if (ailR) ailR.rotation.x = -ci.roll * 0.45;
    }

    // Strobes — white tail flash and the red beacon blink on opposite phases.
    this._blinkT += dt;
    const phase = Math.floor(this._blinkT * NAV_TAIL_BLINK_HZ) % 2;
    const tail = this.mesh.getObjectByName('nav-tail');
    if (tail) tail.visible = phase === 0;
    const beacon = this.mesh.getObjectByName('beacon');
    if (beacon) beacon.visible = phase === 1;

    // Afterburner — the jet's signature. Lights up past ~65% throttle with a
    // subtle flicker; both cones stretch with thrust.
    if (this.type === 'jet') {
      const ab = Math.max(0, (this.throttle - 0.65) / 0.35);
      const core = this.mesh.getObjectByName('ab-core');
      const outer = this.mesh.getObjectByName('ab-outer');
      const flick = 1 + Math.sin(this._blinkT * 47) * 0.08;
      if (core) {
        core.visible = ab > 0.01;
        core.scale.set(1, 1, (0.35 + 0.65 * ab) * flick);
      }
      if (outer) {
        outer.visible = ab > 0.01;
        outer.scale.set(1, 1, (0.3 + 0.7 * ab) * flick);
        outer.material.opacity = 0.18 + 0.32 * ab;
      }
    }

    // Jet engine light — glows orange on ground, wings, water surface when
    // the player is flying a jet. Intensity rides throttle so idle is dim
    // and full burner is bright.
    if (this._jetLight) {
      const jetActive = this.type === 'jet' && !this.crashed;
      this._jetLight.intensity = jetActive
        ? JET_LIGHT_INTENSITY * (0.25 + 0.75 * this.throttle)
        : 0;
    }
  }
}
