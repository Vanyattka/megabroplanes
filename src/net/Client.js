const RECONNECT_MS = 3000;
const SEND_INTERVAL_MS = 50; // 20 Hz

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
    // Latest race state from the server (null until first 'race' message).
    this.race = null;
    this._enabled = true;
    this._reconnectTimer = null;
    this._connect();
  }

  onStatusChange(fn) { this._statusListener = fn; }
  onRace(fn) { this._raceListener = fn; }

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
      if (this.ws) {
        try { this.ws.onclose = null; this.ws.close(); } catch {}
        this.ws = null;
      }
      this.connected = false;
      this.id = null;
      this.remotes.clear();
      this.race = null;
      if (this._raceListener) this._raceListener(null);
      this._notify();
    }
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
    try {
      ws = new WebSocket(this.url);
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
      if (this._enabled) {
        this._reconnectTimer = setTimeout(() => this._connect(), RECONNECT_MS);
      }
    };
    ws.onerror = () => { /* close will fire next */ };
  }

  _onMessage(data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'welcome') {
      this.id = msg.id;
      this.hue = msg.hue;
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
      }
      for (const id of this.remotes.keys()) {
        if (!seen.has(id)) this.remotes.delete(id);
      }
      this._notify();
    } else if (msg.type === 'race') {
      this.race = msg;
      if (this._raceListener) this._raceListener(msg);
    }
  }

  // Ask the server to start a race (no-op server-side unless idle/finished).
  sendRaceStart() {
    if (this.connected && this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'race_start' }));
    }
  }

  // Report clearing the next checkpoint. The server validates ordering.
  sendCheckpoint(idx) {
    if (this.connected && this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'cp', idx }));
    }
  }

  sendState(plane) {
    if (!this._enabled) return;
    if (!this.connected || !this.ws || this.ws.readyState !== 1) return;
    const now = performance.now();
    if (now - this._lastSend < SEND_INTERVAL_MS) return;
    this._lastSend = now;
    const p = plane.position;
    const q = plane.quaternion;
    this.ws.send(JSON.stringify({
      type: 'state',
      state: {
        p: [p.x, p.y, p.z],
        q: [q.x, q.y, q.z, q.w],
        t: plane.throttle,
        c: plane.crashed ? 1 : 0,
        pt: plane.type,   // plane type (cessna/piper/jet)
        pc: plane.color,  // body color hex int
      },
    }));
  }
}
