import { Color, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry } from 'three';
import {
  RUNWAY_LIGHT_COLOR,
  RUNWAY_LIGHT_RADIUS,
  NAV_LIGHT_RADIUS,
  NAV_LIGHT_COLOR_LEFT,
  NAV_LIGHT_COLOR_RIGHT,
  NAV_LIGHT_COLOR_TAIL,
  VILLAGE_LAMP_GLOW_FULL,
  VILLAGE_WINDOW_NIGHT_EMISSIVE,
} from '../config.js';
import { worldTime } from './WorldTime.js';

// Shared geometries + materials for every light in the scene that should
// automatically respond to time of day. Exactly one material per light type,
// mutated in-place by `updateLights()` once per frame. Keeps the per-frame
// work O(1) no matter how many runway lamps or planes are loaded.

export const RUNWAY_LIGHT_GEOM = new SphereGeometry(RUNWAY_LIGHT_RADIUS, 8, 6);
export const NAV_LIGHT_GEOM = new SphereGeometry(NAV_LIGHT_RADIUS, 8, 6);

// Full-brightness reference colors kept separate so updateLights can derive
// the current-frame color without losing the target hue to repeated
// multiplications. Values are HDR (>1) so these lights actually bloom
// when the night factor ramps them up — the bloom threshold is set to 2.0
// and a plain lit white surface caps around 1.8, so anything below that
// doesn't glow.
const RUNWAY_FULL = new Color().setRGB(2.9, 2.5, 1.3);
const NAV_FULL_LEFT = new Color().setRGB(3.2, 0.5, 0.5);
const NAV_FULL_RIGHT = new Color().setRGB(0.5, 3.2, 0.5);
const NAV_FULL_TAIL = new Color().setRGB(3.5, 3.5, 3.5);

// Runway lights fade in via opacity — invisible during the day, glowing at
// night. MeshBasicMaterial ignores scene lighting so they always look self-lit.
export const runwayLightMat = new MeshBasicMaterial({
  color: RUNWAY_LIGHT_COLOR,
  transparent: true,
  opacity: 0,
  depthWrite: false,
});

// Nav lights stay fully opaque so pilots see each other's colored dots in
// daylight too — we just dim the color a bit so they don't look radioactive.
export const navLeftMat = new MeshBasicMaterial({ color: 0x000000 });
export const navRightMat = new MeshBasicMaterial({ color: 0x000000 });
export const navTailMat = new MeshBasicMaterial({ color: 0x000000 });

// Village street-lamp glow (v0.5). Same opacity-ramp trick as the runway lamps:
// invisible by day, blooming warm at night. Shared world-wide → O(1)/frame.
export const VILLAGE_LAMP_GEOM = new SphereGeometry(0.32, 8, 6);
export const villageLampMat = new MeshBasicMaterial({
  color: new Color().setRGB(VILLAGE_LAMP_GLOW_FULL[0], VILLAGE_LAMP_GLOW_FULL[1], VILLAGE_LAMP_GLOW_FULL[2]),
  transparent: true,
  opacity: 0,
  depthWrite: false,
  toneMapped: false,
});

// Window glass, shared by every village house. emissiveIntensity is ramped at
// night so windows glow at dusk world-wide for one extra line in updateLights.
const WINDOW_DAY_EMISSIVE = 0.32;
export const windowMat = new MeshStandardMaterial({
  color: 0x2a3a5a,
  emissive: 0x153060,
  emissiveIntensity: WINDOW_DAY_EMISSIVE,
  flatShading: true,
});

// 0.45 during the day, ramped up to 1.0 at midnight.
const NAV_DAY_LEVEL = 0.45;

export function updateLights() {
  const n = worldTime.nightFactor ?? 0;
  runwayLightMat.opacity = n;
  villageLampMat.opacity = n;
  windowMat.emissiveIntensity = WINDOW_DAY_EMISSIVE + (VILLAGE_WINDOW_NIGHT_EMISSIVE - WINDOW_DAY_EMISSIVE) * n;
  const navLevel = NAV_DAY_LEVEL + (1 - NAV_DAY_LEVEL) * n;
  navLeftMat.color.copy(NAV_FULL_LEFT).multiplyScalar(navLevel);
  navRightMat.color.copy(NAV_FULL_RIGHT).multiplyScalar(navLevel);
  navTailMat.color.copy(NAV_FULL_TAIL).multiplyScalar(navLevel);
}
