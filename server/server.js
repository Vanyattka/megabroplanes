import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 3030;
const TICK_HZ = 20;
const IDLE_KICK_MS = 15000;

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });
const clients = new Map(); // id -> { ws, state, hue, lastSeen }
let nextId = 1;

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
  clients.set(id, { ws, state: null, hue, lastSeen: Date.now() });
  const addr = req?.socket?.remoteAddress || 'unknown';
  console.log(`[+] player ${id} connected from ${addr} (total: ${clients.size})`);

  ws.send(JSON.stringify({ type: 'welcome', id, hue }));

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    const c = clients.get(id);
    if (!c) return;
    c.lastSeen = Date.now();
    if (msg.type === 'state' && msg.state) {
      c.state = msg.state;
    }
  });

  ws.on('close', () => {
    clients.delete(id);
    console.log(`[-] player ${id} disconnected (total: ${clients.size})`);
  });

  ws.on('error', () => { /* swallow; close handles cleanup */ });
});

// Broadcast snapshot of all known states each tick.
setInterval(() => {
  const now = Date.now();
  // Kick silent connections.
  for (const [id, c] of clients) {
    if (now - c.lastSeen > IDLE_KICK_MS) {
      try { c.ws.close(); } catch {}
      clients.delete(id);
    }
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
    });
  }
  broadcast({ type: 'snapshot', states });
}, 1000 / TICK_HZ);

console.log(`megabroplanes server listening on ws://0.0.0.0:${PORT}`);
console.log('tell friends: ws://<your-ip>:' + PORT);
