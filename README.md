# megabroplanes

A relaxing browser-based flight experience inspired by [slowroads.io](https://slowroads.io), but with a plane. Spawn on a runway in a procedurally generated world, throttle up, take off, fly around. No goals, no enemies — just vibes.

Built with Three.js, simplex-noise, and Vite. Vanilla JavaScript, no frameworks.

## Controls

| Key | Action |
|---|---|
| `S` / `W` | Pitch nose down / up |
| `A` / `D` | Roll left / right |
| `Q` / `E` | Yaw right / left |
| `Shift` / `Ctrl` | Throttle up / down |
| `Space` | Brake (when on ground) |
| `R` | Reset to runway |
| Mouse drag | Look around (releases back to chase view) |

## Run

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Multiplayer

Host a game on your machine, let friends fly with you.

**On the host:**

```bash
npm run server   # starts WebSocket server on port 3030
npm run dev      # starts the game on port 5173 (bound to 0.0.0.0)
```

Find your LAN IP (`ipconfig getifaddr en0` on macOS, `hostname -I` on Linux).
Say it's `192.168.1.42`.

**On your friend's machine (same LAN):**

Open `http://192.168.1.42:5173/?server=ws://192.168.1.42:3030` in a browser.

That's it — each player gets a distinct plane color, everyone sees everyone in
real time. The HUD bottom-right shows connection status.

**Across the internet:** use a tunnel like [ngrok](https://ngrok.com):

```bash
ngrok http 5173   # tunnel for the game
ngrok http 3030   # separate tunnel for the WebSocket server
```

Then share the ngrok URL for port 5173 with your friend, appending
`?server=wss://<the-3030-tunnel>` (note `wss://` for ngrok's TLS).

If connection fails the client auto-retries every 3s.
