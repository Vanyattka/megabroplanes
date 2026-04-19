import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { DEFAULT_BODY_COLOR, DEFAULT_PLANE_TYPE } from '../config.js';
import {
  NAV_LIGHT_GEOM,
  navLeftMat,
  navRightMat,
  navTailMat,
} from '../world/NightLights.js';

// Helper: make a box whose front edge (originally at -depth/2) sits at z=0
// so rotating the mesh hinges about that edge instead of the box center.
function leadingEdgeBox(w, h, d) {
  const g = new BoxGeometry(w, h, d);
  g.translate(0, 0, d / 2);
  return g;
}

// Shared geometries per type. Built once at module load, reused by every
// plane instance (player, remote players, static airport planes) to avoid
// GPU buffer leaks on rebuild.
const TYPE_GEOMS = {
  cessna: {
    fuselage: new BoxGeometry(1, 1, 8),
    wing: new BoxGeometry(13, 0.18, 1.8),
    elevator: leadingEdgeBox(3.8, 0.15, 0.9),
    rudder: leadingEdgeBox(0.15, 1.3, 1.1),
    cockpit: new BoxGeometry(0.8, 0.5, 1.5),
    prop: new BoxGeometry(2.8, 0.1, 0.1),
    wingY: 0.85,
    wingZ: 0,
    elevatorY: 0.1,
    elevatorZ: 3.05,     // 3.5 - 0.9/2
    rudderY: 0.65,
    rudderZ: 2.95,       // 3.5 - 1.1/2
    cockpitY: 0.6,
    cockpitZ: -0.5,
    propZ: -4.2,
    navWingX: 6.3,
    navWingY: 0.95,
    navTailY: 1.85,
    navTailZ: 4.0,
    landingLightZ: -4.2,
  },
  piper: {
    fuselage: new BoxGeometry(1, 1, 8),
    wing: new BoxGeometry(12, 0.15, 1.6),
    elevator: leadingEdgeBox(3.5, 0.15, 0.9),
    rudder: leadingEdgeBox(0.15, 1.2, 1.1),
    cockpit: new BoxGeometry(0.8, 0.5, 1.5),
    prop: new BoxGeometry(2.5, 0.1, 0.1),
    wingY: 0.2,
    wingZ: 0,
    elevatorY: 0.1,
    elevatorZ: 3.05,
    rudderY: 0.6,
    rudderZ: 2.95,
    cockpitY: 0.6,
    cockpitZ: -0.5,
    propZ: -4.1,
    navWingX: 5.85,
    navWingY: 0.25,
    navTailY: 1.75,
    navTailZ: 3.95,
    landingLightZ: -4.1,
  },
  jet: {
    fuselage: new BoxGeometry(0.9, 0.9, 10),
    wing: new BoxGeometry(9, 0.12, 2.8),
    elevator: leadingEdgeBox(3, 0.12, 1.0),
    rudder: leadingEdgeBox(0.15, 1.8, 1.2),
    cockpit: new BoxGeometry(0.7, 0.45, 2.2),
    engine: new BoxGeometry(0.9, 0.9, 1.5),
    wingY: 0.15,
    wingZ: 1.5,
    elevatorY: 0.1,
    elevatorZ: 3.7,      // 4.2 - 1.0/2
    rudderY: 0.9,
    rudderZ: 3.6,        // 4.2 - 1.2/2
    cockpitY: 0.5,
    cockpitZ: -2.0,
    engineZ: 5.0,
    navWingX: 4.4,
    navWingY: 0.22,
    navTailY: 2.7,
    navTailZ: 4.75,
    landingLightZ: -4.8,
  },
};

const ACCENT_MAT = new MeshStandardMaterial({ color: 0xcc3333, flatShading: true });
const DARK_MAT = new MeshStandardMaterial({ color: 0x333333, flatShading: true });
const DEFAULT_BODY_MAT = new MeshStandardMaterial({
  color: DEFAULT_BODY_COLOR,
  flatShading: true,
});

function bodyMaterial(colorHex) {
  if (colorHex == null || colorHex === DEFAULT_BODY_COLOR) return DEFAULT_BODY_MAT;
  const m = DEFAULT_BODY_MAT.clone();
  m.color = new Color(colorHex);
  return m;
}

export function buildPlaneMesh(type = DEFAULT_PLANE_TYPE, colorHex = DEFAULT_BODY_COLOR) {
  const g = TYPE_GEOMS[type] || TYPE_GEOMS[DEFAULT_PLANE_TYPE];
  const group = new Group();
  const body = bodyMaterial(colorHex);

  const fuselage = new Mesh(g.fuselage, body);
  group.add(fuselage);

  const wing = new Mesh(g.wing, body);
  wing.position.set(0, g.wingY, g.wingZ);
  group.add(wing);

  // Elevator — entire horizontal tail rotates about its leading edge for pitch.
  const elevator = new Mesh(g.elevator, body);
  elevator.position.set(0, g.elevatorY, g.elevatorZ);
  elevator.name = 'elevator';
  group.add(elevator);

  // Rudder — entire vertical tail rotates about its leading edge for yaw.
  const rudder = new Mesh(g.rudder, ACCENT_MAT);
  rudder.position.set(0, g.rudderY, g.rudderZ);
  rudder.name = 'rudder';
  group.add(rudder);

  const cockpit = new Mesh(g.cockpit, DARK_MAT);
  cockpit.position.set(0, g.cockpitY, g.cockpitZ);
  group.add(cockpit);

  if (type === 'jet') {
    const engine = new Mesh(g.engine, DARK_MAT);
    engine.position.set(0, 0, g.engineZ);
    group.add(engine);
  } else {
    const prop = new Mesh(g.prop, DARK_MAT);
    prop.position.set(0, 0, g.propZ);
    prop.name = 'propeller';
    group.add(prop);
  }

  // Navigation lights — red on port wingtip, green on starboard, white at
  // the tail (strobed from Plane.update). Shared materials are driven by
  // NightLights.updateLights() so they dim to daytime levels and glow at
  // night automatically.
  const navLeft = new Mesh(NAV_LIGHT_GEOM, navLeftMat);
  navLeft.position.set(-g.navWingX, g.navWingY, 0);
  navLeft.name = 'nav-left';
  group.add(navLeft);

  const navRight = new Mesh(NAV_LIGHT_GEOM, navRightMat);
  navRight.position.set(g.navWingX, g.navWingY, 0);
  navRight.name = 'nav-right';
  group.add(navRight);

  const navTail = new Mesh(NAV_LIGHT_GEOM, navTailMat);
  navTail.position.set(0, g.navTailY, g.navTailZ);
  navTail.name = 'nav-tail';
  group.add(navTail);

  // Landing-light anchor — an empty Object3D so Plane.js can attach a
  // SpotLight here without hard-coding offsets per plane type.
  const landingAnchor = new Group();
  landingAnchor.position.set(0, 0, g.landingLightZ);
  landingAnchor.name = 'landing-anchor';
  group.add(landingAnchor);

  return group;
}

// Release per-instance cloned body materials. Safe to call on any plane group:
// it skips the shared accent/dark/default materials.
export function disposePlaneMesh(group) {
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const m = obj.material;
    if (m !== DEFAULT_BODY_MAT && m !== ACCENT_MAT && m !== DARK_MAT) {
      m.dispose();
    }
  });
}
