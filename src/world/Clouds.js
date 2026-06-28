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

// Each cloud is no longer a single flat sprite — it's a CLUSTER of soft
// billboard "puffs" placed in a flattened, flat-bottomed cumulus shape and
// shaded top-bright / bottom-dark via per-instance colour. The puff positions
// are fixed in 3D (only the quads billboard toward the camera), so flying past
// a cloud gives real parallax between its puffs and it reads as a 3D mass
// instead of a cardboard cut-out. Still one InstancedMesh → one draw call.

// One soft, slightly-irregular round puff. Reused (instanced) for every puff.
function makeCloudPuffTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const prng = alea('cloud-puff-tex');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.94)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.46)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  // A few brighter lobes for a billowy, non-perfectly-round silhouette.
  for (let i = 0; i < 5; i++) {
    const x = S * (0.28 + prng() * 0.44);
    const y = S * (0.24 + prng() * 0.40);
    const r = S * (0.11 + prng() * 0.15);
    const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
    gg.addColorStop(0, 'rgba(255,255,255,0.5)');
    gg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gg; ctx.fillRect(0, 0, S, S);
  }
  const img = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (prng() - 0.5) * 16;
    img.data[i + 3] = Math.max(0, Math.min(255, img.data[i + 3] + n));
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

// Build a cumulus from puffs: u^2 height bias gives a flat bottom with a
// sparse rounded crown; lower puffs are larger and darker, the crown bright.
function makePuffs(prng, sizeBase, aspect) {
  const count = 8 + Math.floor(prng() * 6); // 8–13 puffs
  const W = sizeBase * aspect;
  const H = sizeBase * 0.66;
  const D = sizeBase * aspect * 0.6;
  const puffs = [];
  for (let i = 0; i < count; i++) {
    const u = prng();
    const oy = u * u * H;                       // flat bottom, rounded top
    const shrink = Math.pow(1 - u * 0.8, 0.65); // narrower near the crown
    const ang = prng() * Math.PI * 2;
    const rr = Math.sqrt(prng());
    const ox = Math.cos(ang) * rr * W * 0.5 * shrink;
    const oz = Math.sin(ang) * rr * D * 0.5 * shrink;
    const s = sizeBase * (0.44 + 0.30 * prng()) * (0.9 + 0.34 * (1 - u));
    const shade = 0.42 + 0.7 * u;               // deeper shadowed base → bright lit crown (more form)
    puffs.push({ ox, oy, oz, s, shade });
  }
  // Draw bottom (dark) puffs first so the lit crown blends over them.
  puffs.sort((a, b) => a.oy - b.oy);
  return puffs;
}

const _tmpMat = new Matrix4();
const _tmpPos = new Vector3();
const _tmpScale = new Vector3();
const _camQuat = new Quaternion();
const _shade = new Color();

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
    const sizeBase = CLOUD_SIZE_MIN + prng() * (CLOUD_SIZE_MAX - CLOUD_SIZE_MIN);
    const aspect = 1.3 + prng() * 0.8;
    out.push({
      baseX: cx * CLOUD_CELL_SIZE + localX,
      baseZ: cz * CLOUD_CELL_SIZE + localZ,
      y,
      puffs: makePuffs(prng, sizeBase, aspect),
    });
  }
  return out;
}

export class Clouds {
  constructor(scene) {
    this.scene = scene;

    this._texture = makeCloudPuffTexture();
    this._geometry = new PlaneGeometry(1, 1);
    this._material = new MeshBasicMaterial({
      map: this._texture,
      transparent: true,
      opacity: CLOUD_OPACITY,
      depthWrite: false,
      color: 0xffffff,
    });

    this.mesh = new InstancedMesh(this._geometry, this._material, CLOUD_MAX_INSTANCES);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    // Initialise the per-instance colour buffer so setColorAt works.
    for (let i = 0; i < CLOUD_MAX_INSTANCES; i++) this.mesh.setColorAt(i, _shade.setRGB(1, 1, 1));
    scene.add(this.mesh);

    this._elapsed = 0;
    const d = new Vector3(...CLOUD_DRIFT_DIR);
    if (d.lengthSq() > 0) d.normalize();
    this._driftDirN = d;

    this._activeClouds = [];
    this._lastCx = Infinity;
    this._lastCz = Infinity;
  }

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
    this._activeClouds.sort((a, b) => b.y - a.y);
  }

  update(dt, planePos, cameraPos, camera, worldTint) {
    this._elapsed += dt;
    this._refreshCells(planePos);

    if (worldTint) this._material.color.copy(worldTint);

    if (camera) _camQuat.setFromRotationMatrix(camera.matrixWorld);
    else _camQuat.identity();

    const driftX = this._driftDirN.x * CLOUD_DRIFT_SPEED * this._elapsed;
    const driftZ = this._driftDirN.z * CLOUD_DRIFT_SPEED * this._elapsed;
    const viewR2 = CLOUD_VIEW_RADIUS * CLOUD_VIEW_RADIUS;

    let written = 0;
    let colorsChanged = false;
    for (let i = 0; i < this._activeClouds.length && written < CLOUD_MAX_INSTANCES; i++) {
      const c = this._activeClouds[i];
      const cx = c.baseX + driftX;
      const cz = c.baseZ + driftZ;
      const ddx = cx - planePos.x;
      const ddz = cz - planePos.z;
      if (ddx * ddx + ddz * ddz > viewR2) continue;

      for (let j = 0; j < c.puffs.length && written < CLOUD_MAX_INSTANCES; j++) {
        const pf = c.puffs[j];
        _tmpPos.set(cx + pf.ox, c.y + pf.oy, cz + pf.oz);
        _tmpScale.set(pf.s, pf.s, 1);
        _tmpMat.compose(_tmpPos, _camQuat, _tmpScale);
        this.mesh.setMatrixAt(written, _tmpMat);
        this.mesh.setColorAt(written, _shade.setRGB(pf.shade, pf.shade, pf.shade));
        colorsChanged = true;
        written++;
      }
    }
    this.mesh.count = written;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colorsChanged && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this._geometry.dispose();
    this._material.dispose();
    this._texture.dispose();
  }
}
