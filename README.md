# megabroplanes

A relaxing browser-based flight sim inspired by [slowroads.io](https://slowroads.io), but with a plane. Spawn on a runway in a procedurally generated world, throttle up, take off, fly around. No goals, no enemies — just vibes.

Built with [Three.js](https://threejs.org), [simplex-noise](https://github.com/jwagner/simplex-noise.js), and [Vite](https://vitejs.dev). Vanilla JavaScript, no frameworks.

## Try it

Live at <http://91.186.209.67/>. Or run locally — see below.

## Controls

### Keyboard

| Key | Action |
|---|---|
| `W` / `S` | Pitch nose down / up |
| `A` / `D` | Roll left / right |
| `Q` / `E` | Yaw left / right |
| `Shift` / `Ctrl` | Throttle up / down |
| `Space` | Brake (when on ground) |
| `R` | Reset to runway |
| `L` | Toggle landing light |
| `M` | Toggle audio mute |
| `P` | Toggle photo mode (orbit camera, world freezes) |
| Mouse drag | Free-look camera (releases back to chase view) |

### Touch (mobile)

Joystick on the left for pitch/roll, throttle slider on the right, plus on-screen brake / reset buttons. Auto-detected on touch-capable devices.

## Features

- Three planes — Cessna (forgiving), Piper (balanced), Jet (sharp + afterburner exhaust + contrails at altitude). Body color is configurable.
- Realistic procedural terrain — domain-warped landforms with genuinely flat plains, broad uplands/plateaus, and ridged mountain ranges (real ridgelines, not scaled hills). Climate biomes (desert / savanna / plains / forest / taiga / tundra / alpine) chosen by elevation × temperature × moisture, with sandy beaches, a climate-dependent snow line, and rock strata on cliffs. Sea-mask noise carves multi-kilometre oceans. Takeoff is always over open plains, with ranges in the distance.
- Day/night cycle with pink sunrises/sunsets, a moon opposite the sun, runway lamps + plane nav lights at night.
- Procedurally placed villages (small hamlets → khrushchevkas in cities) and stone ruins on high mountain peaks. Roads connect nearby villages.
- Procedural water with multi-octave ripples, sun glint, jet exhaust reflection, landing-light pool, and a plane-color glint disc when you skim low.
- Volumetric god rays + lens flare, atmospheric Preetham sky on High preset, aerial perspective, a cinematic color-grade pass, FXAA, and adaptive bloom that glows more at dawn/dusk. All preset-gated.
- Multiplayer with a **race mode** (see below).
- Photo mode (`P`): freeze the world, orbit camera freely with the mouse + scroll wheel, HUD hides itself.
- Settings menu: graphics preset (Low / Medium / High), view distance, time-of-day preset, plane picker.

## Run

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Multiplayer

Pick **MULTIPLAYER** on the main menu (top of the start screen). The toggle is persisted, so you only do this once.

In MP mode the WebSocket client connects, every other player you see is real, and the time of day is synchronized across all clients (derived from `Date.now()`). The TIME OF DAY picker is greyed out — global time wins. Switch back to **SINGLEPLAYER** to disconnect, hide other players, and use your own time-of-day preset.

### Race mode 🏁

While flying in multiplayer, a **🏁 START RACE** button appears in the bottom-right settings box. Anyone can start a race when none is running; everyone connected is entered. The server generates a checkpoint course (a loop of glowing gate rings around the spawn area), runs a countdown, then times everyone through the gates. Fly through each gate in order — the one you're chasing glows gold with a light beacon over it and is highlighted on the minimap. A live leaderboard shows everyone's progress; finishing pops a results board with medal placements and times. The race is server-authoritative (course, ordering, and finish times all come from the server). New messages on the wire: `race_start`, `cp` (gate cleared) client→server; `race` (phase / countdown / course / standings) server→client.

### Hosting

The deployed prod box at `91.186.209.67` runs nginx + a systemd-managed WebSocket server. To run your own:

```bash
npm run server   # starts ws server on port 3030
npm run dev      # starts the game on port 5173
```

For LAN play, share `http://<host-ip>:5173/?server=ws://<host-ip>:3030` with friends. Across the internet, expose either via a tunnel (ngrok / cloudflared / tailscale) or set up nginx as a reverse proxy that maps `/ws` to the 3030 server (that's what the prod box does, which is why the default in code is `wss://<host>/ws`).

The MP relay state is `{ position, quaternion, throttle, crashed, plane-type, body-color }` at 20 Hz. Exhaust + contrails for remote jets are reconstructed locally from those signals.

## Project layout

- `src/main.js` — entry point, game loop, input wiring
- `src/config.js` — every tunable lives here
- `src/core/` — Renderer, Clock (fixed-timestep), Input
- `src/world/` — terrain, biomes, water, sky, day/night, villages, ruins, roads, chunks
- `src/plane/` — Plane state + physics + controls + mesh
- `src/effects/` — particles (jet exhaust, contrails, explosion), post-FX (bloom, vignette, god rays + lens flare)
- `src/camera/` — chase camera
- `src/ui/` — HUD, menu, minimap, touch controls, graphics settings
- `src/net/` — WebSocket client + remote plane manager
- `src/race/` — multiplayer race mode (gates, checkpoint detection, race HUD)
- `src/audio/` — Web Audio engine + wind voices
- `server/` — Node WebSocket relay (run with `npm run server`)
- `docs/` — ARCHITECTURE / PHYSICS / WORLD / ROADMAP

## Working rules

- Every tunable goes in `src/config.js`. No magic numbers in logic.
- Physics is fixed 60 Hz with an accumulator; rendering is variable framerate with state interpolation.
- Noise is deterministic by world coordinates, never by chunk index — that's what keeps chunk borders seamless.
- Don't optimize prematurely. The chunk worker pool, time-budgeted streaming, and InstancedMesh-everything live in code already; they were added once profiling pointed at them, not before.

## Build & deploy

```bash
npm run build    # → /dist
```

Deploy the `dist/` folder behind nginx (or any static host) and run `server/index.js` as a separate service (e.g. via systemd) for multiplayer. Point clients at the WS server via the `?server=` URL parameter or set the prod default in `defaultServerUrl()` in `src/main.js`.
