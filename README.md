# FRC 3D Sim

Browser-based 3D simulator of the current FIRST Robotics Competition game, rebuilt every year at
kickoff from the Game Manual. Current season: **2026 REBUILT presented by Haas** (manual TU22).

- **Engine** (`src/engine`) — reusable every year: Three.js rendering, Rapier physics, robot, input,
  cameras, match clock, scoreboard, HUD, game loop.
- **Season module** (`src/seasons/2026-rebuilt`) — this year's field, rules, scoring, AUTO routines, HUD.
- See **[docs/FRAMEWORK.md](docs/FRAMEWORK.md)** for what's reusable and the kickoff-day checklist,
  and **[PLAN.md](PLAN.md)** for the full plan and progress log.
- **Multiplayer** — up to 6 drivers + spectators per room. Design, protocol and hand-off log:
  **[docs/MULTIPLAYER.md](docs/MULTIPLAYER.md)**.

## Run it

Needs Node 22.18+ (the multiplayer server runs its TypeScript directly).

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload (multiplayer relay included at `/ws`; add `-- --host` for LAN play) |
| `npm test` | Unit tests (rules, scoring, staging, clock, coordinates) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build to `dist/` (static — deploy anywhere, e.g. Vercel) |
| `npm run preview` | Serve the production build locally |

## Playing 2026 REBUILT

Pick alliance, driver station, AUTO mode, camera and robot specs on the home screen, then **Start match**.
AUTO (20 s): drive it yourself (default) or pick a scripted routine. TELEOP (2:20) is yours.

| Key | Action |
|---|---|
| W A S D | Drive (field-oriented from your driver station) |
| Q / E, ← / → | Rotate |
| Shift | Precision mode |
| Space | Shoot at your HUB (hold) — aim assist handles the turret & shot speed |
| G | Feed (hold) — lob FUEL back into your ALLIANCE ZONE, clearing the hub/net/trench |
| F / J | Toggle auto-intake / hold to intake |
| C / X | Climb / descend (at your TOWER) · 1 2 3 selects the level |
| H | Human player: open/close the CHUTE |
| V | Cycle camera (driver station, follow, chase, overhead, orbit) |
| Mouse drag / wheel | Orbit / zoom the Follow camera (W always drives away from the camera) |
| P / Esc | Pause |
| Gamepad | LS drive · RS rotate · RT shoot · RB feed · LT intake · A climb · B descend · X human player · Y camera |

**What's simulated:** full field (HUBs with sensor cups, exits and nets, BUMPs, TRENCHes, DEPOTs,
TOWERs with rungs, OUTPOSTs with CHUTE/CORRAL, walls, tape, 32 AprilTags at official poses), all 504
FUEL staged per 6.3.4, match timeline with HUB shifts decided by AUTO fuel, 3 s grace windows, hub
lights, FUEL/TOWER points, ENERGIZED/SUPERCHARGED/TRAVERSAL RP, fouls G403 & G407 (G407 is called
when FUEL launched from outside your zone actually enters your HUB — feeding is legal), human player.

**Simplified:** climbing is a kinematic animation to the selected level; FUEL is a rigid sphere
(slightly undersized collider to model squish); no air drag; G408 (catching hub FUEL) and other
referee-judgement rules are not enforced.

## Multiplayer

Menu → **Multiplayer** → *Create room* and share the 4-letter code; friends *Join*, pick a driver
station (or spectate) and bring the robot they configured on the Single player page. The host starts
the match. The host's browser runs the simulation (keep that tab open — it keeps running in the
background); everyone else sends inputs and renders 30 Hz snapshots, with client-side prediction so your
own robot responds instantly. Test latency locally with `?netlag=200` in a client's URL.

| Command | What it does |
|---|---|
| `npm run build` then `npm run serve` | Production: one Node server on :8787 serving `dist/` + relay at `/ws` |

## Deployment

For a site that loads immediately even when the multiplayer server is asleep, deploy the built `dist/`
as a **Render Static Site** (or on Vercel) and the WebSocket relay as a **Render Web Service**. Set the
static site's build-time environment variable `VITE_RELAY_URL=wss://<relay>.onrender.com/ws`.
The Multiplayer page checks `/healthz`, shows the wake status, and connects when the relay is ready.
The included [`render.yaml`](render.yaml) still supports a simpler single-service deployment, but that
URL waits for the service to wake before it can show the site. Steps: [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md) §8.

## Sources

- 2026 Game Manual (TU22) — `2026GameManual.pdf`
- Official AprilTag layout — WPILib `allwpilib` v2026.2.1, `2026-rebuilt-welded.json`
