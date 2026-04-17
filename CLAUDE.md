# Plane MVP — Slowroads-style flight sim

## What this is

A relaxing browser-based flight experience inspired by [slowroads.io](https://slowroads.io),
but with a plane instead of a car. The player spawns on a runway, can take off,
fly over a procedurally generated world, and land. The target mood is calm,
meditative, "just vibes" — not an action game.

## MVP scope

- One plane, assembled from Three.js primitives (boxes). No external models.
- One runway in a fixed world chunk, guaranteed flat.
- Procedurally generated terrain (chunk-based, simplex noise).
- Arcade flight physics: thrust, lift, drag, gravity. Can take off and land.
- Chase camera with smoothing.
- Simple colored sky + fog to hide the world edge.
- Minimal HUD: speed, altitude, throttle.

## Explicitly NOT in MVP

Landing gear physics, flaps, wind, sound, shadows, volumetric clouds, water,
multiple biomes, crash states, scoring, multiplayer, touch/mobile controls,
loading screens, menus. Do not add these unless asked.

## Tech stack

- **Three.js** (via npm, version pinned in `package.json`)
- **simplex-noise** (npm package) for terrain
- **Vite** for dev server and build
- Vanilla JavaScript, ES modules. No TypeScript for MVP.
- No React, no game engine, no physics engine.

## How to run

```bash
npm install
npm run dev      # starts Vite on localhost
npm run build    # production build to /dist
```

## Key conventions (read these carefully)

### Units

- **1 world unit = 1 meter.**
- Plane is ~10 meters long.
- Chunks are 128×128 meters.
- Gravity is 9.81 m/s².
- Speed displayed in HUD as knots (× 1.944), altitude in feet (× 3.281).

### Axes (Three.js default, right-handed)

- **+X right, +Y up, +Z toward viewer.**
- Plane's nose points toward **-Z** in its local frame.
- When loading any external model, verify orientation and rotate on load if needed.

### Physics timestep

- **Fixed 60 Hz** physics step. Rendering framerate is variable.
- Use an accumulator pattern in the game loop.
- Clamp accumulated delta to max 0.1s to prevent the "spiral of death" after tab blur.

### Code style

- One class/module per file, ES modules.
- All tunable values live in `src/config.js`. Do not put magic numbers in logic files.
- Prefer pure functions in `plane/Physics.js` — easier to reason about.
- No TypeScript for MVP. No build complexity beyond Vite.

## Documentation map

- **`docs/ARCHITECTURE.md`** — file tree, module responsibilities, data flow per frame.
- **`docs/PHYSICS.md`** — full physics model spec: forces, integration, ground interaction, control mapping, starting coefficients.
- **`docs/WORLD.md`** — terrain, chunks, runway, sky, plane-from-primitives model.
- **`docs/ROADMAP.md`** — strict step-by-step implementation order with checkpoints.

## Working rules for this project

1. **Follow the roadmap order.** Do not build the plane model before physics works on a cube. Do not build chunk streaming before a single chunk renders.
2. **One change at a time.** If something breaks, the last change is the bug.
3. **Everything tunable goes in `config.js`.** Never hardcode gameplay values in logic.
4. **Physics is tuned empirically.** Starting values in `docs/PHYSICS.md` are a hint, not a spec. Tune until it feels right.
5. **Do not optimize before Phase 8.** Premature optimization makes debugging harder.
6. **Do not add features not in the MVP scope above** without explicit approval.

## Common pitfalls (detailed in each doc)

- Model axes don't match Three.js convention → rotate on load.
- Seams between chunks from inconsistent noise seeds → noise must be deterministic by world coordinates, never by chunk index.
- Lift coefficients wrong by orders of magnitude → tune empirically, keep in `config.js`.
- Camera far-clip plane smaller than fog-far → chunks pop before fog hides them.
- Forgetting `geometry.dispose()` on unloaded chunks → memory leak on long flights.
- Quaternion drift → normalize every physics step.
