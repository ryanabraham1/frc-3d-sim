# FRC 3D Sim

Browser-based 3D simulator of the current FIRST Robotics Competition game, rebuilt every year at
kickoff from the Game Manual. Current season: **2026 REBUILT presented by Haas** (manual TU22).

- **Engine** (`src/engine`) — reusable every year: Three.js rendering, Rapier physics, robot, input,
  cameras, match clock, scoreboard, HUD, game loop.
- **Season module** (`src/seasons/2026-rebuilt`) — this year's field, rules, scoring, AUTO routines, HUD.
- See **[docs/FRAMEWORK.md](docs/FRAMEWORK.md)** for what's reusable and the kickoff-day checklist,
  and **[PLAN.md](PLAN.md)** for the full plan and progress log.

## Run it

Needs Node 20+.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm test` | Unit tests (rules, scoring, staging, clock, coordinates) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build to `dist/` (static — deploy anywhere, e.g. Vercel) |
| `npm run preview` | Serve the production build locally |

## Playing 2026 REBUILT

Pick alliance, driver station, AUTO routine and robot specs on the home screen, then **Start match**.
AUTO (20 s) runs your chosen routine; TELEOP (2:20) is yours.

| Key | Action |
|---|---|
| W A S D | Drive (field-oriented from your driver station) |
| Q / E, ← / → | Rotate |
| Shift | Precision mode |
| Space | Shoot (hold) — aim assist handles the turret & shot speed |
| F / J | Toggle auto-intake / hold to intake |
| C / X | Climb / descend (at your TOWER) · 1 2 3 selects the level |
| H | Human player: open/close the CHUTE |
| V | Cycle camera (driver station, chase, overhead, orbit) |
| P / Esc | Pause |
| Gamepad | LS drive · RS rotate · RT shoot · LT intake · A climb · B descend · X human player · Y camera |

**What's simulated:** full field (HUBs with sensor cups, exits and nets, BUMPs, TRENCHes, DEPOTs,
TOWERs with rungs, OUTPOSTs with CHUTE/CORRAL, walls, tape, 32 AprilTags at official poses), all 504
FUEL staged per 6.3.4, match timeline with HUB shifts decided by AUTO fuel, 3 s grace windows, hub
lights, FUEL/TOWER points, ENERGIZED/SUPERCHARGED/TRAVERSAL RP, fouls G403 & G407, human player.

**Simplified:** climbing is a kinematic animation to the selected level; FUEL is a rigid sphere
(slightly undersized collider to model squish); no air drag; G408 (catching hub FUEL) and other
referee-judgement rules are not enforced. Singleplayer only for now.

## Deployment (not done yet)

The build is a static site — Vercel needs no config beyond `npm run build` → `dist/`.
Multiplayer will need a realtime backend (Vercel serverless can't hold WebSockets): options are
PartyKit / Cloudflare Durable Objects, Colyseus on Fly.io/Railway, or Supabase Realtime. The engine
already routes every robot through a `RobotCommand` and exposes `NetworkAdapter`
(`src/engine/net/adapter.ts`) for that.

## Sources

- 2026 Game Manual (TU22) — `2026GameManual.pdf`
- Official AprilTag layout — WPILib `allwpilib` v2026.2.1, `2026-rebuilt-welded.json`
