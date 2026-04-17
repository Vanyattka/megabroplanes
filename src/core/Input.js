export class Input {
  constructor() {
    this.keys = new Set();
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      // prevent page scroll on space
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  isPressed(code) {
    return this.keys.has(code);
  }

  getAxis(posCode, negCode) {
    const p = this.keys.has(posCode) ? 1 : 0;
    const n = this.keys.has(negCode) ? 1 : 0;
    return p - n;
  }
}
