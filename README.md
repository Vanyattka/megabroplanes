# megabroplanes

A relaxing browser-based flight experience inspired by [slowroads.io](https://slowroads.io), but with a plane. Spawn on a runway in a procedurally generated world, throttle up, take off, fly around. No goals, no enemies — just vibes.

Built with Three.js, simplex-noise, and Vite. Vanilla JavaScript, no frameworks.

## Controls

| Key | Action |
|---|---|
| `W` / `S` | Pitch down / up |
| `A` / `D` | Roll left / right |
| `Q` / `E` | Yaw left / right |
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
