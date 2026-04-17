import { Renderer } from './core/Renderer.js';
import { Clock } from './core/Clock.js';
import { Input } from './core/Input.js';
import { addLighting } from './world/Sky.js';
import { ChunkManager } from './world/ChunkManager.js';
import { buildRunwayMesh, isOnRunway, isInRunwayFlatZone } from './world/Runway.js';
import { heightAt } from './world/Noise.js';
import { Plane } from './plane/Plane.js';
import { ChaseCamera } from './camera/ChaseCamera.js';
import { Hud } from './ui/Hud.js';

const renderer = new Renderer();
const clock = new Clock();
const input = new Input();

addLighting(renderer.scene);

const chunks = new ChunkManager(renderer.scene);
const runwayMesh = buildRunwayMesh();
renderer.scene.add(runwayMesh);

const plane = new Plane();
renderer.scene.add(plane.mesh);

const chaseCamera = new ChaseCamera(renderer.camera);

const hud = new Hud();

function getGroundHeight(x, z) {
  // Runway flat zone is forced to y=0 in the mesh, so physics must match.
  if (isInRunwayFlatZone(x, z)) return 0;
  return heightAt(x, z);
}

// Prime chunks before first frame
chunks.update(plane.position);

function physicsStep(dt) {
  plane.update(dt, input, getGroundHeight, isOnRunway);
  chunks.update(plane.position);
}

function renderStep() {
  chaseCamera.update(plane);
  renderer.render();
  hud.update(plane);
}

function loop() {
  clock.tick(physicsStep, renderStep);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
