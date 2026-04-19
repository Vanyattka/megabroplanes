import {
  CanvasTexture,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import alea from 'alea';
import {
  CLOUD_CELL_SIZE,
  CLOUD_MIN_PER_CELL,
  CLOUD_MAX_PER_CELL,
  CLOUD_MIN_ALT,
  CLOUD_MAX_ALT,
  CLOUD_VIEW_RADIUS,
  CLOUD_SIZE_MIN,
  CLOUD_SIZE_MAX,
  CLOUD_DRIFT_SPEED,
  CLOUD_DRIFT_DIR,
  CLOUD_OPACITY,
  CLOUD_MAX_INSTANCES,
} from '../config.js';

// Generate a soft cumulus texture in a canvas — a few radial-gradient blobs
// plus a subtle noise dither. Done once at module scope; the material reuses
// the resulting CanvasTexture across every cloud instance.
function makeCloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  // Soft blobs give the puffy silhouette; we randomise positions with a
  // fixed seed so the single global texture is still deterministic.
  const prng = alea('cloud-tex');
  const blobCount = 6 + Math.floor(prng() * 4);
  for (let i = 0; i < blobCount; i++) {
    const x = 40 + prng() * 176;
    const y = 30 + prng() * 68;
    const r = 38 + prng() * 34;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 128);
  }
  // Noise dither on the alpha to break up the gradient bands.
  const img = ctx.getImageData(0, 0, 256, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (prng() - 0.5) * 24;
    img.data[i + 3] = Math.max(0, Math.min(255, img.data[i + 3] + n));
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

const _driftDir = new Vector3();
const _tmpMat = new Matrix4();
const _tmpPos = new Vector3();
const _tmpQuat = new Quaternion();
const _tmpScale = new Vector3();
const _camQuat = new Quaternion();

// Deterministic pseudo-random sampling for cell (cx, cz).
// Exposed so other modules could preview cloud positions if needed.
function cloudsInCell(cx, cz) {
  const prng = alea(`cloud-cell:${cx}:${cz}`);
  const n =
    CLOUD_MIN_PER_CELL +
    Math.floor(prng() * (CLOUD_MAX_PER_CELL - CLOUD_MIN_PER_CELL + 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    const localX = prng() * CLOUD_CELL_SIZE;
    const localZ = prng() * CLOUD_CELL_SIZE;
    const y = CLOUD_MIN_ALT + prng() * (CLOUD_MAX_ALT - CLOUD_MIN_ALT);
    const scaleBase =
      CLOUD_SIZE_MIN + prng() * (CLOUD_SIZE_MAX - CLOUD_SIZE_MIN);
    const aspect = 1.4 + prng() * 0.9; // wider than tall
    out.push({
      baseX: cx * CLOUD_CELL_SIZE + localX,
      baseZ: cz * CLOUD_CELL_SIZE + localZ,
      y,
      sx: scaleBase * aspect,
      sy: scaleBase,
    });
  }
  return out;
}

export class Clouds {
  constructor(scene) {
    this.scene = scene;

    this._texture = makeCloudTexture();
    this._geometry = new PlaneGeometry(1, 1);
    this._material = new MeshBasicMaterial({
      map: this._texture,
      transparent: true,
      opacity: CLOUD_OPACITY,
      depthWrite: false,
      color: 0xffffff,
    });

    this.mesh = new InstancedMesh(
      this._geometry,
      this._material,
      CLOUD_MAX_INSTANCES
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);

    this._elapsed = 0;
    // Normalise drift direction once.
    const d = new Vector3(...CLOUD_DRIFT_DIR);
    if (d.lengthSq() > 0) d.normalize();
    this._driftDirN = d;

    // Cached cell listing re-used each frame. We only rebuild when the player
    // crosses a cell boundary OR view radius changes, so per-frame cost is a
    // matrix compose per visible cloud.
    this._activeClouds = [];  // flat list of {baseX, baseZ, y, sx, sy}
    this._lastCx = Infinity;
    this._lastCz = Infinity;
  }

  // Rebuild the list of clouds in the radius around the player's cell. Called
  // whenever the player crosses into a new cell (cheap: a single integer
  // compare each frame).
  _refreshCells(planePos) {
    const pcx = Math.floor(planePos.x / CLOUD_CELL_SIZE);
    const pcz = Math.floor(planePos.z / CLOUD_CELL_SIZE);
    if (pcx === this._lastCx && pcz === this._lastCz) return;
    this._lastCx = pcx;
    this._lastCz = pcz;

    const r = Math.ceil(CLOUD_VIEW_RADIUS / CLOUD_CELL_SIZE);
    this._activeClouds.length = 0;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const clouds = cloudsInCell(pcx + dx, pcz + dz);
        for (const c of clouds) this._activeClouds.push(c);
      }
    }
    // Sort by Y so when we hit the instance cap, we keep the higher ones
    // (they show up at altitude where they're most visible).
    this._activeClouds.sort((a, b) => b.y - a.y);
  }

  // Update billboard orientation + per-frame drift. Clouds share a single
  // camera-aligned orientation per frame so every quad faces the screen.
  update(dt, planePos, cameraPos, camera, worldTint) {
    this._elapsed += dt;
    this._refreshCells(planePos);

    if (worldTint) this._material.color.copy(worldTint);

    // Camera rotation for view-aligned billboards.
    if (camera) {
      _camQuat.setFromRotationMatrix(camera.matrixWorld);
    } else {
      _camQuat.identity();
    }

    const driftX = this._driftDirN.x * CLOUD_DRIFT_SPEED * this._elapsed;
    const driftZ = this._driftDirN.z * CLOUD_DRIFT_SPEED * this._elapsed;
    const viewR2 = CLOUD_VIEW_RADIUS * CLOUD_VIEW_RADIUS;

    let written = 0;
    for (let i = 0; i < this._activeClouds.length && written < CLOUD_MAX_INSTANCES; i++) {
      const c = this._activeClouds[i];
      const wx = c.baseX + driftX;
      const wz = c.baseZ + driftZ;
      const ddx = wx - planePos.x;
      const ddz = wz - planePos.z;
      if (ddx * ddx + ddz * ddz > viewR2) continue;

      _tmpPos.set(wx, c.y, wz);
      _tmpScale.set(c.sx, c.sy, 1);
      _tmpMat.compose(_tmpPos, _camQuat, _tmpScale);
      this.mesh.setMatrixAt(written, _tmpMat);
      written++;
    }
    this.mesh.count = written;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this._geometry.dispose();
    this._material.dispose();
    this._texture.dispose();
  }
}
