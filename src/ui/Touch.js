// Virtual touch controls. Exposes an object with the same-shape state the
// rest of the app can read each frame: joystick axes, throttle value,
// button-down flags. Only activates on touch-capable devices (or when forced
// with ?touch=1 in the URL).

const JOY_RADIUS = 55;      // visual half-extent inside the base
const KNOB_OFFSET_PX = 29;  // matches the CSS half-size of the knob

function isTouchDevice() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('touch') === '1') return true;
  if (params.get('touch') === '0') return false;
  return (
    'ontouchstart' in window ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')
  );
}

export class TouchControls {
  constructor() {
    this.enabled = isTouchDevice();
    this.joyX = 0;                // -1..1  (right = +1)
    this.joyY = 0;                // -1..1  (down-on-stick = +1, i.e. push-forward)
    this.throttle = 0;            // 0..1, null if slider hasn't been touched
    this.throttleActive = false;
    this.yawLeft = false;
    this.yawRight = false;
    this.brake = false;
    this.resetRequested = false;  // consumed by main.js

    if (!this.enabled) return;

    document.body.classList.add('touch');
    const ui = document.getElementById('touch-ui');
    if (ui) ui.classList.remove('hidden');

    this._initJoystick();
    this._initThrottle();
    this._initButtons();
  }

  consumeReset() {
    const r = this.resetRequested;
    this.resetRequested = false;
    return r;
  }

  _initJoystick() {
    const joy = document.getElementById('joy');
    const knob = document.getElementById('joy-knob');
    if (!joy || !knob) return;
    let activePointer = null;

    const setKnob = (dx, dy) => {
      knob.style.left = `calc(50% + ${dx}px)`;
      knob.style.top = `calc(50% + ${dy}px)`;
    };
    const reset = () => {
      this.joyX = 0;
      this.joyY = 0;
      knob.style.left = `50%`;
      knob.style.top = `50%`;
    };
    reset();

    const onDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      activePointer = e.pointerId;
      joy.setPointerCapture(e.pointerId);
      onMove(e);
    };
    const onMove = (e) => {
      if (activePointer !== e.pointerId) return;
      e.preventDefault();
      const rect = joy.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > JOY_RADIUS) {
        dx = (dx / dist) * JOY_RADIUS;
        dy = (dy / dist) * JOY_RADIUS;
      }
      setKnob(dx, dy);
      this.joyX = dx / JOY_RADIUS;
      this.joyY = dy / JOY_RADIUS;
    };
    const onUp = (e) => {
      if (activePointer !== e.pointerId) return;
      activePointer = null;
      try { joy.releasePointerCapture(e.pointerId); } catch {}
      reset();
    };

    joy.addEventListener('pointerdown', onDown);
    joy.addEventListener('pointermove', onMove);
    joy.addEventListener('pointerup', onUp);
    joy.addEventListener('pointercancel', onUp);
  }

  _initThrottle() {
    const throttle = document.getElementById('throttle');
    const fill = document.getElementById('throttle-fill');
    const label = document.getElementById('throttle-value');
    if (!throttle || !fill) return;
    let activePointer = null;

    const setValue = (v) => {
      this.throttle = Math.max(0, Math.min(1, v));
      this.throttleActive = true;
      fill.style.height = `${this.throttle * 100}%`;
      if (label) label.textContent = `${Math.round(this.throttle * 100)}%`;
    };

    const onDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      activePointer = e.pointerId;
      throttle.setPointerCapture(e.pointerId);
      onMove(e);
    };
    const onMove = (e) => {
      if (activePointer !== e.pointerId) return;
      e.preventDefault();
      const rect = throttle.getBoundingClientRect();
      const y = e.clientY - rect.top;
      // invert so dragging up = higher throttle
      const v = 1 - y / rect.height;
      setValue(v);
    };
    const onUp = (e) => {
      if (activePointer !== e.pointerId) return;
      activePointer = null;
      try { throttle.releasePointerCapture(e.pointerId); } catch {}
      // Keep the last throttle value (like a detent slider) — don't snap back.
    };

    throttle.addEventListener('pointerdown', onDown);
    throttle.addEventListener('pointermove', onMove);
    throttle.addEventListener('pointerup', onUp);
    throttle.addEventListener('pointercancel', onUp);
  }

  _bindHoldButton(id, onDown, onUp) {
    const el = document.getElementById(id);
    if (!el) return;
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('down');
      onDown();
    };
    const up = (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('down');
      if (onUp) onUp();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  _initButtons() {
    this._bindHoldButton(
      'btn-yaw-l',
      () => { this.yawLeft = true; },
      () => { this.yawLeft = false; }
    );
    this._bindHoldButton(
      'btn-yaw-r',
      () => { this.yawRight = true; },
      () => { this.yawRight = false; }
    );
    this._bindHoldButton(
      'btn-brake',
      () => { this.brake = true; },
      () => { this.brake = false; }
    );
    this._bindHoldButton(
      'btn-reset',
      () => { this.resetRequested = true; },
      null
    );
  }
}
