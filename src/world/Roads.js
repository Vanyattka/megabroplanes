import {
  BoxGeometry,
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
  ROAD_WIDTH,
  ROAD_COLOR,
  ROAD_SAMPLE_STEP,
  ROAD_MAX_VILLAGE_LINK_DISTANCE,
  ROAD_MAX_SLOPE,
  ROAD_RUNWAY_DISTANCE,
  ROAD_Y_OFFSET,
  ROAD_CURVE_CONTROLS,
  ROAD_CURVE_AMPLITUDE,
  ROAD_VIEW_DISTANCE,
  ROAD_VIEW_HYSTERESIS,
  ROAD_BUILDS_PER_UPDATE,
  BRIDGE_MAX_SPAN,
  BRIDGE_DECK_CLEARANCE,
  BRIDGE_ARCH,
  BRIDGE_PIER_SPACING,
  VILLAGE_CELL_SIZE,
  RUNWAY_WIDTH,
  RUNWAY_MARGIN,
  WATER_LEVEL,
} from '../config.js';
import { getVillage } from './Villages.js';
import { groundHeight } from './Ground.js';
import { profiler } from '../debug/Profiler.js';

// One MeshStandardMaterial shared across every road mesh in the world.
// polygonOffset biases the depth test so the ribbon always wins against the
// coplanar-ish terrain underneath — without it, distant/grazing-angle road
// (and runway) surfaces z-fought with the ground and looked "buried".
const SHARED_ROAD_MAT = new MeshStandardMaterial({
  color: ROAD_COLOR,
  roughness: 1.0,
  metalness: 0.0,
  side: DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

// Shared unit box scaled per bridge pier.
const PIER_GEOM = new BoxGeometry(1, 1, 1);

const WATER_CLEARANCE = 1.0; // ground below WATER_LEVEL + this counts as "wet"

// Generate a gentle deterministic curve between two endpoints by jittering
// interior control points perpendicular to the main axis, then fitting a
// centripetal Catmull-Rom spline. Seeding by endpoint coordinates keeps the
// same pair always producing the same curve across clients.
function buildCurveControlPoints(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < 1) return null;
  const px = dz / length;  // perpendicular in XZ
  const pz = -dx / length;

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

// Evaluate the curve and validate every sample. Short waterway crossings
// (rivers) become BRIDGE spans — the deck runs level between the two banks
// with clearance over the water and a slight arch; longer wet stretches
// (lakes/sea) still reject the route. Returns the sampled centerline +
// per-sample tangent + pier positions, or null if unbuildable.
function sampleAndValidate(controlPoints) {
  const curve = new CatmullRomCurve3(controlPoints, false, 'centripetal', 0.5);
  const approxLen = curve.getLength();
  const steps = Math.max(2, Math.ceil(approxLen / ROAD_SAMPLE_STEP));
  const samples = curve.getSpacedPoints(steps);
  const stepLen = approxLen / steps;
  const n = samples.length;

  const ys = new Array(n);
  const wet = new Array(n);
  for (let i = 0; i < n; i++) {
    const y = groundHeight(samples[i].x, samples[i].z);
    ys[i] = y;
    wet[i] = y < WATER_LEVEL + WATER_CLEARANCE;
  }
  // Endpoints are airport aprons — if one is wet something else is wrong.
  if (wet[0] || wet[n - 1]) return null;

  // Convert each wet run into a bridge deck. The span is EXTENDED a few
  // samples beyond the water on each side so the deck anchors on normal
  // ground past the carved riverbanks — otherwise the steep bank slopes
  // (dry, but plunging to the bed) fail the grade check below and the whole
  // route gets rejected before it ever bridges.
  const EXTEND = 3;
  const isBridge = new Array(n).fill(false);
  const piers = [];
  let i = 0;
  while (i < n) {
    if (!wet[i]) { i++; continue; }
    let j = i;
    while (j < n && wet[j]) j++;
    // Wet run [i, j-1]. Only the WATER portion counts against the span cap.
    if ((j - i + 1) * stepLen > BRIDGE_MAX_SPAN) return null; // lake/sea — no road
    const a = Math.max(1, i - EXTEND);          // first decked sample
    const b = Math.min(n - 1, j + EXTEND);      // first ground sample after the deck
    const y0 = ys[a - 1];
    const y1 = ys[b];
    const deckMin = WATER_LEVEL + BRIDGE_DECK_CLEARANCE;
    for (let k = a; k < b; k++) {
      if (isBridge[k]) continue; // overlapping span already decked
      const t = (k - (a - 1)) / (b - (a - 1));
      const deck =
        Math.max(y0 + (y1 - y0) * t, deckMin) + Math.sin(t * Math.PI) * BRIDGE_ARCH;
      if (wet[k] && (k - i) % BRIDGE_PIER_SPACING === 1) {
        piers.push({ x: samples[k].x, z: samples[k].z, topY: deck, bedY: ys[k] });
      }
      ys[k] = deck;
      isBridge[k] = true;
    }
    i = j;
  }

  // Slope validation on ground sections only — deck grades are controlled by
  // construction, and the bank→deck junction is intentionally a step up.
  for (let s = 1; s < n; s++) {
    if (isBridge[s] || isBridge[s - 1]) continue;
    const segLen =
      Math.hypot(samples[s].x - samples[s - 1].x, samples[s].z - samples[s - 1].z) || stepLen;
    if (Math.abs(ys[s] - ys[s - 1]) / segLen > ROAD_MAX_SLOPE) return null;
  }

  const centerline = [];
  for (let k = 0; k < n; k++) {
    centerline.push({ x: samples[k].x, z: samples[k].z, y: ys[k] });
  }

  // Tangents via finite differences — used to build the ribbon.
  const tangents = [];
  for (let k = 0; k < n; k++) {
    const a = k === 0 ? centerline[k] : centerline[k - 1];
    const b = k === n - 1 ? centerline[k] : centerline[k + 1];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    tangents.push({ x: tx / tl, z: tz / tl });
  }
  return { centerline, tangents, piers };
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

// Returns { mesh, geometry, centerline, pierMeshes } or null if this pair
// can't be connected (open water too wide, or grades too steep).
function buildRoadMesh(ax, az, bx, bz) {
  const ctl = buildCurveControlPoints(ax, az, bx, bz);
  if (!ctl) return null;
  const s = sampleAndValidate(ctl.points);
  if (!s) return null;
  const geometry = buildRibbonGeometry(s.centerline, s.tangents);
  const mesh = new Mesh(geometry, SHARED_ROAD_MAT);
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  const pierMeshes = [];
  for (const p of s.piers) {
    const h = Math.max(1.5, p.topY - p.bedY + 1.5); // extend into the riverbed
    const pier = new Mesh(PIER_GEOM, SHARED_ROAD_MAT);
    pier.scale.set(1.5, h, 1.5);
    pier.position.set(p.x, p.topY - h / 2, p.z);
    pierMeshes.push(pier);
  }
  return { mesh, geometry, centerline: s.centerline, pierMeshes };
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

// Distance from (px,pz) to the segment a→b of a road spec, in XZ.
function distToSpec(px, pz, spec) {
  const dx = spec.bx - spec.ax;
  const dz = spec.bz - spec.az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-6 ? ((px - spec.ax) * dx + (pz - spec.az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = spec.ax + dx * t;
  const qz = spec.az + dz * t;
  return Math.hypot(px - qx, pz - qz);
}

// Enumerate every road spec whose endpoints lie within `radius` of (x, z):
// inter-village links (canonical ordering to avoid doubles) + home spurs.
function enumerateSpecsNear(x, z, radius) {
  const out = new Map(); // canonical key → spec
  const cellR = Math.ceil((radius + ROAD_MAX_VILLAGE_LINK_DISTANCE) / VILLAGE_CELL_SIZE);
  const pcx = Math.floor(x / VILLAGE_CELL_SIZE);
  const pcz = Math.floor(z / VILLAGE_CELL_SIZE);
  const linkRing = Math.ceil(ROAD_MAX_VILLAGE_LINK_DISTANCE / VILLAGE_CELL_SIZE);

  for (let gx = pcx - cellR; gx <= pcx + cellR; gx++) {
    for (let gz = pcz - cellR; gz <= pcz + cellR; gz++) {
      const v = getVillage(gx, gz);
      if (!v) continue;
      const fromKey = `${gx},${gz}`;

      for (let dx = -linkRing; dx <= linkRing; dx++) {
        for (let dz = -linkRing; dz <= linkRing; dz++) {
          if (dx === 0 && dz === 0) continue;
          const n = getVillage(gx + dx, gz + dz);
          if (!n) continue;
          const toKey = `${gx + dx},${gz + dz}`;
          if (fromKey > toKey) continue; // canonical direction
          const ddx = n.airportX - v.airportX;
          const ddz = n.airportZ - v.airportZ;
          if (ddx * ddx + ddz * ddz >
              ROAD_MAX_VILLAGE_LINK_DISTANCE * ROAD_MAX_VILLAGE_LINK_DISTANCE) continue;
          const ap = apronPoint(v);
          const bp = apronPoint(n);
          out.set(`${fromKey}->${toKey}`, { ax: ap.x, az: ap.z, bx: bp.x, bz: bp.z });
        }
      }

      if (!v.isHome) {
        const dd2 = v.airportX * v.airportX + v.airportZ * v.airportZ;
        if (dd2 < ROAD_RUNWAY_DISTANCE * ROAD_RUNWAY_DISTANCE) {
          const home = getVillage(0, 0);
          if (home) {
            const ap = apronPoint(v);
            const hp = apronPoint(home);
            out.set(`home->${fromKey}`, { ax: ap.x, az: ap.z, bx: hp.x, bz: hp.z });
          }
        }
      }
    }
  }
  return out;
}

// The single live Roads instance — listRoadSegmentsNear (minimap) reads its
// already-built centerlines instead of re-sampling terrain every redraw.
let ACTIVE_ROADS = null;

// Roads stream by DISTANCE TO THE PLAYER, decoupled from terrain-chunk
// lifetime. (They used to be owned by the chunk containing the from-village's
// airport — so with several villages close together, a road would vanish the
// moment its faraway owner chunk unloaded, flickering as you flew between
// them.) Build when the route comes within ROAD_VIEW_DISTANCE; dispose past
// view × hysteresis. Failed routes are cached so they aren't re-sampled.
export class Roads {
  constructor(scene) {
    this.scene = scene;
    this.built = new Map(); // canonical key → { spec, rejected } | { spec, mesh, geometry, centerline, pierMeshes }
    this._specs = new Map();
    this._lastCellX = NaN;
    this._lastCellZ = NaN;
    ACTIVE_ROADS = this;
  }

  update(planePos) {
    const cellX = Math.floor(planePos.x / VILLAGE_CELL_SIZE);
    const cellZ = Math.floor(planePos.z / VILLAGE_CELL_SIZE);
    if (cellX !== this._lastCellX || cellZ !== this._lastCellZ) {
      this._lastCellX = cellX;
      this._lastCellZ = cellZ;
      this._specs = enumerateSpecsNear(
        planePos.x, planePos.z, ROAD_VIEW_DISTANCE * ROAD_VIEW_HYSTERESIS
      );
    }

    // Dispose routes that drifted far away (with hysteresis so the boundary
    // doesn't thrash while flying along it).
    const dropBeyond = ROAD_VIEW_DISTANCE * ROAD_VIEW_HYSTERESIS;
    for (const [key, entry] of this.built) {
      if (distToSpec(planePos.x, planePos.z, entry.spec) > dropBeyond) {
        this._disposeEntry(entry);
        this.built.delete(key);
      }
    }

    // Build the nearest few missing routes (sampling terrain is the cost, so
    // cap per frame).
    const candidates = [];
    for (const [key, spec] of this._specs) {
      if (this.built.has(key)) continue;
      const d = distToSpec(planePos.x, planePos.z, spec);
      if (d <= ROAD_VIEW_DISTANCE) candidates.push({ key, spec, d });
    }
    if (candidates.length === 0) return;
    candidates.sort((a, b) => a.d - b.d);
    const _t0 = profiler.timeBegin();
    const limit = Math.min(ROAD_BUILDS_PER_UPDATE, candidates.length);
    for (let i = 0; i < limit; i++) {
      const { key, spec } = candidates[i];
      const r = buildRoadMesh(spec.ax, spec.az, spec.bx, spec.bz);
      if (!r) {
        this.built.set(key, { spec, rejected: true });
        continue;
      }
      this.scene.add(r.mesh);
      for (const p of r.pierMeshes) this.scene.add(p);
      this.built.set(key, { spec, ...r });
    }
    profiler.timeEnd('roads', _t0);
  }

  _disposeEntry(entry) {
    if (entry.rejected) return;
    this.scene.remove(entry.mesh);
    entry.geometry.dispose();
    for (const p of entry.pierMeshes) this.scene.remove(p); // shared geom/mat stay
  }

  dispose() {
    for (const entry of this.built.values()) this._disposeEntry(entry);
    this.built.clear();
    if (ACTIVE_ROADS === this) ACTIVE_ROADS = null;
  }
}

// Road centerlines near a world position, for the minimap. Reads the live
// Roads instance's built routes — no terrain re-sampling per redraw.
export function listRoadSegmentsNear(worldX, worldZ, radius) {
  if (!ACTIVE_ROADS) return [];
  const out = [];
  for (const entry of ACTIVE_ROADS.built.values()) {
    if (entry.rejected) continue;
    if (distToSpec(worldX, worldZ, entry.spec) > radius) continue;
    out.push({ centerline: entry.centerline });
  }
  return out;
}
