import { PLANE_TYPES, BODY_COLORS, TIME_PRESETS } from '../config.js';

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
    this.colorEl = document.getElementById('lobby-color');
    this.timerEl = document.getElementById('lobby-timer');
    this.startBtn = document.getElementById('lobby-start');
    this.leaveBtn = document.getElementById('lobby-leave');
    this.voteNoteEl = document.getElementById('lobby-vote-note');

    this.onLeave = null;
    this._mine = { plane: null, time: null, color: null };

    this._buildOptionButtons();
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
    this._mine = { plane: loadout.type, time: 'day', color: loadout.color };
    this.client.joinLobby(loadout.type, 'day', loadout.color);
    if (this.root) this.root.classList.remove('hidden');
  }

  show() { if (this.root) this.root.classList.remove('hidden'); }
  hide() { if (this.root) this.root.classList.add('hidden'); }

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
    // Remember my picks so RaceManager can read my chosen color at launch.
    if (me) this._mine = { plane: selPlane, time: selTime, color: selColor };
    if (this.planeEl) for (const b of this.planeEl.children) b.classList.toggle('sel', b.dataset.val === selPlane);
    if (this.timeEl) for (const b of this.timeEl.children) b.classList.toggle('sel', b.dataset.val === selTime);
    if (this.colorEl) for (const s of this.colorEl.children) s.classList.toggle('sel', Number(s.dataset.hex) === selColor);

    // Vote result.
    if (this.voteNoteEl && r.vote) {
      this.voteNoteEl.textContent = `Racing: ${PLANE_TYPES[r.vote.plane]?.name || r.vote.plane} · ${TIME_PRESETS[r.vote.time]?.label || r.vote.time} (majority vote)`;
    }

    // Host start button.
    if (this.startBtn) {
      this.startBtn.style.display = amHost ? 'block' : 'none';
      this.startBtn.disabled = r.members.length < 1;
    }

    // Launch countdown.
    if (this.timerEl) {
      if (r.launchAt) {
        const secs = Math.max(0, Math.ceil((r.launchAt - Date.now()) / 1000));
        this.timerEl.textContent = `Launching in ${secs}s …  (${r.members.length}/${r.full})`;
      } else {
        this.timerEl.textContent =
          r.members.length < 2
            ? `Waiting for players …  (${r.members.length}/${r.full}) — host can start anytime`
            : `(${r.members.length}/${r.full})`;
      }
    }
  }
}
