import { Vector3 } from 'three';

const MS_TO_KNOTS = 1.944;
const M_TO_FT = 3.281;
const PIX_PER_RAD = 190;

const _forward = new Vector3();
const _right = new Vector3();
const _up = new Vector3();

export class Hud {
  constructor() {
    this.speedEl = document.getElementById('hud-speed');
    this.altEl = document.getElementById('hud-alt');
    this.thrEl = document.getElementById('hud-thr');
    this.canvas = document.getElementById('horizon');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
  }

  update(plane) {
    const speed = plane.velocity.length() * MS_TO_KNOTS;
    const alt = plane.position.y * M_TO_FT;
    const thr = Math.round(plane.throttle * 100);
    if (this.speedEl) this.speedEl.textContent = `${Math.round(speed)} kt`;
    if (this.altEl) this.altEl.textContent = `${Math.round(alt)} ft`;
    if (this.thrEl) this.thrEl.textContent = `${thr}%`;

    if (this.ctx) this.drawHorizon(plane);
  }

  drawHorizon(plane) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    _forward.set(0, 0, -1).applyQuaternion(plane.quaternion);
    _right.set(1, 0, 0).applyQuaternion(plane.quaternion);
    _up.set(0, 1, 0).applyQuaternion(plane.quaternion);

    const pitch = Math.asin(Math.max(-1, Math.min(1, _forward.y)));
    const roll = Math.atan2(-_right.y, _up.y);

    const cx = w / 2;
    const cy = h / 2;

    // Circular clip so the horizon reads as an instrument.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 110, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(20, 30, 50, 0.55)';
    ctx.fill();
    ctx.clip();

    // Sky and ground halves, rotated/translated by plane attitude.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-roll);
    ctx.translate(0, pitch * PIX_PER_RAD);

    ctx.fillStyle = 'rgba(90, 150, 210, 0.9)';
    ctx.fillRect(-300, -400, 600, 400);
    ctx.fillStyle = 'rgba(90, 70, 40, 0.9)';
    ctx.fillRect(-300, 0, 600, 400);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-140, 0);
    ctx.lineTo(140, 0);
    ctx.stroke();

    // Pitch ladder
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const deg of [-30, -20, -10, 10, 20, 30]) {
      const y = -deg * (Math.PI / 180) * PIX_PER_RAD;
      const halfW = deg % 20 === 0 ? 36 : 22;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-halfW, y);
      ctx.lineTo(halfW, y);
      ctx.stroke();
      ctx.fillText(`${Math.abs(deg)}`, -halfW - 12, y);
      ctx.fillText(`${Math.abs(deg)}`, halfW + 12, y);
    }

    ctx.restore();

    // Fixed aircraft reference
    ctx.strokeStyle = '#ffcc33';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 44, cy);
    ctx.lineTo(cx - 14, cy);
    ctx.moveTo(cx - 14, cy);
    ctx.lineTo(cx - 6, cy + 8);
    ctx.moveTo(cx + 6, cy + 8);
    ctx.lineTo(cx + 14, cy);
    ctx.moveTo(cx + 14, cy);
    ctx.lineTo(cx + 44, cy);
    ctx.stroke();
    ctx.fillStyle = '#ffcc33';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Instrument ring
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 110, 0, Math.PI * 2);
    ctx.stroke();
  }
}
