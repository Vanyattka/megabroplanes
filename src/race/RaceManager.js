import {
  Mesh,
  TorusGeometry,
  CylinderGeometry,
  MeshBasicMaterial,
  Group,
  Vector3,
} from 'three';
import {
  RACE_RING_TUBE,
  RACE_PASS_RADIUS,
  RACE_BEACON_HEIGHT,
  RACE_COLOR_NEXT,
  RACE_COLOR_FUTURE,
  RACE_COLOR_DONE,
} from '../config.js';

// Client-side race presentation + local checkpoint detection. The server owns
// the race state machine, the course, and the authoritative timing/standings
// (see server/server.js). This class:
//   - renders the gate rings + a light beacon over the next gate,
//   - detects when the local plane flies through its next gate and reports it,
//   - drives the race HUD (countdown, gate/timer/position, live leaderboard,
//     results board).
// It only does anything while multiplayer + an active flight (setActive).
export class RaceManager {
  constructor(scene, client, getPlane) {
    this.scene = scene;
    this.client = client;
    this.getPlane = getPlane;

    this.group = new Group();
    this.group.visible = false;
    scene.add(this.group);

    this.rings = [];        // [{ mesh, beacon }]
    this.course = [];
    this.phase = 'idle';
    this.active = false;    // MP mode AND in a flight
    this._courseKey = null;
    this._pendingCp = -1;   // last gate index we've already reported this pass
    this._tmp = new Vector3();

    this.elStatus = document.getElementById('race-status');
    this.elCountdown = document.getElementById('race-countdown');
    this.elBoard = document.getElementById('race-leaderboard');
    this.elResults = document.getElementById('race-results');
    this.btnRace = document.getElementById('btn-race');

    if (this.btnRace) {
      this.btnRace.addEventListener('click', () => this.client.sendRaceStart());
    }
    this.client.onRace((r) => this._onRace(r));
  }

  // main.js calls this when SP/MP mode or game state changes.
  setActive(on) {
    this.active = !!on;
    if (!this.active) {
      this.group.visible = false;
      this._hideAllDom();
    }
    this._refreshButton();
  }

  _onRace(r) {
    if (!r) {
      this.phase = 'idle';
      this.course = [];
      this._courseKey = null;
      this._pendingCp = -1;
      this._disposeRings();
      this._refreshButton();
      return;
    }
    this.phase = r.phase;
    // Re-arm the local checkpoint guard whenever we're not mid-race, so a new
    // race that happens to reuse the same course key still reports gate 0.
    if (r.phase !== 'racing') this._pendingCp = -1;
    const key =
      r.course && r.course.length
        ? `${r.course.length}:${r.course[0].x},${r.course[0].z}`
        : 'none';
    if (key !== this._courseKey) {
      this._courseKey = key;
      this.course = r.course || [];
      this._pendingCp = -1;
      this._buildRings();
    }
    this._refreshButton();
  }

  _localRow() {
    const r = this.client.race;
    if (!r || !r.standings) return null;
    const id = this.client.id;
    return r.standings.find((s) => s.id === id) || null;
  }

  _localNextCp() {
    const row = this._localRow();
    return row ? row.n : 0;
  }

  // --- in-world gates ------------------------------------------------------
  _disposeRings() {
    for (const ring of this.rings) {
      this.group.remove(ring.mesh);
      ring.mesh.geometry.dispose();
      ring.mesh.material.dispose();
      this.group.remove(ring.beacon);
      ring.beacon.geometry.dispose();
      ring.beacon.material.dispose();
    }
    this.rings = [];
  }

  _buildRings() {
    this._disposeRings();
    const cps = this.course;
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      const geo = new TorusGeometry(cp.r, RACE_RING_TUBE, 10, 36);
      const mat = new MeshBasicMaterial({
        color: RACE_COLOR_FUTURE,
        transparent: true,
        opacity: 0.85,
        toneMapped: false, // keep emissive-bright so bloom picks it up
      });
      const mesh = new Mesh(geo, mat);
      mesh.position.set(cp.x, cp.y, cp.z);
      // Face the gate perpendicular to the segment coming into it, so you fly
      // straight through the hole. TorusGeometry's hole axis is local +Z;
      // rotating about Y aligns it with the approach direction.
      const prev = i === 0 ? { x: 0, z: 0 } : cps[i - 1];
      const dx = cp.x - prev.x;
      const dz = cp.z - prev.z;
      if (dx * dx + dz * dz > 0.001) mesh.rotation.y = Math.atan2(dx, dz);
      this.group.add(mesh);

      // A faint tall light pillar — only shown over the gate you're chasing,
      // so it reads as a waypoint from kilometres away.
      const bgeo = new CylinderGeometry(2.5, 2.5, RACE_BEACON_HEIGHT, 6, 1, true);
      const bmat = new MeshBasicMaterial({
        color: RACE_COLOR_NEXT,
        transparent: true,
        opacity: 0.16,
        toneMapped: false,
        depthWrite: false,
      });
      const beacon = new Mesh(bgeo, bmat);
      beacon.position.set(cp.x, cp.y + RACE_BEACON_HEIGHT / 2, cp.z);
      beacon.visible = false;
      this.group.add(beacon);

      this.rings.push({ mesh, beacon });
    }
  }

  update(dt) {
    if (!this.active) return;
    const showWorld =
      this.phase === 'countdown' || this.phase === 'racing' || this.phase === 'finished';
    this.group.visible = showWorld && this.rings.length > 0;

    const nextCp = this._localNextCp();
    const racing = this.phase === 'racing';

    // Color + animate gates relative to local progress.
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      const isNext = i === nextCp;
      const done = i < nextCp;
      ring.mesh.material.color.setHex(
        done ? RACE_COLOR_DONE : isNext ? RACE_COLOR_NEXT : RACE_COLOR_FUTURE
      );
      ring.mesh.material.opacity = done ? 0.4 : isNext ? 0.95 : 0.7;
      ring.beacon.visible = isNext && (this.phase === 'countdown' || racing);
      if (isNext) ring.mesh.rotateZ(dt * 0.9); // gentle spin on the active gate
    }

    // Local checkpoint detection — fly within tolerance of the next gate.
    if (racing && nextCp < this.course.length) {
      const plane = this.getPlane();
      if (plane && plane.position) {
        const cp = this.course[nextCp];
        const d = this._tmp
          .set(cp.x - plane.position.x, cp.y - plane.position.y, cp.z - plane.position.z)
          .length();
        if (d < RACE_PASS_RADIUS && this._pendingCp !== nextCp) {
          this._pendingCp = nextCp;
          this.client.sendCheckpoint(nextCp);
        }
      }
    }

    this._updateDom();
  }

  // --- HUD -----------------------------------------------------------------
  _refreshButton() {
    if (!this.btnRace) return;
    if (!this.active) {
      this.btnRace.style.display = 'none';
      return;
    }
    this.btnRace.style.display = 'block';
    const idle = this.phase === 'idle' || this.phase === 'finished';
    this.btnRace.disabled = !idle;
    this.btnRace.textContent = idle
      ? '🏁 START RACE'
      : this.phase === 'countdown'
        ? '🏁 GET READY…'
        : '🏁 RACING…';
  }

  _hideAllDom() {
    if (this.elStatus) this.elStatus.style.display = 'none';
    if (this.elCountdown) this.elCountdown.style.display = 'none';
    if (this.elBoard) this.elBoard.style.display = 'none';
    if (this.elResults) this.elResults.style.display = 'none';
  }

  _fmt(ms) {
    if (ms == null) return '—';
    const s = ms / 1000;
    return `${s.toFixed(1)}s`;
  }

  _updateDom() {
    const r = this.client.race;
    if (!this.active || !r || this.phase === 'idle') {
      this._hideAllDom();
      return;
    }
    const now = Date.now();
    const total = this.course.length;
    const row = this._localRow();
    const myRank = row && r.standings ? r.standings.indexOf(row) + 1 : 0;

    // Countdown
    if (this.elCountdown) {
      if (this.phase === 'countdown') {
        const secs = Math.max(0, Math.ceil((r.startAt - now) / 1000));
        this.elCountdown.style.display = 'block';
        this.elCountdown.textContent = secs > 0 ? String(secs) : 'GO!';
      } else {
        this.elCountdown.style.display = 'none';
      }
    }

    // Status line (racing)
    if (this.elStatus) {
      if (this.phase === 'racing') {
        const elapsed = Math.max(0, now - r.startAt);
        const gate = row && row.f != null ? total : (row ? row.n : 0);
        const finished = row && row.f != null;
        this.elStatus.style.display = 'block';
        this.elStatus.innerHTML = finished
          ? `<span class="rs-fin">FINISHED · ${this._fmt(row.f)}</span>`
          : `GATE <b>${Math.min(gate + 1, total)}/${total}</b>` +
            ` &nbsp;·&nbsp; ⏱ <b>${(elapsed / 1000).toFixed(1)}s</b>` +
            (myRank ? ` &nbsp;·&nbsp; P<b>${myRank}/${r.standings.length}</b>` : '');
      } else {
        this.elStatus.style.display = 'none';
      }
    }

    // Live leaderboard (countdown + racing)
    if (this.elBoard) {
      if (this.phase === 'countdown' || this.phase === 'racing') {
        const rows = (r.standings || []).slice(0, 6).map((s, i) => {
          const me = s.id === this.client.id;
          const prog = s.f != null ? this._fmt(s.f) : `${s.n}/${total}`;
          return `<div class="lb-row${me ? ' me' : ''}"><span>${i + 1}. P${s.id}${me ? ' (you)' : ''}</span><span>${prog}</span></div>`;
        }).join('');
        this.elBoard.style.display = 'block';
        this.elBoard.innerHTML = `<div class="lb-title">RACE</div>${rows}`;
      } else {
        this.elBoard.style.display = 'none';
      }
    }

    // Results board (finished)
    if (this.elResults) {
      if (this.phase === 'finished') {
        const finishers = (r.standings || []).filter((s) => s.f != null);
        const dnf = (r.standings || []).filter((s) => s.f == null);
        const lines = finishers.map((s, i) => {
          const me = s.id === this.client.id;
          const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
          return `<div class="res-row${me ? ' me' : ''}">${medal} P${s.id}${me ? ' (you)' : ''} — ${this._fmt(s.f)}</div>`;
        });
        for (const s of dnf) {
          const me = s.id === this.client.id;
          lines.push(`<div class="res-row${me ? ' me' : ''}">— P${s.id}${me ? ' (you)' : ''} — DNF (${s.n}/${total})</div>`);
        }
        this.elResults.style.display = 'block';
        this.elResults.innerHTML =
          `<div class="res-title">🏁 RESULTS</div>${lines.join('')}` +
          `<div class="res-foot">next race can start in a moment…</div>`;
      } else {
        this.elResults.style.display = 'none';
      }
    }
  }
}
