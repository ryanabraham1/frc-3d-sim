# FRC 3D Sim

Browser-based 3D FIRST Robotics Competition simulator. Choose **2026 REBUILT** (manual TU22) or
**2025 REEFSCAPE**, both presented by Haas, on the home screen. Both support single player and multiplayer.

- **Engine** (`src/engine`) — reusable every year: Three.js rendering, Rapier physics, robot, input,
  cameras, match clock, scoreboard, HUD, game loop.
- **Season modules** (`src/seasons/2026-rebuilt`, `src/seasons/2025-reefscape`) — each year's field,
  rules, scoring, AUTO routines and HUD.
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

## Playing 2025 REEFSCAPE

Select **2025 REEFSCAPE** in the season dropdown. Pick your alliance, driver station, AUTO routine,
camera and robot. Choose **Shallow cage** or **Deep cage** before starting; this sets your station's cage.
The 2025 robot editor offers All-rounder, CORAL + cage and ALGAE + cage profiles, individual mechanism
toggles, elevator level/speed/reach, placement/removal cycle times, net tuning and cage rise time.
Inventory follows the manual's one-CORAL/one-ALGAE limit rather than an adjustable bulk hopper.
Drive with W/A/S/D and rotate with Q/E. The other camera and pause controls are shared with 2026.

| Key | Action |
|---|---|
| 1 / 2 / 3 / 4, [ / ] | Choose reef L1–L4 |
| Space | Place held CORAL on the nearest open branch or L1 trough; with ALGAE only, shoot your NET |
| J / F | Hold intake / toggle auto-intake; close to either reef, collect its staged ALGAE |
| G | Feed held ALGAE into your nearby PROCESSOR; with CORAL only, eject it a short distance |
| C / X | Climb your driver station's cage / descend; X near your reef retrieves scored CORAL |
| H | Toggle station CORAL supply and act as HUMAN PLAYER; throw received ALGAE in TELEOP |
| Gamepad | LS drive · RS rotate · D-pad reef level · RT score · RB processor · LT intake · A climb · B descend · X human player · Y camera |

Includes both reefs and all 72 branches, troughs, four coral stations, processors, the barge, nets,
six physical cages and 22 visual AprilTags. The full 126 CORAL / 18 ALGAE supply, AUTO/TELEOP scoring,
leave, park, shallow/deep climbs, Coopertition and ranking points are simulated. ALGAE blocks its
staged branch level until collected. An extended elevator can collide with the barge.

This is an assisted game simulator: CORAL placement and cage engagement use animations, and
undimensioned field positions are approximated from the supplied PDF. See
[docs/REEFSCAPE.md](docs/REEFSCAPE.md) for manual source pages, implemented fouls and physics limitations.

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
the match. The host chooses the season; joining drivers and spectators automatically use that same
game. After returning to the lobby, the host can switch between 2025 and 2026. The host's browser runs the simulation (keep that tab open — it keeps running in the
background); everyone else sends inputs and renders 30 Hz snapshots, with client-side prediction so your
own robot responds instantly. Test latency locally with `?netlag=200` in a client's URL.

| Command | What it does |
|---|---|
| `npm run build` then `npm run serve` | Production: one Node server on :8787 serving `dist/` + relay at `/ws` |

## Deployment

For a site that loads immediately even when the multiplayer server is asleep, deploy the built `dist/`
as a **Render Static Site** (or on Vercel) and the WebSocket relay as a **Render Web Service**. Set the
static site's build-time environment variable `VITE_RELAY_URL=wss://<relay>.onrender.com/ws`.
The Multiplayer page probes the WebSocket, shows the wake status, and connects when the relay is ready.
The included [`render.yaml`](render.yaml) still supports a simpler single-service deployment, but that
URL waits for the service to wake before it can show the site. Steps: [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md) §8.

## Sources

- 2026 Game Manual (TU22) — `2026GameManual.pdf`
- Official AprilTag layout — WPILib `allwpilib` v2026.2.1, `2026-rebuilt-welded.json`
- 2025 REEFSCAPE uses only the supplied `2025GameManual.pdf` (ARENA V4, Game Details V13, Game Rules V11).
