import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { DEFAULT_BODY_COLOR, DEFAULT_PLANE_TYPE } from '../config.js';

// Shared geometries per type. Built once at module load, reused by every
// plane instance (player, remote players, static airport planes) to avoid
// GPU buffer leaks on rebuild.
const TYPE_GEOMS = {
  cessna: {
    fuselage: new BoxGeometry(1, 1, 8),
    wing: new BoxGeometry(13, 0.18, 1.8),
    stab: new BoxGeometry(3.8, 0.15, 0.9),
    fin: new BoxGeometry(0.15, 1.3, 1.1),
    cockpit: new BoxGeometry(0.8, 0.5, 1.5),
    prop: new BoxGeometry(2.8, 0.1, 0.1),
    wingY: 0.85,    // high-wing
    wingZ: 0,
    stabZ: 3.5,
    finY: 0.65,
    finZ: 3.5,
    cockpitZ: -0.5,
    propZ: -4.2,
  },
  piper: {
    fuselage: new BoxGeometry(1, 1, 8),
    wing: new BoxGeometry(12, 0.15, 1.6),
    stab: new BoxGeometry(3.5, 0.15, 0.9),
    fin: new BoxGeometry(0.15, 1.2, 1.1),
    cockpit: new BoxGeometry(0.8, 0.5, 1.5),
    prop: new BoxGeometry(2.5, 0.1, 0.1),
    wingY: 0.2,     // mid-wing
    wingZ: 0,
    stabZ: 3.5,
    finY: 0.6,
    finZ: 3.5,
    cockpitZ: -0.5,
    propZ: -4.1,
  },
  jet: {
    fuselage: new BoxGeometry(0.9, 0.9, 10),
    wing: new BoxGeometry(9, 0.12, 2.8),
    stab: new BoxGeometry(3, 0.12, 1.0),
    fin: new BoxGeometry(0.15, 1.8, 1.2),
    cockpit: new BoxGeometry(0.7, 0.45, 2.2),
    engine: new BoxGeometry(0.9, 0.9, 1.5),
    wingY: 0.15,
    wingZ: 1.5,     // swept-back position
    stabZ: 4.2,
    finY: 0.95,
    finZ: 4.2,
    cockpitZ: -2.0,
    engineZ: 5.0,
  },
};

// Accent (fin) and dark (cockpit/prop) materials stay shared. Body materials
// are cloned per plane when a non-default color is requested, so coloring
// one plane doesn't tint every other plane in the scene.
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

  const stab = new Mesh(g.stab, body);
  stab.position.set(0, 0.1, g.stabZ);
  group.add(stab);

  const fin = new Mesh(g.fin, ACCENT_MAT);
  fin.position.set(0, g.finY, g.finZ);
  group.add(fin);

  const cockpit = new Mesh(g.cockpit, DARK_MAT);
  cockpit.position.set(0, type === 'jet' ? 0.5 : 0.6, g.cockpitZ);
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
