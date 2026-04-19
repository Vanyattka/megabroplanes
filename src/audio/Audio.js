import {
  AUDIO_MASTER_VOLUME,
  ENGINE_MIN_PITCH,
  ENGINE_MAX_PITCH,
  ENGINE_MIN_GAIN,
  ENGINE_MAX_GAIN,
  ENGINE_FILTER_MIN_HZ,
  ENGINE_FILTER_MAX_HZ,
  WIND_MIN_GAIN,
  WIND_MAX_GAIN,
  WIND_MIN_FILTER_HZ,
  WIND_MAX_FILTER_HZ,
  WIND_REF_SPEED,
  AUDIO_SMOOTHING_TIME,
} from '../config.js';

// Fill an AudioBuffer with white-ish noise. Used as the source of the wind
// layer — we filter it heavily to get a bandpass pink/wind character.
function makeNoiseBuffer(ctx, seconds = 2) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  // Quick-and-dirty pink-ish noise via running average — less harsh than pure
  // white noise once bandpassed. Not exact pink, but good enough for wind.
  let last = 0;
  for (let i = 0; i < length; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + w * 0.1) * 0.98 + w * 0.02;
    data[i] = last;
  }
  return buffer;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Thin Web Audio wrapper producing two procedural layers driven by plane
// state:
//   engine — sawtooth oscillator + lowpass; pitch / gain ∝ throttle
//   wind   — pink-ish noise buffer + bandpass; gain / cutoff ∝ airspeed
// `start()` must be called from a user gesture (click/keypress/touch) or
// Chrome/Safari will leave the AudioContext suspended.
export class Audio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this._muted = false;

    // Audio graph nodes — created in start(), disposed in dispose().
    this._master = null;
    this._engineOsc = null;
    this._engineFilter = null;
    this._engineGain = null;
    this._windSource = null;
    this._windFilter = null;
    this._windGain = null;
  }

  // Must be called from a user gesture. Safe to call multiple times — idempotent.
  start() {
    if (this.started) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();

    // If the context was created already-suspended (autoplay policy), resume.
    if (this.ctx.state === 'suspended') {
      // Fire-and-forget — resume returns a Promise.
      this.ctx.resume().catch(() => {});
    }

    // Master gain lets us mute + set overall volume.
    this._master = this.ctx.createGain();
    this._master.gain.value = this._muted ? 0 : AUDIO_MASTER_VOLUME;
    this._master.connect(this.ctx.destination);

    // --- Engine: triangle → steep lowpass → per-layer gain → master.
    // Triangle has far fewer high harmonics than sawtooth, and the low
    // cutoff (set in update()) keeps the sound a soft rumble rather than a
    // drill bit through the ear canal.
    this._engineOsc = this.ctx.createOscillator();
    this._engineOsc.type = 'triangle';
    this._engineOsc.frequency.value = ENGINE_MIN_PITCH;

    this._engineFilter = this.ctx.createBiquadFilter();
    this._engineFilter.type = 'lowpass';
    this._engineFilter.frequency.value = ENGINE_FILTER_MIN_HZ;
    this._engineFilter.Q.value = 0.4;

    this._engineGain = this.ctx.createGain();
    this._engineGain.gain.value = 0;

    this._engineOsc.connect(this._engineFilter);
    this._engineFilter.connect(this._engineGain);
    this._engineGain.connect(this._master);
    this._engineOsc.start();

    // --- Wind: noise buffer → bandpass → per-layer gain → master
    this._windSource = this.ctx.createBufferSource();
    this._windSource.buffer = makeNoiseBuffer(this.ctx, 2);
    this._windSource.loop = true;

    this._windFilter = this.ctx.createBiquadFilter();
    this._windFilter.type = 'bandpass';
    this._windFilter.frequency.value = WIND_MIN_FILTER_HZ;
    this._windFilter.Q.value = 0.7;

    this._windGain = this.ctx.createGain();
    this._windGain.gain.value = 0;

    this._windSource.connect(this._windFilter);
    this._windFilter.connect(this._windGain);
    this._windGain.connect(this._master);
    this._windSource.start();

    this.started = true;
  }

  // Ramp engine pitch/gain and wind gain/filter toward new targets.
  // Called every render frame with the latest plane state.
  update(dt, state) {
    if (!this.started || !this.ctx) return;
    const throttle = clamp(state?.throttle ?? 0, 0, 1);
    const airspeed = state?.airspeed ?? 0;
    const windT = clamp(airspeed / WIND_REF_SPEED, 0, 1);

    const now = this.ctx.currentTime;
    const k = AUDIO_SMOOTHING_TIME;

    const enginePitch = ENGINE_MIN_PITCH + (ENGINE_MAX_PITCH - ENGINE_MIN_PITCH) * throttle;
    const engineGain = ENGINE_MIN_GAIN + (ENGINE_MAX_GAIN - ENGINE_MIN_GAIN) * throttle;
    const engineCutoff = ENGINE_FILTER_MIN_HZ + (ENGINE_FILTER_MAX_HZ - ENGINE_FILTER_MIN_HZ) * throttle;
    this._engineOsc.frequency.setTargetAtTime(enginePitch, now, k);
    this._engineGain.gain.setTargetAtTime(engineGain, now, k);
    this._engineFilter.frequency.setTargetAtTime(engineCutoff, now, k);

    const windGain = WIND_MIN_GAIN + (WIND_MAX_GAIN - WIND_MIN_GAIN) * windT;
    const windHz = WIND_MIN_FILTER_HZ + (WIND_MAX_FILTER_HZ - WIND_MIN_FILTER_HZ) * windT;
    this._windGain.gain.setTargetAtTime(windGain, now, k);
    this._windFilter.frequency.setTargetAtTime(windHz, now, k);
  }

  setMasterVolume(v) {
    if (!this._master || !this.ctx) return;
    const target = this._muted ? 0 : clamp(v, 0, 1);
    this._master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this._muted = !this._muted;
    if (this._master && this.ctx) {
      const target = this._muted ? 0 : AUDIO_MASTER_VOLUME;
      this._master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
    }
    return this._muted;
  }

  isMuted() { return this._muted; }
  isStarted() { return this.started; }

  dispose() {
    if (!this.started) return;
    try { this._engineOsc.stop(); } catch {}
    try { this._windSource.stop(); } catch {}
    try { this._engineOsc.disconnect(); } catch {}
    try { this._engineFilter.disconnect(); } catch {}
    try { this._engineGain.disconnect(); } catch {}
    try { this._windSource.disconnect(); } catch {}
    try { this._windFilter.disconnect(); } catch {}
    try { this._windGain.disconnect(); } catch {}
    try { this._master.disconnect(); } catch {}
    if (this.ctx && typeof this.ctx.close === 'function') {
      this.ctx.close().catch(() => {});
    }
    this.started = false;
  }
}
