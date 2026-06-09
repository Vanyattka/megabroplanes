import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import alea from 'alea';
import {
  CHUNK_SIZE,
  ROAD_WIDTH,
  ROAD_COLOR,
  ROAD_SAMPLE_STEP,
  ROAD_MAX_VILLAGE_LINK_DISTANCE,
  ROAD_MAX_SLOPE,
  ROAD_RUNWAY_DISTANCE,
  ROAD_Y_OFFSET,
  ROAD_CURVE_CONTROLS,
  ROAD_CURVE_AMPLITUDE,
  VILLAGE_CELL_SIZE,
  RUNWAY_WIDTH,
  RUNWAY_MARGIN,
  WATER_LEVEL,
} from '../config.js';
import { getVillage } from './Villages.js';
import { groundHeight } from './Ground.js';
import { profiler } from '../debug/Profiler.js';

// One MeshStandardMaterial shared across every road mesh in the world —
// the only thing that varies per road is the BufferGeometry ribbon shape.
const SHARED_ROAD_MAT = new MeshStandardMaterial({
  color: ROAD_COLOR,
  roughness: 1.0,
  metalness: 0.0,
  side: DoubleSide,
});

const WATER_CLEARANCE = 1.0; // road centerline must sit this high above water

// Generate a gentle deterministic curve between two village centers by
// jittering interior control points perpendicular to the main axis, then
// fitting a centripetal Catmull-Rom spline. Seeding by endpoint coordinates
// keeps the same pair always producing the same curve across clients.
function buildCurveControlPoints(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < 1) return null;
  const fx = dx / length;
  const fz = dz / length;
  const px = fz;  // perpendicular in XZ
  const pz = -fx;

  const prng = alea(
    `road:${ax.toFixed(1)}:${az.toFixed(1)}:${bx.toFixed(1)}:${bz.toFixed(1)}`
  );

  const n = ROAD_CURVE_CONTROLS;
  const maxOff = length * ROAD_CURVE_AMPLITUDE;
  const pts = [new Vector3(ax, 0, az)];
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    // Bell-shaped amplitude — endpoints wiggle less than the middle so the
    // road actually reaches the airports tangentially.
    const bell = Math.sin(t * Math.PI);
    const off = (prng() * 2 - 1) * maxOff * bell;
    pts.push(
      new Vector3(ax + dx * t + px * off, 0, az + dz * t + pz * off)
    );
  }
  pts.push(new Vector3(bx, 0, bz));
  return { points: pts, length };
}

// Evaluate the curve and validate every sample. Returns the sampled
// centerline + per-sample tangent, or null if the route is unbuildable.
function sampleAndValidate(controlPoints, length) {
  const curve = new CatmullRomCurve3(controlPoints, false, 'centripetal', 0.5);
  const approxLen = curve.getLength();
  const steps = Math.max(2, Math.ceil(approxLen / ROAD_SAMPLE_STEP));
  const samples = curve.getSpacedPoints(steps);

  const centerline = [];
  let prevY = null;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    const y = groundHeight(p.x, p.z);
    if (y < WATER_LEVEL + WATER_CLEARANCE) return null;
    if (prevY !== null) {
      const segLen =
        i > 0
          ? Math.hypot(p.x - samples[i - 1].x, p.z - samples[i - 1].z)
          : ROAD_SAMPLE_STEP;
      if (segLen > 1e-4) {
        const slope = Math.abs(y - prevY) / segLen;
        if (slope > ROAD_MAX_SLOPE) return null;
      }
    }
    prevY = y;
    centerline.push({ x: p.x, z: p.z, y });
  }

  // Tangents via finite differences — used to build the ribbon.
  const tangents = [];
  for (let i = 0; i < centerline.length; i++) {
    const a = i === 0 ? centerline[i] : centerline[i - 1];
    const b =
      i === centerline.length - 1 ? centerline[i] : centerline[i + 1];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    tangents.push({ x: tx / tl, z: tz / tl });
  }
  return { centerline, tangents };
}

function buildRibbonGeometry(centerline, tangents) {
  const n = centerline.length;
  const verts = new Float32Array(n * 2 * 3);
  const indices = new Uint32Array((n - 1) * 6);
  const halfW = ROAD_WIDTH / 2;

  for (let i = 0; i < n; i++) {
    const p = centerline[i];
    const t = tangents[i];
    const rx = t.z;   // perpendicular (right-hand)
    const rz = -t.x;
    const y = p.y + ROAD_Y_OFFSET;
    verts[i * 6 + 0] = p.x + rx * halfW;
    verts[i * 6 + 1] = y;
    verts[i * 6 + 2] = p.z + rz * halfW;
    verts[i * 6 + 3] = p.x - rx * halfW;
    verts[i * 6 + 4] = y;
    verts[i * 6 + 5] = p.z - rz * halfW;
  }
  for (let i = 0; i < n - 1; i++) {
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
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(verts, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  return geom;
}

// Returns { mesh, geometry } or null if this pair can't be connected by a
// road without crossing water or climbing too steep a grade.
function buildRoadMesh(ax, az, bx, bz) {
  const ctl = buildCurveControlPoints(ax, az, bx, bz);
  if (!ctl) return null;
  const s = sampleAndValidate(ctl.points, ctl.length);
  if (!s) return null;
  const geometry = buildRibbonGeometry(s.centerline, s.tangents);
  const mesh = new Mesh(geometry, SHARED_ROAD_MAT);
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return { mesh, geometry, centerline: s.centerline };
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

// A point on the apron BESIDE the runway (on the village side), so roads
// approach the airport without crossing the runway strip itself.
function apronPoint(v) {
  const px = -Math.sin(v.angle);
  const pz = Math.cos(v.angle);
  const off = RUNWAY_WIDTH / 2 + RUNWAY_MARGIN + 8;
  const s = v.sideSign || 1;
  return { x: v.airportX + px * s * off, z: v.airportZ + pz * s * off };
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
    const ocx = Math.floor(v.airportX / CHUNK_SIZE);
    const ocz = Math.floor(v.airportZ / CHUNK_SIZE);
    if (ocx !== cx || ocz !== cz) continue;

    const fromKey = `${gx},${gz}`;

    const ring = Math.ceil(ROAD_MAX_VILLAGE_LINK_DISTANCE / VILLAGE_CELL_SIZE);
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dz = -ring; dz <= ring; dz++) {
        if (dx === 0 && dz === 0) continue;
        const n = getVillage(gx + dx, gz + dz);
        if (!n) continue;
        const toKey = `${gx + dx},${gz + dz}`;
        if (fromKey > toKey) continue;
        const ddx = n.airportX - v.airportX;
        const ddz = n.airportZ - v.airportZ;
        const dist2 = ddx * ddx + ddz * ddz;
        if (dist2 > ROAD_MAX_VILLAGE_LINK_DISTANCE * ROAD_MAX_VILLAGE_LINK_DISTANCE) continue;
        // Connect apron-to-apron so the ribbon runs beside each runway, not
        // across it.
        const ap = apronPoint(v);
        const bp = apronPoint(n);
        out.push({ ax: ap.x, az: ap.z, bx: bp.x, bz: bp.z });
      }
    }

    if (!v.isHome) {
      const dd2 = v.airportX * v.airportX + v.airportZ * v.airportZ;
      if (dd2 < ROAD_RUNWAY_DISTANCE * ROAD_RUNWAY_DISTANCE) {
        // Spur to the home airport's apron (its actual position/orientation),
        // not the runway centerline.
        const home = getVillage(0, 0);
        if (home) {
          const ap = apronPoint(v);
          const hp = apronPoint(home);
          out.push({ ax: ap.x, az: ap.z, bx: hp.x, bz: hp.z });
        }
      }
    }
  }
  return out;
}

// Per-chunk road bucket. We store both the 3D mesh entries and the raw
// centerline points so the minimap can re-draw the exact same curves as
// 3D space, without re-sampling from scratch.
export class Roads {
  constructor(scene) {
    this.scene = scene;
    this.perChunk = new Map(); // "cx,cz" → { meshes: [{mesh, geometry, centerline}] }
  }

  buildForChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (this.perChunk.has(key)) return;
    const _t0 = profiler.timeBegin();
    const specs = roadsOwnedByChunk(cx, cz);
    if (specs.length === 0) {
      this.perChunk.set(key, { meshes: [] });
      profiler.timeEnd('roads', _t0);
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
    profiler.timeEnd('roads', _t0);
  }

  disposeForChunk(cx, cz) {
    const key = `${cx},${cz}`;
    const entry = this.perChunk.get(key);
    if (!entry) return;
    for (const { mesh, geometry } of entry.meshes) {
      this.scene.remove(mesh);
      geometry.dispose();
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

// Re-enumerate road centerlines around a world position without touching
// any 3D meshes. Used by the minimap. A road is only returned if it would
// actually be built (same validation as buildRoadMesh) so straight "ghost"
// lines never appear over water.
export function listRoadSegmentsNear(worldX, worldZ, radius) {
  const cxMin = Math.floor((worldX - radius) / CHUNK_SIZE);
  const cxMax = Math.floor((worldX + radius) / CHUNK_SIZE);
  const czMin = Math.floor((worldZ - radius) / CHUNK_SIZE);
  const czMax = Math.floor((worldZ + radius) / CHUNK_SIZE);
  const out = [];
  const seen = new Set();
  for (let cx = cxMin; cx <= cxMax; cx++) {
    for (let cz = czMin; cz <= czMax; cz++) {
      for (const s of roadsOwnedByChunk(cx, cz)) {
        const key = `${s.ax.toFixed(0)},${s.az.toFixed(0)}->${s.bx.toFixed(0)},${s.bz.toFixed(0)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const ctl = buildCurveControlPoints(s.ax, s.az, s.bx, s.bz);
        if (!ctl) continue;
        const v = sampleAndValidate(ctl.points, ctl.length);
        if (!v) continue; // same rejection as the 3D build
        out.push({ centerline: v.centerline });
      }
    }
  }
  return out;
}
