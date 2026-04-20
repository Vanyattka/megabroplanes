import { Vector3 } from 'three';
import { biomeAt } from '../world/Biome.js';
import { seaMaskAt } from '../world/SeaMask.js';
import { getVillage } from '../world/Villages.js';
import { getRuin } from '../world/Ruins.js';
import { listRoadSegmentsNear } from '../world/Roads.js';
import {
  VILLAGE_CELL_SIZE,
  RUIN_CELL_SIZE,
  SEA_THRESHOLD_LOW,
  SEA_THRESHOLD_HIGH,
} from '../config.js';

const WORLD_RADIUS = 900;
const GRID = 80;
const UPDATE_INTERVAL = 120; // ms between full refreshes

// Biome → base color on the map. Sea mask overrides lake for the distinct
// deeper-blue colour so big seas read differently from little ponds.
const TERRAIN_COLORS = {
  lake: [58, 111, 160],
  forest: [45, 85, 45],
  hills: [106, 160, 80],
  mountain: [138, 112, 96],
};
const SEA_COLOR = [28, 64, 116]; // deeper blue than lake biome
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
    this.terrainCanvas.width = GRID;
    this.terrainCanvas.height = GRID;
    this.terrainCtx = this.terrainCanvas.getContext('2d');
    this.terrainImage = this.terrainCtx.createImageData(GRID, GRID);
  }

  update(plane) {
    if (!this.canvas) return;
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

    // Everything inside this save/restore is drawn in the world-aligned
    // frame but rotated so the plane's forward direction becomes canvas-up.
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-yaw);
    ctx.translate(-w / 2, -h / 2);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrainCanvas, 0, 0, w, h);

    this._drawRoads(plane);
    this._drawVillages(plane);
    this._drawRuins(plane);
    this._drawRemotes(plane);

    ctx.restore();

    // Fixed overlays — player marker always pointing up, compass "N" placed
    // at the edge of the map in the true-north direction.
    this._drawPlayerMarker();
    this._drawCompass(yaw);

    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  }

  _redrawTerrain(plane) {
    const data = this.terrainImage.data;
    const wpp = (WORLD_RADIUS * 2) / GRID;
    const seaMid = (SEA_THRESHOLD_LOW + SEA_THRESHOLD_HIGH) * 0.5;
    for (let py = 0; py < GRID; py++) {
      const wz = plane.position.z + (py - GRID / 2) * wpp;
      for (let px = 0; px < GRID; px++) {
        const wx = plane.position.x + (px - GRID / 2) * wpp;
        let c;
        if (seaMaskAt(wx, wz) > seaMid) {
          c = SEA_COLOR;
        } else {
          const b = biomeAt(wx, wz);
          c = TERRAIN_COLORS[b.type] || [85, 85, 85];
        }
        const i = (py * GRID + px) * 4;
        data[i] = c[0];
        data[i + 1] = c[1];
        data[i + 2] = c[2];
        data[i + 3] = 255;
      }
    }
    this.terrainCtx.putImageData(this.terrainImage, 0, 0);
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
    ctx.strokeStyle = 'rgba(240, 230, 200, 0.78)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const s of segs) {
      const a = this._worldToCanvas(s.ax, s.az, plane);
      const b = this._worldToCanvas(s.bx, s.bz, plane);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
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
    // After ctx.rotate(-yaw) the displayed world-north vector sits at
    // (sin(yaw), -cos(yaw)) on the canvas. Place the "N" badge at that edge
    // point so the compass always points at true north regardless of
    // heading.
    const nx = cx + Math.sin(yaw) * r;
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
    ctx.fillText('N', nx, ny);
  }
}
