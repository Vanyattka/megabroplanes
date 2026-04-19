import { Color, MeshBasicMaterial, SphereGeometry } from 'three';
import {
  RUNWAY_LIGHT_COLOR,
  RUNWAY_LIGHT_RADIUS,
  NAV_LIGHT_RADIUS,
  NAV_LIGHT_COLOR_LEFT,
  NAV_LIGHT_COLOR_RIGHT,
  NAV_LIGHT_COLOR_TAIL,
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
// multiplications.
const RUNWAY_FULL = new Color(RUNWAY_LIGHT_COLOR);
const NAV_FULL_LEFT = new Color(NAV_LIGHT_COLOR_LEFT);
const NAV_FULL_RIGHT = new Color(NAV_LIGHT_COLOR_RIGHT);
const NAV_FULL_TAIL = new Color(NAV_LIGHT_COLOR_TAIL);

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

// 0.45 during the day, ramped up to 1.0 at midnight.
const NAV_DAY_LEVEL = 0.45;

export function updateLights() {
  const n = worldTime.nightFactor ?? 0;
  runwayLightMat.opacity = n;
  const navLevel = NAV_DAY_LEVEL + (1 - NAV_DAY_LEVEL) * n;
  navLeftMat.color.copy(NAV_FULL_LEFT).multiplyScalar(navLevel);
  navRightMat.color.copy(NAV_FULL_RIGHT).multiplyScalar(navLevel);
  navTailMat.color.copy(NAV_FULL_TAIL).multiplyScalar(navLevel);
}
