import { Vector3 } from 'three';
import { biomeAt } from '../world/Biome.js';
import { riverWaterLevelAt } from '../world/TerrainShape.js';
import { terrainHeightAt } from '../world/Ground.js';
import { getVillage } from '../world/Villages.js';
import { t } from './I18n.js';
import { getRuin } from '../world/Ruins.js';
import { listRoadSegmentsNear } from '../world/Roads.js';
import {
  VILLAGE_CELL_SIZE,
  RUIN_CELL_SIZE,
  WATER_LEVEL,
} from '../config.js';

const WORLD_RADIUS = 900;
const GRID = 80;
const UPDATE_INTERVAL = 120; // ms between full refreshes
// World metres per terrain-layer pixel (22.5 m).
const WPP = (WORLD_RADIUS * 2) / GRID;
// Terrain-layer cache (v1.3.x). The old code resampled all GRID² = 6400 map
// pixels through the full terrain height + river + biome functions on EVERY
// refresh (~25 noise evals each) — measured 14 ms on the main thread, 8×/s:
// the single biggest source of frame hitches in the game. The world is
// static, so a map pixel never changes once computed. The layer is now a
// ring buffer of world-anchored pixels: slot = world-pixel index mod CACHE,
// tagged with the index it holds. Each frame only the slots that entered the
// window (a column or row at the edge as the plane moves — ~12 samples/frame
// even for a jet) are recomputed, under a per-frame budget. Sampling is the
// same terrainHeightAt / riverWaterLevelAt / biomeAt as before, at the pixel
// centre, so the picture is identical.
const CACHE = GRID + 2;   // 1-px margin each side: sub-pixel centring + bilinear draw
const FILL_MIN = 24;      // samples/frame at cruise (jet at 200 m/s exposes ~12)
const FILL_MAX = 400;     // after a respawn/teleport the window refills in ~17 frames (~0.9 ms each)

// Biome → base color on the map. Sea mask overrides everything for the
// distinct deeper-blue so big seas read clearly.
const TERRAIN_COLORS = {
  desert:  [196, 178, 120],
  savanna: [168, 158, 86],
  plains:  [112, 146, 72],
  forest:  [56, 100, 50],
  taiga:   [70, 104, 84],
  tundra:  [142, 146, 126],
  alpine:  [150, 144, 138],
};
const SEA_COLOR = [28, 64, 116]; // deep ocean blue
const SEA_SHALLOW_COLOR = [44, 92, 144]; // coastal shallows — reads as shore
const RIVER_COLOR = [62, 118, 170]; // lighter than the sea so channels read as rivers
const BORDER_COLOR = 'rgba(255,255,255,0.55)';

const _fwd = new Vector3();

export class Minimap {
  constructor(mp) {
    this.canvas = document.getElementById('minimap');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.mp = mp;
    this.lastRedraw = -Infinity;

    // Internal buffer for the pixelated terrain layer, always drawn in a
    // north-up world-aligned frame. We rotate it at composite time so the
    // player's triangle is always at the centre pointing straight up.
    this.terrainCanvas = document.createElement('canvas');
    this.terrainCanvas.width = CACHE;
    this.terrainCanvas.height = CACHE;
    this.terrainCtx = this.terrainCanvas.getContext('2d');
    this.terrainImage = this.terrainCtx.createImageData(CACHE, CACHE);
    // Ring buffer of world-anchored pixels + the world-pixel index each slot
    // holds (a mismatch means the slot is stale and must be resampled).
    this.ringRGB = new Uint8ClampedArray(CACHE * CACHE * 3);
    this.ringIx = new Int32Array(CACHE * CACHE).fill(0x7fffffff);
    this.ringIz = new Int32Array(CACHE * CACHE).fill(0x7fffffff);
    this._staleLeft = CACHE * CACHE;
    // Window offsets sorted centre-first so a refill after a teleport grows
    // outward from the player instead of top-down.
    const order = [];
    for (let oz = 0; oz < CACHE; oz++) {
      for (let ox = 0; ox < CACHE; ox++) {
        const dx = ox - CACHE / 2 + 0.5;
        const dz = oz - CACHE / 2 + 0.5;
        order.push({ ox, oz, d: dx * dx + dz * dz });
      }
    }
    order.sort((a, b) => a.d - b.d);
    this.orderX = Int16Array.from(order, (o) => o.ox);
    this.orderZ = Int16Array.from(order, (o) => o.oz);
    // Where the window image lands on the map canvas (set by _redrawTerrain).
    this._imgX = 0;
    this._imgY = 0;
    this._imgSize = 0;
  }

  update(plane) {
    if (!this.canvas) return;
    // Cheap, budgeted, every frame: keep the world-anchored cache filled for
    // the window around the plane.
    this._fillCache(plane);
    const now = performance.now();
    if (now - this.lastRedraw < UPDATE_INTERVAL) return;
    this.lastRedraw = now;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    this._redrawTerrain(plane);

    _fwd.set(0, 0, -1).applyQuaternion(plane.quaternion);
    // Compass yaw: 0 = heading north (world -Z), +π/2 = heading east (+X).
    const yaw = Math.atan2(_fwd.x, -_fwd.z);

    // The whole map is clipped to a circle, so the corners — which can show
    // not-yet-streamed terrain — never appear, and the minimap reads as a
    // round instrument matching the attitude indicator.
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2);
    ctx.clip();

    // Backing tint so any uncovered pixel reads as deep water, not transparent.
    ctx.fillStyle = 'rgba(14, 20, 32, 0.55)';
    ctx.fillRect(0, 0, w, h);

    // Everything inside this save/restore is drawn in the world-aligned
    // frame but rotated so the plane's forward direction becomes canvas-up.
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-yaw);
    ctx.translate(-w / 2, -h / 2);

    ctx.imageSmoothingEnabled = true; // soft biome blend instead of blocky pixels
    ctx.drawImage(this.terrainCanvas, this._imgX, this._imgY, this._imgSize, this._imgSize);

    this._drawRoads(plane);
    this._drawVillages(plane);
    this._drawRuins(plane);
    this._drawRace(plane);
    this._drawBattle(plane);
    this._drawRemotes(plane);

    ctx.restore();

    // Fixed overlays — player marker always pointing up, compass "N" placed
    // at the edge of the map in the true-north direction.
    this._drawPlayerMarker();
    this._drawCompass(yaw);

    ctx.restore(); // end circular clip

    this._drawRing(w, h);
  }

  // Twin-ring frame: a soft dark seat + a crisp light rim, matching the
  // attitude indicator and the glass panels.
  _drawRing(w, h) {
    const ctx = this.ctx;
    const cx = w / 2;
    const cy = h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, w / 2 - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.30)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, w / 2 - 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Colour of one map pixel, sampled at the pixel centre. Decide water/land
  // EXACTLY as the world does, from the real terrain height — NOT a raw
  // sea-mask threshold (that painted ocean over high coastal land where the
  // sea carve didn't reach the waterline). The global water plane covers
  // terrain below WATER_LEVEL; river pools cover it below their (higher)
  // local level.
  _sampleColor(ix, iz) {
    const wx = (ix + 0.5) * WPP;
    const wz = (iz + 0.5) * WPP;
    const g = terrainHeightAt(wx, wz);
    if (g < WATER_LEVEL) {
      return WATER_LEVEL - g > 8 ? SEA_COLOR : SEA_SHALLOW_COLOR;
    }
    const rw = riverWaterLevelAt(wx, wz);
    if (rw != null && g < rw) return RIVER_COLOR;
    return TERRAIN_COLORS[biomeAt(wx, wz).type] || [85, 85, 85];
  }

  // Resample the stale slots of the window around the plane, centre-first,
  // under a per-frame budget. At cruise a slot goes stale only when the
  // window slides one world pixel (22.5 m) — a single column or row.
  _fillCache(plane) {
    const px = plane.position.x;
    const pz = plane.position.z;
    if (!Number.isFinite(px) || !Number.isFinite(pz)) return;
    const x0 = Math.floor(px / WPP) - CACHE / 2;
    const z0 = Math.floor(pz / WPP) - CACHE / 2;
    const budget = this._staleLeft > CACHE ? FILL_MAX : FILL_MIN;
    const { ringRGB, ringIx, ringIz, orderX, orderZ } = this;
    let stale = 0;
    let done = 0;
    for (let k = 0; k < orderX.length; k++) {
      const ix = x0 + orderX[k];
      const iz = z0 + orderZ[k];
      const sx = ((ix % CACHE) + CACHE) % CACHE;
      const sz = ((iz % CACHE) + CACHE) % CACHE;
      const slot = sz * CACHE + sx;
      if (ringIx[slot] === ix && ringIz[slot] === iz) continue;
      stale++;
      if (done >= budget) continue;
      const c = this._sampleColor(ix, iz);
      ringRGB[slot * 3] = c[0];
      ringRGB[slot * 3 + 1] = c[1];
      ringRGB[slot * 3 + 2] = c[2];
      ringIx[slot] = ix;
      ringIz[slot] = iz;
      done++;
    }
    this._staleLeft = stale - done;
  }

  // Assemble the window image from the ring (slots still stale after a
  // teleport are left transparent so the backing tint shows, not old world)
  // and work out where it lands on the canvas so the plane sits exactly at
  // the centre despite the window being snapped to world-pixel boundaries.
  _redrawTerrain(plane) {
    const data = this.terrainImage.data;
    const { ringRGB, ringIx, ringIz } = this;
    const px = plane.position.x;
    const pz = plane.position.z;
    const x0 = Math.floor(px / WPP) - CACHE / 2;
    const z0 = Math.floor(pz / WPP) - CACHE / 2;
    for (let oz = 0; oz < CACHE; oz++) {
      const iz = z0 + oz;
      const sz = ((iz % CACHE) + CACHE) % CACHE;
      for (let ox = 0; ox < CACHE; ox++) {
        const ix = x0 + ox;
        const sx = ((ix % CACHE) + CACHE) % CACHE;
        const slot = sz * CACHE + sx;
        const i = (oz * CACHE + ox) * 4;
        if (ringIx[slot] === ix && ringIz[slot] === iz) {
          data[i] = ringRGB[slot * 3];
          data[i + 1] = ringRGB[slot * 3 + 1];
          data[i + 2] = ringRGB[slot * 3 + 2];
          data[i + 3] = 255;
        } else {
          data[i + 3] = 0;
        }
      }
    }
    this.terrainCtx.putImageData(this.terrainImage, 0, 0);
    // Canvas pixels per world pixel; the plane's offset from the window's
    // top-left corner in world pixels is in [CACHE/2, CACHE/2 + 1).
    const s = this.canvas.width / GRID;
    this._imgSize = CACHE * s;
    this._imgX = this.canvas.width / 2 - (px / WPP - x0) * s;
    this._imgY = this.canvas.height / 2 - (pz / WPP - z0) * s;
  }

  _worldToCanvas(wx, wz, plane) {
    const w = this.canvas.width;
    const wpp = (WORLD_RADIUS * 2) / w;
    return {
      x: w / 2 + (wx - plane.position.x) / wpp,
      y: w / 2 + (wz - plane.position.z) / wpp,
    };
  }

  _inside(pos, pad = 2) {
    return (
      pos.x >= pad &&
      pos.x <= this.canvas.width - pad &&
      pos.y >= pad &&
      pos.y <= this.canvas.height - pad
    );
  }

  _drawRoads(plane) {
    const ctx = this.ctx;
    const segs = listRoadSegmentsNear(
      plane.position.x,
      plane.position.z,
      WORLD_RADIUS + 120
    );
    ctx.strokeStyle = 'rgba(240, 220, 180, 0.82)';
    ctx.lineWidth = 1.3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const s of segs) {
      if (!s.centerline || s.centerline.length < 2) continue;
      ctx.beginPath();
      const first = this._worldToCanvas(s.centerline[0].x, s.centerline[0].z, plane);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < s.centerline.length; i++) {
        const p = this._worldToCanvas(s.centerline[i].x, s.centerline[i].z, plane);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }

  _drawVillages(plane) {
    const ctx = this.ctx;
    const pcx = Math.floor(plane.position.x / VILLAGE_CELL_SIZE);
    const pcz = Math.floor(plane.position.z / VILLAGE_CELL_SIZE);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const v = getVillage(pcx + dx, pcz + dz);
        if (!v) continue;
        const pos = this._worldToCanvas(v.airportX, v.airportZ, plane);
        if (!this._inside(pos)) continue;

        // Runway strip — a short dark rectangle, rotated to match the
        // airport's heading. Since we're inside the rotated-by-yaw frame,
        // the airport angle still maps correctly to world orientation.
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(v.angle);
        ctx.fillStyle = '#2a2a2a';
        const rlen = v.sizeName === 'city' ? 14 : 9;
        ctx.fillRect(-rlen / 2, -1.5, rlen, 3);
        ctx.restore();

        const s =
          v.sizeName === 'city' ? 8 :
          v.sizeName === 'large' ? 5 :
          v.sizeName === 'medium' ? 4 : 3;
        ctx.fillStyle = v.sizeName === 'city' ? '#ffc040' : '#ffe090';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.fillRect(pos.x - s / 2, pos.y - s / 2, s, s);
        if (v.sizeName === 'city') {
          ctx.strokeRect(
            pos.x - s / 2 - 0.5,
            pos.y - s / 2 - 0.5,
            s + 1,
            s + 1
          );
        }
      }
    }
  }

  _drawRuins(plane) {
    const ctx = this.ctx;
    const pcx = Math.floor(plane.position.x / RUIN_CELL_SIZE);
    const pcz = Math.floor(plane.position.z / RUIN_CELL_SIZE);
    ctx.strokeStyle = '#d5d5d5';
    ctx.lineWidth = 1.3;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const r = getRuin(pcx + dx, pcz + dz);
        if (!r) continue;
        const pos = this._worldToCanvas(r.x, r.z, plane);
        if (!this._inside(pos)) continue;
        ctx.beginPath();
        ctx.moveTo(pos.x - 3, pos.y - 3);
        ctx.lineTo(pos.x + 3, pos.y + 3);
        ctx.moveTo(pos.x + 3, pos.y - 3);
        ctx.lineTo(pos.x - 3, pos.y + 3);
        ctx.stroke();
      }
    }
  }

  // Race checkpoints — small rings, the one you're chasing highlighted gold,
  // with a line linking the gates in order so the course reads at a glance.
  _drawRace(plane) {
    const r = this.mp && this.mp.race;
    if (!r || !r.course || !r.course.length) return;
    if (r.phase !== 'countdown' && r.phase !== 'racing') return;
    const ctx = this.ctx;
    const course = r.course;
    // Prefer the local cursor (advances instantly on a pass) so the minimap's
    // "next gate" highlight stays in lockstep with the in-world ring + HUD;
    // fall back to the server-authoritative count when not the participant.
    let nextCp = 0;
    if (this.raceManager && this.raceManager.inRace) {
      nextCp = this.raceManager.localCp;
    } else if (r.standings && this.mp.id != null) {
      const row = r.standings.find((s) => s.id === this.mp.id);
      if (row) nextCp = row.n;
    }
    // Linking line through the gates.
    ctx.strokeStyle = 'rgba(255, 210, 58, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < course.length; i++) {
      const p = this._worldToCanvas(course[i].x, course[i].z, plane);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    for (let i = 0; i < course.length; i++) {
      const p = this._worldToCanvas(course[i].x, course[i].z, plane);
      if (!this._inside(p)) continue;
      const isNext = i === nextCp;
      const done = i < nextCp;
      ctx.beginPath();
      ctx.arc(p.x, p.y, isNext ? 4 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = done ? 'rgba(57,255,138,0.9)' : isNext ? '#ffd23a' : 'rgba(57,198,255,0.9)';
      ctx.fill();
      if (isNext) { ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); }
    }
  }

  // Battle mode: the shrinking arena as a circle (red while you're outside it)
  // plus the mystery pickups as gold diamonds. Zone radius comes live from
  // BattleManager's wall mesh scale so the map and the world always agree.
  _drawBattle(plane) {
    const bm = this.battleManager;
    const r = this.mp && this.mp.race;
    if (!bm || !bm.inBattle || !r || r.mode !== 'battle' || !r.zone) return;
    if (r.phase !== 'countdown' && r.phase !== 'racing') return;
    const ctx = this.ctx;
    const wpp = (WORLD_RADIUS * 2) / this.canvas.width;
    const c = this._worldToCanvas(r.zone.x, r.zone.z, plane);
    const zr = (bm._wall ? bm._wall.scale.x : r.zone.r0) / wpp;
    ctx.beginPath();
    ctx.arc(c.x, c.y, zr, 0, Math.PI * 2);
    ctx.strokeStyle = bm._outside ? 'rgba(255,80,64,0.95)' : 'rgba(57,198,255,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    for (const p of r.pickups || []) {
      const pos = this._worldToCanvas(p.x, p.z, plane);
      if (!this._inside(pos)) continue;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffd23a';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.fillRect(-3, -3, 6, 6);
      ctx.strokeRect(-3, -3, 6, 6);
      ctx.restore();
    }
    // Deployed AA sites — red triangles, so pilots know which ground to avoid.
    for (const tr of r.turrets || []) {
      const pos = this._worldToCanvas(tr.x, tr.z, plane);
      if (!this._inside(pos)) continue;
      ctx.fillStyle = '#ff5040';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y - 4);
      ctx.lineTo(pos.x + 4, pos.y + 3.5);
      ctx.lineTo(pos.x - 4, pos.y + 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  _drawRemotes(plane) {
    if (!this.mp) return;
    const ctx = this.ctx;
    for (const [, r] of this.mp.remotes) {
      if (!r.pos) continue;
      const pos = this._worldToCanvas(r.pos[0], r.pos[2], plane);
      if (!this._inside(pos)) continue;
      ctx.fillStyle = `hsl(${r.hue * 360}, 70%, 58%)`;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  _drawPlayerMarker() {
    const ctx = this.ctx;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    // With the map rotated by -yaw, the player always looks canvas-up. No
    // per-frame rotation on the triangle itself.
    ctx.fillStyle = '#fff2a0';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx + 5, cy + 5);
    ctx.lineTo(cx - 5, cy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  _drawCompass(yaw) {
    const ctx = this.ctx;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const r = Math.min(this.canvas.width, this.canvas.height) / 2 - 14;
    // After ctx.rotate(-yaw) the displayed world-north vector (-Z, straight up
    // in the unrotated map) sits at (-sin(yaw), -cos(yaw)) on the canvas — so
    // when heading east the "N" badge correctly lands on the LEFT. Place the
    // badge at that edge point so it always points at true north.
    const nx = cx - Math.sin(yaw) * r;
    const ny = cy - Math.cos(yaw) * r;
    ctx.fillStyle = 'rgba(200, 40, 40, 0.9)';
    ctx.beginPath();
    ctx.arc(nx, ny, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('compass.n'), nx, ny);
  }
}
