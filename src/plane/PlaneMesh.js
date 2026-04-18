import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';

// Shared geometries + materials. Every plane in the scene (player, remote
// players, static airport planes) references these, so we never leak GPU
// buffers on load/unload.
const FUSELAGE_GEOM = new BoxGeometry(1, 1, 8);
const WING_GEOM = new BoxGeometry(12, 0.15, 1.6);
const STAB_GEOM = new BoxGeometry(3.5, 0.15, 0.9);
const FIN_GEOM = new BoxGeometry(0.15, 1.2, 1.1);
const COCKPIT_GEOM = new BoxGeometry(0.8, 0.5, 1.5);
const PROP_GEOM = new BoxGeometry(2.5, 0.1, 0.1);

const WHITE = new MeshStandardMaterial({ color: 0xeeeeee, flatShading: true });
const DARK = new MeshStandardMaterial({ color: 0x333333, flatShading: true });
const RED = new MeshStandardMaterial({ color: 0xcc3333, flatShading: true });

export function buildPlaneMesh() {
  const group = new Group();

  const fuselage = new Mesh(FUSELAGE_GEOM, WHITE);
  group.add(fuselage);

  const wing = new Mesh(WING_GEOM, WHITE);
  wing.position.set(0, 0.2, 0);
  group.add(wing);

  const stab = new Mesh(STAB_GEOM, WHITE);
  stab.position.set(0, 0.1, 3.5);
  group.add(stab);

  const fin = new Mesh(FIN_GEOM, RED);
  fin.position.set(0, 0.6, 3.5);
  group.add(fin);

  const cockpit = new Mesh(COCKPIT_GEOM, DARK);
  cockpit.position.set(0, 0.6, -0.5);
  group.add(cockpit);

  const prop = new Mesh(PROP_GEOM, DARK);
  prop.position.set(0, 0, -4.1);
  prop.name = 'propeller';
  group.add(prop);

  return group;
}
