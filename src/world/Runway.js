import {
  CanvasTexture,
  MeshStandardMaterial,
  RepeatWrapping,
} from 'three';
import { getHomeSpawnPose, isOnAnyRunway } from './Villages.js';

// Backwards-compatible exports — every runway now lives inside a village, so
// these just delegate to the village-aware lookups.
export const getSpawnPose = getHomeSpawnPose;
export const isOnRunway = isOnAnyRunway;

// Shared runway texture (canvas-painted asphalt) reused by every village's
// airport mesh.
function makeRunwayTexture() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 128;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, c.width, c.height);

  ctx.fillStyle = '#eeeeee';
  for (let x = 60; x < c.width - 60; x += 120) {
    ctx.fillRect(x, 60, 60, 8);
  }

  for (let i = 0; i < 8; i++) {
    ctx.fillRect(20 + i * 14, 20, 8, 88);
    ctx.fillRect(c.width - 28 - i * 14, 20, 8, 88);
  }

  const tex = new CanvasTexture(c);
  tex.anisotropy = 4;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  return tex;
}

let cachedRunwayMaterial = null;
export function getRunwayMaterial() {
  if (!cachedRunwayMaterial) {
    cachedRunwayMaterial = new MeshStandardMaterial({
      map: makeRunwayTexture(),
      roughness: 0.9,
      metalness: 0.0,
    });
  }
  return cachedRunwayMaterial;
}
