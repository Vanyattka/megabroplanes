import { Clock as ThreeClock } from 'three';
import { FIXED_STEP, MAX_FRAME_DT } from '../config.js';

export class Clock {
  constructor() {
    this.clock = new ThreeClock();
    this.accumulator = 0;
  }

  tick(physicsStep, renderStep) {
    const dt = Math.min(this.clock.getDelta(), MAX_FRAME_DT);
    this.accumulator += dt;
    while (this.accumulator >= FIXED_STEP) {
      physicsStep(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
    renderStep();
  }
}
