import { Renderer } from './core/Renderer.js';
import { Clock } from './core/Clock.js';
import { Input } from './core/Input.js';
import { Sky } from './world/Sky.js';
import { ChunkManager } from './world/ChunkManager.js';
import { VillageManager } from './world/VillageManager.js';
import { isOnFlatGround } from './world/Villages.js';
import { Water } from './world/Water.js';
import { groundHeight } from './world/Ground.js';
import { Clouds } from './world/Clouds.js';
import { PlaneShadow, makeShadowTexture } from './world/Shadow.js';
import { Explosion } from './effects/Explosion.js';
import { CRASH_ENABLED_DEFAULT } from './config.js';
import { MultiplayerClient } from './net/Client.js';
import { RemotePlaneManager } from './net/RemotePlaneManager.js';
import { Plane } from './plane/Plane.js';
import { ChaseCamera } from './camera/ChaseCamera.js';
import { Hud } from './ui/Hud.js';

const renderer = new Renderer();
const clock = new Clock();
const input = new Input();

const sky = new Sky(renderer.scene);

const chunks = new ChunkManager(renderer.scene);
const villages = new VillageManager(renderer.scene);
const water = new Water(renderer.scene);

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

// Multiplayer: default to same-host WebSocket at /ws (nginx proxy), which works
// over both http and https. Override with ?server=ws://... for LAN/dev setups
// where the WebSocket server is reached directly on another port.
const mpStatusEl = document.getElementById('mp-status');
const params = new URLSearchParams(window.location.search);
function defaultServerUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host || 'localhost';
  // Dev (Vite on :5173) won't proxy /ws — fall back to direct :3030.
  if (window.location.port === '5173') {
    return `ws://${window.location.hostname || 'localhost'}:3030`;
  }
  return `${proto}//${host}/ws`;
}
const serverUrl = params.get('server') || defaultServerUrl();
const mp = new MultiplayerClient(serverUrl);
mp.onStatusChange(({ connected, count, id }) => {
  if (!mpStatusEl) return;
  if (!connected) mpStatusEl.textContent = 'mp: offline';
  else mpStatusEl.textContent = `mp: P${id ?? '?'} · ${count} other${count === 1 ? '' : 's'}`;
});
const remotes = new RemotePlaneManager(renderer.scene, mp);

const chaseCamera = new ChaseCamera(renderer.camera);

const hud = new Hud();

const getGroundHeight = groundHeight;

// Prime chunks and villages before first frame
chunks.update(plane.position);
villages.update(plane.position);

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
  plane.update(dt, input, getGroundHeight, isOnFlatGround, crashesEnabled());
  if (!wasCrashed && plane.crashed && plane.crashImpact) {
    explosion.trigger(plane.crashImpact.position, plane.crashImpact.velocity);
    plane.mesh.visible = false;
    if (crashBannerEl) crashBannerEl.style.display = 'block';
  }
  chunks.update(plane.position);
  villages.update(plane.position);
}

function renderStep() {
  const now = performance.now();
  const renderDt = Math.min(0.1, (now - lastRenderTime) / 1000);
  lastRenderTime = now;
  chaseCamera.update(plane, input, renderDt);
  sky.update(renderer.camera);
  water.update(renderer.camera.position);
  clouds.update(renderDt, plane.position, getGroundHeight);
  if (!plane.crashed) planeShadow.update(plane, getGroundHeight);
  else planeShadow.mesh.visible = false;
  explosion.update(renderDt);
  remotes.update(renderDt);
  mp.sendState(plane);
  renderer.render();
  hud.update(plane);
}

function loop() {
  clock.tick(physicsStep, renderStep);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
