# FRC 3D Sim

Browser-based 3D FIRST Robotics Competition simulator. Choose **2026 REBUILT** (manual TU22),
**2025 REEFSCAPE** or **2024 CRESCENDO**, all presented by Haas, on the home screen. All support single
player and multiplayer.

> **Adding another game from a manual?** Read **[INSTRUCTIONS.md](INSTRUCTIONS.md)** first.

- **Engine** (`src/engine`) — reusable every year: Three.js rendering, Rapier physics, robot, input,
  cameras, match clock, scoreboard, HUD, game loop.
- **Season modules** (`src/seasons/2026-rebuilt`, `src/seasons/2025-reefscape`, `src/seasons/2024-crescendo`) — each year's field,
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

For close-up inspection of all 12 team robot models, open `/tools/robot-gallery.html` on the dev server.
Choose a season and mechanism pose, switch sides or alliance colors, and click a robot to enlarge it.
The gallery uses the same models and animation path as the game; it is a development tool.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload (multiplayer relay included at `/ws`; add `-- --host` for LAN play) |
| `npm test` | Unit tests (rules, scoring, staging, clock, coordinates) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build to `dist/` (static — deploy anywhere, e.g. Vercel) |
| `npm run preview` | Serve the production build locally |

## Single-player AI

Choose **3 vs 3** to play with two AI teammates against three AI opponents in any season, or **Solo practice**
for an empty field.

- **AI difficulty** (opponents) and **Teammate skill**: *Easy* just cycles; *Normal* runs the full alliance plan;
  *Hard* adds competitive builds, full speed and tight aim; *Elite* re-plans fastest with the most accurate shots.
- **Alliance strategy** for your teammates: *Adaptive* (recommended) or one fixed plan per season — e.g. 2026
  *Press* / *Shift control* / *Stockpile* / *Lockdown*, 2024 *Amplify cycles* / *Feed & shoot* / *Speaker cycles* /
  *Amplify + defense*, 2025 *Reef race* / *All coral* / *Coral + algae* / *Reef race + press*.
- **Roles per driver station**, including your own: set yours (e.g. *Amp* in 2024) and the bots plan around you.
- **AI radio** shows the callouts the bots coordinate with ("AMP 2/2 — load up", "AMPLIFY!", "I'm beached — need a
  push!", "New plan: PRESS — …").

Each alliance shares one brain (`src/engine/ai/team.ts`): it assigns roles, scouts the opponents (who is defending,
scoring rates, the score margin) and, on *Adaptive*, switches strategy as the match unfolds. A robot that is beached,
pinned or stuck — yours included — gets the nearest AI teammate pushing it free; after a few seconds without success
the helper backs off and returns later. Bots avoid protected-zone contact and pins, try alternative escapes when stuck,
and score only through the same physical mechanisms as you. Which plan is best, and when the adaptive plan switches,
comes from head-to-head headless benchmarks: see [docs/AI-STRATEGY.md](docs/AI-STRATEGY.md).

## Robot archetypes

Each season's **Robot** panel offers archetype presets based on how real teams built robots for that game, plus
mechanism options for the real trade-offs: ground intake or not, station/human-player intake, turret vs chassis
auto-align vs driver aim, shooter type, capacity, height, climber. Use it at kickoff to compare archetypes, e.g.
"is a ground intake worth it?". Human players feed physical pieces down the real chutes (H), and driver assists
(chassis auto-align, reef auto-align) are robot options. How archetypes are derived for a new game (from past-game patterns plus the manual) and what was built 2022–2026: [docs/ROBOT-ARCHETYPES.md](docs/ROBOT-ARCHETYPES.md).

**Defense is physical.** Each wheel pushes with the lesser of its motor force and its tread grip (μ × the weight on
it), so pushing matches are decided by **Weight**, **Accel** and **Tread grip μ** (the **Pushing** bar shows the
result). Flooring it past the tread limit only spins the wheels, a hit off a robot's center turns it, a tank drive is
hard to shove sideways, and a disabled robot (brake mode) can be pushed.

## Playing 2024 CRESCENDO

Select **2024 CRESCENDO** in the season dropdown. Score NOTES (foam rings) in your SPEAKER and AMP,
AMPLIFY, cooperate, and finish ONSTAGE on a STAGE chain. Your SOURCE is at the *opponent's* end.

| Key | Action |
|---|---|
| Space | Shoot at your SPEAKER (hold; chassis auto-align turns you onto it) · while ONSTAGE: place the NOTE in the TRAP |
| G | Against your AMP: score in the AMP · elsewhere: pass into your WING |
| J / I | Hold intake / toggle auto-intake (one NOTE at a time) |
| C / X | Climb the STAGE chain you're under (TELEOP) / descend |
| H | SOURCE human player: drop a NOTE down the 50° CHUTE toward your robot (TELEOP) |
| B / N / M | AMP human player: AMPLIFY / Coopertition / throw a HIGH NOTE (last 20 s) |
| Gamepad | RT shoot · RB amp/pass · LT intake · A climb · B descend · X SOURCE drop · LB amplify · Y camera |

**What's simulated:** full field from the manual (SPEAKERS with hood and SUBWOOFER, AMPS with lights,
SOURCES, STAGES with chains, TRAPS, MICROPHONES and PODIUMS, 16 AprilTags, all tape zones), all 107 NOTES
+ 6 HIGH NOTES staged per §6.3.4, physical SPEAKER shots under the hood lip, passing, NOTES sliding down the SOURCE CHUTE, HIGH NOTE
throws, AMPLIFICATION (10 s + lights), Coopertition, LEAVE/PARK/ONSTAGE/SPOTLIT/HARMONY/TRAP, MELODY and
ENSEMBLE RP, and fouls G404, G405, G414, G422, G423, G424. AMP deposits, chain climbs and TRAP placement
are assisted animations. Details, manual page references and approximations: [docs/CRESCENDO.md](docs/CRESCENDO.md).

## Playing 2025 REEFSCAPE

Select **2025 REEFSCAPE** in the season dropdown. Pick your alliance, driver station, AUTO routine,
camera and robot archetype: *Funnel-fed L4 cycler* (default), *Ground-intake all-rounder*, *L2–L3 elevator*,
*L1 trough bot* or *ALGAE specialist*. You can also change CORAL levels, CORAL intake (funnel / ground / both),
ALGAE handling, reef auto-align and the cage climber.
Inventory follows the manual's one-CORAL/one-ALGAE limit.

| Key | Action |
|---|---|
| 1 / 2 / 3 / 4, [ / ] | Choose reef L1–L4 |
| Space | Release CORAL from the end effector (with reef auto-align: hold to line up on the nearest open BRANCH first); with ALGAE only, shoot your NET |
| J / I | Hold intake / toggle auto-intake; funnel robots back up to a CORAL STATION; at a reef, collect staged ALGAE (or knock it off) |
| G | Feed held ALGAE into your nearby PROCESSOR; with CORAL only, eject it a short distance |
| C / X | Climb the nearest matching alliance cage / descend |
| H | HUMAN PLAYER: drop a CORAL down the nearest CORAL STATION CHUTE, aimed at your robot |
| B | HUMAN PLAYER: throw PROCESSOR ALGAE at your NET (TELEOP) |
| Gamepad | LS drive · RS rotate · D-pad reef level · RT score · RB processor · LT intake · A climb · B descend · X human player · Y camera |

Includes both reefs and all 72 branches, troughs, four coral stations with sloped CHUTES, processors, the barge,
nets, six physical cages and 22 visual AprilTags. The full 126 CORAL / 18 ALGAE supply, AUTO/TELEOP scoring,
leave, park, shallow/deep climbs, Coopertition and ranking points are simulated. **CORAL placement is
physical:** the hollow CORAL leaves the end effector and scores only if a BRANCH ends up inside it, so a robot
about an inch off misses. Staged ALGAE physically blocks its level until removed. An extended elevator can
collide with the barge. Cage engagement is an assisted animation. See [docs/REEFSCAPE.md](docs/REEFSCAPE.md)
for manual source pages, implemented fouls and physics limitations.

## Playing 2026 REBUILT

Pick alliance, driver station, AUTO mode, camera and robot archetype (*Turret trench bot*, *Dumper +
auto-align*, *Big-hopper BUMP bot*, *OUTPOST-fed shooter*) on the home screen, then **Start match**.
AUTO (20 s): drive it yourself (default) or pick a scripted routine. TELEOP (2:20) is yours.

| Key | Action |
|---|---|
| W A S D | Drive (field-oriented from your driver station) |
| Q / E, ← / → | Rotate |
| Shift | Precision mode |
| Space | Shoot at your HUB (hold) — turret robots aim themselves; turretless robots with chassis auto-align rotate onto the HUB |
| G | Feed (hold) — lob FUEL back into your ALLIANCE ZONE, clearing the hub/net/trench |
| I / J | Toggle auto-intake / hold to intake |
| C / X | Climb / descend (at your TOWER) · 1 2 3 selects the level |
| H | Human player: open/close the CHUTE |
| V | Cycle camera (driver station, chase, overhead, orbit) |
| T | Chase camera: look along the intake side (default) or the shooter side |
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
- 2024 CRESCENDO uses only `2024GameManual.pdf` (kickoff release V0; no Team Updates).
