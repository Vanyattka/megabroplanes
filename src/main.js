import { Color, Vector3 } from 'three';
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
import { Contrails } from './effects/Contrails.js';
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
  GODRAYS_STRENGTH,
  LENS_FLARE_STRENGTH,
  LENS_FLARE_STREAK_STRENGTH,
  DAY_LENGTH_SECONDS,
  WATER_LEVEL,
  LANDING_LIGHT_INTENSITY,
  BLOOM_THRESHOLD_DAY,
  BLOOM_THRESHOLD_DUSK,
} from './config.js';
import { MultiplayerClient } from './net/Client.js';
import { RemotePlaneManager } from './net/RemotePlaneManager.js';
import { RaceManager } from './race/RaceManager.js';
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
// Scratch vector for projecting the sun into screen space each frame
// (god rays + lens flare). Reused to avoid per-frame allocation.
const _sunScreen = new Vector3();
// Scratch vectors for landing-light water-cone intersection + plane-glint
// reflection. Allocated once and rewritten each frame.
const _lightWorldPos = new Vector3();
const _lightWorldDir = new Vector3();
const _lightTargetPos = new Vector3();
const _landingHitPos = new Vector3();
const _planeReflPos = new Vector3();
const _planeReflColor = new Color();
// Scratch for jet position passed to water shader. Kept distinct from
// _tmpVec3 so the per-frame computeWaterExtras() bundle doesn't alias
// jet.position with landing.position (water.update reads both).
const _jetReflPos = new Vector3();

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
  postfx.setGodraysEnabled(!!settings.godrays);
  postfx.setColorGradeEnabled(settings.colorGrade !== false);
  postfx.setFxaaEnabled(settings.fxaa !== false);
}
applyGfx(gfx.settings);
gfx.onChange(applyGfx);

const sharedShadowTex = makeShadowTexture();
const planeShadow = new PlaneShadow(renderer.scene, sharedShadowTex);
const explosion = new Explosion(renderer.scene);
const jetExhaust = new JetExhaust(renderer.scene);
const contrails = new Contrails(renderer.scene);

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
const raceManager = new RaceManager(renderer.scene, mp, () => plane);
const touch = new TouchControls();
const minimap = new Minimap(mp);

// Game state
let gameState = 'menu';
// 'singleplayer' | 'multiplayer' — defaults to whatever the menu has
// loaded from localStorage. In MP mode, time of day comes from the wall
// clock so all clients see the same sky; in SP, the player's chosen
// time preset applies.
let currentMode = 'singleplayer';
const menu = new Menu();

// Apply a time-of-day preset to the DayNight cycle (or resume auto mode).
// Only called in singleplayer — multiplayer overrides every frame from
// the wall clock via applyGlobalTime() below.
function applyTimePreset(key) {
  const p = TIME_PRESETS[key];
  if (!p || p.t == null) dayNight.setAuto();
  else dayNight.setFrozenTime(p.t);
}

// Wall-clock-derived time-of-day, deterministic across every client. All
// players agree on the cycle phase because Date.now() is the same global
// source. Run every frame BEFORE dayNight.update() so the keyframe interp
// sees the right t. paused=true keeps DayNight from advancing on its own.
function applyGlobalTime() {
  const seconds = Date.now() / 1000;
  dayNight.t = ((seconds / DAY_LENGTH_SECONDS) % 1 + 1) % 1;
  dayNight.paused = true;
}

// Apply the right time policy when entering or resuming a flight.
function applyModeTime(timePreset) {
  if (currentMode === 'multiplayer') {
    applyGlobalTime();
  } else {
    applyTimePreset(timePreset);
  }
}

// Wire mp.setEnabled and remote clearing to the current mode. Called
// whenever the player flips the mode toggle in the main menu, AND on
// each Start/Continue so the multiplayer client matches the chosen mode.
function applyMode(mode) {
  currentMode = mode === 'multiplayer' ? 'multiplayer' : 'singleplayer';
  mp.setEnabled(currentMode === 'multiplayer');
  syncRaceActive();
}

// Race mode (gates, HUD, checkpoint reporting) is live only while flying in
// multiplayer and not framing a photo. Call after any change to mode / game
// state / photo mode.
function syncRaceActive() {
  raceManager.setActive(
    currentMode === 'multiplayer' && gameState === 'playing' && !photoMode
  );
}

menu.onChange = ({ type, color }) => {
  plane.setLoadout(type, color);
  plane.mesh.visible = true;
};
menu.onStart = ({ type, color, timePreset, mode }) => {
  plane.setLoadout(type, color);
  applyMode(mode);
  applyModeTime(timePreset);
  plane.reset();
  plane.mesh.visible = true;
  jetExhaust.clear();
  contrails.clear();
  explosion.clear();
  if (crashBannerEl) crashBannerEl.style.display = 'none';
  gameState = 'playing';
  syncRaceActive();
  audio.setSuspended(false);
};
// Continue = resume the existing flight without resetting the plane.
menu.onContinue = () => {
  plane.mesh.visible = !plane.crashed;
  gameState = 'playing';
  syncRaceActive();
  audio.setSuspended(false);
};
menu.onTimeChange = (preset) => {
  // In MP mode the picker is greyed out; ignore stray taps that might
  // still fire (e.g. from cached event listeners).
  if (currentMode === 'multiplayer') return;
  applyTimePreset(preset);
};
// Mode toggle in the main menu — disconnect/connect MP and switch the
// time policy. Doesn't kick the player out of a running flight.
menu.onModeChange = (mode) => {
  applyMode(mode);
  // If the player is currently in flight, re-apply the right time policy
  // so the swap takes effect immediately rather than at the next Start.
  if (gameState === 'playing') {
    applyModeTime(menu.getSelection().timePreset);
  }
};

const backToMenuBtn = document.getElementById('btn-menu');
if (backToMenuBtn) {
  backToMenuBtn.addEventListener('click', () => {
    if (gameState !== 'playing') return;
    if (photoMode) setPhotoMode(false);
    explosion.clear();
    jetExhaust.clear();
    contrails.clear();
    if (crashBannerEl) crashBannerEl.style.display = 'none';
    plane.mesh.visible = false;
    gameState = 'menu';
    syncRaceActive();
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
  syncRaceActive();
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
  applyMode(sel.mode);
  applyModeTime(sel.timePreset);
}

const chaseCamera = new ChaseCamera(renderer.camera);
const hud = new Hud();

const getGroundHeight = groundHeight;
const getPhysicsFloor = physicsFloor;

// Project the sun's world direction into screen UV space and hand the
// result to postfx for the god-rays + lens-flare pass. Returns nothing —
// the result is purely side-effect (postfx uniforms). When the sun is
// behind the camera, below the horizon, or off-screen, strength is set
// to 0 and the shader early-outs to a cheap passthrough.
function updateSunPostFx() {
  const camera = renderer.camera;
  // Place a proxy sun 10 km away in worldTime.sunDir, then project into
  // normalized-device coordinates (-1..+1) and convert to UV (0..1).
  _sunScreen.copy(worldTime.sunDir).multiplyScalar(10000).add(camera.position);
  _sunScreen.project(camera);
  const ndcZ = _sunScreen.z;              // > 1 or < -1 = clipped
  const inFront = ndcZ < 1 && ndcZ > -1;
  const ux = _sunScreen.x * 0.5 + 0.5;
  const uy = _sunScreen.y * 0.5 + 0.5;
  // Sun must be above the world horizon (positive Y component) AND in
  // front of the camera. Also fade out smoothly near screen edges so
  // the streak doesn't pop when the sun crosses the viewport boundary.
  const sunAboveHorizon = Math.max(0, Math.min(1, worldTime.sunDir.y * 4));
  // Soft screen-edge falloff — fully on in the middle third of each axis,
  // fading to zero outside a generous margin. Without this, flare/rays
  // snap off the instant the sun UV goes < 0 or > 1.
  const ex = Math.max(0, 1 - Math.max(0, Math.max(-0.15 - ux, ux - 1.15)) / 0.15);
  const ey = Math.max(0, 1 - Math.max(0, Math.max(-0.15 - uy, uy - 1.15)) / 0.15);
  const onScreen = ex * ey;
  const visibility =
    inFront && worldTime.sunIntensity > 0
      ? sunAboveHorizon * onScreen * worldTime.sunIntensity
      : 0;
  postfx.setSunScreenPos(
    ux,
    uy,
    GODRAYS_STRENGTH * visibility,
    LENS_FLARE_STRENGTH * visibility,
    LENS_FLARE_STREAK_STRENGTH * visibility
  );
}

// Build the per-frame "extras" bundle for the water shader: jet engine
// hotspot, landing-light cone-on-water, and plane body-color glint disc.
// Each is null/zero when not applicable so the shader's branches early-out
// for the cheap fast path.
function computeWaterExtras() {
  // Jet engine — already had this; preserved as a sub-bundle. Use a
  // dedicated scratch so jet.position can't alias landing.position.
  const jet =
    plane.type === 'jet' && plane._jetLight
      ? {
          position: plane._jetLight.getWorldPosition(_jetReflPos),
          intensity: plane._jetLight.intensity / 18,
        }
      : null;

  // Landing light: trace the SpotLight's cone axis from its world position
  // along its world direction toward y=WATER_LEVEL. If the cone points
  // downward and the plane is overhead, light hits water at that point.
  // Intensity falls off with cone height (close to water = bright pool;
  // far above = nothing).
  let landing = null;
  if (plane._landingLight && plane._landingTarget && plane.landingLightOn) {
    plane._landingLight.getWorldPosition(_lightWorldPos);
    plane._landingTarget.getWorldPosition(_lightTargetPos);
    _lightWorldDir.subVectors(_lightTargetPos, _lightWorldPos).normalize();
    // Only intersect when cone is pointing down through the water plane.
    if (_lightWorldDir.y < -0.05 && _lightWorldPos.y > WATER_LEVEL) {
      const t = (WATER_LEVEL - _lightWorldPos.y) / _lightWorldDir.y;
      if (t > 0 && t < 800) {
        const hx = _lightWorldPos.x + _lightWorldDir.x * t;
        const hz = _lightWorldPos.z + _lightWorldDir.z * t;
        // Cone-to-water height fades intensity in 0..400 m. The light is
        // useful as a real reflection in the 30–250 m AGL window.
        const heightAboveWater = _lightWorldPos.y - WATER_LEVEL;
        const heightAtten = 1 - Math.min(1, Math.max(0, heightAboveWater / 400));
        const intensityNorm = plane._landingLight.intensity / LANDING_LIGHT_INTENSITY;
        const intensity = intensityNorm * heightAtten;
        if (intensity > 0.02) {
          _landingHitPos.set(hx, WATER_LEVEL, hz);
          landing = { position: _landingHitPos, intensity };
        }
      }
    }
  }

  // Plane body-color glint disc — a stand-in for a real planar reflection
  // visible only when *skimming* the water. The previous range (30–300 m)
  // was way too generous: the disc was visible from 200 m up, which read
  // as a giant coloured halo following the plane around rather than a
  // reflection. Tightened to: full at 0–15 m, fades to nothing by 60 m.
  // A real plane's reflection on water would be a recognisable silhouette
  // at low altitude and an indistinct dot/sparkle from any real height —
  // for the simple disc stand-in, "off above 60 m" reads better than a
  // long faint trail.
  let planeRefl = null;
  if (!plane.crashed) {
    const altOverWater = plane.position.y - WATER_LEVEL;
    if (altOverWater > 0 && altOverWater < 60) {
      const t = 1 - Math.min(1, Math.max(0, (altOverWater - 15) / 45));
      if (t > 0.001) {
        _planeReflPos.set(plane.position.x, WATER_LEVEL, plane.position.z);
        _planeReflColor.setHex(plane.color != null ? plane.color : 0xffffff);
        planeRefl = {
          position: _planeReflPos,
          color: _planeReflColor,
          intensity: t,
        };
      }
    }
  }

  if (!jet && !landing && !planeRefl) return null;
  return { jet, landing, plane: planeRefl };
}

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

  // In multiplayer mode we re-derive `t` from the wall clock every frame
  // so all clients see the same sky. paused=true tells DayNight not to
  // advance on its own — we set t directly. Skip while photo mode is on
  // so the player's shot stays frozen.
  if (currentMode === 'multiplayer' && !photoMode) {
    applyGlobalTime();
  }
  // Day/night advances regardless of menu state — the sky keeps changing
  // behind the menu, which looks nice.
  dayNight.update(renderDt);

  // Adaptive bloom threshold: lower it toward dawn/dusk/night so warm low-sun
  // skies and night lights glow more; raise it at noon to keep the day crisp.
  {
    const sf = Math.max(0, Math.min(1, (worldTime.sunIntensity - 0.3) / 0.7));
    postfx.setBloomThreshold(
      BLOOM_THRESHOLD_DUSK + (BLOOM_THRESHOLD_DAY - BLOOM_THRESHOLD_DUSK) * sf
    );
  }

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
    updateSunPostFx();
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
  const waterExtras = computeWaterExtras();
  // Use the render-interpolated position so water tracks under the camera
  // exactly. plane.position is the post-physics value, which can lag the
  // render frame by up to one physics step (~17 ms) — at jet speeds that's
  // a few metres of offset between camera and water-mesh centre, enough to
  // make the water edge visibly "wobble" at the horizon.
  water.update(
    renderDt,
    plane.renderPosition || plane.position,
    worldTime.horizonColor,
    waterExtras
  );
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
    contrails.update(renderDt, plane);
  }
  remotes.update(renderDt);
  raceManager.update(renderDt);
  mp.sendState(plane);

  // Audio tracks plane state each frame.
  audio.update(renderDt, {
    throttle: plane.throttle,
    airspeed: plane.velocity.length(),
  });

  updateSunPostFx();
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
