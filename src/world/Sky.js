import { HemisphereLight, DirectionalLight } from 'three';

export function addLighting(scene) {
  const hemi = new HemisphereLight(0xffffff, 0x334422, 0.6);
  scene.add(hemi);

  const sun = new DirectionalLight(0xfff4e0, 0.8);
  sun.position.set(100, 200, 50);
  scene.add(sun);
}
