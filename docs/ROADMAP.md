# Roadmap (historical)

The MVP roadmap below is preserved as a record of how the project was bootstrapped. Phase 1–8 are all complete; the project shipped, then a long tail of post-MVP work landed on top. The shipped post-MVP additions are listed at the bottom.

For where the code is *now*, read `ARCHITECTURE.md`, `WORLD.md`, and `PHYSICS.md` — those reflect the live tree.

## MVP (shipped) — Phases 1–8

These phases were followed in order, each gated on a concrete checkpoint. Lessons learned along the way are captured in the relevant doc.

### Phase 1 — Foundation ✅
Vite project, `Renderer` / `Clock` / `Input` skeleton, spinning cube.

### Phase 2 — Flight physics on a cube ✅
Physics built force-by-force on a debug cube. Tuning came out of `PHYSICS.md` plus a lot of empirical play.

### Phase 3 — Chase camera ✅
Local-frame offset, lerp toward desired position. Later upgraded to dt-aware exponential smoothing + mouse-look on top.

### Phase 4 — Single terrain chunk ✅
`Noise.js` + `Terrain.js` building one chunk with vertex-coloured flat shading.

### Phase 5 — Chunk streaming ✅
`ChunkManager` with `Map<key, Mesh>`, dispose on unload, fog hiding the edge.

### Phase 6 — Runway + ground interaction ✅
Flat-zone in chunk (0,0), `CanvasTexture` on the visual mesh, `physicsFloor` ground sample + rolling friction + onGround state.

### Phase 7 — Plane model ✅
`PlaneMesh.buildPlaneMesh` with primitives. Propeller + control surfaces named for animation.

### Phase 8 — Polish ✅
HUD, fog/colour tuning, end-to-end loop test.

## Post-MVP (shipped)

Ordered roughly by when they landed. Every one of these was originally listed in CLAUDE.md as "do not start without approval" — they shipped after the user asked for them.

### World expansion
- **Three plane types** (Cessna / Piper / Jet) with per-type physics multipliers and silhouettes.
- **Body colour picker.**
- **Realistic terrain** (`TerrainShape.js`, 2026 overhaul) — domain-warped landforms: flat plains, broad uplands/plateaus, and ridged-multifractal mountain ranges. Replaced the old "one noise × biome.amp" model that made everywhere look like the same hills.
- **Climate biomes** — desert / savanna / plains / forest / taiga / tundra / alpine, chosen by elevation × temperature × moisture, with beaches, a climate-dependent snow line, and rock strata on cliffs. Spawn area kept flat so takeoff is over plains.
- **Sea mask** noise layer carving multi-kilometre oceans.
- **Villages** — deterministic per-cell, four size tiers from hamlet to city, khrushchevka apartments in cities.
- **Roads** between nearby villages, deterministically curved, slope/water rejected.
- **Ruins** on high mountain peaks above 95 m.
- **Scatter** — trees + rocks per chunk, biome-and-slope filtered.

### Streaming + perf
- **Worker pool** for `TerrainCompute` so chunk math is off the main thread.
- **Time-budgeted streaming** with adaptive ms ceiling.
- **Shared materials + shared index buffer** to avoid per-chunk shader-program compiles.
- **Profiler** infrastructure (`debug/Profiler.js`) for long-frame tracing.

### Visuals
- **Day/night cycle** with keyframe interpolation, pink sunrises/sunsets, dawn pink → daytime blue → dusk pink → midnight indigo.
- **Atmospheric Preetham sky** on High preset.
- **Moon** — separate additive dome, cool-white disc + halo opposite the sun, gated by night factor.
- **Stars** — `Points`-based starfield fading in at night.
- **Water shader** — multi-octave ripples (slow swell + wind chop + sparkle), Fresnel mix, sun glint, jet engine reflection, landing-light pool, plane-color glint disc.
- **Aerial perspective** on terrain — desaturate + horizon-tint distant fragments.
- **Volumetric god rays + lens flare** post-FX pass driven by sun screen-space position.
- **Bloom + vignette** post-FX, with an **adaptive bloom threshold** that drops toward dawn/dusk so low-sun skies glow more.
- **Cinematic color grade** post-FX (contrast + saturation + filmic toe + subtle warmth) in display space.
- **FXAA** anti-aliasing pass (the scene runs through the composer, so MSAA wouldn't apply).
- **Clouds** — instanced billboards, deterministic per cell, global wind drift.
- **Night lights** — runway lamps + plane nav lights (red/green wingtip + tail strobe) + village windows, all gated by `nightFactor`.
- **Landing light** (SpotLight on the nose, toggled by `L`).
- **Jet engine PointLight** — orange light at the engine, throttle-scaled, lights nearby terrain + paints the water.
- **Jet exhaust particles** — HDR additive plume from the engine nozzle.
- **Contrails** — long-lived white vapor at altitude > 400 m on the Jet.
- **Crash explosion** particles.
- **Plane shadow** under low-altitude flight.

### Camera + UI
- **Mouse look** on the chase camera (drag to look, releases back).
- **Photo mode** (`P`) — orbit camera with mouse + scroll, freezes physics + day/night, hides HUD.
- **Settings menu** with three screens (main / planes / settings), graphics preset (Low / Medium / High), view distance preset (Short → Ultra), time-of-day picker.
- **Touch controls** — joystick + throttle slider for mobile.
- **Minimap.**
- **Audio** — Web Audio engine + wind voices.

### Multiplayer
- **WebSocket relay** server (`server/server.js`).
- **Client** with auto-reconnect and `setEnabled(false)` for clean disconnect.
- **Remote plane manager** — per-remote mesh, lerp targets, jet exhaust + contrails reconstructed from broadcast state.
- **SP / MP mode toggle** on the main menu, persisted in localStorage.
- **Global synchronized time** in MP mode — every client derives `t` from `Date.now()` so the sky stays consistent across all players.
- **Race mode** (2026) — server-authoritative checkpoint races. The server generates a gate course, runs a countdown, validates gate ordering, and tracks live standings + finish times. Client `RaceManager` renders the gate rings + beacon, detects local gate passes, and drives the countdown / race HUD / live leaderboard / results board. Minimap shows the course. Wire additions: `race_start` + `cp` (client→server), `race` (server→client).

### Deploy
- **Production VPS** at `91.186.209.67` running nginx + systemd-managed WS server. The default WS URL in code points at `wss://<host>/ws` for the prod box.

## Working rules (still in force)

1. **Physics first, visuals last.** Adding a new force? Test it on a cube before any visual surgery.
2. **One change at a time.** After each change, fly for 30 s.
3. **Config-driven.** Every tunable lives in `src/config.js`.
4. **No premature optimization.** Worker pool, time-budgeting, shared materials all landed *after* profiling pointed at them — not preemptively.
5. **Test in isolation.** If chunks seam, remove the plane and orbit-camera the world. If physics feels wrong, replace chunks with a flat ground.
6. **MVP scope drift requires approval.** New features land when the user asks — not because they'd be cool.
