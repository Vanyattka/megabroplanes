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
const PING_MS = 10000;
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
const MODE_OPTIONS = ['race', 'battle']; // votable match modes (v1.1)
// Combat
const MAX_HP = 100;
const GUN_DMG = 13;
const HIT_MIN_INTERVAL_MS = 70;   // per shooter→target, anti-spam
const HIT_GLOBAL_MIN_MS = 30;     // per shooter across ALL targets, anti-burst
const RESPAWN_MS = 3500;

// ---- Battle mode (v1.1) --------------------------------------------------
// Free-for-all dogfight: a cylindrical arena over the spawn plains shrinks
// from START_R to END_R over SHRINK_MS; outside it the hull burns at ZONE_DPS.
// Most kills when DURATION_MS runs out wins. Mystery pickups spawn inside the
// zone; each holds an effect rolled at EQUAL odds that stays hidden until
// collected (the effect key is never broadcast — only the collector learns it).
// Env overrides exist so an integration test can run a whole match in seconds.
// Match length is VOTED in the lobby (minutes); the zone finishes shrinking at
// SHRINK_FRAC of whatever length won, so a 2-minute brawl and a 7-minute one
// pace the same.
const BATTLE_DURATION_OPTIONS = [2, 5, 7]; // votable match length, minutes
const DEFAULT_BATTLE_MINS = 5;
const BATTLE_SHRINK_FRAC = 0.75;
const BATTLE_DURATION_OVERRIDE_MS = Number(process.env.BATTLE_DURATION_MS) || null;
const BATTLE_ZONE_SHRINK_OVERRIDE_MS = Number(process.env.BATTLE_ZONE_SHRINK_MS) || null;
const BATTLE_ZONE_START_R = 2600;
const BATTLE_ZONE_END_R = 380;
// The arena centre is thrown a seeded random distance out from the home
// plains, so every match fights over different terrain — foothills, sea,
// forest, mountains (the flat-spawn suppression only covers ~1.5 km around
// the origin). Players are teleported in, so distance costs nothing.
const BATTLE_ARENA_MIN_DIST = 3000;
const BATTLE_ARENA_MAX_DIST = 15000;
// The storm pickup divides the REMAINING shrink time by this factor.
const BATTLE_STORM_FACTOR = 2;
// Homing rockets (the `rockets` pickup): ammo is granted/spent SERVER-side —
// +5 per pickup (capped), one spent per rocket launch (`fire` with r:1), all
// lost on death. A rocket hit claim (`hit` with w:'r') is only honored within
// a launch window, and deals ROCKET_DMG instead of GUN_DMG.
const ROCKET_AMMO_PER_PICKUP = 5;
const ROCKET_AMMO_CAP = 10;
const ROCKET_DMG = 34;
const ROCKET_HIT_WINDOW_MS = 12000; // launch-to-hit validity (covers flight time)
// AA sites (the `aa` pickup): a ground launcher is deployed under the shot
// balloon and fires a homing rocket at a RANDOM in-range player every
// AA_FIRE_INTERVAL_MS, for chaos. The server only picks target + timing and
// broadcasts the launch (`fire` with aa:turretId); clients simulate the
// rocket, and the victim self-reports the hit (`aa_hit`, damage to SELF only
// — same trust shape as the self-reported terrain crash).
const AA_FIRE_INTERVAL_MS = 10000;
const AA_RANGE = 1800;
const AA_DMG = 30;
const AA_MAX_SITES = 8;
const AA_HIT_MIN_INTERVAL_MS = 900; // self-report flood floor
const BATTLE_ZONE_DPS = 7;              // hp/s while outside the arena
const BATTLE_PICKUP_INTERVAL_MS = Number(process.env.BATTLE_PICKUP_INTERVAL_MS) || 7000;
const BATTLE_PICKUP_MAX = 6;            // concurrent pickups in the arena
// Pickups are balloons SHOT DOWN by bullets now, not flown through — a tracer
// reaches ~900 m and the shooter keeps flying while it travels, so the claim
// sanity cap is generous and horizontal-only (the balloon's altitude is
// derived client-side from the terrain; the server doesn't know it).
const BATTLE_PICKUP_CLAIM_DIST = 1300;
// Effect table: ms = duration (0 = instant), dmgMul = outgoing damage factor,
// takeMul = incoming damage factor. thrust/throttle effects are client-side
// physics — the server only relays the key + expiry to the collector.
const BATTLE_FX = {
  heal:    { ms: 0 },                     // hull restored to 100%
  dmg2:    { ms: 20000, dmgMul: 2 },      // double damage
  boost:   { ms: 20000 },                 // overdrive thrust (client-side)
  dmg05:   { ms: 20000, dmgMul: 0.5 },    // pea-shooter guns
  fragile: { ms: 20000, takeMul: 1.5 },   // +50% damage taken
  sputter: { ms: 15000 },                 // throttle capped (client-side)
  storm:   { ms: 0 },                     // arena shrinks faster — hits EVERYONE, permanent
  rockets: { ms: 0 },                     // +5 homing rockets (server-side ammo)
  aa:      { ms: 0 },                     // deploys a ground AA rocket site (permanent)
};
// Effects excluded from the random roll. The machinery stays fully wired
// (BATTLE_FX_FORCE can still pin them for tests) — delete a key from this set
// to put the effect back into rotation.
const BATTLE_FX_DISABLED = new Set(['aa']);
const BATTLE_FX_KEYS = Object.keys(BATTLE_FX).filter((k) => !BATTLE_FX_DISABLED.has(k));
// Test seam: force every pickup to hold one specific effect (env-gated so the
// 1-in-7 roll can be pinned in an integration test; unset in production).
const BATTLE_FX_FORCE = BATTLE_FX[process.env.BATTLE_FX_FORCE] ? process.env.BATTLE_FX_FORCE : null;

const DEFAULT_PLANE = 'piper';
const DEFAULT_TIME = 'day';
const DEFAULT_MODE = 'race';

// ---- Chat moderation -----------------------------------------------------
// Flood limits: a floor between consecutive lines, plus a burst cap over a
// short window (so you can fire off a few quick replies but not scroll the
// panel). Both are enforced server-side; the client caps length at 160.
const CHAT_MIN_INTERVAL_MS = 600;
const CHAT_WINDOW_MS = 6000;
const CHAT_WINDOW_MAX = 6;
// Starter obscenity filter — matched roots are masked, the line still sends.
// Deliberately small and root-based (Russian mat inflects heavily); extend as
// needed. This is a politeness filter, not a safety guarantee: the chat is
// public, unmoderated in real time, and the Terms say so.
const PROFANITY = [
  'хуй', 'хуё', 'хуе', 'пизд', 'ебат', 'ебал', 'ебан', 'ебуч', 'бляд', 'блять',
  'сука', 'мудак', 'пидор', 'пидар', 'гандон', 'долбоёб', 'долбоеб', 'уёбок', 'уебок',
  'fuck', 'shit', 'cunt', 'bitch', 'asshole', 'nigg',
];
const PROFANITY_RE = new RegExp(`(${PROFANITY.join('|')})[a-zA-Zа-яёА-ЯЁ]*`, 'gi');
function maskProfanity(s) {
  return s.replace(PROFANITY_RE, (m) => m[0] + '*'.repeat(Math.max(1, m.length - 1)));
}

const httpServer = http.createServer(serveStatic);
const wss = new WebSocketServer({ server: httpServer });
const clients = new Map(); // id -> client
let nextId = 1;

let lobby = { hostId: null, launchAt: null };
let race = makeIdleRace();
function makeIdleRace() {
  return {
    phase: 'idle', mode: DEFAULT_MODE, seed: 0, course: [], startAt: 0, endAt: 0,
    timeKey: DEFAULT_TIME, plane: DEFAULT_PLANE,
    durationMs: RACE_TIMEOUT_MS, zone: null, pickups: [], turrets: [],
    _nextPickupId: 1, _lastPickupAt: 0, _nextTurretId: 1,
  };
}

// Current arena radius — a pure function of the zone's (baseR, baseAt,
// shrinkMs) segment, so clients derive the exact same value locally with no
// per-tick radius sync. The segment starts as (r0, startAt, full shrink time)
// and is REBASED in place when a storm pickup accelerates the shrink: baseR
// pins the radius at that instant and the remaining time is divided down.
// Clients pick the rebased params up from the 20 Hz match broadcast.
function zoneRadius(zone, now) {
  const t = Math.min(1, Math.max(0, (now - zone.baseAt) / zone.shrinkMs));
  return zone.baseR + (zone.r1 - zone.baseR) * t;
}

// A client's active mystery effect, expiring it lazily on read.
function activeFx(c, now) {
  if (!c.fx) return null;
  if (c.fx.until !== 0 && now >= c.fx.until) { c.fx = null; return null; }
  return c.fx;
}

// A full IP address is personal data, and these logs are kept indefinitely by
// the container runtime. We only ever needed a coarse "where from" for abuse
// triage, so drop the host part: IPv4 keeps two octets, IPv6 keeps its /32
// prefix. Nothing that identifies an individual subscriber survives.
function maskIp(addr) {
  if (!addr) return 'unknown';
  let a = String(addr);
  if (a.startsWith('::ffff:')) a = a.slice(7); // IPv4-mapped IPv6
  if (a.includes('.')) {
    const p = a.split('.');
    return p.length === 4 ? `${p[0]}.${p[1]}.x.x` : 'unknown';
  }
  if (a.includes(':')) {
    const p = a.split(':').filter(Boolean);
    return p.length >= 2 ? `${p[0]}:${p[1]}::/32` : 'unknown';
  }
  return 'unknown';
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
  const modeVote = count('mode', DEFAULT_MODE);
  const durVote = parseInt(count('duration', String(DEFAULT_BATTLE_MINS)), 10);
  return {
    plane: count('plane', DEFAULT_PLANE),
    time: count('time', DEFAULT_TIME),
    gates: GATE_OPTIONS.includes(gatesVote) ? gatesVote : DEFAULT_GATES,
    mode: MODE_OPTIONS.includes(modeVote) ? modeVote : DEFAULT_MODE,
    duration: BATTLE_DURATION_OPTIONS.includes(durVote) ? durVote : DEFAULT_BATTLE_MINS,
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
    mode: c.lobby.mode, duration: c.lobby.duration,
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
  const mode = vote.mode;
  const startAt = Date.now() + RACE_COUNTDOWN_MS;
  // Battle length comes from the lobby vote (minutes); the zone finishes
  // shrinking at a fixed fraction of it. Env overrides win for tests.
  const battleMs = BATTLE_DURATION_OVERRIDE_MS || vote.duration * 60000;
  // The battle arena lands somewhere genuinely different each match: a seeded
  // random bearing + distance well outside the flattened spawn plains, so the
  // terrain under the fight varies (hills, sea, forest, mountains). Clients
  // derive spawn/balloon altitudes from the local terrain, so the server never
  // needs to know the relief.
  let zone = null;
  if (mode === 'battle') {
    let s = seed >>> 0;
    const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const ang = rand() * Math.PI * 2;
    const dist = BATTLE_ARENA_MIN_DIST + rand() * (BATTLE_ARENA_MAX_DIST - BATTLE_ARENA_MIN_DIST);
    zone = {
      x: Math.round(Math.cos(ang) * dist),
      z: Math.round(Math.sin(ang) * dist),
      r0: BATTLE_ZONE_START_R,
      r1: BATTLE_ZONE_END_R,
      shrinkMs: BATTLE_ZONE_SHRINK_OVERRIDE_MS || Math.round(battleMs * BATTLE_SHRINK_FRAC),
      // Live shrink segment — rebased in place by storm pickups.
      baseR: BATTLE_ZONE_START_R,
      baseAt: startAt,
      storms: 0,
    };
  }
  race = {
    phase: 'countdown',
    mode,
    seed,
    course: mode === 'race' ? generateCourse(seed, vote.gates) : [],
    startAt,
    endAt: 0,
    timeKey: vote.time,
    plane: vote.plane,
    durationMs: mode === 'battle' ? battleMs : RACE_TIMEOUT_MS,
    zone,
    pickups: [],
    turrets: [],
    _nextPickupId: 1,
    _lastPickupAt: 0,
    _nextTurretId: 1,
  };
  for (const [, c] of members) {
    c.room = 'race';
    c.race = { nextCp: 0, finishMs: null, kills: 0, deaths: 0 };
    c.hp = MAX_HP;
    c.dead = false;
    c.respawnAt = 0;
    c.fx = null;
    c.rockets = 0;
    c.plane.pt = vote.plane; // everyone flies the voted type; color stays personal
    c.lastHit = {};
    c.lastHitAny = 0;
  }
  lobby.launchAt = null;
  lobby.hostId = null;
  console.log(`[race] launch — mode=${mode}${mode === 'battle' ? `, ${Math.round(race.durationMs / 60000)}min` : ''}, ${members.length} players, plane=${vote.plane}, time=${vote.time}, seed=${seed}`);
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
    c.fx = null;
    c.rockets = 0;
  }
  // A lobby may have filled while this race ran; now that we're idle again,
  // (re)arm its launch countdown and refresh the waiting room.
  updateLaunchTimer();
  sendLobbyState();
}

function standings() {
  const rows = [];
  for (const [id, c] of membersIn('race')) {
    rows.push({
      id, name: c.name || `P${id}`,
      n: c.race ? c.race.nextCp : 0,
      f: c.race ? c.race.finishMs : null,
      hp: c.hp ?? MAX_HP,
      k: c.race ? c.race.kills || 0 : 0,
      d: c.race ? c.race.deaths || 0 : 0,
      rk: c.rockets || 0, // homing-rocket ammo (the owner reads their own row)
    });
  }
  if (race.mode === 'battle') {
    // Battle: most kills first; fewer deaths breaks ties, then join order.
    rows.sort((a, b) => (b.k - a.k) || (a.d - b.d) || (a.id - b.id));
    return rows;
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
    mode: race.mode,
    startAt: race.startAt,
    endAt: race.endAt,
    durationMs: race.durationMs,
    course: race.course,
    timeKey: race.timeKey,
    plane: race.plane,
    zone: race.zone,
    // Positions only — the rolled effect stays hidden until shot down.
    pickups: race.pickups.map((p) => ({ id: p.id, x: p.x, z: p.z })),
    // Deployed AA sites (battle). Height is derived client-side from terrain.
    turrets: race.turrets.map((tr) => ({ id: tr.id, x: tr.x, z: tr.z })),
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
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; const c = clients.get(ws._cid); if (c) c.lastSeen = Date.now(); });
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
          // Checkpoint progress piggybacks on state (20 Hz) as a reliable
          // backup to the one-shot `cp` message: if a cp was missed — passed
          // while the socket was down/reconnecting, incl. the FINAL gate
          // (which has no later gate to trigger catch-up) — this re-syncs
          // within a frame. cp = gates cleared (== nextCp).
          if (c.room === 'race' && c.race && race.phase === 'racing' && !c.dead &&
              typeof msg.state.cp === 'number' &&
              msg.state.cp > c.race.nextCp && msg.state.cp <= race.course.length) {
            c.race.nextCp = msg.state.cp;
            if (c.race.nextCp >= race.course.length && c.race.finishMs == null) {
              c.race.finishMs = Date.now() - race.startAt;
            }
          }
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
        if (MODE_OPTIONS.includes(msg.mode)) c.lobby.mode = msg.mode;
        if (BATTLE_DURATION_OPTIONS.includes(msg.duration)) c.lobby.duration = msg.duration;
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
      case 'leave_race':
        // The player bailed out of a race (e.g. hit START GAME from the menu).
        // Drop them to free flight; the race tick recomputes standings/finish
        // over the remaining CONNECTED racers (and ends the race if they were
        // the last one), so no extra bookkeeping is needed here.
        if (c.room === 'race') {
          c.room = 'free';
          c.race = null;
          c.dead = false;
          c.hp = MAX_HP;
          c.fx = null;
          c.rockets = 0;
        }
        break;
      case 'lobby_set':
        if (c.room === 'lobby') {
          if (msg.plane) c.lobby.plane = msg.plane;
          if (msg.time) c.lobby.time = msg.time;
          if (msg.color != null) c.lobby.color = msg.color;
          if (GATE_OPTIONS.includes(msg.gates)) c.lobby.gates = msg.gates;
          if (MODE_OPTIONS.includes(msg.mode)) c.lobby.mode = msg.mode;
          if (BATTLE_DURATION_OPTIONS.includes(msg.duration)) c.lobby.duration = msg.duration;
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
      case 'lobby_chat': {
        // Live lobby chat — relayed to everyone currently in the lobby (incl.
        // the sender, so their own line echoes). No history is stored: a fresh
        // lobby session simply starts empty. Collapse whitespace + cap length;
        // drop empties. The client renders text as plain text (no HTML).
        if (c.room === 'lobby' && typeof msg.text === 'string') {
          const now = Date.now();
          // Flood guard: a minimum gap between lines plus a short-window burst
          // cap. Silently dropped — a spammer gets no feedback to tune against,
          // and honest players never hit either limit while typing.
          if (now - (c.lastChatAt || 0) < CHAT_MIN_INTERVAL_MS) break;
          c.chatWindow = (c.chatWindow || []).filter((ts) => now - ts < CHAT_WINDOW_MS);
          if (c.chatWindow.length >= CHAT_WINDOW_MAX) break;
          const text = maskProfanity(msg.text.replace(/\s+/g, ' ').trim().slice(0, 160));
          if (text) {
            c.lastChatAt = now;
            c.chatWindow.push(now);
            broadcastToRoom('lobby', { type: 'lobby_chat', id, name: c.name || `P${id}`, text });
          }
        }
        break;
      }
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
      case 'aa_hit':
        // An AA rocket caught this player — self-reported, damage to SELF only
        // (same trust shape as 'down'). Rate-floored so a bug/abuse can't melt
        // a hull faster than the sites can actually fire.
        if (race.phase === 'racing' && race.mode === 'battle' && c.room === 'race' && c.race && !c.dead) {
          const nowAa = Date.now();
          if (nowAa - (c.lastAaHitAt || 0) < AA_HIT_MIN_INTERVAL_MS) break;
          if (!race.turrets.length) break; // no sites deployed — nothing could have fired
          c.lastAaHitAt = nowAa;
          let dmg = AA_DMG;
          const fxT = activeFx(c, nowAa);
          if (fxT && fxT.takeMul) dmg *= fxT.takeMul;
          c.hp = Math.max(0, (c.hp ?? MAX_HP) - dmg);
          if (c.hp <= 0 && !c.dead) {
            c.dead = true;
            c.respawnAt = nowAa + RESPAWN_MS;
            c.race.deaths++; // no kill credit — the flak got them
            c.fx = null;
            c.rockets = 0;
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
          if (race.mode === 'battle') { c.race.deaths++; c.fx = null; c.rockets = 0; }
        }
        break;
      case 'fire': {
        // Relay tracer to other racers so they see the shots. A rocket launch
        // (r:1, battle only) spends server-side ammo and carries its homing
        // target id so victims see the rocket actually chasing them; with no
        // ammo the r flag is stripped and it relays as a plain tracer.
        if (c.room === 'race' && race.phase === 'racing' && !c.dead && msg.o && msg.d) {
          const out = { type: 'fire', id, o: msg.o, d: msg.d };
          if (msg.r && race.mode === 'battle' && (c.rockets || 0) > 0) {
            c.rockets--;
            c.lastRocketAt = Date.now();
            out.r = 1;
            if (typeof msg.t === 'number') out.t = msg.t;
          }
          broadcastToRoom('race', out, id);
        }
        break;
      }
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
        // Battle-mode mystery effects scale the damage: the shooter's dmgMul
        // (double damage / pea-shooter) and the target's takeMul (fragile hull).
        // A rocket hit (w:'r') deals ROCKET_DMG instead — honored only within
        // the launch window (ammo was already spent on the `fire` r:1 launch).
        let dmg = GUN_DMG;
        if (race.mode === 'battle' && msg.w === 'r') {
          if (now - (c.lastRocketAt || 0) > ROCKET_HIT_WINDOW_MS) break;
          dmg = ROCKET_DMG;
        }
        if (race.mode === 'battle') {
          const fxS = activeFx(c, now);
          const fxT = activeFx(tgt, now);
          if (fxS && fxS.dmgMul) dmg *= fxS.dmgMul;
          if (fxT && fxT.takeMul) dmg *= fxT.takeMul;
        }
        tgt.hp = Math.max(0, (tgt.hp ?? MAX_HP) - dmg);
        if (tgt.hp <= 0 && !tgt.dead) {
          tgt.dead = true;
          tgt.respawnAt = now + RESPAWN_MS;
          if (race.mode === 'battle') {
            if (c.race) c.race.kills++;
            if (tgt.race) tgt.race.deaths++;
            tgt.fx = null;     // effects don't survive going down
            tgt.rockets = 0;   // neither does rocket ammo
          }
        }
        break;
      }
      case 'pickup': {
        // Collector claims a mystery pickup by id. The server removes it, rolls
        // nothing (the effect was rolled at spawn and kept hidden), applies the
        // server-side part, and reveals the key ONLY to the collector.
        if (race.phase !== 'racing' || race.mode !== 'battle' || c.room !== 'race' || !c.race || c.dead) break;
        const i = race.pickups.findIndex((p) => p.id === msg.id);
        if (i < 0) break; // already taken (or bogus id) — first claim wins
        const p = race.pickups[i];
        // Generous horizontal distance sanity check against the 20 Hz state
        // stream, in the spirit of the existing trust model (cp is trusted;
        // this just stops a client from sniping the whole arena from one spot).
        if (c.state && c.state.p) {
          const dx = c.state.p[0] - p.x, dz = c.state.p[2] - p.z;
          if (dx * dx + dz * dz > BATTLE_PICKUP_CLAIM_DIST * BATTLE_PICKUP_CLAIM_DIST) break;
        }
        race.pickups.splice(i, 1);
        const now2 = Date.now();
        const spec = BATTLE_FX[p.effect];
        const until = spec.ms ? now2 + spec.ms : 0;
        if (p.effect === 'heal') {
          c.hp = MAX_HP;
        } else if (p.effect === 'rockets') {
          c.rockets = Math.min(ROCKET_AMMO_CAP, (c.rockets || 0) + ROCKET_AMMO_PER_PICKUP);
        } else if (p.effect === 'aa') {
          // Deploy a ground AA site right under the popped balloon. Permanent
          // for the match; fires at a random in-range player on its own clock.
          if (race.turrets.length < AA_MAX_SITES) {
            race.turrets.push({ id: race._nextTurretId++, x: p.x, z: p.z, lastFireAt: now2 });
          }
        } else if (p.effect === 'storm') {
          // The storm hits EVERYONE: rebase the shrink segment at the current
          // radius and divide the remaining time. Permanent, and stacks — a
          // second storm halves what's left again. zone.storms lets clients
          // flash a "the arena sped up" notice for the whole room.
          const z = race.zone;
          const rNow = zoneRadius(z, now2);
          const remaining = Math.max(0, z.shrinkMs - (now2 - z.baseAt));
          z.baseR = rNow;
          z.baseAt = now2;
          z.shrinkMs = Math.max(1, Math.round(remaining / BATTLE_STORM_FACTOR));
          z.storms = (z.storms || 0) + 1;
        } else {
          c.fx = { key: p.effect, until, dmgMul: spec.dmgMul, takeMul: spec.takeMul };
        }
        if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ type: 'fx', effect: p.effect, until }));
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
    hp: MAX_HP, dead: false, respawnAt: 0, lastHit: {}, lastHitAny: 0, fx: null, rockets: 0, lastRocketAt: 0,
    race: null,
    lobby: { plane: DEFAULT_PLANE, time: DEFAULT_TIME, color: null, gates: DEFAULT_GATES, mode: DEFAULT_MODE, duration: DEFAULT_BATTLE_MINS, ready: false },
  });
  ws._cid = id;
  attachClientHandlers(ws);
  console.log(`[+] player ${id} connected from ${maskIp(req?.socket?.remoteAddress)} (total: ${clients.size})`);
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
    const conn = entrants.filter(([, c]) => !c.disconnected);
    // End the race the moment NO CONNECTED racer remains. Held/ghost slots
    // must not keep the single global race object alive — otherwise they block
    // every lobby launch (auto + host START require race.phase==='idle') for
    // the whole 90 s grace window: the "2/10, no countdown, can't start" bug.
    // A held racer can still resume while OTHERS keep the race going.
    if (conn.length === 0) { endRaceToFree(); raceChanged = true; }
    else {
      for (const [, c] of conn) {
        if (c.dead && now >= c.respawnAt) { c.dead = false; c.hp = MAX_HP; }
      }
      if (race.mode === 'battle') {
        const zr = zoneRadius(race.zone, now);
        // The wall burns anyone outside it. Damage is applied here (the server
        // knows everyone's 20 Hz position), so it's as authoritative as gunfire.
        for (const [, c] of conn) {
          if (c.dead || !c.state || !c.state.p) continue;
          const dx = c.state.p[0] - race.zone.x, dz = c.state.p[2] - race.zone.z;
          if (dx * dx + dz * dz > zr * zr) {
            c.hp = Math.max(0, (c.hp ?? MAX_HP) - BATTLE_ZONE_DPS / TICK_HZ);
            if (c.hp <= 0 && !c.dead) {
              c.dead = true;
              c.respawnAt = now + RESPAWN_MS;
              if (c.race) c.race.deaths++;
              c.fx = null;
              c.rockets = 0;
            }
          }
        }
        // Drop pickups the shrinking wall has passed; they'd be suicide bait.
        if (race.pickups.length) {
          race.pickups = race.pickups.filter((p) => {
            const dx = p.x - race.zone.x, dz = p.z - race.zone.z;
            return dx * dx + dz * dz <= zr * zr;
          });
        }
        // Trickle in mystery pickups, always inside the CURRENT zone.
        if (race.pickups.length < BATTLE_PICKUP_MAX && now - race._lastPickupAt > BATTLE_PICKUP_INTERVAL_MS) {
          race._lastPickupAt = now;
          const ang = Math.random() * Math.PI * 2;
          const rad = Math.sqrt(Math.random()) * zr * 0.85;
          // No y — the balloon's altitude is derived deterministically from
          // the terrain on every client (same world seed → same answer).
          race.pickups.push({
            id: race._nextPickupId++,
            x: Math.round(race.zone.x + Math.cos(ang) * rad),
            z: Math.round(race.zone.z + Math.sin(ang) * rad),
            effect: BATTLE_FX_FORCE || BATTLE_FX_KEYS[Math.floor(Math.random() * BATTLE_FX_KEYS.length)],
          });
        }
        // AA sites: each fires a homing rocket at a RANDOM alive player within
        // range on its own clock. The launch is just a broadcast — clients
        // simulate the rocket and the victim self-reports the hit.
        for (const tr of race.turrets) {
          if (now - tr.lastFireAt < AA_FIRE_INTERVAL_MS) continue;
          const candidates = [];
          for (const [cid, cc] of conn) {
            if (cc.dead || !cc.state || !cc.state.p) continue;
            const dx = cc.state.p[0] - tr.x, dz = cc.state.p[2] - tr.z;
            if (dx * dx + dz * dz <= AA_RANGE * AA_RANGE) candidates.push(cid);
          }
          if (!candidates.length) continue; // hold fire until someone strays close
          tr.lastFireAt = now;
          const target = candidates[Math.floor(Math.random() * candidates.length)];
          broadcastToRoom('race', { type: 'fire', aa: tr.id, t: target });
        }
        if (now - race.startAt > race.durationMs) { finishRace(); raceChanged = true; }
      } else {
        const allDone = conn.every(([, c]) => c.race.finishMs != null);
        if (allDone || now - race.startAt > race.durationMs) { finishRace(); raceChanged = true; }
      }
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
    // No pong since the last ping = a stalled/half-open socket. Drop it now
    // (~10-20s) instead of waiting out IDLE_KICK_MS (50s) — that long gap is
    // what froze a racer (and their plane on everyone else's screen).
    if (c.ws.isAlive === false) { try { c.ws.terminate(); } catch {} dropClient(c, 'ping timeout'); continue; }
    c.ws.isAlive = false;
    try { c.ws.ping(); } catch {}
  }
}, PING_MS);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`megabroplanes server listening on :${PORT}`);
  console.log(STATIC_DIR ? `serving game from ${STATIC_DIR} + WebSocket` : 'WebSocket only');
});
