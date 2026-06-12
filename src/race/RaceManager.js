import {
  Mesh,
  TorusGeometry,
  CylinderGeometry,
  MeshBasicMaterial,
  Group,
  Vector3,
  Quaternion,
} from 'three';
import {
  RACE_RING_TUBE,
  RACE_PASS_RADIUS,
  RACE_BEACON_HEIGHT,
  RACE_COLOR_NEXT,
  RACE_COLOR_FUTURE,
  RACE_COLOR_DONE,
  GUN_FIRE_INTERVAL,
  GUN_MUZZLE_OFFSET,
  RACE_RESPAWN_MS,
} from '../config.js';

// Owns the full race experience once the lobby launches: the isolated session
// (the server only sends us other racers), the gate rings, checkpoint
// detection, combat (guns + HP + tracers, all server-authoritative on damage),
// local death/respawn, and the race HUD. It's fed its dependencies (plane,
// input, bullets, explosion, audio, and a few callbacks) by main.js so all the
// race logic lives in one place.
const _fwd = new Vector3();
const _mz = new Vector3();
const _v = new Vector3();
const _seg = new Vector3();
const _proj = new Vector3();

export class RaceManager {
  constructor(opts) {
    this.scene = opts.scene;
    this.client = opts.client;
    this.plane = opts.plane;
    this.input = opts.input;
    this.touch = opts.touch;
    this.bullets = opts.bullets;
    this.explosion = opts.explosion;
    this.audio = opts.audio;
    this.getRemoteTargets = opts.getRemoteTargets; // () => [{id, position}]
    this.applyLoadout = opts.applyLoadout;         // (type, color) => void
    this.applyRaceTime = opts.applyRaceTime;       // (timeKey) => void
    this.restoreFreeTime = opts.restoreFreeTime;   // () => void
    this.getMyColor = opts.getMyColor;             // () => hex
    this.onRaceEnd = opts.onRaceEnd;               // () => void (back to free flight)
    this.snapCamera = null;                        // () => void, set by main.js after camera init

    this.group = new Group();
    this.group.visible = false;
    this.scene.add(this.group);

    this.rings = [];
    this.course = [];
    this.phase = 'idle';
    this.inRace = false;       // I'm a participant in an active race
    this._courseKey = null;
    // Local checkpoint cursor — the gate we're flying toward. Advanced the
    // instant we pass a gate (then reported to the server), instead of waiting
    // for the server to echo the previous gate back. That round-trip lag was
    // dropping gates for fast planes / closely-spaced gates on a laggy link.
    this._localCp = 0;
    // Plane position on the previous update frame — the gate sweep tests the
    // segment between it and the current position so a fast plane can't tunnel
    // past a gate between frames.
    this._lastPos = new Vector3();
    this._fireCd = 0;
    this._localDowned = false;
    // Death by gunfire is only armed once the server has reported us alive
    // (hp > 0). After we go down we disarm until the server's snapshot shows
    // a healed plane again — otherwise a stale hp<=0 snapshot that's still in
    // flight when we respawn would instantly re-kill us in a loop.
    this._hpArmed = false;
    this._respawnAt = 0;
    this._deadRemotes = new Set();

    this.elStatus = document.getElementById('race-status');
    this.elCountdown = document.getElementById('race-countdown');
    this.elBoard = document.getElementById('race-leaderboard');
    this.elResults = document.getElementById('race-results');
    this.elHp = document.getElementById('race-hp');
    this.elCross = document.getElementById('race-crosshair');

    // Remote tracers (server relays others' shots).
    this.client.onFire((msg) => {
      if (!this.inRace || !msg.o || !msg.d) return;
      this.bullets.spawn(_v.fromArray(msg.o), _mz.fromArray(msg.d), msg.id);
    });
    // Damage authority is the server; when our local bullet hits, claim it.
    this.bullets.onHit = (targetId) => this.client.sendHit(targetId);

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
  _localNextCp() { const row = this._localRow(); return row ? row.n : 0; }
  // The gate the local player is currently chasing — drives the in-world rings,
  // the HUD counter and the minimap so they all advance together the instant a
  // gate is passed, instead of waiting a network round-trip.
  get localCp() { return this._localCp; }

  _onRace(r) {
    if (!r || r.phase === 'idle') {
      if (this.inRace) this._teardown();
      this.phase = 'idle';
      return;
    }
    const wasIn = this.inRace;
    const amPart = this._amParticipant(r);
    this.phase = r.phase;

    if (amPart && !wasIn) {
      // Entering a race: rebuild course, apply voted plane + my color + voted
      // time, and spawn airborne at the start line.
      this.inRace = true;
      this.course = r.course || [];
      this._courseKey = this._key(r);
      this._buildRings();
      this._localCp = 0;
      this._localDowned = false;
      this._hpArmed = false;
      this._deadRemotes.clear();
      this.bullets.clear();
      // Spawn first (most important), then apply cosmetics — so a hiccup in
      // loadout/time can never leave the player un-spawned mid-race.
      const slot = Math.max(0, r.standings.findIndex((s) => s.id === this.client.id));
      const pose = this._gatePose(0, slot, r.standings.length, 380);
      this.plane.spawnAirborne(pose.pos, pose.q, pose.vel, 1);
      let myColor = this.plane.color;
      try { if (this.getMyColor) { const c = this.getMyColor(); if (c != null) myColor = c; } } catch {}
      this.applyLoadout(r.plane, myColor);
      this.applyRaceTime(r.timeKey);
      this.plane.spawnAirborne(pose.pos, pose.q, pose.vel, 1); // re-assert after loadout rebuild
      if (this.snapCamera) this.snapCamera();
      if (this.elCross) this.elCross.style.display = 'block';
    } else if (amPart && wasIn) {
      // Course shouldn't change mid-race, but keep it fresh just in case.
      const key = this._key(r);
      if (key !== this._courseKey) { this._courseKey = key; this.course = r.course || []; this._buildRings(); }
    } else if (!amPart && wasIn) {
      this._teardown();
    }
  }

  _key(r) {
    return r.course && r.course.length ? `${r.course.length}:${r.course[0].x},${r.course[0].z}` : 'none';
  }

  _teardown() {
    this.inRace = false;
    this.phase = 'idle';
    this.group.visible = false;
    this._disposeRings();
    this.bullets.clear();
    this._localDowned = false;
    this._deadRemotes.clear();
    this._hideAllDom();
    if (this.elCross) this.elCross.style.display = 'none';
    if (this.restoreFreeTime) this.restoreFreeTime();
    if (this.onRaceEnd) this.onRaceEnd();
  }

  // --- gates ---------------------------------------------------------------
  _disposeRings() {
    for (const ring of this.rings) {
      this.group.remove(ring.mesh); ring.mesh.geometry.dispose(); ring.mesh.material.dispose();
      this.group.remove(ring.beacon); ring.beacon.geometry.dispose(); ring.beacon.material.dispose();
    }
    this.rings = [];
  }

  _buildRings() {
    this._disposeRings();
    const cps = this.course;
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      const geo = new TorusGeometry(cp.r, RACE_RING_TUBE, 10, 36);
      const mat = new MeshBasicMaterial({ color: RACE_COLOR_FUTURE, transparent: true, opacity: 0.85, toneMapped: false });
      const mesh = new Mesh(geo, mat);
      mesh.position.set(cp.x, cp.y, cp.z);
      const prev = i === 0 ? { x: 0, z: 0 } : cps[i - 1];
      const dx = cp.x - prev.x, dz = cp.z - prev.z;
      if (dx * dx + dz * dz > 0.001) mesh.rotation.y = Math.atan2(dx, dz);
      this.group.add(mesh);

      const bgeo = new CylinderGeometry(2.5, 2.5, RACE_BEACON_HEIGHT, 6, 1, true);
      const bmat = new MeshBasicMaterial({ color: RACE_COLOR_NEXT, transparent: true, opacity: 0.16, toneMapped: false, depthWrite: false });
      const beacon = new Mesh(bgeo, bmat);
      beacon.position.set(cp.x, cp.y + RACE_BEACON_HEIGHT / 2, cp.z);
      beacon.visible = false;
      this.group.add(beacon);
      this.rings.push({ mesh, beacon });
    }
  }

  // Airborne pose `back` metres before gate `idx`, in lane `slot` of `total`.
  _gatePose(idx, slot, total, back) {
    const cps = this.course;
    const gate = cps[Math.min(idx, cps.length - 1)] || { x: 0, y: 150, z: 0 };
    const prev = idx > 0 ? cps[idx - 1] : { x: 0, z: 0 };
    let dx = gate.x - prev.x, dz = gate.z - prev.z;
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const lateral = (slot - (total - 1) / 2) * 26;
    const pos = new Vector3(
      gate.x - dx * back + -dz * lateral,
      gate.y,
      gate.z - dz * back + dx * lateral
    );
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), new Vector3(dx, 0, dz));
    const vel = new Vector3(dx, 0, dz).multiplyScalar(75);
    return { pos, q, vel };
  }

  // True while the player must take damage / explosions are forced on.
  isCombatActive() { return this.inRace && this.phase === 'racing'; }

  // During the pre-race countdown the plane is held at the start line (physics
  // frozen) so it doesn't fly forward and overshoot the first gate before the
  // clock even starts. main.js skips plane physics while this is true.
  get holdAtStart() { return this.inRace && this.phase === 'countdown'; }

  // R during a race respawns at the next gate (airborne), NOT the home runway.
  respawnAtGate() {
    if (!this.inRace) return;
    const target = this._localNextCp();
    const pose = this._gatePose(target, 0, 1, 300);
    this.plane.spawnAirborne(pose.pos, pose.q, pose.vel, 1);
    if (this.snapCamera) this.snapCamera();
    this._localDowned = false;
    this._localCp = target;
  }

  update(dt) {
    if (!this.inRace) return;
    const now = Date.now();
    const racing = this.phase === 'racing';
    this.group.visible = this.rings.length > 0;

    // The server is authoritative for the standings, but local detection drives
    // its own cursor (this._localCp) so a gate pass registers instantly. Pull
    // the cursor forward if the server is somehow ahead (defensive — the server
    // only advances it in response to our own cp messages).
    const serverCp = this._localNextCp();
    if (serverCp > this._localCp) this._localCp = serverCp;
    const nextCp = this._localCp;
    // Gate colors + spin.
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      const isNext = i === nextCp;
      const done = i < nextCp;
      ring.mesh.material.color.setHex(done ? RACE_COLOR_DONE : isNext ? RACE_COLOR_NEXT : RACE_COLOR_FUTURE);
      ring.mesh.material.opacity = done ? 0.4 : isNext ? 0.95 : 0.7;
      ring.beacon.visible = isNext;
      if (isNext) ring.mesh.rotateZ(dt * 0.9);
    }

    // Local HP / death / respawn.
    const row = this._localRow();
    if (row) this.plane.hp = row.hp != null ? row.hp : this.plane.maxHp;
    // Arm gunfire-death only once the server reports us alive again, so a
    // stale hp<=0 snapshot still in flight at respawn can't re-kill us.
    if (row && row.hp != null && row.hp > 0) this._hpArmed = true;
    // Downed either by gunfire (the server drove HP to 0) OR by flying into the
    // terrain (physics set plane.crashed and main.js already played the
    // explosion). Both funnel into the same downed→respawn flow, so a terrain
    // crash mid-race no longer hides the plane forever with no way back.
    if (racing && !this._localDowned) {
      if (this._hpArmed && row && row.hp <= 0 && !this.plane.crashed) {
        this._die(now);
      } else if (this.plane.crashed) {
        this._enterDowned(now);
      }
    }
    if (this._localDowned && now >= this._respawnAt) {
      const pose = this._gatePose(serverCp, 0, 1, 300);
      this.plane.spawnAirborne(pose.pos, pose.q, pose.vel, 1);
      if (this.snapCamera) this.snapCamera();
      this._localDowned = false;
      // Re-sync the cursor to the server's authoritative gate, so a death
      // mid-pass can't leave us aiming at the wrong gate.
      this._localCp = serverCp;
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

    // Combat: fire + bullet sim.
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

    // Local checkpoint detection. Advance the cursor the instant we pass a gate
    // and report it — without waiting for the server to echo the previous gate
    // back. The server still validates ordering, and because we send strictly
    // increasing indices over an ordered (TCP) socket it stays in lockstep.
    // This is what fixes "rings sometimes not counted" on a laggy link.
    // The test is SWEPT (gate centre vs the segment from last frame's position
    // to this one) so a fast plane can't tunnel past a gate between frames.
    if (racing && !this._localDowned && this._localCp < this.course.length) {
      const cp = this.course[this._localCp];
      _v.set(cp.x, cp.y, cp.z);
      const moved = this._lastPos.distanceTo(this.plane.position);
      // Sweep over a normal frame's travel; a teleport (respawn) is too big to
      // sweep meaningfully, so fall back to a point test that frame.
      let d;
      if (moved > 0.001 && moved < 120) {
        _seg.subVectors(this.plane.position, this._lastPos);
        const len2 = _seg.lengthSq();
        let t = _proj.subVectors(_v, this._lastPos).dot(_seg) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        _proj.copy(this._lastPos).addScaledVector(_seg, t);
        d = _proj.distanceTo(_v);
      } else {
        d = _v.distanceTo(this.plane.position);
      }
      if (d < RACE_PASS_RADIUS) {
        this.client.sendCheckpoint(this._localCp);
        this._localCp++;
      }
    }

    this._lastPos.copy(this.plane.position);
    this._updateDom(now);
  }

  // Shared "go down" transition for both gunfire deaths and terrain crashes.
  // Tells the server we're out (so it stops scoring us as a live target and
  // runs its own respawn timer roughly in lockstep), disarms gunfire-death
  // until the server heals us, and schedules the local respawn.
  _enterDowned(now) {
    this._localDowned = true;
    this._respawnAt = now + RACE_RESPAWN_MS;
    this._hpArmed = false;
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
    for (const el of [this.elStatus, this.elCountdown, this.elBoard, this.elResults, this.elHp]) {
      if (el) el.style.display = 'none';
    }
  }
  _fmt(ms) { return ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`; }

  _updateDom(now) {
    const r = this.client.race;
    if (!r) { this._hideAllDom(); return; }
    const total = this.course.length;
    const row = this._localRow();
    const myRank = row && r.standings ? r.standings.indexOf(row) + 1 : 0;

    if (this.elCountdown) {
      if (this.phase === 'countdown') {
        const secs = Math.max(0, Math.ceil((r.startAt - now) / 1000));
        this.elCountdown.style.display = 'block';
        this.elCountdown.textContent = secs > 0 ? String(secs) : 'GO!';
      } else this.elCountdown.style.display = 'none';
    }

    if (this.elStatus) {
      if (this.phase === 'racing') {
        const elapsed = Math.max(0, now - r.startAt);
        const finished = row && row.f != null;
        // Use the local cursor for my own gate counter so it ticks up the
        // instant I pass, not a network round-trip later (the leaderboard still
        // shows the server-authoritative count for everyone).
        const gate = finished ? total : this._localCp;
        this.elStatus.style.display = 'block';
        this.elStatus.innerHTML = finished
          ? `<span class="rs-fin">FINISHED · ${this._fmt(row.f)}</span>`
          : `GATE <b>${Math.min(gate + 1, total)}/${total}</b> &nbsp;·&nbsp; ⏱ <b>${(elapsed / 1000).toFixed(1)}s</b>` +
            (myRank ? ` &nbsp;·&nbsp; P<b>${myRank}/${r.standings.length}</b>` : '');
      } else this.elStatus.style.display = 'none';
    }

    // HP bar.
    if (this.elHp) {
      if (this.phase === 'racing') {
        const hp = Math.max(0, Math.min(100, this.plane.hp));
        const col = hp > 55 ? '#39ff8a' : hp > 25 ? '#ffd23a' : '#ff5040';
        this.elHp.style.display = 'block';
        this.elHp.innerHTML = `<div class="hp-label">HULL</div><div class="hp-track"><div class="hp-fill" style="width:${hp}%;background:${col}"></div></div>`;
      } else this.elHp.style.display = 'none';
    }

    if (this.elBoard) {
      if (this.phase === 'countdown' || this.phase === 'racing') {
        const rows = (r.standings || []).slice(0, 8).map((s, i) => {
          const me = s.id === this.client.id;
          const prog = s.f != null ? this._fmt(s.f) : `${s.n}/${total}`;
          const dead = s.hp != null && s.hp <= 0 ? ' 💥' : '';
          return `<div class="lb-row${me ? ' me' : ''}"><span>${i + 1}. ${s.name || 'P' + s.id}${me ? ' (you)' : ''}${dead}</span><span>${prog}</span></div>`;
        }).join('');
        this.elBoard.style.display = 'block';
        this.elBoard.innerHTML = `<div class="lb-title">RACE</div>${rows}`;
      } else this.elBoard.style.display = 'none';
    }

    if (this.elResults) {
      if (this.phase === 'finished') {
        const fin = (r.standings || []).filter((s) => s.f != null);
        const dnf = (r.standings || []).filter((s) => s.f == null);
        const lines = fin.map((s, i) => {
          const me = s.id === this.client.id;
          const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
          return `<div class="res-row${me ? ' me' : ''}">${medal} ${s.name || 'P' + s.id}${me ? ' (you)' : ''} — ${this._fmt(s.f)}</div>`;
        });
        for (const s of dnf) {
          const me = s.id === this.client.id;
          lines.push(`<div class="res-row${me ? ' me' : ''}">— ${s.name || 'P' + s.id}${me ? ' (you)' : ''} — DNF (${s.n}/${total})</div>`);
        }
        this.elResults.style.display = 'block';
        this.elResults.innerHTML = `<div class="res-title">🏁 RESULTS</div>${lines.join('')}<div class="res-foot">returning to free flight…</div>`;
      } else this.elResults.style.display = 'none';
    }
  }
}
