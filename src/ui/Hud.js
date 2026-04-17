const MS_TO_KNOTS = 1.944;
const M_TO_FT = 3.281;

export class Hud {
  constructor() {
    this.speedEl = document.getElementById('hud-speed');
    this.altEl = document.getElementById('hud-alt');
    this.thrEl = document.getElementById('hud-thr');
  }

  update(plane) {
    const speed = plane.velocity.length() * MS_TO_KNOTS;
    const alt = plane.position.y * M_TO_FT;
    const thr = Math.round(plane.throttle * 100);
    if (this.speedEl) this.speedEl.textContent = `${Math.round(speed)} kt`;
    if (this.altEl) this.altEl.textContent = `${Math.round(alt)} ft`;
    if (this.thrEl) this.thrEl.textContent = `${thr}%`;
  }
}
