# Framework Guide — what's reusable, and the kickoff-day checklist

This repo is split so that **each new FRC season only needs a new season module**. Everything
else carries over. This doc lists what is reusable (and how much), how the season contract works,
and a step-by-step plan for kickoff day.

---

## 1. Reuse map

| Area | Path | Reuse next year | Notes |
|---|---|---|---|
| Units & math helpers | `src/engine/units.ts` | **100%** | `inch()`, `deg()`, `formatClock()`, `wrapAngle()`… |
| Field coordinates | `src/engine/coords.ts` | **100%** | WPILib field frame ↔ Three.js world. Rotational/mirror helpers for either symmetry style. |
| Seeded RNG | `src/engine/random.ts` | **100%** | Reproducible matches (needed for multiplayer determinism). |
| Physics wrapper | `src/engine/physics/world.ts` | **100%** | Rapier init, fixed timestep, collision groups (field / robot / piece / piece-only / robot-only). |
| Renderer & venue | `src/engine/render/*` | **100%** | Lights, shadows, backdrop, canvas text textures. |
| Field builder | `src/engine/field/builder.ts` | **100%** | `box`, `boxMinMax`, `convex` (ramps/wedges), `cylinder` (rungs/pipes), `tape`, `tapeRect`, `label`, `carpet`. Every primitive = mesh + collider in one call, in field coordinates. |
| AprilTags | `src/engine/field/apriltags.ts` | **100%** | Drop in the year's WPILib `*.json` layout → tags render at official poses. |
| CAD overlay | `src/engine/field/cadOverlay.ts` | **100%** | Optional: show an official field GLB as visuals while physics stays procedural. |
| Game-piece pool | `src/engine/gamepiece/pool.ts` | **~90%** | Spheres today (FUEL, 2022 cargo, 2024 notes ≈ torus → approximate). Non-spherical pieces (cones/cubes/coral) need a collider-shape option — add `shape` to `GamePieceSpec`. |
| Robot | `src/engine/robot/*` | **~85%** | Swerve/tank drive, bumpers, team numbers, intake zone, hopper, turret + ballistic shot solver with hood range and shoot-on-the-move, kinematic climb. New mechanism types (elevator/arm scoring) would be added here as generic mechanisms. |
| Input | `src/engine/input/input.ts` | **100%** | Keyboard + gamepad → `DriverInput`; view-relative field-oriented drive. |
| Cameras | `src/engine/camera/cameras.ts` | **100%** | Driver station, chase, overhead, free orbit. Season only supplies the driver-eye pose. |
| Match clock | `src/engine/match/clock.ts` | **100%** | Any list of periods; `displayGroup` gives the continuous field-timer countdown. |
| Scoreboard | `src/engine/match/scoreboard.ts` | **100%** | Categories, counters, fouls credited to opponent, winner. |
| Steering / pathing | `src/engine/ai/steering.ts` | **~90%** | `routeThroughBands()` handles “cross this row only through these gaps” — true of most FRC fields. Used by the AUTO autopilot. |
| HUD chrome | `src/engine/hud/hud.ts` | **100%** | Scores, timer, banners, toasts, pause/results modals. Seasons fill 4 slots. |
| Game loop | `src/engine/core/game.ts` | **100%** | Fixed-step sim, input/autopilot routing, intake/launch plumbing, pause/restart/results. |
| Multiplayer seam | `src/engine/net/adapter.ts` | **100%** | `NetworkAdapter` interface + `LocalAdapter`. |
| App shell & menu | `src/main.ts`, `src/app/*` | **~95%** | Menu reads everything from the `SeasonDefinition` (name, timeline, routines, rules summary, robot limits). |
| Tests (engine) | `tests/engine.test.ts`, `tests/clock.test.ts` | **~80%** | Clock/coord/steering tests stay; swap season-specific assertions. |
| **Season module** | `src/seasons/2026-rebuilt/*` | **Template only** | Copy the folder structure; rewrite contents. |

### Season module file-by-file (what to rewrite vs. copy)

| File | Kickoff action |
|---|---|
| `constants.ts` | **Rewrite.** Every manual dimension, tagged `[M x.y]` / `[TAG]` / `[EST]`. Do this first — everything reads from it. |
| `apriltags-welded.json` | **Replace** with the new WPILib layout (allwpilib `apriltag/src/main/native/resources/edu/wpi/first/apriltag/<year>-*.json`). |
| `config.ts` | **Edit.** Timeline periods, robot defaults, start poses, driver-eye poses. |
| `field.ts` | **Rewrite** using the `FieldBuilder` primitives. Keep the `side()` rotational-mirror helper (or switch to `mirrorX` for mirror-symmetric years). |
| `scoring.ts`, `hubLogic.ts` (→ rename per game) | **Rewrite** as PURE functions. Unit-test them against the manual's tables. |
| `staging.ts` | **Rewrite** (game-piece start positions). Pure → testable. |
| `rules.ts` | **Rewrite.** Sensors/goals, zone checks, fouls, endgame assessment, human player. Shape of the class (the `SeasonRules` methods) stays the same. |
| `autopilot.ts` | **Adapt.** AUTO routines for the player's robot. `BANDS` definition changes with the field. |
| `hud.ts` | **Adapt.** Season widgets (goal status, RP progress, player panel). |
| `index.ts` | **Edit** metadata + wire-up, then register it in `src/seasons/index.ts`. |

---

## 2. The season contract (summary)

`src/engine/core/season.ts` → `SeasonDefinition`:

```ts
{
  id, year, name, subtitle, manualVersion, summary,
  fieldLength, fieldWidth, carpetColor, maxRobotHeight, maxRobotPerimeter, foulValues,
  timeline: MatchPeriod[],          // periods with mode auto/teleop/disabled
  gamePiece: GamePieceSpec,          // radius, mass, bounce, count, color…
  robotDefaults: RobotConfig,
  maxClimbLevel, autoRoutines, rulesSummary?, controlsHelp?,
  startPose(alliance, station), driverEye(alliance, station),
  buildField(ctx),                   // FieldBuilder calls
  createRules(ctx): SeasonRules,     // stage / onPeriodChange / before+afterStep / onLaunch / aimTarget / climb / human player / visuals / results
  createAutoPilot(ctx, rules, robot, routine): AutoPilot,
  createHud(ctx, rules, slots): SeasonHud,
}
```

The engine owns the loop. Per physics step it: advances the clock (→ `onPeriodChange`), builds each
robot's `RobotCommand` (player input in TELEOP, `AutoPilot` in AUTO), drives robots, handles climb
requests (→ `requestClimb`), aims (`aimTarget`) and launches (→ `onLaunch`), runs intake capture,
calls `beforeStep`, steps physics, then `afterStep` (where seasons detect scoring).

**Coordinates:** season code uses WPILib field coordinates (meters, blue wall at x = 0). This is
the same frame as robot code and the official AprilTag JSON, so positions copy straight across.

---

## 3. Kickoff-day checklist

Target: playable field in ~1 day, full rules in ~2–3 days.

**Hour 0–1 · Setup**
- [ ] `cp -r src/seasons/2026-rebuilt src/seasons/<year>-<name>`; rename exports; register in `src/seasons/index.ts`.
- [ ] Put the new manual PDF in the repo root. Extract text (e.g. `pypdf`) for searching.
- [ ] Download the year's WPILib AprilTag layout JSON (usually published at/soon after kickoff) → `apriltags-*.json`.

**Hour 1–3 · Numbers**
- [ ] Fill `constants.ts` from the manual ARENA section: field size, zones, every element's dimensions, game piece size/mass/count, robot limits. Tag each value `[M §]`.
- [ ] Anchor element *positions* with AprilTag poses (tags sit on the elements). Mark anything guessed `[EST]`.

**Hour 3–8 · Field**
- [ ] `field.ts`: carpet, tape, walls/guardrails, then each element with `box`/`convex`/`cylinder`.
- [ ] `addAprilTags()` with the new JSON — visually confirms element placement.
- [ ] Choose collide modes: `'all'`, `'pieces'` (nets/funnels), `'robots'`, or `false` (visual only).
- [ ] Run `npm run dev`, drive around, check clearances (under/over obstacles).

**Day 1–2 · Game logic**
- [ ] `config.ts` timeline from the MATCH periods table (use `displayGroup` for the field timer).
- [ ] Pure scoring module(s) from the point-value and RP tables + unit tests.
- [ ] `staging.ts` from the setup section + tests (total piece count!).
- [ ] `rules.ts`: goal sensors (position checks inside goal volumes are simplest), zone checks, fouls you can detect automatically, endgame assessment, human player.
- [ ] `hud.ts` widgets; `rulesSummary` for the menu.

**Day 2–3 · Polish**
- [ ] AUTO routines (`autopilot.ts`) — update `BANDS` for the new field.
- [ ] Robot defaults that fit the year's constraints (height/extension limits, typical speed).
- [ ] `npm test`, `npm run build`, deploy.

---

## 4. Known engine gaps (good next investments)

1. **Non-spherical game pieces** — add `shape: 'sphere' | 'box' | 'cylinder' | 'torus-approx'` to `GamePieceSpec` and switch collider + instanced geometry.
2. **Mechanism library** — elevator/arm/wrist scorers as generic parts (currently: intake, hopper, turret launcher, climber).
3. **CAD pipeline** — script to turn the official Onshape/STEP field into a GLB for `cadOverlay.ts` (needs an Onshape account/API key or a STEP→glTF converter).
4. **Multiplayer** — implement a `NetworkAdapter` (see README) with an authoritative host running `Game` headless. Rapier is deterministic for same inputs on same build, which also enables lockstep.
5. **Replays** — record `RobotCommand`s + seed; replay deterministically.
