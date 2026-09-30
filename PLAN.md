# FRC 3D Sim — Master Plan & Progress Log

> **Purpose of this file:** a complete hand-off document. Any agent (or human) should be able to
> read this top-to-bottom and continue the work. Keep the **Progress** checklist current — tick
> items as they land and add notes under **Log**.

---

## 1. Goal

Every FRC kickoff, turn the newly released Game Manual into a playable **browser-based 3D
simulation** of that year's game as fast as possible. Hosted as a static site (Vercel).
Multiplayer comes later.

This repo therefore has two halves:

| Half | Path | Changes each year? |
|---|---|---|
| **Engine** (year-agnostic framework) | `src/engine/` | Rarely — improved over time |
| **Season module** (one per game) | `src/seasons/<year>-<name>/` | Written fresh at kickoff |
| App shell (menu, season picker, bootstrap) | `src/app/`, `src/main.ts` | Rarely |

First season: **2026 REBUILT presented by Haas** (manual: `2026GameManual.pdf`, Team Update 22).

## 2. Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Language/build | TypeScript + Vite 7 | Static output → Vercel, fast HMR |
| Rendering | Three.js (0.186) | Light, huge community, InstancedMesh for 500+ balls |
| Physics | Rapier 3D (`@dimforge/rapier3d-compat` 0.21, WASM) | Fast, deterministic → future server-authoritative multiplayer |
| UI | Plain DOM/CSS overlay | No framework to maintain |
| Tests | Vitest (node env) | Pure-logic tests for rules/timeline/scoring |
| Climbing | **Simplified**: hold/press climb inside tower zone → kinematic animation to level | Full physics climbing costs a lot for little gameplay value |
| Robot | **One configurable robot** (size, speed, hopper capacity, fire rate, height, max climb level, aim assist). Presets later. | Flexible, minimal UI |
| Coordinates | **WPILib field coordinates** in season code (meters, origin = blue alliance wall / right corner, +x toward red, +y left, +z up). Engine converts to Three.js (y-up). | Matches robot code & official AprilTag JSON; drop-in future layouts |
| Field geometry | Procedural primitives from manual dimensions, positions anchored to the official WPILib AprilTag layout | CAD (Onshape/STEP) needs login + conversion; engine supports an optional GLB visual overlay later |
| Players | Singleplayer + **online multiplayer** (up to 6 drivers + spectators). No bot AI — every robot is a human (or its driver's AUTO routine). | Multiplayer: host-authoritative browser sim + WebSocket relay — see `docs/MULTIPLAYER.md` |
| UI theme | Dark "single player" layout (user reference): condensed display title (Barlow Condensed), left column = robot card + option groups, right = top-down starting-spot map (click driver stations) + spec bars, bottom action bar (Controls / Rules / Start match). Purple accent kept. Menu CSS in `src/app/menu.css`; HUD stays light. Seasons supply `mapShapes` for the map. | User request |

## 3. Architecture

```
src/
  main.ts                    bootstrap: load Rapier, show menu, start Game
  app/
    menu.ts                  home screen (sidebar: Play / Controls / Game rules; season picker)
    icons.ts                 inline lucide-style SVG icons
    styles.css               design tokens + menu + HUD styles (light theme)
  engine/                    ── YEAR-AGNOSTIC ──
    units.ts                 inches/feet/deg helpers
    random.ts                seeded PRNG (mulberry32) for determinism
    coords.ts                WPILib field coords <-> Three.js world
    core/
      game.ts                Game orchestrator: fixed-step loop, wires season+engine together
      season.ts              SeasonDefinition interface (THE contract a season implements)
      events.ts              tiny typed event bus
    physics/world.ts         Rapier wrapper, collision groups, fixed timestep
    render/renderer.ts       scene, lights, shadows, resize, sky/arena backdrop
    field/builder.ts         FieldBuilder: box/prism/cylinder/tape/panel/net/label → mesh + collider
    field/apriltags.ts       render tag panels from a WPILib AprilTag JSON layout
    field/cadOverlay.ts      optional GLB visual overlay loader (official CAD export)
    gamepiece/pool.ts        GamePiecePool: N rigid bodies + InstancedMesh; states field/held/reserve
    robot/robot.ts           Robot: chassis+bumpers, swerve drive controller, intake, hopper, launcher(turret), climb controller
    robot/config.ts          RobotConfig type + defaults + validation
    input/input.ts           keyboard + gamepad → DriverCommand
    camera/cameras.ts        driver-station / chase / overhead / orbit camera rig
    match/clock.ts           MatchClock: period timeline state machine (pure logic)
    match/scoreboard.ts      per-alliance score categories, fouls, RP (pure logic)
    ai/steering.ts           arrive/avoid/turn + routeThroughBands (cross rows only via gaps)
    hud/hud.ts               DOM HUD: scores, timer, period banner, toasts, widget slots, results screen
    net/                     multiplayer: relayProtocol, protocol (snapshot codec), netClient, hostSync,
                             clientSync (interpolation), prediction, ticker — see docs/MULTIPLAYER.md
server/                      relay.ts (rooms/fan-out), index.ts (`npm run serve`), vitePlugin.ts (/ws in dev)
  seasons/
    index.ts                 registry of available seasons
    2026-rebuilt/
      constants.ts           every manual dimension (inches) w/ section refs + field anchor points (m)
      apriltags-welded.json  official WPILib 2026 layout (v2026.2.1)
      config.ts              timeline (Table 6-2), points (6-4), RP thresholds (6-5), robot defaults
      hubLogic.ts            PURE: hub active table (6-3), grace windows, auto winner
      scoring.ts             PURE: tower points, RP evaluation
      staging.ts             PURE: 504 FUEL start positions (6.3.4)
      field.ts               builds HUBs, BUMPs, TRENCHes, DEPOTs, TOWERs, OUTPOSTs, walls, tape
      rules.ts               runtime rules: hub sensors & exits, fouls (G403/G407), towers, human player
      autopilot.ts           AUTO routines for the player's robot + BANDS (bump/trench lanes)
      hud.ts                 season HUD widgets (hub status, RP progress, shift countdown)
      index.ts               SeasonDefinition export
tests/                       vitest: clock, hub table, scoring, staging, coords
docs/FRAMEWORK.md            what is reusable + kickoff-day checklist
```

### Season contract (summary — see `src/engine/core/season.ts`)
A season provides: metadata, field dimensions, match timeline, game-piece spec, `buildField()`,
`createRules()` (stage + per-tick hooks + scoring + results), robot defaults, `createAutoPilot()`,
`createHud()`, auto routines, rules summary, controls help. The engine owns everything else.
Full reuse map + kickoff checklist: `docs/FRAMEWORK.md`.

## 4. 2026 REBUILT — facts used (from manual + official AprilTag layout)

- FIELD 651.2 × 317.7 in (16.541 × 8.069 m). Blue wall x=0, red wall x=16.541.
- Rotational symmetry: red element = (L − x, W − y).
- **HUB** 47×47 in, hex opening 41.7 in, front edge 72 in high; blue center (4.6256, 4.0346) m,
  red center (11.9155, 4.0346). Exits at base toward NEUTRAL ZONE; net behind (neutral side).
- **BUMP** 73 w × 44.4 d × 6.513 in tall, 15° ramps; either side of HUB (y 1.577→3.431 and 4.638→6.492).
- **TRENCH** 65.65 w × 47 d × 40.25 in tall; opening 50.34 w × 22.25 in tall, opening centered
  y=0.6445 (and 7.4248); same x as hub.
- **DEPOT** 42 w × 27 d, 1.125 in barriers, along alliance wall (position approximated, opposite side from outpost).
- **TOWER** 49.25 w × 45 d × 78.25 tall at alliance wall, center y=3.7457 (blue) / 4.3233 (red).
  Rungs at 27 / 45 / 63 in; uprights 32.25 in apart.
- **OUTPOST** at wall/guardrail corner, center y=0.666 (blue) / 7.403 (red). Chute opening 31.8×7 in
  at 28.1 in; holds ~25 FUEL; corral opening at floor.
- **ALLIANCE ZONE** 158.6 in deep from alliance wall. NEUTRAL ZONE 283 in, CENTER LINE at x=L/2.
- **FUEL** 5.91 in foam ball, ~0.215 kg. 504 staged: 24/depot, 24/chute, ≤8 preload/robot, rest in
  neutral zone box 206 × 72 in split by a 2 in gap at the center line.
- **Timeline:** AUTO 20 s → 3 s pause → TRANSITION 10 s → SHIFT 1–4 × 25 s → END GAME 30 s → 3 s post.
- **HUB status:** both active in AUTO/TRANSITION/END GAME. Alliance with more AUTO fuel is
  **inactive** in SHIFT 1, then alternate. Tie → random. Fuel counts up to 3 s after deactivation.
- **Points:** FUEL in active hub 1 (auto & teleop). TOWER L1 = 15 auto (max 2 robots) / 10 teleop;
  L2 = 20; L3 = 30 (teleop). One level per robot in teleop.
- **RP:** ENERGIZED ≥100 fuel, SUPERCHARGED ≥360 fuel, TRAVERSAL ≥50 tower pts, Win 3, Tie 1.
- **Fouls:** MINOR 5, MAJOR 15 (credited to opponent). Enforced: G403 (auto center-line cross),
  G407 (launch outside own alliance zone). Robot max height 30 in (R104/R107).

## 5. Progress

Legend: `[x]` done · `[~]` partial · `[ ]` todo

### Stage 1 — Scaffolding & engine core
- [x] package.json / tsconfig / vite config / .gitignore, deps installed
- [x] git repo initialised (no commits yet — user hasn't asked for one)
- [x] units, coords, random, events
- [x] physics world wrapper (Rapier, 90 Hz fixed step, collision groups)
- [x] renderer (light venue backdrop, shadows)
- [x] input (keyboard + gamepad)
- [x] camera rig (driver station / chase / overhead / orbit)
- [x] game loop orchestrator + season contract

### Stage 2 — 2026 field
- [x] constants (with [M §]/[TAG]/[EST] provenance) + official AprilTag JSON
- [x] field builder primitives (box, convex, cylinder, tape, label, panel, carpet)
- [x] HUB (cup + sensor, hex funnel, light bars, net, exits), BUMP (15° prisms), TRENCH (22.25in clearance), DEPOT, TOWER (base, uprights, 3 rungs, supports), OUTPOST (chute + corral openings, corral, chute ramp, door), walls, guardrails, tape
- [x] AprilTag panels at official poses (stylised, not decodable 36h11)

### Stage 3 — FUEL
- [x] GamePiecePool (instanced + physics, air/ground damping switch)
- [x] staging (504 total, neutral grid w/ center divider gap, depots, chutes, preloads) — perf OK (~0.4 ms/step)

### Stage 4 — Robot
- [x] swerve drive (impulse-based, accel-limited → realistic pushing), bumpers, team numbers
- [x] intake capture zone + hopper
- [x] launcher: turret, adjustable-hood ballistic solver that clears the hub rim, shoot-on-the-move lead
- [x] kinematic climb controller (align → rise → hang → lower)

### Stage 5 — Match & rules
- [x] MatchClock timeline (AUTO, 3 s assessment, TRANSITION, SHIFT 1–4, END GAME, 3 s final)
- [x] Scoreboard + RP (ENERGIZED/SUPERCHARGED/TRAVERSAL/W/T)
- [x] Hub sensors, active/inactive by AUTO result, 3 s grace, processing delay → exits, lights (active/warning/chase/off/post)
- [x] Tower assessment (AUTO L1 ×15 max 2 robots; TELEOP 10/20/30)
- [x] Fouls G403 (AUTO center line) / G407 (launch outside alliance zone)
- [x] HUD + results screen + pause
- [x] Unit tests — 43 passing (`npm test`)

### Stage 6 — AUTO & human player  (bots dropped per user)
- [x] ~~Bot brain~~ → removed; singleplayer
- [x] Player AUTO: drive manually (default) or routines: shoot+collect neutral, shoot+depot, shoot+climb L1, shoot only, none
- [x] Human player chute door (H key, or automatic)
- [x] Corral / out-of-bounds → chute recycling

### Stage 6b — Round 2 requests (2026-09-29)
- [x] FEED/PASS: hold G (gamepad RB) to lob FUEL into own ALLIANCE ZONE; solver arcs over hub+net / trench rows (`passing.ts`, `AimTarget.clearances`)
- [x] G407 now assessed when FUEL launched from outside the zone ENTERS own HUB (was: any launch outside zone) — matches manual wording
- [x] Manual AUTO: "Drive it yourself" is the first/default Autonomous option (menu)
- [x] Follow camera: 3rd-person, tracks position not heading, mouse drag orbit + wheel zoom, camera-relative driving; selectable on menu (Camera row) + V cycle
- [x] Tests: 43 passing (added passing/solver tests)

### Stage 7 — App shell
- [x] Home screen themed to user's reference (Play / Controls / Game rules pages, robot config, persisted settings)
- [x] Pause / restart / camera switching / controls help
- [x] Production build verified locally (`npm run build` + `npm run preview`; Rapier/three code-split & lazy-loaded)

### Stage 8 — Docs
- [x] README (run/build/controls/what's simulated)
- [x] docs/FRAMEWORK.md (reuse map + kickoff checklist + engine gaps)

### Later (not in current scope)
- [ ] Deploy to Vercel (needs user's Vercel account/team; static `dist/`, no server needed)
- [x] Multiplayer — done 2026-09-29, full design + log in `docs/MULTIPLAYER.md` (deploy: free Render web service via `render.yaml`)
- [ ] Official CAD GLB visual overlay (`engine/field/cadOverlay.ts` is ready; needs an exported GLB)
- [ ] Robot presets; replay recording; driver practice stats
- [ ] Rules not enforced: G408 catching hub FUEL, contact/defense rules, extension limits (R105), HP zone rules
- [ ] [EST] values to confirm against official field drawings: depot position, hub cup floor/net height, upright x-position, DS positions

## 5b. How to verify (for the next agent)
- `npm test` → 43 tests pass. `npm run typecheck` → clean. `npm run build` → ok.
- `npm run dev`, open http://localhost:5173, Start match. In the browser console `window.game` is the
  live `Game`; you can fast-forward deterministically with `game.step(game.physics.dt, idleInput)`
  (see the session log below for the idle input shape). This is how traversal (bump/trench), climb L3,
  G407, chute and full-match results were verified.
- NOTE: the Claude desktop Browser pane throttles `requestAnimationFrame` when hidden — low FPS there
  is not a real perf problem. Measured: physics+rules ≈ 0.4 ms/step, render ≈ 1 ms/frame (RTX 3060).

## 6. Log
- 2026-09-29: Read manual (sections 4–6, key G/R rules). Pulled official WPILib 2026 AprilTag
  layout (`allwpilib` tag v2026.2.1, `2026-rebuilt-welded.json`) to anchor field element positions.
  Scaffolded project.
- 2026-09-29: Built engine core, 2026 field, FUEL, robot, rules, HUD, menu, tests (37), docs.
  User decisions mid-build: (1) singleplayer only, no bot AI — removed bots, kept an AUTO autopilot
  for the player; (2) re-theme UI to their light "attendance app" reference (done for menu + HUD).
  Verified in browser: menu, match start, AUTO scoring (≈26 FUEL), hub shift order, bump/trench
  traversal, hub blocks robots, L3 climb (30 pts), G407 foul, chute/corral, results modal, prod build.
- 2026-09-29 (round 2): Added feeding (G), G407-on-hub-entry, manual AUTO as default option, Follow
  camera. Verified in browser: feeds from behind hub / over bump / from opponent zone all land in the
  blue alliance zone with 0 hub entries & 0 fouls; shooting into hub from outside zone → G407; manual
  input moves robot during AUTO; W is camera-relative in Follow mode.
- 2026-09-29 (round 3): Fixed tall robots missing the HUB (balls spawned inside own collider), rim/drag-aware
  aim solver, traction only with ground contact (robots wedging under TRENCH), trench arm overhang. Added
  HeadlessSim + tests/physics.test.ts (runs for every season). Mid-air ball collisions kept (user: real
  physics). Details + remaining items: docs/BUGFIX-HANDOFF.md.
