import { Renderer } from './core/Renderer.js';
import { Clock } from './core/Clock.js';
import { Input } from './core/Input.js';
import { Sky } from './world/Sky.js';
import { ChunkManager } from './world/ChunkManager.js';
import { buildRunwayMesh, isOnRunway } from './world/Runway.js';
import { groundHeight } from './world/Ground.js';
import { Clouds } from './world/Clouds.js';
import { PlaneShadow, makeShadowTexture } from './world/Shadow.js';
import { Explosion } from './effects/Explosion.js';
import { CRASH_ENABLED_DEFAULT } from './config.js';
import { Plane } from './plane/Plane.js';
import { ChaseCamera } from './camera/ChaseCamera.js';
import { Hud } from './ui/Hud.js';

const renderer = new Renderer();
const clock = new Clock();
const input = new Input();

const sky = new Sky(renderer.scene);

const chunks = new ChunkManager(renderer.scene);
const runwayMesh = buildRunwayMesh();
renderer.scene.add(runwayMesh);

const plane = new Plane();
renderer.scene.add(plane.mesh);

const sharedShadowTex = makeShadowTexture();
const planeShadow = new PlaneShadow(renderer.scene, sharedShadowTex);
const clouds = new Clouds(renderer.scene, sharedShadowTex);
const explosion = new Explosion(renderer.scene);

const crashToggleEl = document.getElementById('crashes-enabled');
if (crashToggleEl) crashToggleEl.checked = CRASH_ENABLED_DEFAULT;
const crashBannerEl = document.getElementById('crash-banner');
function crashesEnabled() {
  return crashToggleEl ? crashToggleEl.checked : CRASH_ENABLED_DEFAULT;
}

const chaseCamera = new ChaseCamera(renderer.camera);

const hud = new Hud();

const getGroundHeight = groundHeight;

// Prime chunks before first frame
chunks.update(plane.position);

let lastRenderTime = performance.now();
let resetHeld = false;

function physicsStep(dt) {
  if (input.isPressed('KeyR')) {
    if (!resetHeld) {
      plane.reset();
      explosion.clear();
      if (crashBannerEl) crashBannerEl.style.display = 'none';
      resetHeld = true;
    }
  } else {
    resetHeld = false;
  }
  const wasCrashed = plane.crashed;
  plane.update(dt, input, getGroundHeight, isOnRunway, crashesEnabled());
  if (!wasCrashed && plane.crashed && plane.crashImpact) {
    explosion.trigger(plane.crashImpact.position, plane.crashImpact.velocity);
    plane.mesh.visible = false;
    if (crashBannerEl) crashBannerEl.style.display = 'block';
  }
  chunks.update(plane.position);
}

function renderStep() {
  const now = performance.now();
  const renderDt = Math.min(0.1, (now - lastRenderTime) / 1000);
  lastRenderTime = now;
  chaseCamera.update(plane, input, renderDt);
  sky.update(renderer.camera);
  clouds.update(renderDt, plane.position, getGroundHeight);
  if (!plane.crashed) planeShadow.update(plane, getGroundHeight);
  else planeShadow.mesh.visible = false;
  explosion.update(renderDt);
  renderer.render();
  hud.update(plane);
}

function loop() {
  clock.tick(physicsStep, renderStep);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
