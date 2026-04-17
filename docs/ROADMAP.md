# Implementation roadmap

**Follow this order strictly.** Each phase has a concrete checkpoint — do not proceed until it passes. If something breaks in a later phase, the bug is almost always in whatever changed last.

Rationale: physics and world rendering are independently hard. Getting them tangled together makes both impossible to debug. By staging the work, each phase tests one thing.

## Phase 1 — Foundation

- [ ] **1.1** Initialize project: `npm init`, install `three`, `simplex-noise`, `alea`, `vite`.
- [ ] **1.2** `index.html` with a canvas and a module-type script tag loading `src/main.js`.
- [ ] **1.3** `vite.config.js` with default settings.
- [ ] **1.4** `src/config.js` with all constants from `docs/ARCHITECTURE.md`.
- [ ] **1.5** `core/Renderer.js` creates scene, perspective camera at (0, 5, 15), blue background, one visible cube at origin, hemisphere + directional light. Handles window resize.
- [ ] **1.6** `core/Clock.js` with fixed-timestep accumulator (clamp dt ≤ 0.1).
- [ ] **1.7** `core/Input.js` tracks keyboard, exposes `isPressed`, `getAxis`.
- [ ] **1.8** `main.js` wires them together, runs loop. The cube rotates on each frame to prove the loop runs.

**Checkpoint 1:** Spinning cube on blue background. `npm run dev` opens the page. Pressing W logs `true` to console.

## Phase 2 — Flight physics on a cube

Build physics against a `THREE.Mesh` cube. Do NOT load a plane model until physics is correct.

- [ ] **2.1** Give the cube a state object: `{ position, velocity, quaternion, angularVelocity, throttle, onGround: false }`.
- [ ] **2.2** `plane/Physics.js` — implement ONE force at a time and verify each:
  - [ ] **2.2.a** Thrust only. Holding Shift accelerates the cube forward indefinitely (no drag yet).
  - [ ] **2.2.b** Add drag. Cube reaches terminal speed.
  - [ ] **2.2.c** Add gravity. Cube falls when throttle is 0.
  - [ ] **2.2.d** Add lift. At high forward speed, cube stays level or climbs.
- [ ] **2.3** `plane/Controls.js` — angular velocity from WASD + Q/E with smoothing and damping.
- [ ] **2.4** Test: WASD pitches and rolls smoothly. Banking turns because of roll-to-yaw coupling.
- [ ] **2.5** Tune `config.js` until flight *feels* right. Expect this to take a while — it's the hardest step. Focus on: can you take off by accelerating from rest? Can you level off? Does banking cause a turn?

**Checkpoint 2:** Cube flies like a plane on an infinite flat plane (use a big `PlaneGeometry` at y=0 as ground). Takeoff works. Controls feel natural.

## Phase 3 — Chase camera

- [ ] **3.1** `camera/ChaseCamera.js`. Compute desired camera position as `plane.position + offset` where offset is in the plane's local frame (behind and above).
- [ ] **3.2** `camera.position.lerp(desiredPos, 0.1)` each render frame.
- [ ] **3.3** `camera.lookAt(plane.position)`.

**Checkpoint 3:** Camera smoothly trails the cube. No jitter. Banking looks good from behind.

## Phase 4 — Single terrain chunk

- [ ] **4.1** `world/Noise.js` with seeded simplex, `heightAt(x, z)` returning 2-octave sum.
- [ ] **4.2** `world/Terrain.js` — `buildChunk(0, 0)` returns a mesh with heights applied.
- [ ] **4.3** Vertex colors by height.
- [ ] **4.4** `flatShading: true` for the low-poly look.

**Checkpoint 4:** A single 128×128 terrain chunk at origin, colored by height. Cube flies over it (physics still checks against flat y=0 — that's OK for now).

## Phase 5 — Chunk streaming

- [ ] **5.1** `world/ChunkManager.js` with `update(planePos)`.
- [ ] **5.2** Chunks appear as you fly, disappear when far.
- [ ] **5.3** `geometry.dispose()` and `material.dispose()` on removed chunks.
- [ ] **5.4** Fly around and verify: no seams between chunks, no chunks missing, devtools memory stays stable.
- [ ] **5.5** Add fog matching background. Tune `FOG_NEAR` / `FOG_FAR` to hide chunk boundaries.
- [ ] **5.6** Verify camera `far > FOG_FAR`.

**Checkpoint 5:** Infinite procedural world. Fly in any direction for minutes, memory doesn't grow, no visible seams, fog blends the distance cleanly.

## Phase 6 — Runway & ground interaction

- [ ] **6.1** `world/Runway.js` — `isInRunwayFlatZone`, `isOnRunway`.
- [ ] **6.2** In `Terrain.buildChunk`, flatten vertices inside the flat zone.
- [ ] **6.3** Visual runway mesh with `CanvasTexture`, placed at y=0.02.
- [ ] **6.4** Physics ground check: sample `heightAt(plane.x, plane.z)`, clamp Y, handle onGround state.
- [ ] **6.5** Rolling friction when on ground.
- [ ] **6.6** Spawn cube on runway at start, throttle 0, velocity 0, facing +X.

**Checkpoint 6:** Cube spawns stopped on runway. Throttle up → cube rolls. At ~40 m/s → lifts off. Approach runway level and slow → lands softly. Approach terrain elsewhere fast → "rough landing" logged.

## Phase 7 — Plane model

- [ ] **7.1** `buildPlaneMesh()` returns a Group of BoxGeometries (fuselage, wing, fin, stab, cockpit, prop).
- [ ] **7.2** Replace the debug cube with this group in `Plane.js`.
- [ ] **7.3** Verify orientation: nose points -Z locally, so it flies toward its nose.
- [ ] **7.4** Propeller spins each frame proportional to throttle.

**Checkpoint 7:** A recognizable low-poly plane flies the same way the cube did.

## Phase 8 — Polish

- [ ] **8.1** `ui/Hud.js` — DOM overlay with speed (knots), altitude (feet), throttle (%).
- [ ] **8.2** Tune fog and light colors. Consider warmer tones for "magic hour" feel.
- [ ] **8.3** Slight camera FOV tweaks (70° is a good start).
- [ ] **8.4** Add a second, finer noise octave for ground detail if terrain feels too smooth.
- [ ] **8.5** Test full loop: spawn → takeoff → fly around for 2 min → return → land.

**Checkpoint 8 / Done:** Complete MVP. Ship it.

## Post-MVP ideas (do not start without approval)

- Sound (engine, wind) — Web Audio API.
- Gradient sky shader / sun disc.
- Volumetric clouds (raymarched) — big project.
- Multiple biomes (desert, forest, snow) by blending noise layers.
- Better plane model from Kenney / Poly Pizza.
- Shadows (needs optimization for streaming chunks).
- Water / lakes (shader, reflective).
- Mobile touch controls.
- Replays / screenshot mode.

## Rules

1. **Physics first, visuals last.** Never debug physics through a loaded `.glb`.
2. **One change at a time.** After each change, fly for 30 seconds to verify nothing broke.
3. **Config-driven.** Every tunable number lives in `src/config.js`.
4. **No premature optimization.** `ChunkManager.update` every frame is fine for MVP.
5. **Test in isolation.** If chunks seam, remove the plane and orbit-camera the world. If physics feels wrong, replace chunks with a flat ground.
6. **Stay inside the MVP scope** in `CLAUDE.md`. Do not add features without request.
