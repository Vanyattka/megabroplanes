# World generation

What the world is made of, and how it streams. The MVP-era examples in this file have been replaced — actual implementation is what's described below.

## Layered noise

Three independent simplex-noise fields are seeded with distinct strings (`alea(...)`) so they don't correlate:

1. **Terrain height** — `Noise.js`. 2–3 octaves summed, scaled by the local biome's `amp` and offset by the local biome's `offset`. Pure function of world coordinates.
2. **Biome mask** — `Biome.js`. Single low-frequency simplex over `BIOME_SCALE` (≈ 1700 m features). Maps to one of five named biomes via weighted overlap.
3. **Sea mask** — `SeaMask.js`. Even lower frequency over `SEA_SCALE` (≈ 6000 m features). Where the mask is high, terrain is pushed down by up to `SEA_DEPTH` (45 m).

Together these decide the height at any `(x, z)`:
```
biome = biomeAt(x, z)
height = (terrainNoise(x, z) * biome.amp) + biome.offset - seaDepth(x, z)
```

The biome blend is *weighted*, not categorical — five biomes contribute proportionally to their nearness in noise-space, so transitions are smooth rather than stair-stepped.

### Biomes

In `Biome.js`, the bands are placed across the noise distribution:

| Type | Centre | Amp | Offset | Tree density | Rock density |
|---|---|---|---|---|---|
| `lake` | 0.02 | 0.35 | -12 | 0.0 | 0.2 |
| `forest` | 0.32 | 0.55 | 14 | 2.8 | 0.4 |
| `hills` | 0.62 | 1.00 | 16 | 1.0 | 1.0 |
| `mountain` | 0.92 | 2.00 | 22 | 0.3 | 2.5 |
| `highmountain` | 1.04 | 3.40 | 55 | 0.05 | 4.0 |

`highmountain` sits at the extreme of the noise distribution — rare, very tall, snow-capped. `BANDWIDTH = 0.22` controls the smoothing kernel between bands.

## Chunks

- `CHUNK_SIZE = 128` m
- `CHUNK_RESOLUTION = 33` vertices per side (32 quads)
- View distance preset (Short / Medium / High / Extra High / Ultra) controls the radius dynamically.

A chunk `(cx, cz)` covers `[cx·128, (cx+1)·128] × [cz·128, (cz+1)·128]` and is centred at `((cx+0.5)·128, *, (cz+0.5)·128)`.

### Build pipeline

`world/TerrainCompute.js` does the heavy work and is the only thing that needs to run inside a worker:
1. For each vertex, compute biome + sea + height.
2. Apply runway and village flatten zones (vertices inside a flat region are clamped to that region's height with smoothstep edges).
3. Build positions, normals, and per-vertex colours via `colorByHeight(y, slope, biome)` with multi-tier rules: sand → grass → dark grass → alpine stone → packed snow → summit snow, with slope-based rock override above `SLOPE_ROCK_THRESHOLD`.

`world/Terrain.js` wraps the resulting `ArrayBuffer`s in a `BufferGeometry` + a single shared `MeshStandardMaterial`. **Sharing the material is critical** — without it every new chunk triggered a 40–80 ms shader-program compile stall the first time it appeared. The shared index buffer is also cached.

### Aerial perspective injection

`Terrain.js` patches the shared material's fragment shader via `onBeforeCompile`:
```glsl
float aerial = smoothstep(uAerialNear, uAerialFar, length(vViewPosition));
float lum = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
vec3 desat = mix(gl_FragColor.rgb, vec3(lum), aerial * uAerialDesat);
gl_FragColor.rgb = mix(desat, uAerialColor, aerial * uAerialStrength);
```

Distant fragments are desaturated *and* tinted toward the horizon colour — a Rayleigh-haze approximation. `DayNight.update()` writes the current `worldTime.horizonColor` into `uAerialColor` each frame, so distant mountains pick up dawn pink, daytime pale blue, sunset orange, and night indigo automatically.

`AERIAL_NEAR = 250 m`, `AERIAL_FAR = 1800 m`, `AERIAL_STRENGTH = 0.55`, `AERIAL_DESATURATION = 0.65`.

### Streaming

`ChunkManager.update(planePos, viewDistanceChunks, fogFar)` runs once per render frame:

1. Walk the `(2·VD+1)²` grid around the plane's chunk. Sort missing entries by squared distance.
2. Push the closest pending chunks to the worker pool, capped by `MAX_IN_FLIGHT`.
3. Drain the pool's result queue into actual meshes, capped by `MAX_TERRAIN_INSTALLS_PER_FRAME`.
4. Adaptive build budget: starts at `CHUNK_BUILD_BUDGET_MS` (4 ms) and ramps to `CHUNK_BUILD_BUDGET_MAX_MS` (10 ms) when the backlog grows. So big jumps in view distance fill quickly, while normal flight stays smooth.
5. Unload chunks beyond view radius — `geometry.dispose()` (the index buffer is shared and not disposed), drop the entry from the map, also call `roads.disposeForChunk(cx, cz)` to release per-chunk roads.

`primeAll(planePos, radius)` does a synchronous fill of an inner ring before the first frame so the runway and immediate surroundings exist by frame 1.

## Runway / home airport

The home airport is hunted out of the origin cell at startup: `Runway.js` samples a grid of candidate strip orientations and picks the flattest 600×30 m rectangle. That rectangle's flat-zone coordinates feed back into `TerrainCompute` so terrain inside it is forced to the runway height.

```js
const halfL = RUNWAY_LENGTH / 2 + RUNWAY_MARGIN;   // 300 + 20
const halfW = RUNWAY_WIDTH  / 2 + RUNWAY_MARGIN;   // 15 + 20
isInRunwayFlatZone(localX, localZ) = |localX| ≤ halfL && |localZ| ≤ halfW
```

The flat zone smooths to natural terrain over `RUNWAY_BLEND` (300 m) — a long ramp so there's no cliff at the runway ends.

The visual runway mesh is a thin `PlaneGeometry` with a `CanvasTexture` painted at module load (asphalt, centre dashes, threshold zebras) and lifted to `RUNWAY_Y` (0.02 m) above terrain to avoid Z-fight.

## Villages

`VillageData.js` deterministically places at most one village per `VILLAGE_CELL_SIZE` × `VILLAGE_CELL_SIZE` cell (1800 m). Per cell:

1. Hash `(cx, cz)` with `alea` to a chance vs `VILLAGE_CHANCE` (0.75).
2. Pick a size tier — `small / medium / large / city` — with `VILLAGE_SIZE_WEIGHTS` (cities are rare).
3. Reject if the chosen centre lies in a sea (`seaMaskAt ≥ SEA_THRESHOLD_LOW`) or sits on the home runway flat zone.
4. Compute the rectangular flat zone (from `halfL × halfW` of the size tier).

`Villages.js` lays out 1–2 streets parallel along the rectangle's long axis and slots houses on either side at `VILLAGE_HOUSE_SPACING`. `tallChance` and `apartmentChance` (per-tier) decide whether a slot becomes a 2-storey variant or a 4-floor khrushchevka.

`VillageManager.js` builds meshes lazily, gated on `chunkReady(cx, cz)` so houses don't pop in mid-air over un-loaded terrain. It honours `VILLAGE_BUILD_BUDGET_MS` per frame.

`VillageMeshes.js` shares one material per piece type (4 house variants, khrushchevka, chimney, door, window, terminal, hangar, tower accent) and one window-emissive material that brightens at night.

## Ruins

`Ruins.js` places stone wall / arch / tower silhouettes on mountain peaks where `groundHeight > RUIN_MIN_HEIGHT` (32 m). Per-cell pattern matches villages but with `RUIN_CELL_SIZE` (2400 m) and `RUIN_CHANCE` (0.55). `RuinsManager.js` builds them with the same per-chunk budget gate.

## Roads

`world/Roads.js` builds ribbon meshes between nearby village airports. Ownership is per chunk: a road is emitted by the chunk containing its from-village's airport, and only if `fromCellKey ≤ toCellKey` to dedupe A↔B pairs. Pathing samples the centerline at `ROAD_SAMPLE_STEP` (14 m) and rejects:
- any sample below `WATER_LEVEL` (no underwater roads);
- any pair of samples whose slope exceeds `ROAD_MAX_SLOPE` (no impossible mountain climbs).

Surviving paths are extruded into a triangle-strip ribbon of `ROAD_WIDTH` (8 m), offset `ROAD_Y_OFFSET` (0.22 m) above terrain. Centerline is *deterministically curved*: `ROAD_CURVE_CONTROLS` interior control points each offset perpendicularly by up to `ROAD_CURVE_AMPLITUDE` of the path length, so roads bend gently instead of pixel-straight. Villages within `ROAD_RUNWAY_DISTANCE` (3 km) of the home airport also get a spur.

## Trees + rocks

`world/Scatter.js` per chunk:
1. Sample `TREES_PER_CHUNK` (160) random positions inside the chunk.
2. Multiply by `biomeAt(p).trees` to get an acceptance probability — 2.8 in pure forest, ~0 in lakes / mountain peaks, drops to 0 over sea.
3. Reject on slope > `TREE_MAX_SLOPE` and on water below `WATER_LEVEL`.
4. Same flow for rocks with `ROCKS_PER_CHUNK` and `biome.rocks`.

Trees are randomized between several variants; everything is built into a few `InstancedMesh`es. Per-chunk lifetimes match terrain: built when the chunk lands, disposed on unload.

## Sky and lighting

### Two domes

`Sky.js` owns:
- A **gradient sky dome** (`ShaderMaterial`, `BackSide`) that mixes `uHorizon → uZenith` and adds a three-layer sun (wide glow, halo, HDR disc).
- A **moon dome** (separate mesh, additive blending, always visible). Disc + halo at `-uSunDir`, gated by `uNightFactor`. Renders correctly under both gradient and Preetham sky modes.

`AtmosphericSky.js` (Preetham) wraps Three's `objects/Sky.js`. Used on **High** preset in place of the gradient dome. Tuned low (`turbidity = 1.0, rayleigh = 0.35`) and clamped to ≤ 1.9 in fragment so it can't whiteout via bloom.

### Day/night cycle

`DayNight.js` interpolates a list of keyframes (`DAY_NIGHT_KEYFRAMES` in `config.js`) over `DAY_LENGTH_SECONDS` (600 s by default — 10 min). Each frame writes:

1. `worldTime.{skyColor, horizonColor, fogColor, sunColor, sunIntensity, ambientColor, ambientIntensity, starsOpacity, sunDir, nightFactor}` (read by water, clouds, stars, post-FX).
2. The gradient sky shader uniforms.
3. The moon dome's `uMoonDir` (= `-sunDir`) and `uNightFactor`.
4. Scene fog colour.
5. The `DirectionalLight` colour + intensity (sun) and `AmbientLight`.
6. `updateAerialPerspective(horizonColor)` — the terrain shader's haze tint.
7. `updateLights()` — runway lamps + plane nav lights.

Keyframes cover: midnight → pre-dawn violet → twilight magenta → sunrise pink → post-sunrise warm → noon cool blue → golden hour → pre-sunset → sunset hot pink → after-sunset → civil twilight → midnight.

`paused` mode lets external code drive `t` directly (used by photo mode for freeze, and multiplayer for wall-clock-derived global time).

### Time presets

`TIME_PRESETS` in `config.js`: `auto, sunrise (t=0.24), morning (0.36), day (0.5), sunset (0.76), night (0.0)`. The menu picker writes one of these via `dayNight.setFrozenTime(t)` or `dayNight.setAuto()`. In multiplayer mode this picker is greyed out and the time is force-derived from `Date.now()` so all clients see the same sky.

### Stars

`Stars.js` is a single `Points` mesh on a fixed-radius dome around the camera, with material opacity = `worldTime.starsOpacity`.

### Night lights

`NightLights.js` exposes shared HDR materials for runway edge lamps, plane nav lights (red/green wingtip + tail strobe), and village windows. `updateLights()` scales each emissive by `worldTime.nightFactor`. The plane's landing light (SpotLight) is owned by `Plane.js` and toggled by `L`.

## Water

`world/Water.js` is a single 6 km × 6 km `PlaneGeometry` at `y = WATER_LEVEL` (-4 m) that follows `plane.renderPosition` horizontally each frame.

The fragment shader does:
- **Multi-octave ripple normal**: slow swell + mid-frequency wind chop drifting against it + high-frequency surface sparkle. Each layer has its own wind vector. World-locked (uses `vWorldPos.xz` as the ripple coordinate, not local mesh UV) so ripples don't slide as the mesh follows the plane.
- **Fresnel** mix between deep water tones (`WATER_COLOR_DEEP`) and shallow tones (`WATER_COLOR_SHALLOW`), darkened by `uDayFactor` so night water is black-blue.
- **Sky reflection**, tinted by horizon colour at grazing view, by zenith colour when looking straight down.
- **Sun glint** Blinn-Phong specular — golden sunset path, HDR so it blooms.
- **Jet engine reflection** — orange smear under low-flying jets (driven by `_jetLight.intensity`).
- **Landing light pool** — wide soft Blinn-Phong centred on where the SpotLight cone meets water (cone-axis ↔ y=WATER_LEVEL intersection computed in `main.js`).
- **Plane body-color glint disc** — fades in from 300 m altitude down to 30 m, tinted to the plane's chosen body colour. A stand-in for true planar reflection (which would require a mirrored render pass).

`Water.update(dt, planePos, worldTint, extras)` takes an optional `extras = { jet, landing, plane }` bundle. Each sub-uniform self-disables when its intensity is 0, and the shader has explicit early-outs.

The 6 km size is deliberately bigger than `2 × fog_far` at the largest view-distance preset (Ultra, fog_far ≈ 2 km) so the water edge always lives inside full fog.

## Clouds

`Clouds.js`: one `InstancedMesh` of `PlaneGeometry` quads, billboarded each frame to face the camera. Cloud texture is generated once at module load (canvas 2D: overlapping radial gradients + dither).

Position deterministically per `CLOUD_CELL_SIZE` cell via `alea('cloud-cell:cx:cz')`. A global wind offset (`CLOUD_DRIFT_DIR × CLOUD_DRIFT_SPEED × elapsed`) shifts everything uniformly — the world flows but the *pattern* is constant per cell. Cells outside `CLOUD_VIEW_RADIUS` aren't spawned. Pool capped at `CLOUD_MAX_INSTANCES`.

Cloud material is tinted with `worldTime.horizonColor` so they pick up dusk colours for free.

## Plane model

Every plane is built from `BoxGeometry` parts in `plane/PlaneMesh.js`. Three silhouettes share the same code with different proportions and accessories: `cessna`, `piper`, `jet`. Common parts: fuselage, wing, fin, stab, cockpit, propeller (for piston types), control surfaces (named so animation code finds them), nav-light spheres (red/green wingtip + tail strobe), landing-light anchor, and on the jet — engine block + nozzle + (no propeller).

Plane mesh is rebuilt on `setLoadout(type, color)` calls — not pooled. Cheap because all parts are `BoxGeometry`.

The propeller spins each frame proportional to `throttle` × 30 rad/s. Control surfaces (elevator, rudder, ailerons) animate from `plane.controlInputs` so they visibly track WASD inputs.

## Crash effects

`effects/Explosion.js` — instanced cube particles with HDR fire colour, gravity + drag. Triggered in `main.js` when `plane.crashed && plane.crashImpact`.

## Pitfalls

- **Chunk seam on borders** = `heightAt` differs at shared vertices. Verify noise depends purely on world coords and identical biome/sea blends are produced for the same `(x, z)` regardless of which chunk asks.
- **Camera far < fog far** = chunks pop before fog hides them. Camera far is sized for the largest view-distance preset.
- **Fog colour mismatch** = visible "edge of world" line. Both the scene background and `Fog.color` are written from the same keyframe in `DayNight.update`.
- **Forgetting to dispose** geometry/material on chunk removal = memory leak. `ChunkManager.dropChunk()` does both, plus `roads.disposeForChunk()`.
- **Per-chunk material allocation** = a 40–80 ms shader compile stall on every new chunk. Always share materials. The same applies to villages, ruins, scatter, roads.
- **Z-fighting** between runway / road meshes and terrain. Lift to `RUNWAY_Y` / `ROAD_Y_OFFSET`.
- **Plane mesh axes.** Nose points local `-Z`. If you replace the primitives with an external model, rotate on load to match.
- **Water mesh edge visible** = `WATER_SIZE` is smaller than `2 × fog_far`. Currently 6 km, which exceeds Ultra's fog_far (≈ 2 km) by a comfortable margin.
- **Effect particles with stale `plane.velocity`.** Photo mode pauses physics but velocity isn't zeroed; `JetExhaust` and `Contrails` updates are skipped while `photoMode` is on so frozen particles stay in place.
