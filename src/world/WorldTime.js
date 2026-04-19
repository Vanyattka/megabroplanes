import { Color, Vector3 } from 'three';

// Shared per-frame world-time state. DayNight writes to this each update;
// Water / Clouds / Stars read from it. Keeping it a module-level singleton
// instead of prop-drilling avoids passing DayNight into every system that
// only cares about the current tint.
export const worldTime = {
  t: 0.5,
  skyColor: new Color(0x3b72c4),
  horizonColor: new Color(0xcfe2f3),
  fogColor: new Color(0xcfe2f3),
  sunColor: new Color(0xfff4d0),
  sunIntensity: 1.2,
  ambientColor: new Color(0xffffff),
  ambientIntensity: 0.85,
  starsOpacity: 0.0,
  sunDir: new Vector3(0.35, 0.45, -0.5).normalize(),
  // 0 = full daylight, 1 = darkest night. Computed by DayNight each frame
  // from sunIntensity; drives runway lamp opacity and plane nav brightness.
  nightFactor: 0.0,
};
