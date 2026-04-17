import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
} from 'three';
import alea from 'alea';
import {
  CLOUD_COUNT,
  CLOUD_ALTITUDE,
  CLOUD_ALTITUDE_JITTER,
  CLOUD_AREA,
  CLOUD_SIZE_MIN,
  CLOUD_SIZE_MAX,
  CLOUD_WIND,
  CLOUD_OPACITY,
  CLOUD_SHADOW_OPACITY,
} from '../config.js';

function makeCloudTexture(variant) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  // A few overlapping soft blobs give a puffy cumulus silhouette. Each
  // variant uses different blob positions so repeated clouds look different.
  const prng = alea(`cloud-${variant}`);
  const blobCount = 5 + Math.floor(prng() * 3);
  for (let i = 0; i < blobCount; i++) {
    const x = 50 + prng() * 156;
    const y = 40 + prng() * 48;
    const r = 36 + prng() * 28;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 128);
  }
  return new CanvasTexture(c);
}

export class Clouds {
  constructor(scene, sharedShadowTexture) {
    this.scene = scene;

    // A handful of texture variants shared across all clouds so the sky
    // doesn't look tiled.
    const variants = [0, 1, 2, 3].map((v) => makeCloudTexture(v));
    const cloudMats = variants.map(
      (tex) =>
        new SpriteMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          opacity: CLOUD_OPACITY,
        })
    );

    const shadowGeo = new PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadowMat = new MeshBasicMaterial({
      map: sharedShadowTexture,
      transparent: true,
      depthWrite: false,
      opacity: CLOUD_SHADOW_OPACITY,
    });

    this.clouds = [];
    const prng = alea('cloud-field');
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const mat = cloudMats[i % cloudMats.length];
      const size =
        CLOUD_SIZE_MIN + prng() * (CLOUD_SIZE_MAX - CLOUD_SIZE_MIN);
      const sprite = new Sprite(mat);
      sprite.scale.set(size * 1.8, size, 1);
      const x = (prng() * 2 - 1) * CLOUD_AREA;
      const z = (prng() * 2 - 1) * CLOUD_AREA;
      const y =
        CLOUD_ALTITUDE + (prng() * 2 - 1) * CLOUD_ALTITUDE_JITTER;
      sprite.position.set(x, y, z);
      sprite.renderOrder = 2;
      scene.add(sprite);

      const shadow = new Mesh(shadowGeo, this.shadowMat);
      shadow.scale.set(size * 1.4, 1, size * 0.9);
      shadow.renderOrder = 1;
      scene.add(shadow);

      this.clouds.push({ sprite, shadow });
    }
  }

  update(dt, planePos, getHeight) {
    const windX = CLOUD_WIND[0];
    const windZ = CLOUD_WIND[2];
    for (const c of this.clouds) {
      c.sprite.position.x += windX * dt;
      c.sprite.position.z += windZ * dt;

      // Wrap around the plane so the cloud field always surrounds it.
      const dx = c.sprite.position.x - planePos.x;
      const dz = c.sprite.position.z - planePos.z;
      if (dx > CLOUD_AREA) c.sprite.position.x -= 2 * CLOUD_AREA;
      else if (dx < -CLOUD_AREA) c.sprite.position.x += 2 * CLOUD_AREA;
      if (dz > CLOUD_AREA) c.sprite.position.z -= 2 * CLOUD_AREA;
      else if (dz < -CLOUD_AREA) c.sprite.position.z += 2 * CLOUD_AREA;

      const gh = getHeight(c.sprite.position.x, c.sprite.position.z);
      c.shadow.position.set(c.sprite.position.x, gh + 0.2, c.sprite.position.z);
    }
  }
}
