import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';

export function buildPlaneMesh() {
  const group = new Group();
  const white = new MeshStandardMaterial({ color: 0xeeeeee, flatShading: true });
  const dark = new MeshStandardMaterial({ color: 0x333333, flatShading: true });
  const red = new MeshStandardMaterial({ color: 0xcc3333, flatShading: true });

  const fuselage = new Mesh(new BoxGeometry(1, 1, 8), white);
  group.add(fuselage);

  const wing = new Mesh(new BoxGeometry(12, 0.15, 1.6), white);
  wing.position.set(0, 0.2, 0);
  group.add(wing);

  const stab = new Mesh(new BoxGeometry(3.5, 0.15, 0.9), white);
  stab.position.set(0, 0.1, 3.5);
  group.add(stab);

  const fin = new Mesh(new BoxGeometry(0.15, 1.2, 1.1), red);
  fin.position.set(0, 0.6, 3.5);
  group.add(fin);

  const cockpit = new Mesh(new BoxGeometry(0.8, 0.5, 1.5), dark);
  cockpit.position.set(0, 0.6, -0.5);
  group.add(cockpit);

  const prop = new Mesh(new BoxGeometry(2.5, 0.1, 0.1), dark);
  prop.position.set(0, 0, -4.1);
  prop.name = 'propeller';
  group.add(prop);

  return group;
}
