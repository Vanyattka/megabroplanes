import { Vector3 } from 'three';
import { biomeAt } from '../world/Biome.js';
import { getVillage } from '../world/Villages.js';
import { getRuin } from '../world/Ruins.js';
import { VILLAGE_CELL_SIZE, RUIN_CELL_SIZE } from '../config.js';

const WORLD_RADIUS = 900;    // meters covered from center to edge
const GRID = 80;              // internal resolution (80×80 = 6400 biome samples)
const UPDATE_INTERVAL = 120;  // ms between repaints — 8 fps is fine for a map

const TERRAIN_COLORS = {
  lake: [58, 111, 160],
  forest: [45, 85, 45],
  hills: [106, 160, 80],
  mountain: [138, 112, 96],
};
const BORDER_COLOR = 'rgba(255,255,255,0.55)';

const _fwd = new Vector3();

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class Minimap {
  constructor(mp) {
    this.canvas = document.getElementById('minimap');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.mp = mp;
    this.lastRedraw = -Infinity;

    // Internal buffer for the pixelated terrain layer.
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

    this._redrawTerrain(plane);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrainCanvas, 0, 0, w, h);

    this._drawVillages(plane);
    this._drawRuins(plane);
    this._drawRemotes(plane);
    this._drawPlayer(plane);

    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  }

  _redrawTerrain(plane) {
    const data = this.terrainImage.data;
    const wpp = (WORLD_RADIUS * 2) / GRID;
    for (let py = 0; py < GRID; py++) {
      const wz = plane.position.z + (py - GRID / 2) * wpp;
      for (let px = 0; px < GRID; px++) {
        const wx = plane.position.x + (px - GRID / 2) * wpp;
        const b = biomeAt(wx, wz);
        const c = TERRAIN_COLORS[b.type] || [85, 85, 85];
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

  _inside(pos) {
    return (
      pos.x >= 2 &&
      pos.x <= this.canvas.width - 2 &&
      pos.y >= 2 &&
      pos.y <= this.canvas.height - 2
    );
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
        // Runway strip: a short rectangle rotated to the airport angle.
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(v.angle);
        ctx.fillStyle = '#2a2a2a';
        const rlen = v.sizeName === 'city' ? 14 : 9;
        ctx.fillRect(-rlen / 2, -1.5, rlen, 3);
        ctx.restore();
        // Settlement marker on top.
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

  _drawPlayer(plane) {
    const ctx = this.ctx;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    _fwd.set(0, 0, -1).applyQuaternion(plane.quaternion);
    // Canvas up is world -Z, canvas right is world +X. A triangle drawn
    // pointing canvas-up rotates to plane's world heading.
    const angle = Math.atan2(_fwd.x, -_fwd.z);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = '#fff2a0';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
