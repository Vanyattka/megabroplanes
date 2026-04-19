import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import {
  CHUNK_SIZE,
  ROAD_WIDTH,
  ROAD_COLOR,
  ROAD_SAMPLE_STEP,
  ROAD_MAX_VILLAGE_LINK_DISTANCE,
  ROAD_MAX_SLOPE,
  ROAD_RUNWAY_DISTANCE,
  ROAD_Y_OFFSET,
  VILLAGE_CELL_SIZE,
  RUNWAY_LENGTH,
} from '../config.js';
import { getVillage } from './Villages.js';
import { groundHeight } from './Ground.js';
import { biomeAt } from './Biome.js';

// One MeshStandardMaterial shared across every road mesh in the world —
// the only thing that varies per road is the BufferGeometry ribbon shape.
const SHARED_ROAD_MAT = new MeshStandardMaterial({
  color: ROAD_COLOR,
  roughness: 0.95,
  metalness: 0.0,
  side: DoubleSide,
});

// Build a ribbon mesh hugging the terrain from (ax,az) to (bx,bz). Returns
// { mesh, geometry } or null if the path is unbuildable (underwater, too
// steep, or mountain biome in the middle).
function buildRoadMesh(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < ROAD_SAMPLE_STEP) return null;
  const steps = Math.max(2, Math.ceil(length / ROAD_SAMPLE_STEP));

  const fx = dx / length;
  const fz = dz / length;
  // Perpendicular in XZ plane (right-hand: cross(forward, worldUp) = (fz, 0, -fx))
  const rx = fz;
  const rz = -fx;
  const halfW = ROAD_WIDTH / 2;

  const verts = new Float32Array((steps + 1) * 2 * 3);
  const indices = new Uint32Array(steps * 6);

  let prevY = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = ax + dx * t;
    const cz = az + dz * t;
    const y = groundHeight(cx, cz);
    // Reject if the centerline dips below water.
    if (y < -4 /* WATER_LEVEL inline to keep module deps small */) return null;
    // Reject if slope between adjacent samples is too steep.
    if (prevY !== null) {
      const slope = Math.abs(y - prevY) / ROAD_SAMPLE_STEP;
      if (slope > ROAD_MAX_SLOPE) return null;
    }
    prevY = y;

    const yOff = y + ROAD_Y_OFFSET;
    // Left side
    verts[i * 6 + 0] = cx + rx * halfW;
    verts[i * 6 + 1] = yOff;
    verts[i * 6 + 2] = cz + rz * halfW;
    // Right side
    verts[i * 6 + 3] = cx - rx * halfW;
    verts[i * 6 + 4] = yOff;
    verts[i * 6 + 5] = cz - rz * halfW;
  }

  for (let i = 0; i < steps; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = i * 2 + 2;
    const d = i * 2 + 3;
    indices[i * 6 + 0] = a;
    indices[i * 6 + 1] = c;
    indices[i * 6 + 2] = b;
    indices[i * 6 + 3] = b;
    indices[i * 6 + 4] = c;
    indices[i * 6 + 5] = d;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(verts, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const mesh = new Mesh(geometry, SHARED_ROAD_MAT);
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return { mesh, geometry };
}

// Villages.js doesn't expose cell coords for villages (cells are what define
// villages, not vice versa). We iterate the few cells that could touch this
// chunk. Cell size is 1800m, chunk is 128m, so at most 2×2 cells intersect.
function villageCellsForChunk(cx, cz) {
  const minX = cx * CHUNK_SIZE;
  const maxX = (cx + 1) * CHUNK_SIZE;
  const minZ = cz * CHUNK_SIZE;
  const maxZ = (cz + 1) * CHUNK_SIZE;
  const gminX = Math.floor(minX / VILLAGE_CELL_SIZE);
  const gmaxX = Math.floor(maxX / VILLAGE_CELL_SIZE);
  const gminZ = Math.floor(minZ / VILLAGE_CELL_SIZE);
  const gmaxZ = Math.floor(maxZ / VILLAGE_CELL_SIZE);
  const out = [];
  for (let gx = gminX; gx <= gmaxX; gx++) {
    for (let gz = gminZ; gz <= gmaxZ; gz++) {
      out.push([gx, gz]);
    }
  }
  return out;
}

// Roads are "owned" by the chunk containing the from-village's airport. For
// each village whose airport falls inside (cx, cz), emit roads to nearby
// villages (with a canonical ordering to avoid doubling) and optionally a
// spur to the home runway. This keeps the chunk↔road lifetime link simple.
function roadsOwnedByChunk(cx, cz) {
  const out = [];
  const cells = villageCellsForChunk(cx, cz);

  for (const [gx, gz] of cells) {
    const v = getVillage(gx, gz);
    if (!v) continue;
    // Only own the village if its airport center lies in this chunk.
    const ocx = Math.floor(v.airportX / CHUNK_SIZE);
    const ocz = Math.floor(v.airportZ / CHUNK_SIZE);
    if (ocx !== cx || ocz !== cz) continue;

    const fromKey = `${gx},${gz}`;

    // Neighboring villages — iterate a ring so we don't miss any within range
    // even though cells are 1800m and ROAD_MAX_LINK_DISTANCE is 3600m.
    const ring = Math.ceil(ROAD_MAX_VILLAGE_LINK_DISTANCE / VILLAGE_CELL_SIZE);
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dz = -ring; dz <= ring; dz++) {
        if (dx === 0 && dz === 0) continue;
        const n = getVillage(gx + dx, gz + dz);
        if (!n) continue;
        // Canonical ordering: only build this road if from-cell < to-cell
        // lexicographically. Avoids building both A→B and B→A.
        const toKey = `${gx + dx},${gz + dz}`;
        if (fromKey > toKey) continue;
        const ddx = n.airportX - v.airportX;
        const ddz = n.airportZ - v.airportZ;
        const dist2 = ddx * ddx + ddz * ddz;
        if (dist2 > ROAD_MAX_VILLAGE_LINK_DISTANCE * ROAD_MAX_VILLAGE_LINK_DISTANCE) continue;
        out.push({
          ax: v.airportX, az: v.airportZ,
          bx: n.airportX, bz: n.airportZ,
        });
      }
    }

    // Spur to the home runway (0,0). Skip for the home village itself.
    if (!v.isHome) {
      const dd2 =
        v.airportX * v.airportX + v.airportZ * v.airportZ;
      if (dd2 < ROAD_RUNWAY_DISTANCE * ROAD_RUNWAY_DISTANCE) {
        // Pick whichever runway endpoint is closer.
        const ex1 = RUNWAY_LENGTH / 2;
        const ex2 = -RUNWAY_LENGTH / 2;
        const d1 = (v.airportX - ex1) ** 2 + v.airportZ ** 2;
        const d2 = (v.airportX - ex2) ** 2 + v.airportZ ** 2;
        const ex = d1 < d2 ? ex1 : ex2;
        out.push({ ax: v.airportX, az: v.airportZ, bx: ex, bz: 0 });
      }
    }
  }
  return out;
}

// Manages per-chunk road groups. ChunkManager calls buildForChunk on load
// and disposeForChunk on unload.
export class Roads {
  constructor(scene) {
    this.scene = scene;
    this.perChunk = new Map(); // "cx,cz" → { meshes: [{mesh, geometry}] }
  }

  buildForChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (this.perChunk.has(key)) return;
    const specs = roadsOwnedByChunk(cx, cz);
    if (specs.length === 0) {
      this.perChunk.set(key, { meshes: [] });
      return;
    }
    const meshes = [];
    for (const s of specs) {
      const r = buildRoadMesh(s.ax, s.az, s.bx, s.bz);
      if (!r) continue;
      this.scene.add(r.mesh);
      meshes.push(r);
    }
    this.perChunk.set(key, { meshes });
  }

  disposeForChunk(cx, cz) {
    const key = `${cx},${cz}`;
    const entry = this.perChunk.get(key);
    if (!entry) return;
    for (const { mesh, geometry } of entry.meshes) {
      this.scene.remove(mesh);
      geometry.dispose();
      // Material is shared; do not dispose here.
    }
    this.perChunk.delete(key);
  }

  dispose() {
    for (const key of [...this.perChunk.keys()]) {
      const [cx, cz] = key.split(',').map(Number);
      this.disposeForChunk(cx, cz);
    }
    SHARED_ROAD_MAT.dispose();
  }
}
