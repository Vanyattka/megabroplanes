export class Input {
  constructor() {
    this.keys = new Set();
    this.mouseDown = false;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.mouseDown) {
        this.mouseDeltaX += e.movementX || 0;
        this.mouseDeltaY += e.movementY || 0;
      }
    });
    // prevent context menu eating right-click if we ever add it
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isPressed(code) {
    return this.keys.has(code);
  }

  getAxis(posCode, negCode) {
    const p = this.keys.has(posCode) ? 1 : 0;
    const n = this.keys.has(negCode) ? 1 : 0;
    return p - n;
  }

  // Consume accumulated mouse delta since last call
  consumeMouseDelta() {
    const dx = this.mouseDeltaX;
    const dy = this.mouseDeltaY;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return { dx, dy };
  }
}
