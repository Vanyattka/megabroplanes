import { WebSocketServer } from 'ws';
import http from 'http';
import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { join, normalize, extname } from 'path';

const PORT = Number(process.env.PORT) || 3030;
const TICK_HZ = 20;
// Liveness: the server pings every PING_MS; browsers auto-reply with a pong at
// the protocol level EVEN WHEN THE TAB IS BACKGROUNDED (no JS needed), so a
// player who alt-tabs no longer looks "idle". A connection is dropped only if
// neither a pong nor a message arrives for IDLE_KICK_MS. (Was a flat 20 s
// app-message timeout — that kicked anyone whose render loop paused on a
// backgrounded tab, the root cause of the mid-session disconnects.)
const PING_MS = 15000;
const IDLE_KICK_MS = 50000;
// When a socket drops in a race OR the lobby, hold that slot (id, progress,
// HP, lobby membership) this long so a quick reconnect resumes it instead of
// dumping the player out. Generous enough to cover an alt-tab to Discord / a
// phone backgrounding the tab while the group coordinates.
const RESUME_GRACE_MS = 90000;
// A lobby member only counts toward launching a race if it was seen (a pong
// or message) this recently — so a silent/frozen tab can't be auto-launched
// into a race it isn't present for (which then instantly empties).
const LOBBY_ACTIVE_MS = 20000;
// When set, the same server also serves the built game (static dist) over HTTP,
// so one container/process can host both the page and the WebSocket relay
// behind a single reverse-proxy host. Unset = WebSocket-only (legacy nginx box).
const STATIC_DIR = process.env.STATIC_DIR || null;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.map': 'application/json',
};

async function serveStatic(req, res) {
  if (!STATIC_DIR) { res.writeHead(426); res.end('WebSocket endpoint'); return; }
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  let filePath = normalize(join(STATIC_DIR, urlPath));
  // Path-traversal guard.
  if (!filePath.startsWith(STATIC_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
  let data;
  try {
    data = await readFile(filePath);
  } catch {
    // SPA fallback to index.html for unknown routes.
    try { filePath = join(STATIC_DIR, 'index.html'); data = await readFile(filePath); }
    catch { res.writeHead(404); res.end('not found'); return; }
  }
  const ext = extname(filePath);
  // Hashed assets are immutable; the entry HTML must always re-fetch.
  const cache = filePath.includes('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
  res.end(data);
}

// ---- Rooms ---------------------------------------------------------------
// Every client is in exactly one room:
//   'free'  — the open multiplayer sandbox (see everyone else flying free)
//   'lobby' — waiting in the race lobby (voting, not flying)
//   'race'  — flying an active, isolated race (only see other racers)
// Snapshots are scoped per room, so racers fly on their own "map" away from
// the free-flight crowd.

// ---- Lobby + race tuning -------------------------------------------------
const LOBBY_FULL = 10;
const LOBBY_AUTO_LAUNCH_MS = 35000; // auto-launch countdown once >=2 are waiting
const LOBBY_FULL_LAUNCH_MS = 6000;  // when the lobby fills, launch soon
const HOST_LAUNCH_MS = 4000;        // host pressed START -> short countdown
const RACE_COUNTDOWN_MS = 6000;
const RESULTS_MS = 15000;
const RACE_TIMEOUT_MS = 360000;
const DEFAULT_GATES = 8;
const GATE_OPTIONS = [8, 16, 32]; // votable flag counts
// Combat
const MAX_HP = 100;
const GUN_DMG = 13;
const HIT_MIN_INTERVAL_MS = 70;   // per shooter→target, anti-spam
const HIT_GLOBAL_MIN_MS = 30;     // per shooter across ALL targets, anti-burst
const RESPAWN_MS = 3500;

const DEFAULT_PLANE = 'piper';
const DEFAULT_TIME = 'day';

const httpServer = http.createServer(serveStatic);
const wss = new WebSocketServer({ server: httpServer });
const clients = new Map(); // id -> client
let nextId = 1;

let lobby = { hostId: null, launchAt: null };
let race = makeIdleRace();
function makeIdleRace() {
  return { phase: 'idle', seed: 0, course: [], startAt: 0, endAt: 0, timeKey: DEFAULT_TIME, plane: DEFAULT_PLANE };
}

function membersIn(room) {
  const out = [];
  for (const [id, c] of clients) if (c.room === room) out.push([id, c]);
  return out;
}

// Lobby members that currently "count": visible = present in the room (a
// held-for-resume member is hidden until it returns or expires); active =
// also seen recently, the bar for triggering a race launch.
function lobbyVisible() { return membersIn('lobby').filter(([, c]) => !c.disconnected); }
function lobbyActive() {
  const now = Date.now();
  return lobbyVisible().filter(([, c]) => now - c.lastSeen < LOBBY_ACTIVE_MS);
}

// Deterministic course generator (LCG, seeded → random each race). `n` is the
// voted flag count (8/16/32). ~8 gates make one 360° loop, so bigger counts
// wind into a longer multi-loop circuit; the radius oscillates so successive
// loops sit at different distances instead of stacking. Gates stay over the
// gentle spawn plains (≈500–1850 m, alt 130–310 m) so they're flyable.
function generateCourse(seed, n) {
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const count = GATE_OPTIONS.includes(n) ? n : DEFAULT_GATES;
  const baseR = 550, spanR = 1250;
  const cps = [];
  let ang = rand() * Math.PI * 2;
  const radPhase = rand() * Math.PI * 2;
  const dir = rand() < 0.5 ? 1 : -1; // randomize circuit direction
  for (let i = 0; i < count; i++) {
    ang += dir * (Math.PI * 2 / 8) + (rand() - 0.5) * 0.5;
    const r = baseR + spanR * (0.5 + 0.45 * Math.sin(i * 0.8 + radPhase)) + (rand() - 0.5) * 220;
    cps.push({
      x: Math.round(Math.cos(ang) * r),
      y: Math.round(130 + rand() * 180),
      z: Math.round(Math.sin(ang) * r),
      r: 60,
    });
  }
  return cps;
}

// Tally lobby votes (mode wins; ties fall back to host's pick, then default).
function tallyVotes() {
  const members = lobbyVisible();
  const count = (key, def) => {
    const tally = {};
    for (const [, c] of members) {
      const v = c.lobby[key];
      if (v) tally[v] = (tally[v] || 0) + 1;
    }
    let best = null, bestN = -1;
    for (const k of Object.keys(tally)) if (tally[k] > bestN) { bestN = tally[k]; best = k; }
    // tie-break toward the host's choice
    const host = clients.get(lobby.hostId);
    if (host && host.lobby[key] && (tally[host.lobby[key]] || 0) === bestN) best = host.lobby[key];
    return best || def;
  };
  const gatesVote = parseInt(count('gates', String(DEFAULT_GATES)), 10);
  return {
    plane: count('plane', DEFAULT_PLANE),
    time: count('time', DEFAULT_TIME),
    gates: GATE_OPTIONS.includes(gatesVote) ? gatesVote : DEFAULT_GATES,
  };
}

function recomputeHost() {
  // Host must be a present (non-held) member; reassign off a dropped host.
  const visible = lobbyVisible();
  if (!visible.some(([id]) => id === lobby.hostId)) {
    lobby.hostId = visible.length ? visible[0][0] : null;
  }
}

// Single removal path for BOTH a socket close and an idle-kick, so lobby
// bookkeeping (host reassignment, launch timer, broadcast) can never diverge
// between the two — previously the idle-kick deleted a client raw, orphaning
// lobby.hostId and leaving the launch countdown stuck on a stale member count.
function removeClient(id) {
  const c = clients.get(id);
  if (!c) return;
  const wasLobby = c.room === 'lobby';
  clients.delete(id);
  if (wasLobby) { recomputeHost(); updateLaunchTimer(); sendLobbyState(); }
}

// Resume token carried in the reconnect URL (?rt=...). Parsing it in the
// connection handler lets us re-adopt the old session BEFORE sending any
// welcome, so there's no welcome-ordering race between a fresh id and a
// resumed one.
function parseResumeToken(url) {
  if (!url) return null;
  const q = url.indexOf('?');
  if (q < 0) return null;
  try { return new URLSearchParams(url.slice(q + 1)).get('rt'); } catch { return null; }
}

function findResumable(token) {
  if (!token) return null;
  const now = Date.now();
  for (const [, c] of clients) {
    if (c.disconnected && c.token === token && now - c.dcAt <= RESUME_GRACE_MS) return c;
  }
  return null;
}

// A socket went away (close or idle). Mid-race players keep their slot for a
// grace window so a reconnect can resume; everyone else is removed at once.
function dropClient(c, reason) {
  if (!c || c.disconnected) return;
  // Hold a slot for resume if the player is mid-race OR sitting in the lobby —
  // a brief drop/alt-tab shouldn't eject them from either.
  const hold = (c.room === 'race' && race.phase !== 'idle') || c.room === 'lobby';
  if (hold) {
    c.disconnected = true;
    c.dcAt = Date.now();
    console.log(`[~] player ${c.id} ${reason} — holding ${c.room} slot ${Math.round(RESUME_GRACE_MS / 1000)}s`);
    if (c.room === 'lobby') { recomputeHost(); updateLaunchTimer(); sendLobbyState(); }
  } else {
    removeClient(c.id);
    console.log(`[-] player ${c.id} ${reason} (total: ${clients.size})`);
  }
}

function lobbyMessage() {
  const members = lobbyVisible().map(([id, c]) => ({
    id, name: c.name || `P${id}`,
    plane: c.lobby.plane, time: c.lobby.time, color: c.lobby.color, gates: c.lobby.gates,
    ready: !!c.lobby.ready, host: id === lobby.hostId,
  }));
  return {
    type: 'lobby',
    members,
    hostId: lobby.hostId,
    vote: tallyVotes(),
    launchAt: lobby.launchAt,
    full: LOBBY_FULL,
  };
}

function sendLobbyState() {
  const msg = JSON.stringify(lobbyMessage());
  for (const [, c] of clients) if (c.room === 'lobby' && c.ws.readyState === 1) c.ws.send(msg);
}

// Re-evaluate the auto-launch countdown whenever lobby membership/size changes.
function updateLaunchTimer() {
  // A single global race object exists, so never arm a launch while one is
  // already running — it would clobber the in-progress race. The countdown is
  // (re)armed when the race returns to idle (see endRaceToFree).
  if (race.phase !== 'idle') { lobby.launchAt = null; return; }
  const n = lobbyActive().length;
  if (n >= LOBBY_FULL) {
    const soon = Date.now() + LOBBY_FULL_LAUNCH_MS;
    if (lobby.launchAt == null || lobby.launchAt > soon) lobby.launchAt = soon;
  } else if (n >= 2) {
    if (lobby.launchAt == null) lobby.launchAt = Date.now() + LOBBY_AUTO_LAUNCH_MS;
  } else {
    lobby.launchAt = null; // need >=2 (host can still force-start a solo race)
  }
}

function launchRace() {
  // Only launch present (recently-seen) members — never drag a silent/held
  // lobby slot into a race it would instantly vacate.
  const members = lobbyActive();
  if (members.length === 0) return;
  const vote = tallyVotes();
  const seed = Math.floor(Math.random() * 0x7fffffff);
  race = {
    phase: 'countdown',
    seed,
    course: generateCourse(seed, vote.gates),
    startAt: Date.now() + RACE_COUNTDOWN_MS,
    endAt: 0,
    timeKey: vote.time,
    plane: vote.plane,
  };
  for (const [, c] of members) {
    c.room = 'race';
    c.race = { nextCp: 0, finishMs: null };
    c.hp = MAX_HP;
    c.dead = false;
    c.respawnAt = 0;
    c.plane.pt = vote.plane; // everyone flies the voted type; color stays personal
    c.lastHit = {};
    c.lastHitAny = 0;
  }
  lobby.launchAt = null;
  lobby.hostId = null;
  console.log(`[race] launch — ${members.length} racers, plane=${vote.plane}, time=${vote.time}, seed=${seed}`);
  broadcastRace();
}

function finishRace() {
  race.phase = 'finished';
  race.endAt = Date.now() + RESULTS_MS;
  console.log('[race] finished');
  broadcastRace();
}

function endRaceToFree() {
  const members = membersIn('race');
  race = makeIdleRace();
  // Tell racers the race is over (idle) BEFORE moving them out, otherwise the
  // room-scoped broadcast would never reach them and they'd be stuck in the
  // race HUD client-side.
  const idleMsg = JSON.stringify(raceMessage()); // phase idle, empty standings
  for (const [, c] of members) {
    if (c.ws.readyState === 1) c.ws.send(idleMsg);
    c.room = 'free';
    c.race = null;
  }
  // A lobby may have filled while this race ran; now that we're idle again,
  // (re)arm its launch countdown and refresh the waiting room.
  updateLaunchTimer();
  sendLobbyState();
}

function standings() {
  const rows = [];
  for (const [id, c] of membersIn('race')) {
    rows.push({ id, name: c.name || `P${id}`, n: c.race ? c.race.nextCp : 0, f: c.race ? c.race.finishMs : null, hp: c.hp ?? MAX_HP });
  }
  rows.sort((a, b) => {
    const af = a.f != null, bf = b.f != null;
    if (af && bf) return a.f - b.f;
    if (af) return -1;
    if (bf) return 1;
    return b.n - a.n;
  });
  return rows;
}

function raceMessage() {
  return {
    type: 'race',
    phase: race.phase,
    startAt: race.startAt,
    endAt: race.endAt,
    course: race.course,
    timeKey: race.timeKey,
    plane: race.plane,
    standings: standings(),
  };
}

function broadcastRace() {
  const msg = JSON.stringify(raceMessage());
  for (const [, c] of clients) if (c.room === 'race' && c.ws.readyState === 1) c.ws.send(msg);
}

function broadcastToRoom(room, payload, exceptId = null) {
  const str = JSON.stringify(payload);
  for (const [id, c] of clients) {
    if (id === exceptId) continue;
    if (c.room === room && c.ws.readyState === 1) c.ws.send(str);
  }
}

// Message/close/pong handlers resolve the client via ws._cid (NOT a captured
// id) so a resumed socket routes to the adopted session.
function attachClientHandlers(ws) {
  ws.on('pong', () => { const c = clients.get(ws._cid); if (c) c.lastSeen = Date.now(); });
  ws.on('error', () => {});
  ws.on('close', () => {
    const c = clients.get(ws._cid);
    if (!c || c.ws !== ws) return; // stale socket — a newer one already resumed this session
    dropClient(c, 'disconnected');
  });

  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    const id = ws._cid;
    const c = clients.get(id);
    if (!c) return;
    c.lastSeen = Date.now();

    switch (msg.type) {
      case 'state':
        if (msg.state) {
          c.state = msg.state;
          if (msg.state.pc != null) c.plane.pc = msg.state.pc;
          if (c.room === 'free' && msg.state.pt) c.plane.pt = msg.state.pt;
        }
        break;
      case 'set_name':
        if (typeof msg.name === 'string') c.name = msg.name.slice(0, 16);
        break;
      case 'join_lobby': {
        // Only a free-flight player may enter the lobby. Without this guard an
        // active racer that (re)sends join_lobby — e.g. a client bug or a tap
        // on a stale button — would yank itself out of the running race.
        if (c.room !== 'free') break;
        c.room = 'lobby';
        c.lobby.ready = false;
        if (msg.plane) c.lobby.plane = msg.plane;
        if (msg.time) c.lobby.time = msg.time;
        if (msg.color != null) c.lobby.color = msg.color;
        if (GATE_OPTIONS.includes(msg.gates)) c.lobby.gates = msg.gates;
        recomputeHost();
        updateLaunchTimer();
        sendLobbyState();
        break;
      }
      case 'leave_lobby':
        if (c.room === 'lobby') {
          c.room = 'free';
          recomputeHost();
          updateLaunchTimer();
          sendLobbyState();
        }
        break;
      case 'lobby_set':
        if (c.room === 'lobby') {
          if (msg.plane) c.lobby.plane = msg.plane;
          if (msg.time) c.lobby.time = msg.time;
          if (msg.color != null) c.lobby.color = msg.color;
          if (GATE_OPTIONS.includes(msg.gates)) c.lobby.gates = msg.gates;
          if (typeof msg.ready === 'boolean') c.lobby.ready = msg.ready;
          sendLobbyState();
        }
        break;
      case 'lobby_start':
        if (race.phase === 'idle' && c.room === 'lobby' && id === lobby.hostId && lobbyActive().length >= 1) {
          lobby.launchAt = Date.now() + HOST_LAUNCH_MS;
          sendLobbyState();
        }
        break;
      case 'cp':
        if (race.phase === 'racing' && c.room === 'race' && c.race && !c.dead) {
          // Accept idx >= expected (not just ==): if a cp message was lost
          // (packet loss, or a gate passed during a brief reconnect), the
          // client — which is authoritative for its own gate-passing — can
          // still advance the server instead of desyncing forever.
          if (typeof msg.idx === 'number' && msg.idx >= c.race.nextCp && msg.idx < race.course.length) {
            c.race.nextCp = msg.idx + 1;
            if (c.race.nextCp >= race.course.length && c.race.finishMs == null) {
              c.race.finishMs = Date.now() - race.startAt;
            }
          }
        }
        break;
      case 'down':
        // Self-reported crash (e.g. flew into terrain). A client can only down
        // itself, and damage is server-authoritative anyway, so trust it: mark
        // dead + schedule the respawn so other racers stop scoring/shooting the
        // wreck and the server clock stays roughly in step with the client.
        if (race.phase === 'racing' && c.room === 'race' && c.race && !c.dead) {
          c.hp = 0;
          c.dead = true;
          c.respawnAt = Date.now() + RESPAWN_MS;
        }
        break;
      case 'fire':
        // Relay tracer to other racers so they see the shots.
        if (c.room === 'race' && race.phase === 'racing' && !c.dead && msg.o && msg.d) {
          broadcastToRoom('race', { type: 'fire', id, o: msg.o, d: msg.d }, id);
        }
        break;
      case 'hit': {
        // Shooter claims a hit; server is the authority on HP.
        if (race.phase !== 'racing' || c.room !== 'race' || c.dead) break;
        const tgt = clients.get(msg.target);
        if (!tgt || tgt.room !== 'race' || tgt.dead || msg.target === id) break;
        const now = Date.now();
        // Per-target AND global (across all targets) rate limits, so a client
        // can't claim simultaneous hits on many planes in one burst.
        if (now - (c.lastHit[msg.target] || 0) < HIT_MIN_INTERVAL_MS) break;
        if (now - (c.lastHitAny || 0) < HIT_GLOBAL_MIN_MS) break;
        c.lastHit[msg.target] = now;
        c.lastHitAny = now;
        tgt.hp = Math.max(0, (tgt.hp ?? MAX_HP) - GUN_DMG);
        if (tgt.hp <= 0 && !tgt.dead) {
          tgt.dead = true;
          tgt.respawnAt = now + RESPAWN_MS;
        }
        break;
      }
    }
  });
}

wss.on('connection', (ws, req) => {
  // Resume an existing (recently dropped) session if a valid token is on the
  // reconnect URL — same id, room, race progress, HP. No fresh record is made.
  const old = findResumable(parseResumeToken(req.url));
  if (old) {
    old.ws = ws;
    old.disconnected = false;
    old.dcAt = 0;
    old.lastSeen = Date.now();
    ws._cid = old.id;
    attachClientHandlers(ws);
    ws.send(JSON.stringify({ type: 'welcome', id: old.id, hue: old.hue, token: old.token }));
    if (old.room === 'race') ws.send(JSON.stringify(raceMessage())); // re-sync the running race
    else if (old.room === 'lobby') { recomputeHost(); updateLaunchTimer(); sendLobbyState(); } // back into the lobby
    console.log(`[~] player ${old.id} resumed (room=${old.room}, total: ${clients.size})`);
    return;
  }

  const id = nextId++;
  const hue = ((id * 137.508) % 360) / 360;
  const token = randomUUID();
  clients.set(id, {
    id, ws, hue, token, lastSeen: Date.now(), disconnected: false, dcAt: 0,
    name: null,
    room: 'free',
    state: null,
    plane: { pt: DEFAULT_PLANE, pc: null },
    hp: MAX_HP, dead: false, respawnAt: 0, lastHit: {}, lastHitAny: 0,
    race: null,
    lobby: { plane: DEFAULT_PLANE, time: DEFAULT_TIME, color: null, gates: DEFAULT_GATES, ready: false },
  });
  ws._cid = id;
  attachClientHandlers(ws);
  const addr = req?.socket?.remoteAddress || 'unknown';
  console.log(`[+] player ${id} connected from ${addr} (total: ${clients.size})`);
  // token lets this client reclaim its session on a brief reconnect.
  ws.send(JSON.stringify({ type: 'welcome', id, hue, token }));
});

setInterval(() => {
  const now = Date.now();
  for (const [id, c] of clients) {
    if (c.disconnected) {
      // Held for resume — drop for good once the grace window lapses.
      if (now - c.dcAt > RESUME_GRACE_MS) { removeClient(id); console.log(`[-] player ${id} resume window expired`); }
      continue;
    }
    // No pong/message for IDLE_KICK_MS = the socket is dead.
    if (now - c.lastSeen > IDLE_KICK_MS) { try { c.ws.terminate(); } catch {} dropClient(c, 'idle'); }
  }

  // Lobby launch — only while no race is active (the global race object would
  // otherwise be clobbered mid-flight). updateLaunchTimer keeps launchAt null
  // during a race, but guard here too in case of clock/edge races.
  if (race.phase === 'idle' && lobby.launchAt != null && now >= lobby.launchAt) launchRace();

  // Race clock.
  let raceChanged = false;
  if (race.phase === 'countdown' && now >= race.startAt) { race.phase = 'racing'; raceChanged = true; }
  if (race.phase === 'racing') {
    const entrants = membersIn('race');
    if (entrants.length === 0) { endRaceToFree(); raceChanged = true; }
    else {
      // Respawns.
      for (const [, c] of entrants) {
        if (!c.disconnected && c.dead && now >= c.respawnAt) { c.dead = false; c.hp = MAX_HP; }
      }
      // A dropped-but-held racer must not block the finish (or, if it's the
      // only one, wrongly finish an empty race). Judge "all done" over the
      // currently-connected racers; held slots clear via the grace window.
      const conn = entrants.filter(([, c]) => !c.disconnected);
      const allDone = conn.length > 0 && conn.every(([, c]) => c.race.finishMs != null);
      if (allDone || now - race.startAt > RACE_TIMEOUT_MS) { finishRace(); raceChanged = true; }
    }
  }
  if (race.phase === 'finished' && now >= race.endAt) { endRaceToFree(); raceChanged = true; }

  // Per-room snapshots.
  const byRoom = { free: [], race: [] };
  for (const [id, c] of clients) {
    if (c.disconnected) continue; // held-for-resume: no fresh state, don't show as frozen
    if (!c.state || (c.room !== 'free' && c.room !== 'race')) continue;
    byRoom[c.room].push({
      id, hue: c.hue,
      p: c.state.p, q: c.state.q, t: c.state.t ?? 0,
      c: (c.dead ? 1 : 0) || (c.state.c ? 1 : 0),
      g: c.state.g ? 1 : 0, // landing gear extended
      pt: c.plane.pt, pc: c.plane.pc,
      hp: c.hp ?? MAX_HP,
    });
  }
  const freeMsg = JSON.stringify({ type: 'snapshot', states: byRoom.free });
  const raceMsg = JSON.stringify({ type: 'snapshot', states: byRoom.race });
  for (const [, c] of clients) {
    if (c.ws.readyState !== 1) continue;
    if (c.room === 'free') c.ws.send(freeMsg);
    else if (c.room === 'race') c.ws.send(raceMsg);
  }

  if (race.phase !== 'idle' || raceChanged) broadcastRace();
}, 1000 / TICK_HZ);

// Heartbeat — protocol-level WS pings. A browser answers a ping with a pong
// from its network stack WITHOUT running page JS, so even a backgrounded /
// minimized tab (whose requestAnimationFrame is paused) keeps its connection
// alive. Idle-kick then only ever fires on a genuinely dead socket.
setInterval(() => {
  for (const [, c] of clients) {
    if (c.disconnected || !c.ws || c.ws.readyState !== 1) continue;
    try { c.ws.ping(); } catch {}
  }
}, PING_MS);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`megabroplanes server listening on :${PORT}`);
  console.log(STATIC_DIR ? `serving game from ${STATIC_DIR} + WebSocket` : 'WebSocket only');
});
