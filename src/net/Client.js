const RECONNECT_MS = 3000;
const SEND_INTERVAL_MS = 50; // 20 Hz
// If we can't reconnect+resume within this window, give up and tear the race/
// lobby down locally. Slightly longer than the server's resume grace (90 s).
const RESUME_GIVEUP_MS = 95000;

export class MultiplayerClient {
  constructor(url) {
    this.url = url;
    this.id = null;
    this.hue = 0;
    this.connected = false;
    this.remotes = new Map(); // id -> { hue, pos, quat, throttle, crashed }
    this._lastSend = 0;
    this._statusListener = null;
    this._raceListener = null;
    this._lobbyListener = null;
    this._fireListener = null;
    // Latest race / lobby state from the server (null until first message).
    this.race = null;
    this.lobby = null;
    this._enabled = true;
    this._reconnectTimer = null;
    // Session resume: the server issues a token per session; we present it on
    // reconnect (?rt=) to reclaim the same id + room + race progress. prevId
    // lets a welcome tell a resume (same id) from a fresh session (new id).
    this.token = null;
    this.prevId = null;
    this._giveUpTimer = null;
    this._connect();
  }

  onStatusChange(fn) { this._statusListener = fn; }
  onRace(fn) { this._raceListener = fn; }
  onLobby(fn) { this._lobbyListener = fn; }
  onFire(fn) { this._fireListener = fn; }

  // Toggle the multiplayer system. When off, close the socket, drop
  // remotes, and stop the reconnect loop. Used by the singleplayer mode:
  // in SP we don't waste a connection or paint other players' planes.
  setEnabled(on) {
    const next = !!on;
    if (next === this._enabled) return;
    this._enabled = next;
    if (next) {
      this._connect();
    } else {
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
      this._clearGiveUp();
      if (this.ws) {
        try { this.ws.onclose = null; this.ws.close(); } catch {}
        this.ws = null;
      }
      this.connected = false;
      this.id = null;
      this.token = null;
      this.prevId = null;
      this.remotes.clear();
      this.race = null;
      this.lobby = null;
      if (this._raceListener) this._raceListener(null);
      if (this._lobbyListener) this._lobbyListener(null);
      this._notify();
    }
  }

  _clearGiveUp() {
    if (this._giveUpTimer) { clearTimeout(this._giveUpTimer); this._giveUpTimer = null; }
  }

  // Abandon a race/lobby we couldn't restore — falls the player cleanly back
  // to free flight (RaceManager tears down on a null race).
  _dropSession() {
    if (this.race) { this.race = null; if (this._raceListener) this._raceListener(null); }
    if (this.lobby) { this.lobby = null; if (this._lobbyListener) this._lobbyListener(null); }
  }

  _notify() {
    if (this._statusListener) {
      this._statusListener({
        connected: this.connected,
        count: this.remotes.size,
        id: this.id,
      });
    }
  }

  _connect() {
    if (!this._enabled) return;
    let ws;
    // Carry the resume token so a reconnect reclaims the same session.
    const url = this.token
      ? this.url + (this.url.includes('?') ? '&' : '?') + 'rt=' + encodeURIComponent(this.token)
      : this.url;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      console.warn('[net] connect failed, retry in', RECONNECT_MS, 'ms', e);
      this._reconnectTimer = setTimeout(() => this._connect(), RECONNECT_MS);
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      console.log('[net] connected to', this.url);
      this._notify();
    };
    ws.onmessage = (ev) => this._onMessage(ev.data);
    ws.onclose = () => {
      this.connected = false;
      this.remotes.clear();
      this._notify();
      // Only auto-reconnect while enabled. setEnabled(false) clears this
      // timer + nulls the socket so a stale handler can't queue retries.
      if (!this._enabled) return;
      // Keep the race/lobby ALIVE locally and try to reconnect+resume the same
      // session (token in the URL) — a brief drop (alt-tab, wifi blip) should
      // not eject the player. Only if we can't restore it within the grace
      // window do we tear it down (give-up timer).
      this._reconnectTimer = setTimeout(() => this._connect(), RECONNECT_MS);
      if (!this._giveUpTimer && (this.race || this.lobby)) {
        this._giveUpTimer = setTimeout(() => {
          this._giveUpTimer = null;
          this._dropSession();
        }, RESUME_GIVEUP_MS);
      }
    };
    ws.onerror = () => { /* close will fire next */ };
  }

  _onMessage(data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'welcome') {
      // Same id as before a drop == the server resumed our session; a new id
      // means a fresh one (first connect, or the resume window lapsed).
      const resumed = this.prevId != null && msg.id === this.prevId;
      this.id = msg.id;
      this.hue = msg.hue;
      if (msg.token) this.token = msg.token;
      this.prevId = msg.id;
      this._clearGiveUp();
      // Fresh identity → abandon any stale race/lobby so we land cleanly in
      // free flight. Resume → keep them; the server re-sends the race state.
      if (!resumed) this._dropSession();
      this._notify();
    } else if (msg.type === 'snapshot') {
      const seen = new Set();
      for (const s of msg.states) {
        if (s.id === this.id) continue;
        seen.add(s.id);
        let r = this.remotes.get(s.id);
        if (!r) {
          r = { hue: s.hue };
          this.remotes.set(s.id, r);
        }
        r.pos = s.p;
        r.quat = s.q;
        r.throttle = s.t;
        r.crashed = s.c === 1;
        r.type = s.pt;
        r.color = s.pc;
        r.hp = s.hp;
        r.gearDown = s.g === 1;
      }
      for (const id of this.remotes.keys()) {
        if (!seen.has(id)) this.remotes.delete(id);
      }
      this._notify();
    } else if (msg.type === 'race') {
      this.race = msg;
      if (this._raceListener) this._raceListener(msg);
    } else if (msg.type === 'lobby') {
      this.lobby = msg;
      if (this._lobbyListener) this._lobbyListener(msg);
    } else if (msg.type === 'fire') {
      if (this._fireListener) this._fireListener(msg); // {id, o, d}
    }
  }

  _send(obj) {
    if (this.connected && this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  setName(name) { this._send({ type: 'set_name', name }); }
  joinLobby(plane, time, color, gates) { this._send({ type: 'join_lobby', plane, time, color, gates }); }
  leaveLobby() { this._send({ type: 'leave_lobby' }); }
  // Drop the cached lobby snapshot. The server scopes lobby broadcasts to
  // CURRENT lobby members, so after we leave (or get moved into a race) no
  // fresh message ever overwrites the stale one — and the stale member list
  // still contains us, wedging currentMpPhase() in 'lobby' forever (dead
  // overlay, missing RACE button). Call on race entry and on leaving.
  clearLobby() {
    this.lobby = null;
    if (this._lobbyListener) this._lobbyListener(null);
  }
  lobbySet(patch) { this._send({ type: 'lobby_set', ...patch }); }
  lobbyStart() { this._send({ type: 'lobby_start' }); }

  // Report clearing the next checkpoint. The server validates ordering.
  sendCheckpoint(idx) { this._send({ type: 'cp', idx }); }
  // Self-reported "I went down" (e.g. flew into terrain). The server marks us
  // dead so other racers stop scoring/shooting us and its respawn timer runs
  // roughly in lockstep with the client's local respawn.
  sendDown() { this._send({ type: 'down' }); }
  // Combat: broadcast a tracer + claim a hit (server is HP authority).
  sendFire(o, d) { this._send({ type: 'fire', o, d }); }
  sendHit(target) { this._send({ type: 'hit', target }); }

  // `cp` (optional) = the local race checkpoint progress (gates cleared). Sent
  // alongside state at 20 Hz so the server self-heals any checkpoint that the
  // one-shot sendCheckpoint() failed to deliver (e.g. during a reconnect).
  sendState(plane, cp) {
    if (!this._enabled) return;
    if (!this.connected || !this.ws || this.ws.readyState !== 1) return;
    const now = performance.now();
    if (now - this._lastSend < SEND_INTERVAL_MS) return;
    this._lastSend = now;
    const p = plane.position;
    const q = plane.quaternion;
    const state = {
      p: [p.x, p.y, p.z],
      q: [q.x, q.y, q.z, q.w],
      t: plane.throttle,
      c: plane.crashed ? 1 : 0,
      g: plane.gearDown ? 1 : 0, // landing gear, so remotes show it too
      pt: plane.type,   // plane type (cessna/piper/jet)
      pc: plane.color,  // body color hex int
    };
    if (typeof cp === 'number') state.cp = cp;
    this.ws.send(JSON.stringify({ type: 'state', state }));
  }
}
