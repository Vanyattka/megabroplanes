import { PLANE_TYPES, BODY_COLORS, TIME_PRESETS, RACE_GATE_OPTIONS } from '../config.js';

// Time options offered in the lobby vote (skip 'auto' — a race wants a fixed,
// shared sky).
const TIME_VOTE_KEYS = ['day', 'morning', 'sunrise', 'sunset', 'night'].filter(
  (k) => TIME_PRESETS[k]
);

// The race lobby: a waiting room where players gather, vote on the shared
// plane type + time of day, pick their own color, and launch. Launch happens
// either when the host hits START or when the auto-fill countdown elapses
// (which starts once >=2 players are waiting, and shortens when the lobby
// fills up). Once launched, the server moves everyone into an isolated race.
export class Lobby {
  constructor(client) {
    this.client = client;
    this.root = document.getElementById('lobby');
    this.membersEl = document.getElementById('lobby-members');
    this.planeEl = document.getElementById('lobby-plane');
    this.timeEl = document.getElementById('lobby-time');
    this.gatesEl = document.getElementById('lobby-gates');
    this.colorEl = document.getElementById('lobby-color');
    this.timerEl = document.getElementById('lobby-timer');
    this.startBtn = document.getElementById('lobby-start');
    this.leaveBtn = document.getElementById('lobby-leave');
    this.voteNoteEl = document.getElementById('lobby-vote-note');
    this.chatLogEl = document.getElementById('lobby-chat-log');
    this.chatInputEl = document.getElementById('lobby-chat-input');
    this.chatSendEl = document.getElementById('lobby-chat-send');

    this.onLeave = null;
    // Wired by main.js to spin the lead-voted plane in the shared 3D hero.
    this.onHero = null;
    this._mine = { plane: null, time: null, color: null, gates: null };

    // Countdown ticker state — so the "Launching in Ns" text counts down every
    // second on its own, not only when a vote/lobby message happens to arrive.
    this._countdownTimer = null;
    this._launchAt = null;
    this._memberCount = 0;
    this._full = 0;

    this._buildOptionButtons();
    this._wireChat();
    if (this.startBtn) this.startBtn.addEventListener('click', () => this.client.lobbyStart());
    if (this.leaveBtn) this.leaveBtn.addEventListener('click', () => { if (this.onLeave) this.onLeave(); });

    this.client.onLobby((r) => this._render(r));
  }

  _buildOptionButtons() {
    if (this.planeEl) {
      this.planeEl.innerHTML = '';
      for (const key of Object.keys(PLANE_TYPES)) {
        const b = document.createElement('button');
        b.className = 'lobby-opt';
        b.dataset.kind = 'plane';
        b.dataset.val = key;
        b.textContent = PLANE_TYPES[key].name.toUpperCase();
        b.addEventListener('click', () => this.client.lobbySet({ plane: key }));
        this.planeEl.appendChild(b);
      }
    }
    if (this.timeEl) {
      this.timeEl.innerHTML = '';
      for (const key of TIME_VOTE_KEYS) {
        const b = document.createElement('button');
        b.className = 'lobby-opt';
        b.dataset.kind = 'time';
        b.dataset.val = key;
        b.textContent = TIME_PRESETS[key].label.toUpperCase();
        b.addEventListener('click', () => this.client.lobbySet({ time: key }));
        this.timeEl.appendChild(b);
      }
    }
    if (this.gatesEl) {
      this.gatesEl.innerHTML = '';
      for (const n of RACE_GATE_OPTIONS) {
        const b = document.createElement('button');
        b.className = 'lobby-opt';
        b.dataset.kind = 'gates';
        b.dataset.val = String(n);
        b.textContent = `${n} FLAGS`;
        b.addEventListener('click', () => this.client.lobbySet({ gates: n }));
        this.gatesEl.appendChild(b);
      }
    }
    if (this.colorEl) {
      this.colorEl.innerHTML = '';
      for (const c of BODY_COLORS) {
        const s = document.createElement('div');
        s.className = 'lobby-swatch';
        s.dataset.hex = String(c.hex);
        s.style.background = `#${c.hex.toString(16).padStart(6, '0')}`;
        s.title = c.name;
        s.addEventListener('click', () => this.client.lobbySet({ color: c.hex }));
        this.colorEl.appendChild(s);
      }
    }
  }

  // Join with an initial loadout (from the menu selection).
  join(loadout) {
    this._mine = { plane: loadout.type, time: 'day', color: loadout.color, gates: RACE_GATE_OPTIONS[0] };
    this.clearChat(); // a fresh lobby session starts with an empty chat
    this.client.joinLobby(loadout.type, 'day', loadout.color, RACE_GATE_OPTIONS[0]);
    if (this.root) this.root.classList.remove('hidden');
  }

  show() { if (this.root) this.root.classList.remove('hidden'); }
  // Hiding the lobby = leaving it (race started, left, or disconnected). Stop
  // the countdown ticker and wipe the chat so the next lobby starts clean.
  hide() {
    if (this.root) this.root.classList.add('hidden');
    this._stopCountdown();
    this.clearChat();
  }

  // --- Lobby chat ---------------------------------------------------------
  _wireChat() {
    if (this.chatSendEl) this.chatSendEl.addEventListener('click', () => this._sendChat());
    if (this.chatInputEl) {
      // Input listens on `window`, so chat keystrokes would otherwise drive the
      // plane / trigger shortcuts (and the game preventDefaults Space — can't
      // type a space). Stop the events here; Enter sends.
      this.chatInputEl.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); this._sendChat(); }
      });
      this.chatInputEl.addEventListener('keyup', (e) => e.stopPropagation());
    }
    this.client.onChat((m) => this._addChat(m));
  }

  _sendChat() {
    if (!this.chatInputEl) return;
    const text = this.chatInputEl.value.replace(/\s+/g, ' ').trim();
    if (!text) return;
    this.client.sendLobbyChat(text.slice(0, 160));
    this.chatInputEl.value = '';
  }

  // Append a received line. Text is set via textContent / createTextNode so a
  // message can never inject HTML.
  _addChat(m) {
    if (!m || !this.chatLogEl) return;
    const row = document.createElement('div');
    row.className = 'lc-msg' + (m.id === this.client.id ? ' me' : '');
    const name = document.createElement('span');
    name.className = 'lc-name';
    name.textContent = m.name || `P${m.id}`;
    row.appendChild(name);
    row.appendChild(document.createTextNode(m.text));
    // Keep the DOM bounded.
    while (this.chatLogEl.children.length >= 80) this.chatLogEl.removeChild(this.chatLogEl.firstChild);
    const nearBottom =
      this.chatLogEl.scrollHeight - this.chatLogEl.scrollTop - this.chatLogEl.clientHeight < 40;
    this.chatLogEl.appendChild(row);
    if (nearBottom) this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  clearChat() {
    if (this.chatLogEl) this.chatLogEl.innerHTML = '';
    if (this.chatInputEl) this.chatInputEl.value = '';
  }

  // --- Launch countdown ticker -------------------------------------------
  _renderTimer() {
    if (!this.timerEl) return;
    if (this._launchAt) {
      const secs = Math.max(0, Math.ceil((this._launchAt - Date.now()) / 1000));
      this.timerEl.textContent = `Launching in ${secs}s …  (${this._memberCount}/${this._full})`;
    } else {
      this.timerEl.textContent =
        this._memberCount < 2
          ? `Waiting for players …  (${this._memberCount}/${this._full}) — host can start anytime`
          : `(${this._memberCount}/${this._full})`;
    }
  }

  _startCountdown() {
    if (this._countdownTimer) return;
    // 250ms so the displayed second flips promptly at each boundary.
    this._countdownTimer = setInterval(() => this._renderTimer(), 250);
  }

  _stopCountdown() {
    if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
  }

  // The color this player chose in the lobby (used as their race body color).
  getMyColor() { return this._mine.color; }

  _render(r) {
    if (!r) { this.hide(); return; }
    const myId = this.client.id;
    const me = r.members.find((m) => m.id === myId);
    const amHost = me && me.host;

    // Members list.
    if (this.membersEl) {
      this.membersEl.innerHTML = r.members
        .map((m) => {
          const dot = `<span class="lm-dot" style="background:#${(m.color != null ? m.color : 0xffffff).toString(16).padStart(6, '0')}"></span>`;
          return `<div class="lm-row${m.id === myId ? ' me' : ''}">${dot}<span>${m.name}${m.host ? ' 👑' : ''}${m.id === myId ? ' (you)' : ''}</span><span class="lm-vote">${PLANE_TYPES[m.plane]?.name || m.plane} · ${m.time}</span></div>`;
        })
        .join('');
    }

    // Highlight my current votes (from the server's view of me).
    const selPlane = me ? me.plane : null;
    const selTime = me ? me.time : null;
    const selColor = me ? me.color : null;
    const selGates = me ? me.gates : null;
    // Remember my picks so RaceManager can read my chosen color at launch.
    if (me) this._mine = { plane: selPlane, time: selTime, color: selColor, gates: selGates };
    if (this.planeEl) for (const b of this.planeEl.children) b.classList.toggle('sel', b.dataset.val === selPlane);
    if (this.timeEl) for (const b of this.timeEl.children) b.classList.toggle('sel', b.dataset.val === selTime);
    if (this.gatesEl) for (const b of this.gatesEl.children) b.classList.toggle('sel', Number(b.dataset.val) === selGates);
    if (this.colorEl) for (const s of this.colorEl.children) s.classList.toggle('sel', Number(s.dataset.hex) === selColor);

    // Vote result.
    if (this.voteNoteEl && r.vote) {
      this.voteNoteEl.textContent = `Racing: ${PLANE_TYPES[r.vote.plane]?.name || r.vote.plane} · ${TIME_PRESETS[r.vote.time]?.label || r.vote.time} · ${r.vote.gates} flags (majority vote)`;
    }

    // Host start button.
    if (this.startBtn) {
      this.startBtn.style.display = amHost ? 'block' : 'none';
      this.startBtn.disabled = r.members.length < 1;
    }

    // Launch countdown. Cache the server's absolute launch timestamp + member
    // count, render once now, then let the local ticker decrement it every
    // second (each new lobby message re-syncs these, so it can't drift).
    this._launchAt = r.launchAt || null;
    this._memberCount = r.members.length;
    this._full = r.full;
    this._renderTimer();
    if (this._launchAt) this._startCountdown();
    else this._stopCountdown();

    // Spin the lead-voted plane (in my colour) in the shared 3D hero.
    if (this.onHero) {
      const heroPlane = (r.vote && r.vote.plane) || selPlane || this._mine.plane;
      const heroColor = selColor != null ? selColor : this._mine.color;
      if (heroPlane) this.onHero(heroPlane, heroColor);
    }
  }
}
