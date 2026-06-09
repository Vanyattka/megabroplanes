import { WebSocketServer } from 'ws';
import http from 'http';
import { readFile } from 'fs/promises';
import { join, normalize, extname } from 'path';

const PORT = Number(process.env.PORT) || 3030;
const TICK_HZ = 20;
const IDLE_KICK_MS = 20000;
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
  const members = membersIn('lobby');
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
  const members = membersIn('lobby');
  if (!members.some(([id]) => id === lobby.hostId)) {
    lobby.hostId = members.length ? members[0][0] : null;
  }
}

function lobbyMessage() {
  const members = membersIn('lobby').map(([id, c]) => ({
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
  const n = membersIn('lobby').length;
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
  const members = membersIn('lobby');
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

wss.on('connection', (ws, req) => {
  const id = nextId++;
  const hue = ((id * 137.508) % 360) / 360;
  clients.set(id, {
    ws, hue, lastSeen: Date.now(),
    name: null,
    room: 'free',
    state: null,
    plane: { pt: DEFAULT_PLANE, pc: null },
    hp: MAX_HP, dead: false, respawnAt: 0, lastHit: {}, lastHitAny: 0,
    race: null,
    lobby: { plane: DEFAULT_PLANE, time: DEFAULT_TIME, color: null, gates: DEFAULT_GATES, ready: false },
  });
  const addr = req?.socket?.remoteAddress || 'unknown';
  console.log(`[+] player ${id} connected from ${addr} (total: ${clients.size})`);
  ws.send(JSON.stringify({ type: 'welcome', id, hue }));

  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
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
        if (c.room === 'lobby' && id === lobby.hostId && membersIn('lobby').length >= 1) {
          lobby.launchAt = Date.now() + HOST_LAUNCH_MS;
          sendLobbyState();
        }
        break;
      case 'cp':
        if (race.phase === 'racing' && c.room === 'race' && c.race && !c.dead) {
          if (typeof msg.idx === 'number' && msg.idx === c.race.nextCp) {
            c.race.nextCp++;
            if (c.race.nextCp >= race.course.length && c.race.finishMs == null) {
              c.race.finishMs = Date.now() - race.startAt;
            }
          }
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

  ws.on('close', () => {
    const c = clients.get(id);
    const wasLobby = c && c.room === 'lobby';
    clients.delete(id);
    if (wasLobby) { recomputeHost(); updateLaunchTimer(); sendLobbyState(); }
    console.log(`[-] player ${id} disconnected (total: ${clients.size})`);
  });
  ws.on('error', () => {});
});

setInterval(() => {
  const now = Date.now();
  for (const [id, c] of clients) {
    if (now - c.lastSeen > IDLE_KICK_MS) { try { c.ws.close(); } catch {} clients.delete(id); }
  }

  // Lobby launch.
  if (lobby.launchAt != null && now >= lobby.launchAt) launchRace();

  // Race clock.
  let raceChanged = false;
  if (race.phase === 'countdown' && now >= race.startAt) { race.phase = 'racing'; raceChanged = true; }
  if (race.phase === 'racing') {
    const entrants = membersIn('race');
    if (entrants.length === 0) { endRaceToFree(); raceChanged = true; }
    else {
      // Respawns.
      for (const [, c] of entrants) {
        if (c.dead && now >= c.respawnAt) { c.dead = false; c.hp = MAX_HP; }
      }
      const allDone = entrants.every(([, c]) => c.race.finishMs != null);
      if (allDone || now - race.startAt > RACE_TIMEOUT_MS) { finishRace(); raceChanged = true; }
    }
  }
  if (race.phase === 'finished' && now >= race.endAt) { endRaceToFree(); raceChanged = true; }

  // Per-room snapshots.
  const byRoom = { free: [], race: [] };
  for (const [id, c] of clients) {
    if (!c.state || (c.room !== 'free' && c.room !== 'race')) continue;
    byRoom[c.room].push({
      id, hue: c.hue,
      p: c.state.p, q: c.state.q, t: c.state.t ?? 0,
      c: (c.dead ? 1 : 0) || (c.state.c ? 1 : 0),
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

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`megabroplanes server listening on :${PORT}`);
  console.log(STATIC_DIR ? `serving game from ${STATIC_DIR} + WebSocket` : 'WebSocket only');
});
