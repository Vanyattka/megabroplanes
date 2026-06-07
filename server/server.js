import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 3030;
const TICK_HZ = 20;
const IDLE_KICK_MS = 15000;

// ---- Race mode ------------------------------------------------------------
// One global race for the whole server (the server IS the room). Any player
// can start one when none is running; everyone connected is auto-entered.
// Lifecycle: idle → countdown → racing → finished → idle.
const COUNTDOWN_MS = 6000;     // get-ready window before the clock starts
const RESULTS_MS = 14000;      // how long the results board stays up
const RACE_TIMEOUT_MS = 360000; // hard cap so a stuck race always resolves
const RACE_CHECKPOINTS = 8;

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });
const clients = new Map(); // id -> { ws, state, hue, lastSeen, race }
let nextId = 1;

let race = makeIdleRace();
function makeIdleRace() {
  return { phase: 'idle', seed: 0, course: [], startAt: 0, endAt: 0 };
}

// Deterministic course generator (LCG) — a rough loop of gate checkpoints
// around the origin, at flyable altitudes, biased to stay near the gentle
// spawn plains so gates don't end up buried in a mountain.
function generateCourse(seed) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const n = RACE_CHECKPOINTS;
  const baseR = 600;
  const spanR = 1150;
  const cps = [];
  let ang = rand() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    ang += (Math.PI * 2) / n + (rand() - 0.5) * 0.6;
    const r = baseR + rand() * spanR;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const y = 130 + rand() * 170; // 130–300 m
    cps.push({ x: Math.round(x), y: Math.round(y), z: Math.round(z), r: 60 });
  }
  return cps;
}

function startRace() {
  const seed = Math.floor(Math.random() * 0x7fffffff);
  race = {
    phase: 'countdown',
    seed,
    course: generateCourse(seed),
    startAt: Date.now() + COUNTDOWN_MS,
    endAt: 0,
  };
  for (const [, c] of clients) c.race = { nextCp: 0, finishMs: null };
  console.log(`[race] starting — seed ${seed}, ${race.course.length} gates`);
}

function finishRace() {
  race.phase = 'finished';
  race.endAt = Date.now() + RESULTS_MS;
  console.log('[race] finished');
}

// Live standings: finished players first (by time asc), then by progress
// (more gates cleared = higher). Returns compact rows for the wire.
function standings() {
  const rows = [];
  for (const [id, c] of clients) {
    if (!c.race) continue;
    rows.push({ id, n: c.race.nextCp, f: c.race.finishMs });
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
    standings: standings(),
  };
}

function broadcast(payload, exceptId = null) {
  const str = JSON.stringify(payload);
  for (const [id, c] of clients) {
    if (id === exceptId) continue;
    if (c.ws.readyState === 1) c.ws.send(str);
  }
}

wss.on('connection', (ws, req) => {
  const id = nextId++;
  // Golden-angle hue spacing gives every new player a distinct color.
  const hue = ((id * 137.508) % 360) / 360;
  clients.set(id, {
    ws,
    state: null,
    hue,
    lastSeen: Date.now(),
    // Late joiners can still chase gates in an active race.
    race: race.phase === 'racing' || race.phase === 'countdown'
      ? { nextCp: 0, finishMs: null }
      : null,
  });
  const addr = req?.socket?.remoteAddress || 'unknown';
  console.log(`[+] player ${id} connected from ${addr} (total: ${clients.size})`);

  ws.send(JSON.stringify({ type: 'welcome', id, hue }));
  // Hand the newcomer the current race state immediately.
  ws.send(JSON.stringify(raceMessage()));

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    const c = clients.get(id);
    if (!c) return;
    c.lastSeen = Date.now();
    if (msg.type === 'state' && msg.state) {
      c.state = msg.state;
    } else if (msg.type === 'race_start') {
      if (race.phase === 'idle' || race.phase === 'finished') {
        startRace();
        broadcast(raceMessage());
      }
    } else if (msg.type === 'cp') {
      // Checkpoint cleared — only valid in order, while racing.
      if (race.phase !== 'racing' || !c.race) return;
      if (typeof msg.idx !== 'number' || msg.idx !== c.race.nextCp) return;
      c.race.nextCp++;
      if (c.race.nextCp >= race.course.length && c.race.finishMs == null) {
        c.race.finishMs = Date.now() - race.startAt;
        console.log(`[race] player ${id} finished in ${(c.race.finishMs / 1000).toFixed(1)}s`);
      }
    }
  });

  ws.on('close', () => {
    clients.delete(id);
    console.log(`[-] player ${id} disconnected (total: ${clients.size})`);
  });

  ws.on('error', () => { /* swallow; close handles cleanup */ });
});

// Broadcast snapshot of all known states each tick + drive the race clock.
setInterval(() => {
  const now = Date.now();
  // Kick silent connections.
  for (const [id, c] of clients) {
    if (now - c.lastSeen > IDLE_KICK_MS) {
      try { c.ws.close(); } catch {}
      clients.delete(id);
    }
  }

  // Race clock transitions.
  let raceChanged = false;
  if (race.phase === 'countdown' && now >= race.startAt) {
    race.phase = 'racing';
    raceChanged = true;
    console.log('[race] go!');
  }
  if (race.phase === 'racing') {
    const entrants = [...clients.values()].filter((c) => c.race);
    if (entrants.length === 0) {
      // Everyone left mid-race — don't leave a zombie race running to timeout.
      race = makeIdleRace();
      raceChanged = true;
    } else {
      const allDone = entrants.every((c) => c.race.finishMs != null);
      if (allDone || now - race.startAt > RACE_TIMEOUT_MS) {
        finishRace();
        raceChanged = true;
      }
    }
  }
  if (race.phase === 'finished' && now >= race.endAt) {
    race = makeIdleRace();
    raceChanged = true;
  }

  const states = [];
  for (const [id, c] of clients) {
    if (!c.state) continue;
    states.push({
      id,
      hue: c.hue,
      p: c.state.p,
      q: c.state.q,
      t: c.state.t ?? 0,
      c: c.state.c ? 1 : 0,
      pt: c.state.pt,
      pc: c.state.pc,
    });
  }
  broadcast({ type: 'snapshot', states });

  // Race state: stream every tick while active (timer + standings are live),
  // otherwise only when something changed.
  if (race.phase !== 'idle' || raceChanged) {
    broadcast(raceMessage());
  }
}, 1000 / TICK_HZ);

console.log(`megabroplanes server listening on ws://0.0.0.0:${PORT}`);
console.log('tell friends: ws://<your-ip>:' + PORT);
