import {
  Mesh,
  Group,
  Vector3,
  Quaternion,
  CylinderGeometry,
  OctahedronGeometry,
  IcosahedronGeometry,
  MeshBasicMaterial,
  DoubleSide,
} from 'three';
import {
  GUN_FIRE_INTERVAL,
  GUN_MUZZLE_OFFSET,
  RACE_RESPAWN_MS,
  BATTLE_WALL_HEIGHT,
  BATTLE_WALL_SEGMENTS,
  BATTLE_WALL_OPACITY,
  BATTLE_ZONE_COLOR,
  BATTLE_ZONE_COLOR_OUT,
  BATTLE_PICKUP_RADIUS,
  BATTLE_PICKUP_COLOR,
  BATTLE_PICKUP_CORE,
  BATTLE_PICKUP_SIZE,
  BATTLE_EFFECTS,
} from '../config.js';
import { t } from '../ui/I18n.js';

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
    this._pickupMeshes = new Map(); // id -> { group, shell, core, baseY }
    this._lastPos = new Vector3();
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

    this.elStatus = document.getElementById('race-status');
    this.elCountdown = document.getElementById('race-countdown');
    this.elBoard = document.getElementById('race-leaderboard');
    this.elResults = document.getElementById('race-results');
    this.elHp = document.getElementById('race-hp');
    this.elCross = document.getElementById('race-crosshair');
    this.elWarn = document.getElementById('battle-warning');
    this.elStorm = document.getElementById('battle-storm');
    this.elFx = document.getElementById('battle-fx');
    this.elKill = document.getElementById('battle-kill');

    this.client.onFire((msg) => {
      if (!this.inBattle || !msg.o || !msg.d) return;
      this.bullets.spawn(_v.fromArray(msg.o), _mz.fromArray(msg.d), msg.id);
    });
    this.bullets.onHit = (targetId) => this.client.sendHit(targetId);
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

  // --- mystery pickup orbs -------------------------------------------------
  _addPickupMesh(p) {
    const group = new Group();
    // Outer gold wireframe shell + inner magenta core, both HDR so they bloom
    // — reads as an obvious "grab me", says nothing about what's inside.
    const shell = new Mesh(
      new IcosahedronGeometry(BATTLE_PICKUP_SIZE, 0),
      new MeshBasicMaterial({ color: BATTLE_PICKUP_COLOR, wireframe: true, toneMapped: false })
    );
    const core = new Mesh(
      new OctahedronGeometry(BATTLE_PICKUP_SIZE * 0.45, 0),
      new MeshBasicMaterial({ color: BATTLE_PICKUP_CORE, toneMapped: false })
    );
    group.add(shell);
    group.add(core);
    group.position.set(p.x, p.y, p.z);
    this.group.add(group);
    this._pickupMeshes.set(p.id, { group, shell, core, baseY: p.y });
  }

  _removePickupMesh(id) {
    const m = this._pickupMeshes.get(id);
    if (!m) return;
    this.group.remove(m.group);
    m.shell.geometry.dispose();
    m.shell.material.dispose();
    m.core.geometry.dispose();
    m.core.material.dispose();
    this._pickupMeshes.delete(id);
  }

  _disposeAllPickups() {
    for (const id of [...this._pickupMeshes.keys()]) this._removePickupMesh(id);
  }

  // Sync local orbs to the server's pickup list (spawn new, drop taken/culled).
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

  // --- spawn/respawn poses -------------------------------------------------
  // Match start: evenly spaced on a ring at half the initial radius, everyone
  // facing the arena centre.
  _spawnPose(slot, total) {
    const z = this._zone || { x: 0, z: 0, r0: 2000 };
    const ang = (slot / Math.max(1, total)) * Math.PI * 2;
    const rad = z.r0 * 0.5;
    const px = z.x + Math.cos(ang) * rad;
    const pz = z.z + Math.sin(ang) * rad;
    let dx = z.x - px, dz = z.z - pz;
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const pos = new Vector3(px, 260, pz);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), new Vector3(dx, 0, dz));
    const vel = new Vector3(dx, 0, dz).multiplyScalar(75);
    return { pos, q, vel };
  }

  // Respawn: a random spot well inside the CURRENT zone, facing the centre.
  _respawnPose() {
    const z = this._zone || { x: 0, z: 0, r1: 400, baseR: 2000, baseAt: 0, shrinkMs: 1 };
    const zr = z.baseAt ? zoneRadius(z, Date.now()) : z.r1;
    const ang = Math.random() * Math.PI * 2;
    const rad = (0.3 + Math.random() * 0.4) * zr;
    const px = z.x + Math.cos(ang) * rad;
    const pz = z.z + Math.sin(ang) * rad;
    let dx = z.x - px, dz = z.z - pz;
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const pos = new Vector3(px, 200 + Math.random() * 160, pz);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), new Vector3(dx, 0, dz));
    const vel = new Vector3(dx, 0, dz).multiplyScalar(75);
    return { pos, q, vel };
  }

  // True while the player must take damage / explosions are forced on.
  isCombatActive() { return this.inBattle && this.phase === 'racing'; }
  // Physics frozen at the spawn ring during the pre-match countdown.
  get holdAtStart() { return this.inBattle && this.phase === 'countdown'; }

  // R during a battle = manual respawn inside the zone.
  respawnNow() {
    if (!this.inBattle) return;
    const pose = this._respawnPose();
    this.plane.spawnAirborne(pose.pos, pose.q, pose.vel, 1);
    if (this.snapCamera) this.snapCamera();
    this._localDowned = false;
  }

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

    // Pickup orbs: sync with the server list, spin + bob, detect fly-through.
    this._syncPickups(r.pickups || []);
    for (const [id, m] of this._pickupMeshes) {
      m.group.rotation.y += dt * 1.6;
      m.core.rotation.x += dt * 2.4;
      m.group.position.y = m.baseY + Math.sin(now / 500 + id) * 3;
    }
    if (racing && !this._localDowned && !this.plane.crashed) {
      const moved = this._lastPos.distanceTo(this.plane.position);
      for (const [id, m] of this._pickupMeshes) {
        _v.copy(m.group.position);
        // Swept segment test (same as gate detection) so a fast plane can't
        // tunnel past an orb between frames; falls back to a point test
        // across a teleport.
        let d;
        if (moved > 0.001 && moved < 120) {
          _seg.subVectors(this.plane.position, this._lastPos);
          const len2 = _seg.lengthSq();
          let t01 = _proj.subVectors(_v, this._lastPos).dot(_seg) / len2;
          t01 = t01 < 0 ? 0 : t01 > 1 ? 1 : t01;
          _proj.copy(this._lastPos).addScaledVector(_seg, t01);
          d = _proj.distanceTo(_v);
        } else {
          d = _v.distanceTo(this.plane.position);
        }
        if (d < BATTLE_PICKUP_RADIUS) {
          // Optimistically remove the orb; the server confirms with an `fx`
          // reveal (first claim wins — if someone beat us to it by a tick,
          // the orb is gone either way and no effect arrives).
          this.client.sendPickup(id);
          this._removePickupMesh(id);
          break;
        }
      }
    }

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
    const combat = racing && !this._localDowned && !this.plane.crashed;
    const firing = combat && !this.plane.onGround &&
      (this.input.isPressed('Space') || !!(this.touch && this.touch.fire));
    if (firing && this._fireCd <= 0) {
      this._fire();
      this._fireCd = GUN_FIRE_INTERVAL;
    }
    const targets = this.getRemoteTargets ? this.getRemoteTargets() : null;
    this.bullets.update(dt, combat ? targets : null);

    this._lastPos.copy(this.plane.position);
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
  }

  // --- HUD -----------------------------------------------------------------
  _hideAllDom() {
    for (const el of [this.elStatus, this.elCountdown, this.elBoard, this.elResults,
                      this.elHp, this.elWarn, this.elStorm, this.elFx, this.elKill]) {
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
        this.elStatus.style.display = 'block';
        this.elStatus.innerHTML =
          `⏱ <b>${this._fmtClock(left)}</b> &nbsp;·&nbsp; ☠ <b>${row ? row.k : 0}</b>` +
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
