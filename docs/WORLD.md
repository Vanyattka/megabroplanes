# World generation

Covers: terrain, chunks, runway, sky, lighting, and the plane model (primitives).

## Terrain

### Noise

Use the `simplex-noise` npm package (v4+, which uses explicit seed API).
One global instance, seeded deterministically.

```js
import { createNoise2D } from 'simplex-noise';
import alea from 'alea';

const prng = alea('plane-mvp-seed');
const noise2D = createNoise2D(prng);

export function heightAt(worldX, worldZ) {
  const s = NOISE_SCALE;   // e.g. 0.005 → features ~200m across
  let h = 0;
  h += noise2D(worldX * s,       worldZ * s)       * HEIGHT_AMPLITUDE;
  h += noise2D(worldX * s * 2,   worldZ * s * 2)   * HEIGHT_AMPLITUDE * 0.5;
  h += noise2D(worldX * s * 4,   worldZ * s * 4)   * HEIGHT_AMPLITUDE * 0.25;
  return h;
}
```

**Invariant:** `heightAt` is a pure function of world coordinates. It must never depend on chunk index, load order, or time. This is what makes chunk edges seamless.

### Chunks

- `CHUNK_SIZE = 128` meters.
- `CHUNK_RESOLUTION = 33` vertices per side (→ 32 quads per side). Odd number so a vertex sits exactly at chunk center if ever needed.
- `VIEW_DISTANCE_CHUNKS = 4` → a 9×9 grid of active chunks (~1152m radius of visible world).

Chunk `(cx, cz)` occupies the world region `[cx·128, (cx+1)·128] × [cz·128, (cz+1)·128]`.

### Chunk mesh construction

```js
function buildChunk(cx, cz) {
  const geo = new PlaneGeometry(
    CHUNK_SIZE, CHUNK_SIZE,
    CHUNK_RESOLUTION - 1, CHUNK_RESOLUTION - 1
  );
  geo.rotateX(-Math.PI / 2);   // make it horizontal (XZ plane)

  const positions = geo.attributes.position;
  const colors = new Float32Array(positions.count * 3);

  for (let i = 0; i < positions.count; i++) {
    const localX = positions.getX(i);
    const localZ = positions.getZ(i);
    const worldX = cx * CHUNK_SIZE + localX + CHUNK_SIZE / 2;
    const worldZ = cz * CHUNK_SIZE + localZ + CHUNK_SIZE / 2;

    let y = heightAt(worldX, worldZ);

    // flatten runway region
    if (cx === RUNWAY_CHUNK.cx && cz === RUNWAY_CHUNK.cz
        && isInRunwayFlatZone(worldX, worldZ)) {
      y = 0;
    }

    positions.setY(i, y);

    // color by height + slope (after computing normals — see below)
    const [r, g, b] = colorForVertex(y /* , slope later */);
    colors[i*3] = r; colors[i*3 + 1] = g; colors[i*3 + 2] = b;
  }

  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
  });

  const mesh = new Mesh(geo, mat);
  mesh.position.set(
    cx * CHUNK_SIZE + CHUNK_SIZE / 2,
    0,
    cz * CHUNK_SIZE + CHUNK_SIZE / 2
  );
  return mesh;
}
```

### Coloring (no textures)

Pick vertex colors by height thresholds. Tune to taste:

```js
function colorForVertex(y) {
  if (y < 1)        return [0.85, 0.80, 0.60];   // sand
  if (y < 10)       return [0.35, 0.55, 0.25];   // grass
  if (y < 25)       return [0.45, 0.50, 0.35];   // darker grass
  if (y < 40)       return [0.50, 0.45, 0.40];   // rock
  return              [0.95, 0.95, 0.95];        // snow
}
```

For a prettier result, also factor in slope (steeper → rock). But MVP: height only.

### Chunk manager

```js
class ChunkManager {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();   // "cx,cz" → Mesh
  }

  update(planePos) {
    const pcx = Math.floor(planePos.x / CHUNK_SIZE);
    const pcz = Math.floor(planePos.z / CHUNK_SIZE);
    const needed = new Set();

    for (let dx = -VIEW_DISTANCE_CHUNKS; dx <= VIEW_DISTANCE_CHUNKS; dx++) {
      for (let dz = -VIEW_DISTANCE_CHUNKS; dz <= VIEW_DISTANCE_CHUNKS; dz++) {
        const key = `${pcx + dx},${pcz + dz}`;
        needed.add(key);
        if (!this.chunks.has(key)) {
          const mesh = buildChunk(pcx + dx, pcz + dz);
          this.chunks.set(key, mesh);
          this.scene.add(mesh);
        }
      }
    }

    for (const [key, mesh] of this.chunks) {
      if (!needed.has(key)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        this.chunks.delete(key);
      }
    }
  }
}
```

Call `update` each physics step (or every 10 frames, it's cheap-ish).

## Runway

Located in chunk `(0, 0)`, centered at world origin.

- Length: `RUNWAY_LENGTH = 600` m along the **X axis** (plane takes off heading +X).
- Width: `RUNWAY_WIDTH = 30` m along the Z axis.
- Margin: flatten an extra 20m around the runway (avoids cliffs at edges).

```js
function isInRunwayFlatZone(x, z) {
  const halfL = RUNWAY_LENGTH / 2 + 20;
  const halfW = RUNWAY_WIDTH / 2 + 20;
  return Math.abs(x) <= halfL && Math.abs(z) <= halfW;
}

function isOnRunway(x, z) {
  const halfL = RUNWAY_LENGTH / 2;
  const halfW = RUNWAY_WIDTH / 2;
  return Math.abs(x) <= halfL && Math.abs(z) <= halfW;
}
```

### Visual runway mesh

A separate thin plane on top of the terrain at y=0.01 so it doesn't z-fight.

### Runway texture (procedural)

Drawn once via `CanvasTexture`:

```js
function makeRunwayTexture() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 128;
  const ctx = c.getContext('2d');

  // asphalt
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, c.width, c.height);

  // center dashed line
  ctx.fillStyle = '#eeeeee';
  for (let x = 60; x < c.width - 60; x += 120) {
    ctx.fillRect(x, 60, 60, 8);
  }

  // threshold markings at both ends (zebra stripes)
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(20 + i * 14, 20, 8, 88);
    ctx.fillRect(c.width - 28 - i * 14, 20, 8, 88);
  }

  const tex = new CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}
```

### Plane spawn pose

- Position: `(-RUNWAY_LENGTH / 2 + 50, PLANE_BOTTOM_OFFSET, 0)` — 50m from the start of the runway.
- Orientation: identity quaternion rotated so the nose (-Z) faces +X down the runway. That's a +90° rotation around world Y: `Quaternion.setFromAxisAngle((0,1,0), Math.PI/2)`.
- Throttle: 0.
- Velocity: zero.

## Sky and lighting

### Background + fog

```js
scene.background = new Color(FOG_COLOR);
scene.fog = new Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
```

Fog color **must exactly match** background color. Otherwise the chunk edge becomes visible as a color discontinuity.

Set `FOG_FAR ≈ 0.8 * (VIEW_DISTANCE_CHUNKS * CHUNK_SIZE)`. With 4 chunks view distance (512m), use `FOG_FAR = 420`, `FOG_NEAR = 150`.

Camera `far` must be `> FOG_FAR` (set to e.g. `FOG_FAR * 1.5`) so chunks don't pop before fog hides them.

### Lighting

```js
const hemi = new HemisphereLight(0xffffff, 0x334422, 0.6);
scene.add(hemi);

const sun = new DirectionalLight(0xfff4e0, 0.8);
sun.position.set(100, 200, 50);
scene.add(sun);
```

No shadow maps for MVP — they're expensive and tricky with streaming chunks.

### Later polish (post-MVP)

- Gradient sky shader (two colors, interpolated by view-up Y).
- Sun disc billboard.
- Time-of-day by rotating `sun` around.

## Plane model (from primitives)

Do not use any external `.glb` file for MVP. Build the plane from `BoxGeometry`:

```js
function buildPlaneMesh() {
  const group = new Group();
  const white = new MeshStandardMaterial({ color: 0xeeeeee, flatShading: true });
  const dark  = new MeshStandardMaterial({ color: 0x333333, flatShading: true });
  const red   = new MeshStandardMaterial({ color: 0xcc3333, flatShading: true });

  // Fuselage — length along Z (nose toward -Z)
  const fuselage = new Mesh(new BoxGeometry(1, 1, 8), white);
  group.add(fuselage);

  // Main wing — spans X
  const wing = new Mesh(new BoxGeometry(12, 0.15, 1.6), white);
  wing.position.set(0, 0.2, 0);
  group.add(wing);

  // Horizontal stabilizer (rear)
  const stab = new Mesh(new BoxGeometry(3.5, 0.15, 0.9), white);
  stab.position.set(0, 0.1, 3.5);
  group.add(stab);

  // Vertical fin
  const fin = new Mesh(new BoxGeometry(0.15, 1.2, 1.1), red);
  fin.position.set(0, 0.6, 3.5);
  group.add(fin);

  // Cockpit (dark block on top)
  const cockpit = new Mesh(new BoxGeometry(0.8, 0.5, 1.5), dark);
  cockpit.position.set(0, 0.6, -0.5);
  group.add(cockpit);

  // Propeller (spun visually in Plane.update)
  const prop = new Mesh(new BoxGeometry(2.5, 0.1, 0.1), dark);
  prop.position.set(0, 0, -4.1);
  prop.name = 'propeller';
  group.add(prop);

  return group;
}
```

In `Plane.update(dt)`:
```js
const prop = this.mesh.getObjectByName('propeller');
prop.rotation.z += this.throttle * 30 * dt;   // visual only
```

## Water (added)

A single large `PlaneGeometry` at `y = WATER_LEVEL` follows the camera/player
horizontally each frame — no chunking. Material is a `ShaderMaterial` with
analytic sine-wave ripples (fragment-only, no displacement), a Fresnel term
that blends `WATER_COLOR_SHALLOW` → `WATER_COLOR_DEEP`, and a sky-color
reflection term driven by the current horizon color from `worldTime`. The
plane is `WATER_SIZE` square (defaults to `2 × VIEW_DISTANCE_CHUNKS × CHUNK_SIZE × 1.8`)
so its edges stay inside fog. Tunables: `WATER_LEVEL`, `WATER_SIZE`,
`WATER_COLOR_SHALLOW`, `WATER_COLOR_DEEP`, `WATER_NORMAL_SCROLL_SPEED`,
`WATER_OPACITY`. See `src/world/Water.js`.

## Clouds (added)

`src/world/Clouds.js` exports a `Clouds` class backed by a single
`InstancedMesh` of camera-facing quads. The cloud texture is generated at
module load (canvas 2D: overlapping radial gradients + noise dither). Cloud
positions are seeded per `CLOUD_CELL_SIZE` cell via `alea('cloud-cell:cx:cz')`
with `CLOUD_MIN_PER_CELL`..`CLOUD_MAX_PER_CELL` clouds per cell, so flying
back shows the same scatter pattern. A global wind vector
(`CLOUD_DRIFT_DIR × CLOUD_DRIFT_SPEED × elapsed`) offsets all clouds uniformly
each frame — the spawn is still deterministic, only the drift is temporal.
Clouds outside `CLOUD_VIEW_RADIUS` are excluded. Billboarding is done on the
CPU each frame by composing matrices with the camera's rotation quaternion
(shared by every instance). Pool size `CLOUD_MAX_INSTANCES`.

## Day / night cycle (added)

`src/world/DayNight.js` drives a `timeOfDay ∈ [0, 1]` advancing at
`1 / DAY_LENGTH_SECONDS × DAY_TIME_MULT`. Each frame it locates the surrounding
pair in `DAY_NIGHT_KEYFRAMES` and linearly interpolates sky / horizon / fog
colors, sun/ambient color + intensity, and `starsOpacity`. The sun orbits
around world +X so it rises in +Z, crests at +Y (noon), sets in -Z, and
re-appears after midnight. Outputs are written to three places:

1. The shared `worldTime` singleton (`src/world/WorldTime.js`) — read by
   Water / Clouds / Stars for tint.
2. `sky.material.uniforms.*` — the sky shader's horizon/zenith/sun uniforms.
3. The `Sky`-owned `DirectionalLight` (sun) and `AmbientLight` + `scene.fog`.

`Sky.js` now exposes `sun` and `ambient` as public fields and no longer owns
a `HemisphereLight` — `DayNight` replaces that with an `AmbientLight` whose
color it can drive directly. A simple `PointsMaterial`-based starfield in
`src/world/Stars.js` fades in at night via `starsOpacity`.

## Roads (added)

`src/world/Roads.js` builds thin ribbon meshes connecting neighboring village
airports. Ownership is per chunk: a road is emitted by the chunk containing
its from-village airport, and only if `fromCellKey ≤ toCellKey` to avoid
double-building. `ChunkManager` calls `roads.buildForChunk(cx, cz)` on chunk
load and `roads.disposeForChunk(cx, cz)` on unload. Pathing is simple: sample
the center line at `ROAD_SAMPLE_STEP`-meter intervals, reject the candidate if
any point is underwater (`y < WATER_LEVEL`) or if the slope between adjacent
samples exceeds `ROAD_MAX_SLOPE`. Surviving candidates are extruded into a
triangle-strip ribbon of width `ROAD_WIDTH`, offset `+ROAD_Y_OFFSET` above
the terrain to avoid z-fight. Villages within `ROAD_RUNWAY_DISTANCE` of (0,0)
also get a spur to the nearest home-runway endpoint. All roads share a
single `MeshStandardMaterial`.

## Pitfalls

- **Chunk seam on borders** means `heightAt` is not identical at shared vertices → check that noise depends purely on world coords.
- **Far clip plane too small** causes visible popping. Set camera `far > FOG_FAR`.
- **Fog color mismatch** is the most common "edge of world visible" bug. Both background and fog must use the same hex exactly.
- **Forgetting to dispose** geometry and material on chunk removal causes a slow memory leak. Open Chrome devtools memory tab during a long flight to verify.
- **Runway cliff.** If you flatten only the runway rectangle without margin, there will be a sharp drop-off beside the runway surface. The flat zone must be larger than the runway mesh.
- **Z-fighting** between runway mesh and terrain. Offset runway to `y = 0.02` (not 0).
- **Plane model axes.** If you later replace primitives with a `.glb`, verify nose direction matches the -Z convention or rotate on load.
