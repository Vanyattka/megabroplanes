import { Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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
import { ChunkWorkerPool } from './world/ChunkWorkerPool.js';
import { worldTime } from './world/WorldTime.js';
import { Audio } from './audio/Audio.js';
import {
  CRASH_ENABLED_DEFAULT,
  CHUNK_SIZE,
  VIEW_ALT_SCALE,
  FOG_NEAR_FRAC,
  FOG_FAR_FRAC,
  TIME_PRESETS,
  PRIME_RADIUS_CHUNKS,
} from './config.js';
import { MultiplayerClient } from './net/Client.js';
import { RemotePlaneManager } from './net/RemotePlaneManager.js';
import { TouchControls } from './ui/Touch.js';
import { Minimap } from './ui/Minimap.js';
import { Menu } from './ui/Menu.js';
import { Plane } from './plane/Plane.js';
import { ChaseCamera } from './camera/ChaseCamera.js';
import { Hud } from './ui/Hud.js';
import { PostFx } from './effects/PostFx.js';
import { gfx, view } from './ui/GraphicsSettings.js';
import { profiler } from './debug/Profiler.js';

const renderer = new Renderer();
// Scratch Vector3 reused by the per-frame jet reflection query so we
// don't allocate one a frame.
const _tmpVec3 = new Vector3();

// Photo mode state. When on, plane physics and day-night clock pause and
// OrbitControls takes over so the player can frame a shot freely.
let photoMode = false;
const orbitControls = new OrbitControls(renderer.camera, renderer.renderer.domElement);
orbitControls.enabled = false;
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.08;
orbitControls.minDistance = 4;
orbitControls.maxDistance = 450;
orbitControls.target.set(0, 0, 0);
const photoBannerEl = document.getElementById('photo-banner');
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
// 2-worker pool offloads terrain compute (~3 ms CPU per chunk) off the
// main thread. primeAll still runs synchronously so the world is ready by
// the first frame; mid-flight streaming uses the pool.
const chunkPool = new ChunkWorkerPool(2);
const chunks = new ChunkManager(renderer.scene, { roads, pool: chunkPool });
const villages = new VillageManager(renderer.scene);
const ruins = new RuinsManager(renderer.scene);
const water = new Water(renderer.scene);
const clouds = new Clouds(renderer.scene);

const plane = new Plane(renderer.scene);
// Hidden initially — menu state will animate an orbit camera over the world.
plane.mesh.visible = false;

// Post-processing pipeline — bloom + vignette on top of the render pass.
const postfx = new PostFx(renderer.renderer, renderer.scene, renderer.camera);
window.addEventListener('resize', () => {
  postfx.setSize(window.innerWidth, window.innerHeight);
});

// Apply graphics-settings changes across the subsystems that care. Tree
// shadows and terrain detail noise are only applied to *new* chunks — old
// chunks keep their existing look until they unload, which is fine.
function applyGfx(settings) {
  renderer.renderer.setPixelRatio(settings.pixelRatio);
  renderer.renderer.toneMappingExposure = settings.toneMappingExposure;
  sky.setShadowMapSize(settings.shadows);
  sky.setShadowFrustumHalf(settings.shadowFrustumHalf);
  sky.setAtmospheric(settings.atmoSky);
  postfx.setBloomEnabled(settings.bloom);
  postfx.setBloomStrength(settings.bloomStrength);
  postfx.setVignetteEnabled(settings.vignette);
}
applyGfx(gfx.settings);
gfx.onChange(applyGfx);

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
  // Menu is open on first user gesture — keep audio silenced until the
  // player actually starts/continues a flight.
  audio.setSuspended(gameState === 'menu');
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
  audio.setSuspended(false);
};
// Continue = resume the existing flight without resetting the plane.
menu.onContinue = () => {
  plane.mesh.visible = !plane.crashed;
  gameState = 'playing';
  audio.setSuspended(false);
};
menu.onTimeChange = (preset) => applyTimePreset(preset);

const backToMenuBtn = document.getElementById('btn-menu');
if (backToMenuBtn) {
  backToMenuBtn.addEventListener('click', () => {
    if (gameState !== 'playing') return;
    if (photoMode) setPhotoMode(false);
    explosion.clear();
    jetExhaust.clear();
    if (crashBannerEl) crashBannerEl.style.display = 'none';
    plane.mesh.visible = false;
    gameState = 'menu';
    audio.setSuspended(true);
    // The player already has a flight in progress — show CONTINUE on the
    // main menu so they can pick up where they left off.
    menu.setContinueAvailable(!plane.crashed);
    menu.open();
  });
}

// Enter/exit photo mode. Freezes plane physics + day/night so the player can
// orbit the camera freely and take a screenshot. On exit, re-hands control to
// the chase camera, which will re-lock onto the plane within one render frame.
function setPhotoMode(on) {
  if (on === photoMode) return;
  photoMode = on;
  if (on) {
    _prevDayPaused = dayNight.paused;
    dayNight.paused = true;
    // Collapse the 60 Hz render-interpolation snapshots so updateRender(alpha)
    // lerps from position → position every frame. Without this, _prevPosition
    // still holds the position from one physics step ago, and the mesh visibly
    // jitters/"drags" between that stale snapshot and the live one as alpha
    // oscillates, even though physics is frozen.
    plane._prevPosition.copy(plane.position);
    plane._prevQuaternion.copy(plane.quaternion);
    plane.syncMesh();
    // Aim orbit at the plane and seed the camera on the current chase-cam
    // position so there's no visual jump.
    orbitControls.target.copy(plane.position);
    orbitControls.enabled = true;
    orbitControls.update();
    document.body.classList.add('photo');
    if (photoBannerEl) photoBannerEl.style.display = 'block';
  } else {
    orbitControls.enabled = false;
    dayNight.paused = _prevDayPaused;
    document.body.classList.remove('photo');
    if (photoBannerEl) photoBannerEl.style.display = 'none';
  }
}
let _prevDayPaused = false;

// M key toggles audio mute. L key toggles the landing light. P toggles photo mode.
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && audio.isStarted()) {
    audio.toggleMute();
    updateAudioIndicator();
  }
  if (e.code === 'KeyL' && gameState === 'playing') {
    plane.toggleLandingLight();
  }
  if (e.code === 'KeyP' && gameState === 'playing') {
    setPhotoMode(!photoMode);
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
  // Bounds come from the active view-distance preset; altitude still smoothly
  // expands the view inside those bounds so takeoff feels snappy.
  const vs = view.settings;
  const t = altitudeT(plane.position.y);
  return Math.round(vs.min + t * (vs.max - vs.min));
}
function terrainViewRadiusFor(plane) {
  return (viewDistanceFor(plane) + 0.5) * CHUNK_SIZE;
}
function viewMetersFor(plane) {
  return viewDistanceFor(plane) * CHUNK_SIZE;
}
function fogFarFor(plane) {
  // Fog far tracks the current view distance — so terrain is rendered all
  // the way up to where fog becomes opaque, and the "edge of loaded chunks"
  // is never visible as a hard line against the sky.
  return viewMetersFor(plane) * FOG_FAR_FRAC;
}
function fogNearFor(plane) {
  return viewMetersFor(plane) * FOG_NEAR_FRAC;
}

// Predicate villages/ruins use to avoid popping in above a chunk whose
// terrain isn't loaded yet.
function chunkReady(cx, cz) {
  return chunks.hasChunk(cx, cz);
}

// Prime world — build just the inner PRIME_RADIUS_CHUNKS ring synchronously
// so the runway and immediate surroundings are present on the first frame.
// Priming the FULL view (441 chunks at VD=10) was a mistake: Three.js
// uploads each geometry to the GPU lazily on first render, so the first
// ~20 s of play dripped out 22–60 ms frames as 441 VBOs uploaded one at
// a time while the menu camera panned. Small prime → GPU catches up
// instantly → outer rings stream in via normal update() within a couple
// of seconds, spread across many frames so the upload cost is invisible.
const primeRadius = Math.min(PRIME_RADIUS_CHUNKS, viewDistanceFor(plane));
chunks.primeAll(plane.position, primeRadius);
// Villages/ruins still use the full radius so their "which cells can be
// built" calculation is correct — but primeAll only builds those whose
// terrain chunk is actually loaded, and outside primeRadius the gate
// fails, so only nearby villages/ruins end up built synchronously.
villages.primeAll(plane.position, terrainViewRadiusFor(plane), chunkReady);
ruins.primeAll(plane.position, terrainViewRadiusFor(plane), chunkReady);

let lastRenderTime = performance.now();
let resetHeld = false;

// Stream new chunks/villages/ruins. Runs every physicsStep — the per-
// subsystem update() functions have cheap fast-paths when nothing changed
// (ChunkManager in particular exits in ~0 ms when the plane cell is
// unchanged and no scatter is pending), so this is essentially free most
// ticks and only allocates work when new cells are needed.
function streamUpdate() {
  // Pass fog_far as the visibility radius so chunks fully hidden by fog
  // are skipped in rendering — a major GPU win that keeps loaded chunks
  // available for when the plane turns and they come back into view.
  chunks.update(plane.position, viewDistanceFor(plane), fogFarFor(plane));
  villages.update(plane.position, terrainViewRadiusFor(plane), chunkReady);
  ruins.update(plane.position, terrainViewRadiusFor(plane), chunkReady);
}

function physicsStep(dt) {
  if (gameState === 'menu') {
    return;
  }
  // Photo mode freezes the world — skip plane physics entirely. Day/night
  // is already paused via dayNight.paused; streaming still runs from
  // renderStep so loaded chunks stay fresh around the frozen plane.
  if (photoMode) return;

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
  // NOTE: chunks/villages/ruins streaming is NOT called here — it belongs in
  // renderStep. Physics runs 1–3× per render frame via the accumulator, and
  // calling streamUpdate() from here gave each sub-step its own 10 ms build
  // budget, letting a single long frame eat 30 ms of chunk work. It also
  // made the camera "zoom in and out" during loading: plane advanced by
  // FIXED_STEP while wall-clock advanced by 30 ms, so camera lerp (driven by
  // renderDt) overshot the plane's actual position. Running streaming once
  // per render frame fixes both.
}

function renderStep(alpha) {
  const now = performance.now();
  const renderDt = Math.min(0.1, (now - lastRenderTime) / 1000);
  lastRenderTime = now;

  // Interpolate plane state between its last two physics snapshots so the
  // mesh and camera move smoothly at 120+ fps even though physics ticks
  // at 60 Hz. Without this the camera "rubber-bands" every other frame
  // whenever render is faster than physics.
  plane.updateRender(alpha);

  // Stream chunks/villages/ruins exactly once per render frame. Before, this
  // was in physicsStep — which runs 1–3× per render via the accumulator,
  // so streaming ran multiple times and could eat 30 ms/frame on long
  // frames. Plane physics still gets its proper N physics sub-steps.
  streamUpdate();

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
    const menuPlane = { position: { y: 50 } };
    if (renderer.scene.fog) {
      renderer.scene.fog.near = fogNearFor(menuPlane);
      renderer.scene.fog.far = fogFarFor(menuPlane);
    }
    sky.update(renderer.camera, renderer.camera.position);
    stars.update(renderer.camera);
    water.update(renderDt, renderer.camera.position, worldTime.horizonColor);
    clouds.update(
      renderDt,
      renderer.camera.position,
      renderer.camera.position,
      renderer.camera,
      worldTime.horizonColor
    );
    postfx.render();
    return;
  }

  if (photoMode) {
    // Player drives the camera directly via OrbitControls; keep the focus
    // tracking plane.position in case it drifts (it shouldn't — physics is
    // paused — but this is cheap insurance).
    orbitControls.target.copy(plane.position);
    orbitControls.update();
  } else {
    chaseCamera.update(plane, input, renderDt);
  }
  if (renderer.scene.fog) {
    renderer.scene.fog.near = fogNearFor(plane);
    renderer.scene.fog.far = fogFarFor(plane);
  }
  sky.update(renderer.camera, plane.position);
  stars.update(renderer.camera);
  // When the player flies a jet, pass the engine position + intensity so the
  // water shader paints a hot orange reflection under it.
  const jetInfo =
    plane.type === 'jet' && plane._jetLight
      ? {
          position: plane._jetLight.getWorldPosition(_tmpVec3),
          intensity: plane._jetLight.intensity / 18, // normalize to 0..1
        }
      : null;
  water.update(renderDt, plane.position, worldTime.horizonColor, jetInfo);
  clouds.update(
    renderDt,
    plane.position,
    renderer.camera.position,
    renderer.camera,
    worldTime.horizonColor
  );
  if (!plane.crashed) planeShadow.update(plane, getPhysicsFloor);
  else planeShadow.mesh.visible = false;
  // Freeze particle systems in photo mode. Jet exhaust in particular was
  // shooting forward ahead of the frozen plane — each spawned particle
  // inherits plane.velocity, which is still large (flight speed) even
  // though physics is paused, so they'd jet forward then stop. Skipping
  // update() keeps currently-rendered particles in place; entry clears
  // the existing plume so there's no stale trail.
  if (!photoMode) {
    explosion.update(renderDt);
    jetExhaust.update(renderDt, plane);
  }
  remotes.update(renderDt);
  mp.sendState(plane);

  // Audio tracks plane state each frame.
  audio.update(renderDt, {
    throttle: plane.throttle,
    airspeed: plane.velocity.length(),
  });

  postfx.render();
  hud.update(plane);
  minimap.update(plane);
}

function loop() {
  profiler.frameBegin();
  clock.tick(physicsStep, renderStep);
  profiler.frameEnd();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
