import { Renderer } from './core/Renderer.js';
import { Clock } from './core/Clock.js';
import { Input } from './core/Input.js';
import { Sky } from './world/Sky.js';
import { ChunkManager } from './world/ChunkManager.js';
import { VillageManager } from './world/VillageManager.js';
import { isOnFlatGround } from './world/Villages.js';
import { RuinsManager } from './world/RuinsManager.js';
import { Water } from './world/Water.js';
import { groundHeight, physicsFloor } from './world/Ground.js';
import { Clouds } from './world/Clouds.js';
import { PlaneShadow, makeShadowTexture } from './world/Shadow.js';
import { Explosion } from './effects/Explosion.js';
import {
  CRASH_ENABLED_DEFAULT,
  VIEW_DISTANCE_MIN,
  VIEW_DISTANCE_MAX,
  VIEW_ALT_SCALE,
  FOG_FAR_MIN,
  FOG_FAR_MAX,
} from './config.js';
import { MultiplayerClient } from './net/Client.js';
import { RemotePlaneManager } from './net/RemotePlaneManager.js';
import { TouchControls } from './ui/Touch.js';
import { Minimap } from './ui/Minimap.js';
import { Plane } from './plane/Plane.js';
import { ChaseCamera } from './camera/ChaseCamera.js';
import { Hud } from './ui/Hud.js';

const renderer = new Renderer();
const clock = new Clock();
const input = new Input();

const sky = new Sky(renderer.scene);

const chunks = new ChunkManager(renderer.scene);
const villages = new VillageManager(renderer.scene);
const ruins = new RuinsManager(renderer.scene);
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
const touch = new TouchControls();
const minimap = new Minimap(mp);

const chaseCamera = new ChaseCamera(renderer.camera);

const hud = new Hud();

const getGroundHeight = groundHeight;
const getPhysicsFloor = physicsFloor;

// Altitude scales both view distance and fog far, so flying higher reveals a
// bigger world — like climbing unlocks a wider horizon.
function altitudeT(y) {
  return Math.max(0, Math.min(1, y / VIEW_ALT_SCALE));
}
function viewDistanceFor(plane) {
  const t = altitudeT(plane.position.y);
  return Math.round(VIEW_DISTANCE_MIN + t * (VIEW_DISTANCE_MAX - VIEW_DISTANCE_MIN));
}
function fogFarFor(plane) {
  const t = altitudeT(plane.position.y);
  return FOG_FAR_MIN + t * (FOG_FAR_MAX - FOG_FAR_MIN);
}

// Prime chunks and villages before first frame
chunks.update(plane.position, viewDistanceFor(plane));
villages.update(plane.position);
ruins.update(plane.position);

let lastRenderTime = performance.now();
let resetHeld = false;

function physicsStep(dt) {
  const resetKey = input.isPressed('KeyR');
  const resetBtn = touch.consumeReset();
  if (resetKey || resetBtn) {
    if (!resetHeld || resetBtn) {
      plane.reset();
      explosion.clear();
      if (crashBannerEl) crashBannerEl.style.display = 'none';
      resetHeld = true;
    }
  } else {
    resetHeld = false;
  }
  const wasCrashed = plane.crashed;
  plane.update(dt, input, getPhysicsFloor, isOnFlatGround, crashesEnabled(), touch);
  if (!wasCrashed && plane.crashed && plane.crashImpact) {
    explosion.trigger(plane.crashImpact.position, plane.crashImpact.velocity);
    plane.mesh.visible = false;
    if (crashBannerEl) crashBannerEl.style.display = 'block';
  }
  chunks.update(plane.position, viewDistanceFor(plane));
  villages.update(plane.position);
  ruins.update(plane.position);
}

function renderStep() {
  const now = performance.now();
  const renderDt = Math.min(0.1, (now - lastRenderTime) / 1000);
  lastRenderTime = now;
  chaseCamera.update(plane, input, renderDt);
  const fogFar = fogFarFor(plane);
  if (renderer.scene.fog) renderer.scene.fog.far = fogFar;
  sky.update(renderer.camera);
  water.update(renderer.camera.position);
  clouds.update(renderDt, plane.position, getPhysicsFloor);
  if (!plane.crashed) planeShadow.update(plane, getPhysicsFloor);
  else planeShadow.mesh.visible = false;
  explosion.update(renderDt);
  remotes.update(renderDt);
  mp.sendState(plane);
  renderer.render();
  hud.update(plane);
  minimap.update(plane);
}

function loop() {
  clock.tick(physicsStep, renderStep);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
