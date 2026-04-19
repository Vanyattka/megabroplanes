import { Color, Vector3 } from 'three';
import {
  DAY_LENGTH_SECONDS,
  DAY_TIME_START,
  DAY_TIME_MULT,
  DAY_NIGHT_KEYFRAMES,
} from '../config.js';
import { worldTime } from './WorldTime.js';

// Linear interpolate two hex colors by an amount t∈[0,1], writing into `out`.
function lerpColor(a, b, t, out) {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
  return out;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Pre-baked Color instances per keyframe so we don't thrash the allocator.
function bakeKeyframes(frames) {
  return frames.map((f) => ({
    t: f.t,
    sky: new Color(f.skyColor),
    horizon: new Color(f.horizonColor ?? f.skyColor),
    fog: new Color(f.fogColor),
    sun: new Color(f.sunColor),
    sunI: f.sunIntensity,
    amb: new Color(f.ambientColor),
    ambI: f.ambientIntensity,
    stars: f.starsOpacity ?? 0,
  }));
}

// Drives the day/night cycle. Interpolates keyframes and writes results to
// the shared `worldTime` singleton plus the actual scene fog + Sky lights
// provided by the caller.
export class DayNight {
  constructor({ scene, sky, sunLight, ambientLight, fog }) {
    this.scene = scene;
    this.sky = sky;
    this.sun = sunLight;
    this.ambient = ambientLight;
    this.fog = fog;

    this.frames = bakeKeyframes(DAY_NIGHT_KEYFRAMES);
    this.t = DAY_TIME_START;
    this.speed = 1 / DAY_LENGTH_SECONDS;

    // Scratch colors to avoid per-frame allocations.
    this._c1 = new Color();
    this._c2 = new Color();
    this._c3 = new Color();
    this._c4 = new Color();
    this._c5 = new Color();
    this._sunDir = new Vector3();

    // Write an initial frame so sky uniforms / lights aren't stale on frame 1.
    this.update(0);
  }

  // Set/get time of day in [0, 1]. 0 = midnight, 0.5 = noon.
  setTime(t) { this.t = ((t % 1) + 1) % 1; }
  getTime() { return this.t; }

  _findSegment(t) {
    const f = this.frames;
    for (let i = 0; i < f.length - 1; i++) {
      if (t >= f[i].t && t <= f[i + 1].t) {
        const span = f[i + 1].t - f[i].t;
        const u = span > 0 ? (t - f[i].t) / span : 0;
        return { a: f[i], b: f[i + 1], u };
      }
    }
    // Shouldn't happen if frames cover [0,1], but fall back to last pair.
    return { a: f[f.length - 2], b: f[f.length - 1], u: 1 };
  }

  update(dt) {
    this.t = (this.t + dt * this.speed * DAY_TIME_MULT) % 1;
    const { a, b, u } = this._findSegment(this.t);

    lerpColor(a.sky, b.sky, u, this._c1);
    lerpColor(a.horizon, b.horizon, u, this._c2);
    lerpColor(a.fog, b.fog, u, this._c3);
    lerpColor(a.sun, b.sun, u, this._c4);
    lerpColor(a.amb, b.amb, u, this._c5);
    const sunI = lerp(a.sunI, b.sunI, u);
    const ambI = lerp(a.ambI, b.ambI, u);
    const stars = lerp(a.stars, b.stars, u);

    // Sun orbits around world +X so it rises in +Z and sets in -Z over time.
    // At t=0   -> below horizon (midnight)
    // At t=0.25 -> horizon on +Z side (dawn)
    // At t=0.5  -> overhead (noon)
    // At t=0.75 -> horizon on -Z side (dusk)
    const sunAngle = (this.t - 0.25) * 2 * Math.PI; // shift so noon is at top
    this._sunDir.set(0, Math.sin(sunAngle), Math.cos(sunAngle)).normalize();

    // Write through to the shared singleton for Water / Clouds / Stars.
    worldTime.t = this.t;
    worldTime.skyColor.copy(this._c1);
    worldTime.horizonColor.copy(this._c2);
    worldTime.fogColor.copy(this._c3);
    worldTime.sunColor.copy(this._c4);
    worldTime.sunIntensity = sunI;
    worldTime.ambientColor.copy(this._c5);
    worldTime.ambientIntensity = ambI;
    worldTime.starsOpacity = stars;
    worldTime.sunDir.copy(this._sunDir);

    // Apply to scene / lights / sky shader.
    if (this.fog) this.fog.color.copy(this._c3);
    if (this.scene && this.scene.background && this.scene.background.isColor) {
      this.scene.background.copy(this._c1);
    }
    if (this.ambient) {
      this.ambient.color.copy(this._c5);
      this.ambient.intensity = ambI;
    }
    if (this.sun) {
      this.sun.color.copy(this._c4);
      this.sun.intensity = sunI;
      this.sun.position.copy(this._sunDir).multiplyScalar(500);
    }
    if (this.sky && this.sky.material && this.sky.material.uniforms) {
      const u_ = this.sky.material.uniforms;
      if (u_.uHorizon) u_.uHorizon.value.copy(this._c2);
      if (u_.uZenith) u_.uZenith.value.copy(this._c1);
      if (u_.uSunDir) u_.uSunDir.value.copy(this._sunDir);
      if (u_.uSunColor) u_.uSunColor.value.copy(this._c4);
      if (u_.uSunIntensity) u_.uSunIntensity.value = sunI;
    }
  }
}
