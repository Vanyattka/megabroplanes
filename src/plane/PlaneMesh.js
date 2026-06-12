import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import { DEFAULT_BODY_COLOR, DEFAULT_PLANE_TYPE } from '../config.js';
import {
  NAV_LIGHT_GEOM,
  navLeftMat,
  navRightMat,
  navTailMat,
  windowMat,
} from '../world/NightLights.js';

// ---------------------------------------------------------------------------
// v0.6 detailed aircraft, still 100% primitives. Geometries are module-level
// and shared by every instance (player, remotes, parked airport planes, menu
// preview, water reflection) — they are NEVER disposed. Materials: everything
// in SHARED_MATS is a module singleton; the per-plane body color is the only
// per-instance clone, and disposePlaneMesh frees exactly the non-shared ones.
// Named nodes consumed by Plane.update / RemotePlaneManager / applyGearPose:
//   'propeller' (group: spinner + blades, spins about Z)
//   'elevator', 'rudder', 'aileron-left', 'aileron-right' (control surfaces)
//   'gear-nose', 'gear-left', 'gear-right' (hinged legs — applyGearPose)
//   'nav-left', 'nav-right', 'nav-tail', 'beacon' (lights/strobes)
//   'ab-core', 'ab-outer' (jet afterburner cones, throttle-driven)
//   'landing-anchor' (empty, the landing SpotLight attaches here)
// ---------------------------------------------------------------------------

// --- geometry helpers (axis conventions: nose toward -Z) -------------------
// Tapered tube along Z. rFront = radius at the -Z (nose) end.
function tubeZ(rFront, rRear, len, seg = 8) {
  const g = new CylinderGeometry(rRear, rFront, len, seg);
  g.rotateX(Math.PI / 2);
  return g;
}
// Cone whose apex points forward (-Z).
function noseConeZ(r, len, seg = 8) {
  const g = new ConeGeometry(r, len, seg);
  g.rotateX(-Math.PI / 2);
  return g;
}
// Cone whose apex points backward (+Z), base anchored at z=0 — afterburner
// flames stretch backward from the nozzle when scaled along Z.
function tailConeZ(r, len, seg = 8) {
  const g = new ConeGeometry(r, len, seg);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, len / 2);
  return g;
}
// Box hinged at its leading edge (z=0), extending backward — control surfaces.
function leadingEdgeBox(w, h, d) {
  const g = new BoxGeometry(w, h, d);
  g.translate(0, 0, d / 2);
  return g;
}
// Gear strut along -Y with its top (hinge) at y=0.
function strutGeom(rTop, rBot, len) {
  const g = new CylinderGeometry(rTop, rBot, len, 6);
  g.translate(0, -len / 2, 0);
  return g;
}
// Wheel with its axle along X.
function wheelGeom(r, w) {
  const g = new CylinderGeometry(r, r, w, 10);
  g.rotateZ(Math.PI / 2);
  return g;
}

// --- shared materials -------------------------------------------------------
const SHARED_MATS = new Set();
function sharedMat(m) { SHARED_MATS.add(m); return m; }

const ACCENT_MAT = sharedMat(new MeshStandardMaterial({ color: 0xcc3333, flatShading: true, roughness: 0.6 }));
const DARK_MAT = sharedMat(new MeshStandardMaterial({ color: 0x2e2e2e, flatShading: true, roughness: 0.85 }));
const METAL_MAT = sharedMat(new MeshStandardMaterial({ color: 0x9aa2aa, flatShading: true, roughness: 0.35, metalness: 0.65 }));
const NOZZLE_MAT = sharedMat(new MeshStandardMaterial({ color: 0x3a3f44, flatShading: true, roughness: 0.4, metalness: 0.8 }));
const TIRE_MAT = sharedMat(new MeshStandardMaterial({ color: 0x16181a, flatShading: true, roughness: 1 }));
const INTAKE_MAT = sharedMat(new MeshStandardMaterial({ color: 0x23272b, flatShading: true, roughness: 0.6, metalness: 0.4 }));
// Canopy glass reuses the village window material — slightly emissive, and its
// emissive ramps up at night via NightLights.updateLights, so cockpits glow at
// dusk exactly like village windows. (It's a shared singleton — registered.)
sharedMat(windowMat);
sharedMat(navLeftMat);
sharedMat(navRightMat);
sharedMat(navTailMat);
// Afterburner cones — HDR additive so they bloom. Core is hotter than shell.
const AB_CORE_MAT = sharedMat(new MeshBasicMaterial({
  color: new Color().setRGB(3.4, 2.4, 0.9), transparent: true, opacity: 0.85,
  blending: AdditiveBlending, depthWrite: false, toneMapped: false,
}));
const AB_OUTER_MAT = sharedMat(new MeshBasicMaterial({
  color: new Color().setRGB(2.0, 0.8, 0.25), transparent: true, opacity: 0.45,
  blending: AdditiveBlending, depthWrite: false, toneMapped: false,
}));
// The body color: glossier than the old chalky look so the sun throws a real
// specular highlight across the fuselage facets ("more realistic lighting").
const DEFAULT_BODY_MAT = sharedMat(new MeshStandardMaterial({
  color: DEFAULT_BODY_COLOR, flatShading: true, roughness: 0.5, metalness: 0.12,
}));

function bodyMaterial(colorHex) {
  if (colorHex == null || colorHex === DEFAULT_BODY_COLOR) return DEFAULT_BODY_MAT;
  const m = DEFAULT_BODY_MAT.clone(); // per-instance — the one disposable material
  m.color = new Color(colorHex);
  return m;
}

// --- shared geometries per type ---------------------------------------------
// Gear spec: hingeY (belly attach), strut length L and wheel radius R satisfy
// hingeY - L - R = -PLANE_BOTTOM_OFFSET so extended wheels touch the ground.
const GEOMS = {
  cessna: {
    cowl: new BoxGeometry(1.05, 0.95, 1.25),
    cabin: new BoxGeometry(1.15, 1.05, 2.5),
    tail: tubeZ(0.5, 0.14, 3.6),
    canopy: new BoxGeometry(1.0, 0.55, 1.35),
    stripe: new BoxGeometry(1.19, 0.2, 2.5),
    wing: new BoxGeometry(11, 0.16, 1.7),
    aileron: leadingEdgeBox(2.0, 0.12, 0.5),
    hstab: new BoxGeometry(3.7, 0.13, 0.85),
    elevator: leadingEdgeBox(3.6, 0.11, 0.6),
    fin: new BoxGeometry(0.13, 1.25, 0.95),
    rudder: leadingEdgeBox(0.11, 1.1, 0.62),
    spinner: noseConeZ(0.17, 0.52),
    blade: new BoxGeometry(2.7, 0.2, 0.06),
    strutWing: strutGeom(0.045, 0.045, 1.0), // scaled per side
    gearStrut: strutGeom(0.05, 0.06, 0.35),
    wheel: wheelGeom(0.22, 0.16),
  },
  piper: {
    cowl: new BoxGeometry(0.95, 0.82, 1.3),
    cabin: new BoxGeometry(1.05, 0.95, 2.6),
    tail: tubeZ(0.44, 0.13, 3.8),
    canopy: new BoxGeometry(0.9, 0.5, 1.55),
    stripe: new BoxGeometry(1.09, 0.18, 2.6),
    wing: new BoxGeometry(10.5, 0.15, 1.6),
    aileron: leadingEdgeBox(1.9, 0.11, 0.48),
    hstab: new BoxGeometry(3.5, 0.12, 0.8),
    elevator: leadingEdgeBox(3.4, 0.1, 0.58),
    fin: new BoxGeometry(0.12, 1.15, 0.9),
    rudder: leadingEdgeBox(0.1, 1.0, 0.6),
    spinner: noseConeZ(0.16, 0.5),
    blade: new BoxGeometry(2.5, 0.19, 0.06),
    gearStrut: strutGeom(0.05, 0.06, 0.34),
    wheel: wheelGeom(0.21, 0.15),
  },
  jet: {
    nose: noseConeZ(0.42, 1.7),
    foreFuse: tubeZ(0.42, 0.55, 3.0),
    midFuse: new BoxGeometry(1.2, 0.95, 3.4),
    engine: tubeZ(0.55, 0.5, 2.2),
    nozzle: tubeZ(0.5, 0.36, 0.7),
    canopy: new SphereGeometry(0.5, 8, 6),
    intake: new BoxGeometry(0.42, 0.62, 1.7),
    wing: new BoxGeometry(3.9, 0.12, 1.9),
    aileron: leadingEdgeBox(1.5, 0.1, 0.5),
    hstabHalf: new BoxGeometry(1.6, 0.1, 1.05),
    fin: new BoxGeometry(0.12, 1.7, 1.45),
    finTip: new BoxGeometry(0.14, 0.28, 1.45),
    rudder: leadingEdgeBox(0.1, 1.05, 0.62),
    abCore: tailConeZ(0.3, 1.7),
    abOuter: tailConeZ(0.46, 2.7),
    gearStrut: strutGeom(0.05, 0.06, 0.3),
    wheel: wheelGeom(0.2, 0.15),
  },
};

// Per-type layout numbers consumed by the builders below.
const LAYOUT = {
  cessna: {
    navWingX: 5.4, navWingY: 1.02, navTailY: 1.55, navTailZ: 3.7, beaconY: 1.62, beaconZ: 3.45,
    landingLightZ: -3.6, gearHingeY: -0.38, gearNoseZ: -2.5, gearMainZ: -0.35, gearMainX: 0.95,
  },
  piper: {
    navWingX: 5.15, navWingY: -0.22, navTailY: 1.35, navTailZ: 3.8, beaconY: 1.42, beaconZ: 3.55,
    landingLightZ: -3.6, gearHingeY: -0.4, gearNoseZ: -2.55, gearMainZ: -0.25, gearMainX: 1.1,
  },
  jet: {
    navWingX: 4.1, navWingY: -0.02, navTailY: 1.85, navTailZ: 4.4, beaconY: 1.95, beaconZ: 4.15,
    landingLightZ: -4.6, gearHingeY: -0.45, gearNoseZ: -2.8, gearMainZ: 0.9, gearMainX: 0.85,
  },
};

function shadowed(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Position a wing strut between two local points (Cessna's signature V-struts).
function placeStrut(mesh, x1, y1, z1, x2, y2, z2) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  mesh.scale.set(1, len, 1);
  mesh.position.set(x1, y1, z1);
  // strutGeom extends along -Y from its origin; aim that -Y at point 2.
  mesh.lookAt(mesh.position.x + dx, mesh.position.y + dy, mesh.position.z + dz);
  mesh.rotateX(-Math.PI / 2);
  return mesh;
}

// One retractable landing-gear leg: a hinged Group whose children extend -Y.
function buildGearLeg(name, g, hingeX, hingeY, hingeZ) {
  const leg = new Group();
  leg.name = name;
  leg.position.set(hingeX, hingeY, hingeZ);
  const strut = shadowed(new Mesh(g.gearStrut, METAL_MAT));
  leg.add(strut);
  const wheel = shadowed(new Mesh(g.wheel, TIRE_MAT));
  // gearStrut length is baked into the geometry; wheel center sits at its tip.
  wheel.position.set(0, -g.gearStrut.parameters.height, 0);
  leg.add(wheel);
  return leg;
}

// Drive the three gear legs of any plane group to extension t (0=up, 1=down).
// Nose folds forward into the belly; mains fold inward toward the centreline.
// A slight retract-shrink keeps tucked wheels from poking through slim hulls.
export function applyGearPose(group, t) {
  const k = 1 - t;
  const s = 0.45 + 0.55 * t;
  const nose = group.getObjectByName('gear-nose');
  if (nose) { nose.rotation.x = k * 1.9; nose.scale.setScalar(s); }
  const left = group.getObjectByName('gear-left');
  if (left) { left.rotation.z = k * 1.85; left.scale.setScalar(s); }
  const right = group.getObjectByName('gear-right');
  if (right) { right.rotation.z = -k * 1.85; right.scale.setScalar(s); }
}

// --- per-type assembly -------------------------------------------------------
function buildCessna(group, body) {
  const g = GEOMS.cessna;
  group.add(shadowed(new Mesh(g.cowl, body)).translateZ(-2.95).translateY(0.02));
  group.add(shadowed(new Mesh(g.cabin, body)).translateZ(-1.05).translateY(0.12));
  const tail = shadowed(new Mesh(g.tail, body)); tail.position.set(0, 0.2, 1.95); group.add(tail);
  const stripe = new Mesh(g.stripe, ACCENT_MAT); stripe.position.set(0, 0.16, -1.05); group.add(stripe);
  const canopy = new Mesh(g.canopy, windowMat); canopy.position.set(0, 0.85, -1.15); canopy.name = 'canopy'; group.add(canopy);

  const wing = shadowed(new Mesh(g.wing, body)); wing.position.set(0, 1.08, -0.95); group.add(wing);
  for (const sx of [-1, 1]) {
    const ail = shadowed(new Mesh(g.aileron, body));
    ail.position.set(sx * 4.2, 1.08, -0.12);
    ail.name = sx < 0 ? 'aileron-left' : 'aileron-right';
    group.add(ail);
    // V wing struts — the Cessna signature.
    const strut = new Mesh(g.strutWing, METAL_MAT);
    placeStrut(strut, sx * 0.55, -0.3, -1.0, sx * 2.5, 1.0, -0.95);
    group.add(strut);
  }

  const hstab = shadowed(new Mesh(g.hstab, body)); hstab.position.set(0, 0.32, 3.3); group.add(hstab);
  const elevator = shadowed(new Mesh(g.elevator, body)); elevator.position.set(0, 0.32, 3.7); elevator.name = 'elevator'; group.add(elevator);
  const fin = shadowed(new Mesh(g.fin, ACCENT_MAT)); fin.position.set(0, 0.95, 3.35); group.add(fin);
  const rudder = shadowed(new Mesh(g.rudder, ACCENT_MAT)); rudder.position.set(0, 1.0, 3.78); rudder.name = 'rudder'; group.add(rudder);

  const prop = new Group(); prop.name = 'propeller'; prop.position.set(0, 0.02, -3.62);
  prop.add(new Mesh(g.spinner, METAL_MAT));
  prop.add(new Mesh(g.blade, DARK_MAT));
  group.add(prop);
}

function buildPiper(group, body) {
  const g = GEOMS.piper;
  group.add(shadowed(new Mesh(g.cowl, body)).translateZ(-2.95).translateY(-0.02));
  group.add(shadowed(new Mesh(g.cabin, body)).translateZ(-0.95).translateY(0.05));
  const tail = shadowed(new Mesh(g.tail, body)); tail.position.set(0, 0.12, 2.15); group.add(tail);
  const stripe = new Mesh(g.stripe, ACCENT_MAT); stripe.position.set(0, 0.05, -0.95); group.add(stripe);
  const canopy = new Mesh(g.canopy, windowMat); canopy.position.set(0, 0.66, -1.0); canopy.name = 'canopy'; group.add(canopy);

  const wing = shadowed(new Mesh(g.wing, body)); wing.position.set(0, -0.25, -0.55); group.add(wing);
  for (const sx of [-1, 1]) {
    const ail = shadowed(new Mesh(g.aileron, body));
    ail.position.set(sx * 4.0, -0.25, 0.22);
    ail.name = sx < 0 ? 'aileron-left' : 'aileron-right';
    group.add(ail);
  }

  const hstab = shadowed(new Mesh(g.hstab, body)); hstab.position.set(0, 0.22, 3.5); group.add(hstab);
  const elevator = shadowed(new Mesh(g.elevator, body)); elevator.position.set(0, 0.22, 3.88); elevator.name = 'elevator'; group.add(elevator);
  const fin = shadowed(new Mesh(g.fin, ACCENT_MAT)); fin.position.set(0, 0.82, 3.5); group.add(fin);
  const rudder = shadowed(new Mesh(g.rudder, ACCENT_MAT)); rudder.position.set(0, 0.85, 3.9); rudder.name = 'rudder'; group.add(rudder);

  const prop = new Group(); prop.name = 'propeller'; prop.position.set(0, -0.02, -3.65);
  prop.add(new Mesh(g.spinner, METAL_MAT));
  prop.add(new Mesh(g.blade, DARK_MAT));
  group.add(prop);
}

function buildJet(group, body) {
  const g = GEOMS.jet;
  group.add(shadowed(new Mesh(g.nose, body)).translateZ(-4.05));
  group.add(shadowed(new Mesh(g.foreFuse, body)).translateZ(-1.7));
  group.add(shadowed(new Mesh(g.midFuse, body)).translateZ(0.6));
  const engine = shadowed(new Mesh(g.engine, METAL_MAT)); engine.position.set(0, 0, 3.4); group.add(engine);
  const nozzle = shadowed(new Mesh(g.nozzle, NOZZLE_MAT)); nozzle.position.set(0, 0, 4.85); group.add(nozzle);
  const canopy = new Mesh(g.canopy, windowMat);
  canopy.position.set(0, 0.52, -2.1); canopy.scale.set(0.78, 0.62, 1.7); canopy.name = 'canopy';
  group.add(canopy);
  for (const sx of [-1, 1]) {
    const intake = shadowed(new Mesh(g.intake, INTAKE_MAT));
    intake.position.set(sx * 0.78, -0.05, -0.5);
    group.add(intake);
    // Swept main wings with ailerons as children (they inherit the sweep).
    const wing = shadowed(new Mesh(g.wing, body));
    wing.position.set(sx * 2.2, -0.05, 1.15);
    wing.rotation.y = sx * 0.42;
    group.add(wing);
    const ail = shadowed(new Mesh(g.aileron, body));
    ail.position.set(sx * 1.0, 0, 0.95);
    ail.name = sx < 0 ? 'aileron-left' : 'aileron-right';
    wing.add(ail);
  }
  // All-moving horizontal tail — both swept halves under one 'elevator' group.
  const elevator = new Group(); elevator.name = 'elevator'; elevator.position.set(0, 0.05, 4.35);
  for (const sx of [-1, 1]) {
    const half = shadowed(new Mesh(g.hstabHalf, body));
    half.position.set(sx * 1.0, 0, 0);
    half.rotation.y = sx * 0.38;
    elevator.add(half);
  }
  group.add(elevator);
  const fin = shadowed(new Mesh(g.fin, body)); fin.position.set(0, 1.0, 3.9); group.add(fin);
  const finTip = new Mesh(g.finTip, ACCENT_MAT); finTip.position.set(0, 1.95, 3.9); group.add(finTip);
  const rudder = shadowed(new Mesh(g.rudder, ACCENT_MAT)); rudder.position.set(0, 1.1, 4.6); rudder.name = 'rudder'; group.add(rudder);

  // Afterburner cones — hidden until Plane.update lights them at high throttle.
  // Base-anchored at the nozzle exit; Plane scales them backward along Z.
  const abCore = new Mesh(g.abCore, AB_CORE_MAT); abCore.position.set(0, 0, 5.2); abCore.name = 'ab-core';
  const abOuter = new Mesh(g.abOuter, AB_OUTER_MAT); abOuter.position.set(0, 0, 5.18); abOuter.name = 'ab-outer';
  abCore.visible = false; abOuter.visible = false;
  abCore.renderOrder = 2; abOuter.renderOrder = 2;
  group.add(abCore, abOuter);
}

export function buildPlaneMesh(type = DEFAULT_PLANE_TYPE, colorHex = DEFAULT_BODY_COLOR) {
  const t = GEOMS[type] ? type : DEFAULT_PLANE_TYPE;
  const g = GEOMS[t];
  const L = LAYOUT[t];
  const group = new Group();
  const body = bodyMaterial(colorHex);

  if (t === 'cessna') buildCessna(group, body);
  else if (t === 'jet') buildJet(group, body);
  else buildPiper(group, body);

  // Retractable tricycle gear (default pose: extended — parked planes and the
  // menu preview stand on their wheels; Plane/RemotePlaneManager animate it).
  group.add(buildGearLeg('gear-nose', g, 0, L.gearHingeY, L.gearNoseZ));
  group.add(buildGearLeg('gear-left', g, -L.gearMainX, L.gearHingeY, L.gearMainZ));
  group.add(buildGearLeg('gear-right', g, L.gearMainX, L.gearHingeY, L.gearMainZ));
  applyGearPose(group, 1);

  // Navigation lights (shared HDR mats driven by NightLights.updateLights):
  // red port / green starboard / white tail strobe / red rotating beacon.
  const navLeft = new Mesh(NAV_LIGHT_GEOM, navLeftMat);
  navLeft.position.set(-L.navWingX, L.navWingY, t === 'jet' ? 1.9 : -0.6);
  navLeft.name = 'nav-left';
  group.add(navLeft);
  const navRight = new Mesh(NAV_LIGHT_GEOM, navRightMat);
  navRight.position.set(L.navWingX, L.navWingY, t === 'jet' ? 1.9 : -0.6);
  navRight.name = 'nav-right';
  group.add(navRight);
  const navTail = new Mesh(NAV_LIGHT_GEOM, navTailMat);
  navTail.position.set(0, L.navTailY, L.navTailZ);
  navTail.name = 'nav-tail';
  group.add(navTail);
  const beacon = new Mesh(NAV_LIGHT_GEOM, navLeftMat);
  beacon.position.set(0, L.beaconY, L.beaconZ);
  beacon.scale.setScalar(0.8);
  beacon.name = 'beacon';
  group.add(beacon);

  // Landing-light anchor — Plane.js attaches its SpotLight here.
  const landingAnchor = new Group();
  landingAnchor.position.set(0, 0, L.landingLightZ);
  landingAnchor.name = 'landing-anchor';
  group.add(landingAnchor);

  return group;
}

// Release per-instance materials (the cloned body color). Identity-based: any
// material NOT registered in SHARED_MATS is per-instance and safe to free —
// shared singletons (incl. the nav/window mats reused scene-wide) never are.
export function disposePlaneMesh(group) {
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    if (!SHARED_MATS.has(obj.material)) obj.material.dispose();
  });
}
