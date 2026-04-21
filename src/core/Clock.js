import { Clock as ThreeClock } from 'three';
import { FIXED_STEP, MAX_FRAME_DT } from '../config.js';

export class Clock {
  constructor() {
    this.clock = new ThreeClock();
    this.accumulator = 0;
  }

  // Fixed-timestep game loop with render-side interpolation. At render
  // framerates higher than the physics rate (e.g. 120 Hz render with
  // 60 Hz physics), plane.position stays literally constant for 2–3
  // render frames between physics steps, causing a visible "rubber-
  // band" in the chase camera. renderStep receives `alpha = 0..1`, the
  // fraction of a physics step elapsed since the last one — callers
  // (plane in particular) use it to interpolate between prev and current
  // authoritative state for smooth visual motion.
  tick(physicsStep, renderStep) {
    const dt = Math.min(this.clock.getDelta(), MAX_FRAME_DT);
    this.accumulator += dt;
    while (this.accumulator >= FIXED_STEP) {
      physicsStep(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
    const alpha = this.accumulator / FIXED_STEP;
    renderStep(alpha);
  }
}
