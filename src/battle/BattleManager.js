import {
  Mesh,
  Group,
  Vector3,
  Quaternion,
  CylinderGeometry,
  SphereGeometry,
  ConeGeometry,
  BoxGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  CanvasTexture,
  RepeatWrapping,
  DoubleSide,
} from 'three';
import {
  GUN_FIRE_INTERVAL,
  GUN_MUZZLE_OFFSET,
  RACE_RESPAWN_MS,
  WATER_LEVEL,
  BATTLE_WALL_HEIGHT,
  BATTLE_WALL_SEGMENTS,
  BATTLE_WALL_OPACITY,
  BATTLE_WALL_NEAR_OPACITY,
  BATTLE_WALL_NEAR_DIST,
  BATTLE_WALL_STREAKS,
  BATTLE_ZONE_COLOR,
  BATTLE_ZONE_COLOR_OUT,
  BATTLE_BALLOON_RADIUS,
  BATTLE_BALLOON_HIT_RADIUS,
  BATTLE_BALLOON_ALT_MIN,
  BATTLE_BALLOON_ALT_SPAN,
  BATTLE_PICKUP_COLOR,
  BATTLE_BALLOON_COLORS,
  BATTLE_EFFECTS,
  ROCKET_SPEED,
  ROCKET_TURN_RATE,
  ROCKET_LIFE,
  ROCKET_INTERVAL,
  ROCKET_HIT_RADIUS,
  ROCKET_LOCK_RANGE,
  ROCKET_LOCK_CONE_COS,
  ROCKET_MAX,
} from '../config.js';
import { groundHeight } from '../world/Ground.js';
import { t } from '../ui/I18n.js';

// ---- shared balloon / rocket assets (lazy module singletons — never
// disposed per-instance, so add/remove of pickups is alloc-free) -------------
let _balloonAssets = null;
function balloonAssets() {
  if (_balloonAssets) return _balloonAssets;
  const envelope = new SphereGeometry(BATTLE_BALLOON_RADIUS, 14, 12);
  envelope.scale(1, 1.15, 1);
  const basket = new BoxGeometry(2.6, 2.2, 2.6);
  const rope = new CylinderGeometry(0.07, 0.07, 1, 4);
  const envelopeMats = BATTLE_BALLOON_COLORS.map(
    (c) => new MeshStandardMaterial({ color: c, roughness: 0.65, metalness: 0.05 })
  );
  // The gold basket is the HDR beacon — it blooms, so the pickup reads at range.
  const basketMat = new MeshBasicMaterial({ color: BATTLE_PICKUP_COLOR, toneMapped: false });
  const ropeMat = new MeshStandardMaterial({ color: 0x4a4038, roughness: 0.9 });
  _balloonAssets = { envelope, basket, rope, envelopeMats, basketMat, ropeMat };
  return _balloonAssets;
}

let _rocketAssets = null;
function rocketAssets() {
  if (_rocketAssets) return _rocketAssets;
  // Built pointing along +Z so Object3D.lookAt(pos + vel) aims the nose.
  const body = new CylinderGeometry(0.28, 0.28, 2.4, 8);
  body.rotateX(Math.PI / 2);
  const nose = new ConeGeometry(0.3, 1.0, 8);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 0, 1.7);
  const glow = new SphereGeometry(0.6, 8, 6);
  glow.translate(0, 0, -1.6);
  const bodyMat = new MeshStandardMaterial({ color: 0xd8d8de, roughness: 0.4, metalness: 0.4 });
  const glowMat = new MeshBasicMaterial({ color: 0xffa23a, toneMapped: false }); // HDR exhaust, blooms
  _rocketAssets = { body, nose, glow, bodyMat, glowMat };
  return _rocketAssets;
}

// Faint vertical light streaks for the arena wall — transparent between the
// streaks with a whisper of haze, so the wall reads as a curtain of light
// rather than a solid veil.
let _wallTexture = null;
function wallTexture() {
  if (_wallTexture) return _wallTexture;
  const cnv = document.createElement('canvas');
  cnv.width = 32;
  cnv.height = 8;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.10)'; // between-streak haze
  ctx.fillRect(0, 0, 32, 8);
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; // streak shoulders
  ctx.fillRect(14, 0, 4, 8);
  ctx.fillStyle = 'rgba(255,255,255,1)';    // streak core
  ctx.fillRect(15, 0, 2, 8);
  _wallTexture = new CanvasTexture(cnv);
  _wallTexture.wrapS = RepeatWrapping;
  _wallTexture.wrapT = RepeatWrapping;
  _wallTexture.repeat.set(BATTLE_WALL_STREAKS, 1);
  return _wallTexture;
}

// Deterministic per-id balloon variation (color pick + altitude), identical on
// every client without any extra wire data.
function idHash(id) {
  return (((id * 2654435761) >>> 0) % 100000) / 100000;
}

// Owns the BATTLE match experience (v1.1): a free-for-all dogfight inside a
// shrinking arena. The server authors the match (zone parameters, mystery
// pickups, HP, kills); this manager renders the arena wall + pickup orbs,
// detects pickup fly-throughs, drives combat (shared Bullets pool), applies
// the client-side half of mystery effects (thrust/throttle) to the plane, and
// owns the battle HUD. Structured as a sibling of RaceManager: both subscribe
// to the same `race` wire message and each ignores the other's mode.
//
// The arena radius is a pure function of the match clock (startAt + zone
// params), so client and server always agree without a per-tick radius sync.
const _fwd = new Vector3();
const _mz = new Vector3();
const _v = new Vector3();
const _seg = new Vector3();
const _proj = new Vector3();
const _desired = new Vector3();
const _axis = new Vector3();

// Radius from the zone's live shrink segment (baseR at baseAt → r1 over
// shrinkMs). The server rebases the segment in place when a storm pickup
// accelerates the shrink; we always read the freshest zone object off the
// 20 Hz match message, so the wall follows within a tick.
function zoneRadius(zone, now) {
  const t01 = Math.min(1, Math.max(0, (now - zone.baseAt) / zone.shrinkMs));
  return zone.baseR + (zone.r1 - zone.baseR) * t01;
}

export class BattleManager {
  constructor(opts) {
    this.scene = opts.scene;
    this.client = opts.client;
    this.plane = opts.plane;
    this.input = opts.input;
    this.touch = opts.touch;
    this.bullets = opts.bullets;
    this.explosion = opts.explosion;
    this.audio = opts.audio;
    this.getRemoteTargets = opts.getRemoteTargets;
    this.applyLoadout = opts.applyLoadout;
    this.applyRaceTime = opts.applyRaceTime;
    this.restoreFreeTime = opts.restoreFreeTime;
    this.getMyColor = opts.getMyColor;
    this.onBattleEnd = opts.onBattleEnd;
    this.snapCamera = null; // set by main.js after camera init

    this.group = new Group();
    this.group.visible = false;
    this.scene.add(this.group);

    this.phase = 'idle';
    this.inBattle = false;
    this._zone = null;
    this._wall = null;
    this._pickupMeshes = new Map(); // id -> { group, envelope, baseY } (balloons)
    this._turretMeshes = new Map(); // id -> { group, barrel } (AA sites)
    // Live homing rockets — a fixed pool of reusable meshes, own + remote + AA.
    this._rockets = [];
    this._rocketCd = 0;
    this._fireCd = 0;
    this._localDowned = false;
    // Same re-death guard as the race: only arm gunfire-death once the server
    // has reported us alive, so a stale hp<=0 snapshot can't re-kill a fresh
    // respawn.
    this._hpArmed = false;
    this._respawnAt = 0;
    this._deadRemotes = new Set();
    this._outside = false;
    // Active mystery effect (from the server's `fx` reveal): {key, until}.
    this._fx = null;
    this._lastKills = 0;
    this._killFlashUntil = 0;
    // Storm notices: the server bumps zone.storms on every storm pickup; any
    // increase flashes the room-wide "arena sped up" banner.
    this._lastStorms = 0;
    this._stormFlashUntil = 0;
    // Same pattern for AA sites: a growing turret list flashes its own notice.
    this._lastTurrets = 0;
    this._aaFlashUntil = 0;

    this.elStatus = document.getElementById('race-status');
    this.elCountdown = document.getElementById('race-countdown');
    this.elBoard = document.getElementById('race-leaderboard');
    this.elResults = document.getElementById('race-results');
    this.elHp = document.getElementById('race-hp');
    this.elCross = document.getElementById('race-crosshair');
    this.elWarn = document.getElementById('battle-warning');
    this.elStorm = document.getElementById('battle-storm');
    this.elAa = document.getElementById('battle-aa');
    this.elFx = document.getElementById('battle-fx');
    this.elKill = document.getElementById('battle-kill');

    this.client.onFire((msg) => {
      if (!this.inBattle) return;
      // aa: a ground AA turret launched a homing rocket at player `t`. The
      // server only knows the turret id — the launch position (terrain height)
      // is derived locally, identically on every client.
      if (msg.aa != null) {
        const tm = this._turretMeshes.get(msg.aa);
        if (!tm) return;
        _v.copy(tm.group.position);
        _v.y += 6;
        _mz.set(0, 1, 0); // straight up out of the launcher, then it steers
        this._launchRocket(_v, _mz, typeof msg.t === 'number' ? msg.t : null, 'aa');
        return;
      }
      if (!msg.o || !msg.d) return;
      // r:1 = a remote player's homing-rocket launch (t = its target id) —
      // simulate it locally so the victim sees the rocket actually chasing them.
      if (msg.r) {
        this._launchRocket(
          _v.fromArray(msg.o), _mz.fromArray(msg.d),
          typeof msg.t === 'number' ? msg.t : null, 'remote'
        );
      } else {
        this.bullets.spawn(_v.fromArray(msg.o), _mz.fromArray(msg.d), msg.id);
      }
    });
    // This assignment (constructed after RaceManager) is the live one for BOTH
    // modes: race targets are always numeric player ids and take the sendHit
    // branch, so the race path is unchanged. String 'pk:N' ids are the battle
    // balloons — a bullet popping one claims the pickup.
    this.bullets.onHit = (targetId) => {
      if (typeof targetId === 'string' && targetId.startsWith('pk:')) {
        this._popBalloon(Number(targetId.slice(3)));
      } else {
        this.client.sendHit(targetId);
      }
    };
    this.client.onFx((msg) => this._onFx(msg));
    this.client.onRace((r) => this._onRace(r));
  }

  _amParticipant(r) {
    return !!(r && r.standings && this.client.id != null &&
      r.standings.some((s) => s.id === this.client.id));
  }
  _localRow() {
    const r = this.client.race;
    if (!r || !r.standings) return null;
    return r.standings.find((s) => s.id === this.client.id) || null;
  }

  _onRace(r) {
    if (!r || r.phase === 'idle' || r.mode !== 'battle') {
      if (this.inBattle) this._teardown();
      this.phase = 'idle';
      return;
    }
    const wasIn = this.inBattle;
    const amPart = this._amParticipant(r);
    this.phase = r.phase;

    if (amPart && !wasIn) {
      // Entering a battle: drop the stale lobby snapshot (same wedge as the
      // race — the server stops sending us lobby updates), build the arena,
      // and spawn on the start ring facing the arena centre.
      this.client.clearLobby();
      this.inBattle = true;
      this._zone = r.zone;
      this._buildWall();
      this._localDowned = false;
      this._hpArmed = false;
      this._deadRemotes.clear();
      this._outside = false;
      this._clearFx();
      this._lastKills = 0;
      this._killFlashUntil = 0;
      this._lastStorms = (r.zone && r.zone.storms) || 0;
      this._stormFlashUntil = 0;
      this._lastTurrets = (r.turrets || []).length;
      this._aaFlashUntil = 0;
      this._clearRockets();
      this._rocketCd = 0;
      this.bullets.clear();
      const slot = Math.max(0, r.standings.findIndex((s) => s.id === this.client.id));
      const pose = this._spawnPose(slot, r.standings.length);
      this.plane.spawnAirborne(pose.pos, pose.q, pose.vel, 1);
      let myColor = this.plane.color;
      try { if (this.getMyColor) { const c = this.getMyColor(); if (c != null) myColor = c; } } catch {}
      this.applyLoadout(r.plane, myColor);
      this.applyRaceTime(r.timeKey);
      this.plane.spawnAirborne(pose.pos, pose.q, pose.vel, 1); // re-assert after loadout rebuild
      if (this.snapCamera) this.snapCamera();
      if (this.elCross) this.elCross.style.display = 'block';
    } else if (!amPart && wasIn) {
      this._teardown();
    }
  }

  // Bail out of the current battle back to free flight (START GAME mid-match).
  leaveBattle() {
    if (!this.inBattle) return;
    this.client.leaveRace();
    this._teardown();
  }

  _teardown() {
    this.inBattle = false;
    this.phase = 'idle';
    this.group.visible = false;
    this._disposeWall();
    this._disposeAllPickups();
    this._disposeAllTurrets();
    this._clearRockets();
    this.bullets.clear();
    this._localDowned = false;
    this._deadRemotes.clear();
    this._outside = false;
    this._clearFx();
    this._hideAllDom();
    if (this.elCross) this.elCross.style.display = 'none';
    if (this.restoreFreeTime) this.restoreFreeTime();
    if (this.onBattleEnd) this.onBattleEnd();
  }

  // --- arena wall ----------------------------------------------------------
  _buildWall() {
    this._disposeWall();
    if (!this._zone) return;
    // Unit-radius open cylinder; the current zone radius is applied per-frame
    // via scale so the shrink is smooth and free.
    const geo = new CylinderGeometry(1, 1, BATTLE_WALL_HEIGHT, BATTLE_WALL_SEGMENTS, 1, true);
    const mat = new MeshBasicMaterial({
      color: BATTLE_ZONE_COLOR,
      // Vertical light streaks instead of a solid veil — unobtrusive from the
      // arena centre, unmistakable up close (opacity also scales with distance
      // to the wall, see update()).
      map: wallTexture(),
      transparent: true,
      opacity: BATTLE_WALL_OPACITY,
      side: DoubleSide,
      depthWrite: false,
      toneMapped: false,
      // The wall is a gameplay marker kilometres wide — fog would wash it
      // into the sky long before the player reaches it.
      fog: false,
    });
    this._wall = new Mesh(geo, mat);
    this._wall.position.set(this._zone.x, BATTLE_WALL_HEIGHT / 2 - 100, this._zone.z);
    this._wall.frustumCulled = false; // huge + always around the player
    this._wall.renderOrder = 1;
    this.group.add(this._wall);
    this.group.visible = true;
  }

  _disposeWall() {
    if (!this._wall) return;
    this.group.remove(this._wall);
    this._wall.geometry.dispose();
    this._wall.material.dispose();
    this._wall = null;
  }

  // --- mystery pickup balloons ---------------------------------------------
  // Ground level under a point, water counting as ground (a balloon over the
  // sea floats above the surface, not above the seabed).
  _surfaceY(x, z) {
    return Math.max(groundHeight(x, z), WATER_LEVEL);
  }

  // A hot-air balloon: bright envelope (deterministic per-id color), rope
  // lines, and a glowing gold basket — the "?" prize crate. Shot down by
  // bullets, not flown through. All geometry/materials are shared module
  // assets, so building/removing is alloc-light.
  _addPickupMesh(p) {
    const a = balloonAssets();
    const h = idHash(p.id);
    const group = new Group();
    const envelope = new Mesh(a.envelope, a.envelopeMats[p.id % a.envelopeMats.length]);
    envelope.castShadow = true;
    group.add(envelope);
    const drop = BATTLE_BALLOON_RADIUS * 1.15 + 4.6;
    const basket = new Mesh(a.basket, a.basketMat);
    basket.position.y = -drop;
    group.add(basket);
    for (const [rx, rz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const rope = new Mesh(a.rope, a.ropeMat);
      rope.scale.y = drop - 3;
      rope.position.set(rx * 1.1, -(drop - 3) / 2 - 2.6, rz * 1.1);
      group.add(rope);
    }
    // Altitude rides the LOCAL terrain (identical on every client — same world
    // seed) plus a per-id spread, so balloons hug valleys and crown ridges.
    const baseY = this._surfaceY(p.x, p.z) + BATTLE_BALLOON_ALT_MIN + h * BATTLE_BALLOON_ALT_SPAN;
    group.position.set(p.x, baseY, p.z);
    this.group.add(group);
    this._pickupMeshes.set(p.id, { group, envelope, baseY });
  }

  _removePickupMesh(id) {
    const m = this._pickupMeshes.get(id);
    if (!m) return;
    this.group.remove(m.group); // shared assets — nothing to dispose
    this._pickupMeshes.delete(id);
  }

  _disposeAllPickups() {
    for (const id of [...this._pickupMeshes.keys()]) this._removePickupMesh(id);
  }

  // A bullet popped balloon `id`: bang + claim. The server resolves the race
  // if someone else shot it in the same tick — first claim wins, and the loser
  // just sees the balloon vanish with no reveal.
  _popBalloon(id) {
    const m = this._pickupMeshes.get(id);
    if (!m) return;
    this.explosion.trigger(m.group.position, _mz.set(0, 2, 0));
    this.audio.boom();
    this.client.sendPickup(id);
    this._removePickupMesh(id);
  }

  // Sync local balloons to the server's pickup list (spawn new, drop taken/culled).
  _syncPickups(pickups) {
    const seen = new Set();
    for (const p of pickups) {
      seen.add(p.id);
      if (!this._pickupMeshes.has(p.id)) this._addPickupMesh(p);
    }
    for (const id of [...this._pickupMeshes.keys()]) {
      if (!seen.has(id)) this._removePickupMesh(id);
    }
  }

  // --- AA turret sites (the `aa` mystery effect) ---------------------------
  // A simple ground launcher: concrete base, pivot box, and an angled launch
  // tube that slowly sweeps. Placement height is derived from local terrain
  // (floats on the surface over water).
  _addTurretMesh(tr) {
    const group = new Group();
    const base = new Mesh(new CylinderGeometry(4.2, 5, 2.4, 12), new MeshStandardMaterial({ color: 0x777d84, roughness: 0.85 }));
    base.position.y = 1.2;
    group.add(base);
    const body = new Mesh(new BoxGeometry(3.4, 2.6, 3.4), new MeshStandardMaterial({ color: 0x4b5560, roughness: 0.7 }));
    body.position.y = 3.6;
    group.add(body);
    const barrel = new Mesh(new CylinderGeometry(0.55, 0.7, 7.5, 8), new MeshStandardMaterial({ color: 0x2e343c, roughness: 0.6 }));
    barrel.geometry.translate(0, 3.75, 0);
    barrel.position.y = 4.6;
    barrel.rotation.z = 0.6; // raked launch tube
    group.add(barrel);
    const light = new Mesh(new SphereGeometry(0.5, 8, 6), new MeshBasicMaterial({ color: 0xff4030, toneMapped: false }));
    light.position.y = 5.4;
    group.add(light);
    group.position.set(tr.x, this._surfaceY(tr.x, tr.z), tr.z);
    this.group.add(group);
    this._turretMeshes.set(tr.id, { group, barrel, mats: [base.material, body.material, barrel.material, light.material], geos: [base.geometry, body.geometry, barrel.geometry, light.geometry] });
  }

  _removeTurretMesh(id) {
    const m = this._turretMeshes.get(id);
    if (!m) return;
    this.group.remove(m.group);
    for (const g of m.geos) g.dispose();
    for (const mat of m.mats) mat.dispose();
    this._turretMeshes.delete(id);
  }

  _disposeAllTurrets() {
    for (const id of [...this._turretMeshes.keys()]) this._removeTurretMesh(id);
  }

  _syncTurrets(turrets) {
    const seen = new Set();
    for (const tr of turrets) {
      seen.add(tr.id);
      if (!this._turretMeshes.has(tr.id)) this._addTurretMesh(tr);
    }
    for (const id of [...this._turretMeshes.keys()]) {
      if (!seen.has(id)) this._removeTurretMesh(id);
    }
  }

  // --- spawn/respawn poses -------------------------------------------------
  // Match start: evenly spaced on a ring at half the initial radius, everyone
  // facing the arena centre. The arena lands on arbitrary terrain now, so the
  // altitude rides the local surface instead of assuming flat plains.
  _spawnPose(slot, total) {
    const z = this._zone || { x: 0, z: 0, r0: 2000 };
    const ang = (slot / Math.max(1, total)) * Math.PI * 2;
    const rad = z.r0 * 0.5;
    const px = z.x + Math.cos(ang) * rad;
    const pz = z.z + Math.sin(ang) * rad;
    let dx = z.x - px, dz = z.z - pz;
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const pos = new Vector3(px, this._surfaceY(px, pz) + 280, pz);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), new Vector3(dx, 0, dz));
    const vel = new Vector3(dx, 0, dz).multiplyScalar(75);
    return { pos, q, vel };
  }

  // Respawn: a random spot well inside the CURRENT zone, facing the centre,
  // at a safe height above whatever terrain is underneath.
  _respawnPose() {
    const z = this._zone || { x: 0, z: 0, r1: 400, baseR: 2000, baseAt: 0, shrinkMs: 1 };
    const zr = z.baseAt ? zoneRadius(z, Date.now()) : z.r1;
    const ang = Math.random() * Math.PI * 2;
    const rad = (0.3 + Math.random() * 0.4) * zr;
    const px = z.x + Math.cos(ang) * rad;
    const pz = z.z + Math.sin(ang) * rad;
    let dx = z.x - px, dz = z.z - pz;
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const pos = new Vector3(px, this._surfaceY(px, pz) + 220 + Math.random() * 120, pz);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), new Vector3(dx, 0, dz));
    const vel = new Vector3(dx, 0, dz).multiplyScalar(75);
    return { pos, q, vel };
  }

  // --- homing rockets ------------------------------------------------------
  // One pooled rocket record: { active, kind, target, life, vel, mesh }.
  // kind: 'own'    — my launch; I do the hit test and claim `hit w:'r'`.
  //       'remote' — another player's launch; purely visual (they claim hits).
  //       'aa'     — a ground AA site's launch; if it targets ME, *I* detect
  //                  the hit on myself and self-report it (`aa_hit`), like the
  //                  existing self-reported terrain crash.
  _getRocketSlot() {
    let slot = this._rockets.find((r) => !r.active);
    if (!slot) {
      if (this._rockets.length >= ROCKET_MAX) return null;
      const a = rocketAssets();
      const mesh = new Group();
      mesh.add(new Mesh(a.body, a.bodyMat));
      mesh.add(new Mesh(a.nose, a.bodyMat));
      mesh.add(new Mesh(a.glow, a.glowMat));
      mesh.visible = false;
      this.group.add(mesh);
      slot = { active: false, kind: 'remote', target: null, life: 0, vel: new Vector3(), mesh };
      this._rockets.push(slot);
    }
    return slot;
  }

  _launchRocket(origin, dir, targetId, kind) {
    const slot = this._getRocketSlot();
    if (!slot) return;
    slot.active = true;
    slot.kind = kind === 'own' || kind === 'aa' ? kind : 'remote';
    slot.target = targetId;
    slot.life = ROCKET_LIFE;
    slot.vel.copy(dir).normalize().multiplyScalar(ROCKET_SPEED);
    slot.mesh.position.copy(origin);
    slot.mesh.visible = true;
  }

  _clearRockets() {
    for (const r of this._rockets) { r.active = false; r.mesh.visible = false; }
  }

  // Where rocket `targetId` currently is: me, a remote plane, or gone (null).
  _targetPos(targetId, remoteTargets) {
    if (targetId == null) return null;
    if (targetId === this.client.id) return this.plane.position;
    if (remoteTargets) {
      for (const rt of remoteTargets) if (rt.id === targetId) return rt.position;
    }
    return null;
  }

  // Lock-on for my own launches: nearest plane within the nose cone, falling
  // back to nearest in range at any bearing.
  _acquireTarget(remoteTargets) {
    if (!remoteTargets || !remoteTargets.length) return null;
    _fwd.set(0, 0, -1).applyQuaternion(this.plane.quaternion);
    let bestCone = null, bestConeD = Infinity;
    let bestAny = null, bestAnyD = Infinity;
    for (const rt of remoteTargets) {
      const d = rt.position.distanceTo(this.plane.position);
      if (d > ROCKET_LOCK_RANGE) continue;
      _desired.subVectors(rt.position, this.plane.position).normalize();
      const inCone = _desired.dot(_fwd) > ROCKET_LOCK_CONE_COS;
      if (inCone && d < bestConeD) { bestCone = rt; bestConeD = d; }
      if (d < bestAnyD) { bestAny = rt; bestAnyD = d; }
    }
    return bestCone || bestAny;
  }

  _detonateRocket(r) {
    r.active = false;
    r.mesh.visible = false;
    this.explosion.trigger(r.mesh.position, _mz.set(0, 0, 0));
    this.audio.boom();
  }

  _updateRockets(dt, remoteTargets) {
    for (const r of this._rockets) {
      if (!r.active) continue;
      const targetPos = this._targetPos(r.target, remoteTargets);
      // Steer the velocity toward the target with a capped turn rate — enough
      // to chase a plane, not enough to be inescapable in a hard break turn.
      if (targetPos) {
        _desired.subVectors(targetPos, r.mesh.position).normalize();
        _v.copy(r.vel).normalize();
        const dot = Math.max(-1, Math.min(1, _v.dot(_desired)));
        const ang = Math.acos(dot);
        const maxAng = ROCKET_TURN_RATE * dt;
        if (ang > 1e-4) {
          if (ang <= maxAng) {
            _v.copy(_desired);
          } else {
            _axis.crossVectors(_v, _desired);
            if (_axis.lengthSq() < 1e-8) _axis.set(0, 1, 0); // dead-astern: pick any pivot
            _axis.normalize();
            _v.applyAxisAngle(_axis, maxAng);
          }
        }
        r.vel.copy(_v).multiplyScalar(ROCKET_SPEED);
      }
      r.mesh.position.addScaledVector(r.vel, dt);
      _proj.copy(r.mesh.position).add(r.vel);
      r.mesh.lookAt(_proj);
      r.life -= dt;

      // Detonation: on the target, on the ground/sea, or fizzle at end of life.
      const p = r.mesh.position;
      if (targetPos && p.distanceTo(targetPos) < ROCKET_HIT_RADIUS) {
        if (r.kind === 'own') {
          this.client.sendHit(r.target, 'r');
        } else if (r.kind === 'aa' && r.target === this.client.id) {
          this.client.sendAaHit();
        }
        this._detonateRocket(r);
      } else if (p.y < this._surfaceY(p.x, p.z)) {
        this._detonateRocket(r);
      } else if (r.life <= 0) {
        r.active = false;
        r.mesh.visible = false;
      }
    }
  }

  // True while the player must take damage / explosions are forced on.
  isCombatActive() { return this.inBattle && this.phase === 'racing'; }
  // Physics frozen at the spawn ring during the pre-match countdown.
  get holdAtStart() { return this.inBattle && this.phase === 'countdown'; }

  // NOTE: there is deliberately NO manual respawn in battle (main.js keeps the
  // R/reset input inert here) — teleporting away from a pursuer at will made
  // chases pointless. Going down auto-respawns via the flow in update().

  // --- mystery effects -----------------------------------------------------
  _onFx(msg) {
    if (!this.inBattle || !msg || !msg.effect) return;
    const spec = BATTLE_EFFECTS[msg.effect] || {};
    // One active effect at a time — a new pickup replaces the old one.
    this._clearFx();
    this._fx = { key: msg.effect, until: msg.until || 0, good: !!spec.good };
    if (spec.thrustMul) this.plane.fxThrustMul = spec.thrustMul;
    if (spec.throttleCap) this.plane.fxThrottleCap = spec.throttleCap;
    // Instant effects (heal) just flash the banner briefly.
    if (!this._fx.until) this._fx.until = Date.now() + 3000;
  }

  _clearFx() {
    this._fx = null;
    this.plane.fxThrustMul = 1;
    this.plane.fxThrottleCap = 1;
    if (this.elFx) this.elFx.style.display = 'none';
  }

  update(dt) {
    if (!this.inBattle) return;
    const now = Date.now();
    const racing = this.phase === 'racing';
    const r = this.client.race;
    if (!r || !this._zone) return;

    // Effect expiry.
    if (this._fx && now >= this._fx.until) this._clearFx();

    // Always track the freshest zone object — the server rebases its shrink
    // segment in place when a storm pickup fires, and each match message
    // carries a new zone snapshot.
    if (r.zone) this._zone = r.zone;
    // A storm count bump = someone grabbed the storm pickup — flash the
    // room-wide notice.
    const storms = (this._zone && this._zone.storms) || 0;
    if (storms > this._lastStorms) this._stormFlashUntil = now + 4000;
    this._lastStorms = storms;

    // Arena wall: shrink to the clock-derived radius; flip red while outside.
    const zr = zoneRadius(this._zone, now);
    const dxz = Math.hypot(this.plane.position.x - this._zone.x, this.plane.position.z - this._zone.z);
    const outside = racing && dxz > zr;
    if (this._wall) {
      this._wall.scale.set(zr, 1, zr);
      this._wall.material.color.setHex(outside ? BATTLE_ZONE_COLOR_OUT : BATTLE_ZONE_COLOR);
      // Soft breathing pulse; more agitated while the hull is burning.
      const pulse = outside ? 0.10 + 0.05 * Math.sin(now / 90) : 0.02 * Math.sin(now / 400);
      this._wall.material.opacity = BATTLE_WALL_OPACITY + pulse;
    }
    this._outside = outside;

    // Balloons: sync with the server list, drift gently. Collection is by
    // SHOOTING them down (see the shootables fed to bullets.update below) —
    // flying through does nothing.
    this._syncPickups(r.pickups || []);
    for (const [id, m] of this._pickupMeshes) {
      m.group.rotation.y += dt * 0.35;
      m.group.position.y = m.baseY + Math.sin(now / 900 + id) * 4;
    }

    // AA turret sites: sync + a slow menacing sweep of the launch tube; a new
    // site flashes the room-wide notice.
    this._syncTurrets(r.turrets || []);
    for (const [id, m] of this._turretMeshes) {
      m.group.rotation.y += dt * 0.5;
      void id;
    }
    const nTurrets = (r.turrets || []).length;
    if (nTurrets > this._lastTurrets) this._aaFlashUntil = now + 4000;
    this._lastTurrets = nTurrets;

    // Local HP / death / respawn — mirrors the race flow.
    const row = this._localRow();
    if (row) this.plane.hp = row.hp != null ? row.hp : this.plane.maxHp;
    if (row && row.hp != null && row.hp > 0) this._hpArmed = true;
    if (racing && !this._localDowned) {
      if (this._hpArmed && row && row.hp <= 0 && !this.plane.crashed) {
        this._die(now);
      } else if (this.plane.crashed) {
        this._enterDowned(now);
      }
    }
    if (this._localDowned && now >= this._respawnAt) {
      const pose = this._respawnPose();
      this.plane.spawnAirborne(pose.pos, pose.q, pose.vel, 1);
      if (this.snapCamera) this.snapCamera();
      this._localDowned = false;
    }

    // Kill feedback: our server-side kill count ticked up → flash it.
    if (row && row.k != null) {
      if (row.k > this._lastKills) this._killFlashUntil = now + 1400;
      this._lastKills = row.k;
    }

    // Remote deaths → explosions (once per death).
    if (this.getRemoteTargets) {
      for (const [id, rem] of this.client.remotes) {
        const dead = rem.crashed || (rem.hp != null && rem.hp <= 0);
        if (dead && !this._deadRemotes.has(id) && rem.pos && rem.pos.length >= 3) {
          this._deadRemotes.add(id);
          _v.fromArray(rem.pos);
          this.explosion.trigger(_v, _mz.set(0, 0, 0));
          this.audio.boom();
        } else if (!dead && this._deadRemotes.has(id)) {
          this._deadRemotes.delete(id);
        }
      }
    }

    // Combat: fire + bullet sim (shared pool with the race — only one of the
    // two managers is ever active).
    this._fireCd -= dt;
    this._rocketCd -= dt;
    const combat = racing && !this._localDowned && !this.plane.crashed;
    const firing = combat && !this.plane.onGround &&
      (this.input.isPressed('Space') || !!(this.touch && this.touch.fire));
    if (firing && this._fireCd <= 0) {
      this._fire();
      this._fireCd = GUN_FIRE_INTERVAL;
    }
    // Bullets hit remote planes AND the balloons (string 'pk:' ids with a
    // bigger per-target radius — see bullets.onHit for the routing).
    const targets = this.getRemoteTargets ? this.getRemoteTargets() : null;
    let shootables = null;
    if (combat) {
      shootables = targets ? [...targets] : [];
      for (const [id, m] of this._pickupMeshes) {
        shootables.push({ id: 'pk:' + id, position: m.group.position, r: BATTLE_BALLOON_HIT_RADIUS });
      }
    }
    this.bullets.update(dt, shootables);
    // Homing rockets (mine chase + claim, remote/AA ones chase for show — and
    // an AA rocket aimed at ME is the one that hurts).
    this._updateRockets(dt, targets);

    this._updateDom(now, zr);
  }

  _enterDowned(now) {
    this._localDowned = true;
    this._respawnAt = now + RACE_RESPAWN_MS;
    this._hpArmed = false;
    this._clearFx(); // effects don't survive going down (server clears too)
    this.client.sendDown();
  }

  _die(now) {
    this.explosion.trigger(this.plane.position, this.plane.velocity);
    this.audio.boom();
    this.plane.crashed = true;
    this.plane.mesh.visible = false;
    this._enterDowned(now);
  }

  _fire() {
    _fwd.set(0, 0, -1).applyQuaternion(this.plane.quaternion).normalize();
    this.plane.mesh.updateMatrixWorld();
    for (const sx of [-1, 1]) {
      _mz.set(GUN_MUZZLE_OFFSET[0] * sx, GUN_MUZZLE_OFFSET[1], GUN_MUZZLE_OFFSET[2]);
      this.plane.mesh.localToWorld(_mz);
      this.bullets.spawn(_mz, _fwd, this.client.id, this.plane.velocity);
    }
    _mz.set(0, GUN_MUZZLE_OFFSET[1], GUN_MUZZLE_OFFSET[2]);
    this.plane.mesh.localToWorld(_mz);
    this.client.sendFire([_mz.x, _mz.y, _mz.z], [_fwd.x, _fwd.y, _fwd.z]);
    this.audio.gunShot();

    // While rocket ammo remains (server-side count, read off my standings
    // row), holding fire also rides a homing rocket out every ROCKET_INTERVAL.
    // The launch itself spends the ammo on the server (`fire` with r:1).
    const row = this._localRow();
    if (row && (row.rk || 0) > 0 && this._rocketCd <= 0) {
      this._rocketCd = ROCKET_INTERVAL;
      const rts = this.getRemoteTargets ? this.getRemoteTargets() : null;
      const lock = this._acquireTarget(rts);
      _mz.set(0, -0.9, -3.5); // belly rail
      this.plane.mesh.localToWorld(_mz);
      this._launchRocket(_mz, _fwd, lock ? lock.id : null, 'own');
      this.client.sendFire(
        [_mz.x, _mz.y, _mz.z], [_fwd.x, _fwd.y, _fwd.z],
        { rocket: true, target: lock ? lock.id : undefined }
      );
    }
  }

  // --- HUD -----------------------------------------------------------------
  _hideAllDom() {
    for (const el of [this.elStatus, this.elCountdown, this.elBoard, this.elResults,
                      this.elHp, this.elWarn, this.elStorm, this.elAa, this.elFx, this.elKill]) {
      if (el) el.style.display = 'none';
    }
  }

  _fmtClock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  _updateDom(now, zr) {
    const r = this.client.race;
    if (!r) { this._hideAllDom(); return; }
    const row = this._localRow();
    const myRank = row && r.standings ? r.standings.indexOf(row) + 1 : 0;

    if (this.elCountdown) {
      if (this.phase === 'countdown') {
        const secs = Math.max(0, Math.ceil((r.startAt - now) / 1000));
        this.elCountdown.style.display = 'block';
        this.elCountdown.textContent = secs > 0 ? String(secs) : t('race.go');
      } else this.elCountdown.style.display = 'none';
    }

    if (this.elStatus) {
      if (this.phase === 'racing') {
        const left = Math.max(0, r.startAt + (r.durationMs || 0) - now);
        const ammo = row && row.rk ? ` &nbsp;·&nbsp; 🚀 <b>${row.rk}</b>` : '';
        this.elStatus.style.display = 'block';
        this.elStatus.innerHTML =
          `⏱ <b>${this._fmtClock(left)}</b> &nbsp;·&nbsp; ☠ <b>${row ? row.k : 0}</b>${ammo}` +
          (myRank ? ` &nbsp;·&nbsp; P<b>${myRank}/${r.standings.length}</b>` : '');
      } else this.elStatus.style.display = 'none';
    }

    // Outside-the-wall warning.
    if (this.elWarn) {
      this.elWarn.style.display = this._outside && this.phase === 'racing' ? 'block' : 'none';
    }

    // Room-wide storm notice (someone grabbed the storm pickup).
    if (this.elStorm) {
      this.elStorm.style.display =
        now < this._stormFlashUntil && this.phase === 'racing' ? 'block' : 'none';
    }

    // Room-wide AA notice (a new turret was just deployed).
    if (this.elAa) {
      this.elAa.style.display =
        now < this._aaFlashUntil && this.phase === 'racing' ? 'block' : 'none';
    }

    // Active mystery-effect banner (name + remaining seconds).
    if (this.elFx) {
      if (this._fx && this.phase === 'racing') {
        const secs = Math.max(0, Math.ceil((this._fx.until - now) / 1000));
        this.elFx.style.display = 'block';
        this.elFx.className = this._fx.good ? 'fx-good' : 'fx-bad';
        this.elFx.innerHTML = `<b>${t('fx.' + this._fx.key)}</b> · ${secs}s`;
      } else this.elFx.style.display = 'none';
    }

    // "+1 kill" flash.
    if (this.elKill) {
      this.elKill.style.display = now < this._killFlashUntil ? 'block' : 'none';
      if (now < this._killFlashUntil) this.elKill.textContent = t('battle.plusKill');
    }

    // HP bar (same element + look as the race).
    if (this.elHp) {
      if (this.phase === 'racing') {
        const hp = Math.max(0, Math.min(100, this.plane.hp));
        const col = hp > 55 ? '#39ff8a' : hp > 25 ? '#ffd23a' : '#ff5040';
        this.elHp.style.display = 'block';
        this.elHp.innerHTML = `<div class="hp-label">${t('race.hull')}</div><div class="hp-track"><div class="hp-fill" style="width:${hp}%;background:${col}"></div></div>`;
      } else this.elHp.style.display = 'none';
    }

    // Kills leaderboard.
    if (this.elBoard) {
      if (this.phase === 'countdown' || this.phase === 'racing') {
        const rows = (r.standings || []).slice(0, 8).map((s, i) => {
          const me = s.id === this.client.id;
          const dead = s.hp != null && s.hp <= 0 ? ' 💥' : '';
          return `<div class="lb-row${me ? ' me' : ''}"><span>${i + 1}. ${s.name || 'P' + s.id}${me ? t('lobby.you') : ''}${dead}</span><span>☠ ${s.k}</span></div>`;
        }).join('');
        this.elBoard.style.display = 'block';
        this.elBoard.innerHTML = `<div class="lb-title">${t('battle.title')}</div>${rows}`;
      } else this.elBoard.style.display = 'none';
    }

    // Final results — kills, with deaths as the small print.
    if (this.elResults) {
      if (this.phase === 'finished') {
        const lines = (r.standings || []).map((s, i) => {
          const me = s.id === this.client.id;
          const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
          return `<div class="res-row${me ? ' me' : ''}">${medal} ${s.name || 'P' + s.id}${me ? t('lobby.you') : ''} — ☠ ${s.k} · 💀 ${s.d}</div>`;
        });
        this.elResults.style.display = 'block';
        this.elResults.innerHTML = `<div class="res-title">${t('battle.results')}</div>${lines.join('')}<div class="res-foot">${t('race.returning')}</div>`;
      } else this.elResults.style.display = 'none';
    }
  }
}
