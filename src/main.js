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
import { JetExhaust } from './effects/JetExhaust.js';
import { DayNight } from './world/DayNight.js';
import { Stars } from './world/Stars.js';
import { Roads } from './world/Roads.js';
import { worldTime } from './world/WorldTime.js';
import { Audio } from './audio/Audio.js';
import {
  CRASH_ENABLED_DEFAULT,
  CHUNK_SIZE,
  VIEW_DISTANCE_MIN,
  VIEW_DISTANCE_MAX,
  VIEW_ALT_SCALE,
  FOG_FAR_MIN,
  FOG_FAR_MAX,
  TIME_PRESETS,
} from './config.js';
import { MultiplayerClient } from './net/Client.js';
import { RemotePlaneManager } from './net/RemotePlaneManager.js';
import { TouchControls } from './ui/Touch.js';
import { Minimap } from './ui/Minimap.js';
import { Menu } from './ui/Menu.js';
import { Plane } from './plane/Plane.js';
import { ChaseCamera } from './camera/ChaseCamera.js';
import { Hud } from './ui/Hud.js';

const renderer = new Renderer();
const clock = new Clock();
const input = new Input();

const sky = new Sky(renderer.scene);
const stars = new Stars(renderer.scene);
const dayNight = new DayNight({
  scene: renderer.scene,
  sky,
  sunLight: sky.sun,
  ambientLight: sky.ambient,
  fog: renderer.scene.fog,
});

// Roads are owned per chunk — ChunkManager calls roads.buildForChunk /
// disposeForChunk so road meshes live and die with their terrain.
const roads = new Roads(renderer.scene);
const chunks = new ChunkManager(renderer.scene, { roads });
const villages = new VillageManager(renderer.scene);
const ruins = new RuinsManager(renderer.scene);
const water = new Water(renderer.scene);
const clouds = new Clouds(renderer.scene);

const plane = new Plane(renderer.scene);
// Hidden initially — menu state will animate an orbit camera over the world.
plane.mesh.visible = false;

const sharedShadowTex = makeShadowTexture();
const planeShadow = new PlaneShadow(renderer.scene, sharedShadowTex);
const explosion = new Explosion(renderer.scene);
const jetExhaust = new JetExhaust(renderer.scene);

const crashToggleEl = document.getElementById('crashes-enabled');
if (crashToggleEl) crashToggleEl.checked = CRASH_ENABLED_DEFAULT;
const crashBannerEl = document.getElementById('crash-banner');
function crashesEnabled() {
  return crashToggleEl ? crashToggleEl.checked : CRASH_ENABLED_DEFAULT;
}

// ---------------------------------------------------------------------------
// Audio — constructed now but started lazily on first user gesture.
// ---------------------------------------------------------------------------
const audio = new Audio();
const audioIndicatorEl = document.getElementById('audio-indicator');
function updateAudioIndicator() {
  if (!audioIndicatorEl) return;
  if (!audio.isStarted()) { audioIndicatorEl.textContent = '🔈 off'; return; }
  audioIndicatorEl.textContent = audio.isMuted() ? '🔇 muted' : '🔊 on';
}
function firstInput() {
  audio.start();
  updateAudioIndicator();
  window.removeEventListener('keydown', firstInput);
  window.removeEventListener('mousedown', firstInput);
  window.removeEventListener('touchstart', firstInput);
}
window.addEventListener('keydown', firstInput);
window.addEventListener('mousedown', firstInput);
window.addEventListener('touchstart', firstInput);
updateAudioIndicator();

// Multiplayer
const mpStatusEl = document.getElementById('mp-status');
const params = new URLSearchParams(window.location.search);
function defaultServerUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host || 'localhost';
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

// Game state
let gameState = 'menu';
const menu = new Menu();

// Apply a time-of-day preset to the DayNight cycle (or resume auto mode).
function applyTimePreset(key) {
  const p = TIME_PRESETS[key];
  if (!p || p.t == null) dayNight.setAuto();
  else dayNight.setFrozenTime(p.t);
}

menu.onChange = ({ type, color }) => {
  plane.setLoadout(type, color);
  plane.mesh.visible = true;
};
menu.onStart = ({ type, color, timePreset }) => {
  plane.setLoadout(type, color);
  applyTimePreset(timePreset);
  plane.reset();
  plane.mesh.visible = true;
  jetExhaust.clear();
  explosion.clear();
  if (crashBannerEl) crashBannerEl.style.display = 'none';
  gameState = 'playing';
};
menu.onTimeChange = (preset) => applyTimePreset(preset);

const backToMenuBtn = document.getElementById('btn-menu');
if (backToMenuBtn) {
  backToMenuBtn.addEventListener('click', () => {
    if (gameState !== 'playing') return;
    explosion.clear();
    jetExhaust.clear();
    if (crashBannerEl) crashBannerEl.style.display = 'none';
    plane.mesh.visible = false;
    gameState = 'menu';
    menu.open();
  });
}

// M key toggles audio mute. L key toggles the landing light.
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && audio.isStarted()) {
    audio.toggleMute();
    updateAudioIndicator();
  }
  if (e.code === 'KeyL' && gameState === 'playing') {
    plane.toggleLandingLight();
  }
});

{
  const sel = menu.getSelection();
  plane.setLoadout(sel.type, sel.color);
  applyTimePreset(sel.timePreset);
}

const chaseCamera = new ChaseCamera(renderer.camera);
const hud = new Hud();

const getGroundHeight = groundHeight;
const getPhysicsFloor = physicsFloor;

function altitudeT(y) {
  return Math.max(0, Math.min(1, y / VIEW_ALT_SCALE));
}
function viewDistanceFor(plane) {
  const t = altitudeT(plane.position.y);
  return Math.round(VIEW_DISTANCE_MIN + t * (VIEW_DISTANCE_MAX - VIEW_DISTANCE_MIN));
}
function terrainViewRadiusFor(plane) {
  return (viewDistanceFor(plane) + 0.5) * CHUNK_SIZE;
}
function fogFarFor(plane) {
  const t = altitudeT(plane.position.y);
  return FOG_FAR_MIN + t * (FOG_FAR_MAX - FOG_FAR_MIN);
}

// Prime world
chunks.update(plane.position, viewDistanceFor(plane));
villages.update(plane.position, terrainViewRadiusFor(plane));
ruins.update(plane.position, terrainViewRadiusFor(plane));

let lastRenderTime = performance.now();
let resetHeld = false;

function physicsStep(dt) {
  if (gameState === 'menu') {
    chunks.update(plane.position, viewDistanceFor(plane));
    villages.update(plane.position, terrainViewRadiusFor(plane));
    ruins.update(plane.position, terrainViewRadiusFor(plane));
    return;
  }

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
  villages.update(plane.position, terrainViewRadiusFor(plane));
  ruins.update(plane.position, terrainViewRadiusFor(plane));
}

function renderStep() {
  const now = performance.now();
  const renderDt = Math.min(0.1, (now - lastRenderTime) / 1000);
  lastRenderTime = now;

  // Day/night advances regardless of menu state — the sky keeps changing
  // behind the menu, which looks nice.
  dayNight.update(renderDt);

  if (gameState === 'menu') {
    const t = now / 6000;
    const radius = 180;
    const height = 55;
    renderer.camera.position.set(
      Math.cos(t) * radius,
      height,
      Math.sin(t) * radius
    );
    renderer.camera.lookAt(0, 12, 0);
    const fogFar = fogFarFor({ position: { y: 50 } });
    if (renderer.scene.fog) renderer.scene.fog.far = fogFar;
    sky.update(renderer.camera);
    stars.update(renderer.camera);
    water.update(renderDt, renderer.camera.position, worldTime.horizonColor);
    clouds.update(
      renderDt,
      renderer.camera.position,
      renderer.camera.position,
      renderer.camera,
      worldTime.horizonColor
    );
    renderer.render();
    return;
  }

  chaseCamera.update(plane, input, renderDt);
  const fogFar = fogFarFor(plane);
  if (renderer.scene.fog) renderer.scene.fog.far = fogFar;
  sky.update(renderer.camera);
  stars.update(renderer.camera);
  water.update(renderDt, plane.position, worldTime.horizonColor);
  clouds.update(
    renderDt,
    plane.position,
    renderer.camera.position,
    renderer.camera,
    worldTime.horizonColor
  );
  if (!plane.crashed) planeShadow.update(plane, getPhysicsFloor);
  else planeShadow.mesh.visible = false;
  explosion.update(renderDt);
  jetExhaust.update(renderDt, plane);
  remotes.update(renderDt);
  mp.sendState(plane);

  // Audio tracks plane state each frame.
  audio.update(renderDt, {
    throttle: plane.throttle,
    airspeed: plane.velocity.length(),
  });

  renderer.render();
  hud.update(plane);
  minimap.update(plane);
}

function loop() {
  clock.tick(physicsStep, renderStep);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
