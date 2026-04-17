import { createNoise2D } from 'simplex-noise';
import alea from 'alea';
import { NOISE_SCALE, HEIGHT_AMPLITUDE, NOISE_SEED } from '../config.js';

const prng = alea(NOISE_SEED);
const noise2D = createNoise2D(prng);

export function heightAt(worldX, worldZ) {
  const s = NOISE_SCALE;
  let h = 0;
  h += noise2D(worldX * s, worldZ * s) * HEIGHT_AMPLITUDE;
  h += noise2D(worldX * s * 2, worldZ * s * 2) * HEIGHT_AMPLITUDE * 0.5;
  h += noise2D(worldX * s * 4, worldZ * s * 4) * HEIGHT_AMPLITUDE * 0.25;
  return h;
}
