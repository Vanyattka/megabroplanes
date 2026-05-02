# Architecture

This is a snapshot of how the live code is wired up — not the original MVP plan. The MVP one lives in `ROADMAP.md` for historical reference.

## File tree

```
megabroplanes/
├── index.html              # canvas + DOM overlays (HUD, menu, touch UI, banners)
├── package.json
├── vite.config.js
├── server/
│   └── index.js            # Node WebSocket relay used by multiplayer
├── docs/
│   ├── ARCHITECTURE.md
│   ├── PHYSICS.md
│   ├── WORLD.md
│   └── ROADMAP.md
├── CLAUDE.md
├── README.md
└── src/
    ├── main.js                  # entry point, game loop, mode/photo state
    ├── config.js                # every tunable, grouped by domain
    ├── core/
    │   ├── Renderer.js          # WebGLRenderer + Scene + PerspectiveCamera
    │   ├── Clock.js             # fixed-timestep accumulator + render alpha
    │   └── Input.js             # keyboard/mouse state + drag detection
    ├── camera/
    │   └── ChaseCamera.js       # exponential-smoothing chase + mouse-look
    ├── plane/
    │   ├── Plane.js             # state + landing/jet lights + render interp
    │   ├── Physics.js           # pure force/torque step, ground interaction
    │   ├── Controls.js          # input → angular velocity / throttle
    │   └── PlaneMesh.js         # build a plane Group from primitives
    ├── world/
    │   ├── Noise.js             # seeded simplex (terrain + biome + sea)
    │   ├── Biome.js             # 5-band weighted blend (lake → highmountain)
    │   ├── SeaMask.js           # low-frequency ocean noise overlay
    │   ├── TerrainCompute.js    # heavy per-chunk math (positions/colors/normals)
    │   ├── Terrain.js           # Mesh assembly + shared MeshStandardMaterial
    │   ├── ChunkManager.js      # streams chunks, owns roads per chunk
    │   ├── ChunkWorker.js       # worker entry: TerrainCompute off the main thread
    │   ├── ChunkWorkerPool.js   # round-robin pool of workers + result queue
    │   ├── Ground.js            # heightAt sampler used by physics
    │   ├── Runway.js            # home-airport flat zone + canvas-textured mesh
    │   ├── VillageData.js       # deterministic village placement per cell
    │   ├── Villages.js          # per-cell house/street layout
    │   ├── VillageMeshes.js     # shared materials for village pieces
    │   ├── VillageManager.js    # build/dispose village meshes per chunk
    │   ├── Ruins.js             # mountain-peak ruin placement + shapes
    │   ├── RuinMeshes.js        # shared stone materials
    │   ├── RuinsManager.js      # build/dispose ruin meshes per chunk
    │   ├── Roads.js             # ribbon meshes between nearby villages
    │   ├── Scatter.js           # trees + rocks per chunk via biome filter
    │   ├── Sky.js               # gradient sky dome + sun + ambient + moon
    │   ├── AtmosphericSky.js    # Preetham sky (High preset only)
    │   ├── DayNight.js          # keyframe interpolator → worldTime + lights
    │   ├── WorldTime.js         # shared singleton read by water/clouds/sky
    │   ├── NightLights.js       # shared HDR materials for nav / runway lamps
    │   ├── Stars.js             # Points-based starfield, fades at night
    │   ├── Water.js             # ShaderMaterial: ripples + reflections
    │   └── Clouds.js            # InstancedMesh of camera-facing quads
    ├── effects/
    │   ├── Explosion.js         # crash particle burst (instanced cubes)
    │   ├── JetExhaust.js        # throttle-scaled HDR particle plume
    │   ├── Contrails.js         # long-lived white vapor at altitude
    │   └── PostFx.js            # bloom + vignette + god-rays/lens-flare
    ├── ui/
    │   ├── Hud.js               # speed/altitude/throttle DOM
    │   ├── Minimap.js           # 2D minimap
    │   ├── Menu.js              # main + planes + settings screens, mode toggle
    │   ├── PlanePreview.js      # spinning plane in the picker cards
    │   ├── Touch.js             # joystick + throttle slider for mobile
    │   └── GraphicsSettings.js  # gfx + view-distance preset singletons
    ├── net/
    │   ├── Client.js            # WebSocket client (auto-reconnect, setEnabled)
    │   └── RemotePlaneManager.js # remote-plane visuals + jet effects
    ├── audio/
    │   └── Audio.js             # Web Audio engine + wind voice
    └── debug/
        └── Profiler.js          # opt-in counters/timers + long-frame tracer
```

## Game loop (per frame)

```
Clock.tick(physicsStep, renderStep)
├── physics step (fixed 1/60s, possibly 0–3 substeps per frame)
│   ├── early-return if menu / photo mode
│   ├── plane.update(dt, input, ground, isOnRunway, crashesEnabled, touch)
│   └── crash detection → explosion.trigger
└── render step (once per frame, with interpolation alpha)
    ├── plane.updateRender(alpha)              # interp prev↔curr physics state
    ├── streamUpdate()                         # chunks + villages + ruins
    ├── (MP mode) applyGlobalTime()            # wall-clock derived t
    ├── dayNight.update(renderDt)              # interpolate keyframes
    ├── chaseCamera.update OR orbitControls.update (photo mode)
    ├── sky.update + stars.update
    ├── water.update(extras: jet/landing/plane)
    ├── clouds.update
    ├── jetExhaust + contrails + explosion (skipped in photo mode)
    ├── remotes.update (no-op in SP mode)
    ├── mp.sendState (no-op in SP mode)
    ├── audio.update
    ├── updateSunPostFx() → postfx godrays uniforms
    ├── postfx.render()                        # bloom → godrays → vignette
    ├── hud.update
    └── minimap.update
```

`main.js` keeps three pieces of mutable runtime state:
- `gameState` — `'menu' | 'playing'`
- `currentMode` — `'singleplayer' | 'multiplayer'`
- `photoMode` — boolean

Both gates short-circuit specific pipeline stages rather than swapping render trees.

## Module responsibilities

### `main.js`
Wires every subsystem together, owns the game loop and the cross-cutting state listed above. Builds the per-frame water "extras" bundle (`computeWaterExtras()`) and the sun's screen-space projection for god rays (`updateSunPostFx()`). Around 600 lines — the original "under 100 lines" goal didn't survive contact with multiplayer + photo mode + extras bundles + mode-switching, but the file remains pure orchestration, no gameplay logic.

### `config.js`
Single source of truth. Constants are grouped: timing, world, runway, villages, ruins, physics, plane types, sky/fog, biomes, water, clouds, shadows, crashes, particles, jet exhaust + jet light, contrails, scatter, streaming budget, camera, mouse-look, day/night keyframes, night lights, roads, audio, post-FX (bloom + vignette + god rays + aerial perspective), graphics presets, view-distance presets, time-of-day presets. Every visual or gameplay knob has a comment explaining what range is sensible and why the current value was picked.

### `core/Renderer.js`
Wraps `WebGLRenderer`, `Scene`, `PerspectiveCamera`. ACES tone mapping, SRGB output, soft PCF shadows. Camera far is sized to the largest view-distance preset (`14 × CHUNK_SIZE × 1.6`).

### `core/Clock.js`
Fixed-timestep accumulator that calls `physicsStep(FIXED_STEP)` 0..3 times per render frame, then `renderStep(alpha)` once. `alpha ∈ [0,1]` is the fraction of a physics step elapsed since the last sub-step — passed to `Plane.updateRender(alpha)` so the rendered plane interpolates between two physics snapshots.

### `core/Input.js`
Tracks keyboard pressed-set, mouse delta with drag detection, and exposes `consumeMouseDelta()` (read-once accumulator). `getAxis(pos, neg)` helper.

### `camera/ChaseCamera.js`
Reads `plane.renderPosition` / `plane.renderQuaternion` (the interpolated state). Mouse drag adds a temporary `yaw`/`pitch` that decays back to zero when the mouse releases. Camera position uses dt-aware exponential smoothing (`alpha = 1 - exp(-dt × CAMERA_FOLLOW_RATE)`) instead of raw lerp so the rate is frame-rate-independent.

### `plane/Plane.js`
State: `position`, `velocity`, `quaternion`, `angularVelocity`, `throttle`, `onGround`, `crashed`, plus the prev-physics snapshot (`_prevPosition`, `_prevQuaternion`) for render interpolation. Two attached lights — `_landingLight` (SpotLight on the nose, toggled by `L`) and `_jetLight` (orange PointLight at the engine, throttle-scaled). `setLoadout(type, color)` swaps the visible mesh when the player picks a different plane.

### `plane/Physics.js`
Pure functions, see `PHYSICS.md`. Forces: thrust, lift (clamped to `LIFT_REFERENCE_SPEED²`), drag, gravity, velocity-aligns-with-nose torque (ramped by airspeed), stall pitch-down. Crash detection: speed × dive-angle × downward-velocity all above thresholds and not on a flat runway.

### `plane/Controls.js`
WASD/QE → angular-velocity targets, smoothed via `CONTROL_RESPONSIVENESS`. Throttle is integrated from Shift/Ctrl. Touch joystick + throttle slider feed in via the same axes. Roll-to-yaw coupling here.

### `plane/PlaneMesh.js`
`buildPlaneMesh(type, color)` returns a `Group` of `BoxGeometry` parts: fuselage, wing, fin, stab, cockpit, propeller, control surfaces (named so animation code can find them), nav-light spheres, landing-light anchor, jet-engine block. Three silhouettes (cessna / piper / jet) share the same code with different sizes / accessories.

### `world/Noise.js`
Three independent noise fields: terrain height (`noise2D`), biome mask (in `Biome.js`), sea mask (in `SeaMask.js`). All seeded via `alea` with distinct seed strings so they don't correlate. Terrain noise sums multiple octaves; pure function of world coordinates only.

### `world/Biome.js`
Low-frequency `simplex-noise` over `BIOME_SCALE` selects between 5 named biomes (lake / forest / hills / mountain / highmountain). `biomeAt(x, z)` returns a smoothly weighted blend of `{ amp, offset, trees, rocks, type }` — the heaviest-weighted biome's `type` is reported for downstream switches (e.g. tree species selection).

### `world/SeaMask.js`
Even-lower-frequency simplex layer over `SEA_SCALE`. Where the mask is high, terrain height is pushed down by up to `SEA_DEPTH` so multi-kilometre oceans cut through whatever biome is locally selected. `seaMaskAt(x, z)` is also used to reject village placement in seas.

### `world/TerrainCompute.js`
The "heavy" per-chunk work, isolated so it can run on a worker thread. Returns transferable buffers: `positions`, `normals`, `colors`, plus a bounding-sphere centre/radius. Uses `Biome` + `SeaMask` to drive height, then `colorByHeight` with slope-based rock+snow tiers (sand, grass, dark grass, alpine stone, packed snow, summit snow). Honors village-flatten zones passed in as data.

### `world/Terrain.js`
Cheap Mesh assembly around the worker output. One shared `MeshStandardMaterial` and one shared index buffer across every chunk — without sharing, each new chunk triggered a 40–80 ms shader-program compile stall. The shared material's `onBeforeCompile` injects an aerial-perspective term: distant fragments are desaturated and tinted toward `worldTime.horizonColor`. `updateAerialPerspective(color)` is called from `DayNight` each frame so the tint tracks the sky.

### `world/ChunkManager.js`
Time-budgeted, closest-first streaming. Owns a worker pool (`ChunkWorkerPool`), a result queue with backpressure, and per-chunk roads (`buildForChunk` / `disposeForChunk`). Adaptive build budget: the per-frame ms ceiling scales with backlog so initial load fills fast without stalling once cruise begins. `primeAll(planePos, radius)` does a synchronous fill for the inner ring before the first frame.

### `world/ChunkWorker.js` + `world/ChunkWorkerPool.js`
Worker thread runs `TerrainCompute` and ships `ArrayBuffer`s back as transferables. Pool keeps `MAX_IN_FLIGHT` requests outstanding and a result queue capped at `MAX_BUFFERED_RESULTS`. `ChunkManager` finalizes meshes from results in `MAX_TERRAIN_INSTALLS_PER_FRAME` increments.

### `world/Ground.js`
`groundHeight(x, z)` and `physicsFloor(x, z)` — the two height samplers used by `Plane.update`. Don't go through `TerrainCompute` (that's per-vertex); they recompute the same height function in JS for fast point queries.

### `world/Runway.js`
The home airport is hunted out of the origin cell by sampling for the flattest 600×30 m strip. `isInRunwayFlatZone(x, z)` and `isOnRunway(x, z)` for terrain-flatten + ground checks. The visual runway mesh uses a `CanvasTexture` painted at module load.

### `world/VillageData.js` + `world/Villages.js`
Deterministic placement of 0–1 village per `VILLAGE_CELL_SIZE` × `VILLAGE_CELL_SIZE` cell. Size tier is chosen by weighted RNG (small / medium / large / city); city is rare. Villages are rejected if the cell centre is in a sea or sits on the home runway. `Villages.js` lays out streets + house slots; `VillageData.js` is the small structure passed to the worker so terrain knows where to flatten.

### `world/VillageManager.js`
Builds village meshes per cell (lazily, gated on `chunkReady(cx, cz)` so houses don't spawn before terrain). Time-budgeted at `VILLAGE_BUILD_BUDGET_MS` per frame. `primeAll(planePos, radius, chunkReady)` for synchronous initial fill.

### `world/VillageMeshes.js`
Shared materials for every village piece (house variants, khrushchevkas, doors, chimneys, terminal, hangar, tower) so first-render compile stalls don't multiply by house count. Window emissive material brightens at night via `NightLights.updateLights()`.

### `world/Ruins.js` + `world/RuinMeshes.js` + `world/RuinsManager.js`
Stone wall / tower / arch silhouettes spawned on mountain peaks (height > `RUIN_MIN_HEIGHT`). Same per-chunk placement + lazy-build pattern as villages. Three weathered grey shared materials.

### `world/Roads.js`
Ribbon meshes between nearby village airports, sampled along a deterministic curved centerline. Per-chunk ownership keyed on the from-village cell so each road is built exactly once. Reject candidates whose path crosses sea or exceeds `ROAD_MAX_SLOPE`.

### `world/Scatter.js`
Trees + rocks per chunk. Candidate count = `TREES_PER_CHUNK × biome.trees × …` then biome / slope / water rejection trims the list. Trees use a small set of variants; both materials are flat-shaded `MeshStandardMaterial`s shared across instances.

### `world/Sky.js`
Two domes, both centred on the camera every frame:
1. **Gradient dome** — `ShaderMaterial` mixing `uHorizon → uZenith` with a three-layer sun (wide glow, halo, HDR disc). `DayNight` writes its uniforms.
2. **Moon dome** — separate additive-blended dome that always renders. Cool-white disc + halo at `-uSunDir`, gated by `uNightFactor`. Works through both gradient and Preetham sky.

Also owns the scene's `DirectionalLight` (sun, with a shadow-camera frustum that follows the plane) and `AmbientLight`. `setAtmospheric(on)` swaps in `AtmosphericSky` (Preetham) for the gradient dome on High preset.

### `world/AtmosphericSky.js`
Wraps Three's `objects/Sky.js` (Preetham model). Parameters are tuned low (`turbidity=1.0`, `rayleigh=0.35`) and an `onBeforeCompile` clamp keeps the output ≤ 1.9 so it can never cross the bloom threshold and whiteout the sky.

### `world/DayNight.js`
Keyframe interpolator. Frames in `DAY_NIGHT_KEYFRAMES` cover sky/horizon/fog/sun/ambient colours + intensities, plus `starsOpacity`. Each frame `update(dt)`:
1. Advance `t` (or read it directly when paused / under wall-clock control).
2. Find the surrounding keyframe pair, lerp every channel.
3. Compute sun direction from `t` (sin/cos orbit, noon at top).
4. Write everything to: the `worldTime` singleton, the gradient sky uniforms, the moon dome uniforms, scene fog, sun/ambient lights, and `updateAerialPerspective(horizonColor)` on the terrain shader, and `NightLights.updateLights()` for runway/nav lights.

`paused` mode lets external code (photo mode, multiplayer global time) drive `t` directly.

### `world/WorldTime.js`
A trivial mutable singleton with `t`, `skyColor`, `horizonColor`, `fogColor`, `sunDir`, `sunColor`, `sunIntensity`, `ambientColor`, `ambientIntensity`, `starsOpacity`, `nightFactor`. Read by `Water`, `Clouds`, `Stars`, and the post-FX sun computation. Singleton is fine because there is exactly one day/night cycle.

### `world/Stars.js`
`Points` cloud on a fixed-radius dome around the camera. Material's opacity = `worldTime.starsOpacity` so they fade in at night.

### `world/NightLights.js`
Shared HDR materials for runway lamps, plane nav lights, and village windows. `updateLights()` is called once per frame from `DayNight` and writes a single `nightFactor`-scaled emissive to all of them.

### `world/Water.js`
Single huge `PlaneGeometry` (6 km × 6 km — bigger than fog far at every preset) at `y = WATER_LEVEL`, follows `plane.renderPosition` horizontally. Custom `ShaderMaterial` does:
- Multi-octave analytic ripple normal (slow swell + mid wind chop + high-frequency sparkle, each with its own wind drift).
- Fresnel mix between `WATER_COLOR_SHALLOW`/`WATER_COLOR_DEEP` and reflected sky.
- Sun glint Blinn-Phong specular (HDR — golden sunset path blooms).
- Jet-engine reflection pool (orange smear under low jets).
- Landing-light reflection pool (where the SpotLight cone meets water).
- Plane body-color glint disc that fades with altitude (stand-in for a true planar reflection).

`update(dt, planePos, worldTint, extras)` builds these per-frame.

### `world/Clouds.js`
`InstancedMesh` of camera-facing quads, deterministic per `CLOUD_CELL_SIZE` cell. Wind drift is a global offset so cells stay deterministic but the world flows. Cloud texture is generated once at module load via canvas 2D. Tinted by `worldTime.horizonColor` so they take on dusk/dawn colours.

### `effects/Explosion.js`
Crash particle burst — one `InstancedMesh` of cubes with HDR fire colour, gravity + drag. Lives ~0.9–2 s.

### `effects/JetExhaust.js`
Throttle-scaled HDR particle plume from the engine nozzle, additively blended. Particles inherit plane velocity at spawn, decelerate via drag, drift up via buoyancy. Colour curve hot → orange → red → dark over particle lifetime; only the hottest core crosses the bloom threshold.

### `effects/Contrails.js`
Long-lived white vapor (≈28 s lifetime) above `CONTRAIL_MIN_ALT` with throttle gate. Particles spawn at zero velocity (relative to world, not plane) so they hang in the sky exactly where the plane was. Two parallel trails — one per engine offset.

### `effects/PostFx.js`
EffectComposer chain:
1. `RenderPass` (scene → buffer)
2. `UnrealBloomPass` (threshold 2.0 — only HDR pixels bloom)
3. Custom god-rays + lens-flare `ShaderPass` (radial blur from sun's screen position + 4 ghost discs + anamorphic streak)
4. Custom vignette `ShaderPass`
5. `OutputPass`

`setSunScreenPos(x, y, raysStrength, flareStrength, streakStrength)` lets `main.js` drive the third pass; strength is zero when sun is off-screen / behind camera so the pass is a passthrough most frames. Each pass is independently toggleable via the gfx preset.

### `ui/Hud.js`, `ui/Minimap.js`
DOM overlays for speed/altitude/throttle and a 2D minimap (other players also plot when MP is on).

### `ui/Menu.js`
Three screens: main (mode toggle, START / CONTINUE / PLANES / SETTINGS), planes (picker + colour swatches), settings (time of day + graphics + view distance). Selections persist in `localStorage`. Mode toggle is the SP/MP pill at the top of the main screen — when MP is selected, the time picker greys out and a synced-time note appears.

### `ui/PlanePreview.js`
Spinning preview rendered into each plane card's canvas via a small dedicated WebGLRenderer. Only animates while the planes screen is open.

### `ui/Touch.js`
On-screen joystick + throttle slider for mobile, exposed as the same axis values the keyboard would produce.

### `ui/GraphicsSettings.js`
Two singleton-style stores (`gfx`, `view`) with `set/preset/settings/onChange` and `localStorage` persistence. `main.js` registers an `onChange` that re-applies pixel ratio, shadow size, bloom strength, atmospheric sky, god rays, etc.

### `net/Client.js`
WebSocket client. Reconnects every `RECONNECT_MS` (3 s) when it disconnects. `setEnabled(false)` cleanly closes and stops reconnecting (used by SP mode). Sends state at 20 Hz. Snapshot messages populate `this.remotes` keyed by remote ID.

### `net/RemotePlaneManager.js`
Per-remote `{ mesh, lerp targets, throttle, crashed, type, color, jetExhaust, contrails }`. The mesh lerps toward the network target each frame. For jet remotes, lazily allocates `JetExhaust` + `Contrails` and feeds them a synthetic plane object (`position`, `quaternion`, `throttle`, plus a velocity estimate derived from successive position deltas). Cleaned up on disconnect or plane-type swap.

### `audio/Audio.js`
Web Audio API. Engine voice = sawtooth → lowpass → gain (frequency/cutoff/gain tracked to throttle). Wind voice = pink-ish noise buffer → bandpass → gain (tracked to airspeed). `setTargetAtTime` with `AUDIO_SMOOTHING_TIME` for zipper-free ramps. Started lazily on first user gesture.

### `debug/Profiler.js`
Opt-in via `DEBUG_PROFILER` in `config.js`. Per-frame counters and named timers, with a long-frame tracer that logs the breakdown when a frame exceeds `DEBUG_PROFILER_LONG_FRAME_MS`. Zero runtime cost when disabled.

### `server/index.js` (Node)
Tiny WebSocket relay. On connect: assign an ID + hue, broadcast a welcome. Maintains an in-memory map of last state per client. Every `BROADCAST_INTERVAL_MS`, sends a snapshot of all states to every client. No persistence.

## Key invariants

- **`config.js` is the only place magic numbers live.** Logic files import constants by name.
- **Noise is a pure function of world coordinates.** Chunk index is never an input. Without this, chunk borders seam.
- **One physics tick = `1/60 s` exactly.** `Clock` clamps the absorbed wall delta to `MAX_FRAME_DT` (50 ms) so a paused tab can't accumulate spiral-of-death.
- **`plane.renderPosition` is what you read for visuals**, not `plane.position`. The latter is post-physics; the former is alpha-interpolated for smooth display at 120 fps.
- **Quaternion normalize every step.** Drift is real over long flights.
- **Dispose geometries and materials on chunk unload.** GPU memory leaks otherwise.
- **One shared material per object class** wherever possible. Per-instance materials trigger fresh shader-program compiles on first render.
- **HDR colour values > 2.0 bloom; everything else doesn't.** Bloom threshold is set so accidental self-blooming of lit `MeshStandardMaterial`s can't happen. To make something bloom, give it an emissive color that exceeds 2.0 in linear space.
