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
| Moving field elements | `src/engine/field/hanging.ts` | **100%** | `HangingElement`: a dynamic pendulum (cages, chains) that robots push. Climbers can `hold`/`release` it, and it replicates via `netState`/`applyNetState`. Add sibling helpers for hinged/tilting elements. |
| AprilTags | `src/engine/field/apriltags.ts` | **100%** | Drop in the year's WPILib `*.json` layout → tags render at official poses. |
| CAD overlay | `src/engine/field/cadOverlay.ts` | **100%** | Optional: show an official field GLB as visuals while physics stays procedural. |
| Game-piece pool | `src/engine/gamepiece/pool.ts` | **~90%** | Sphere, tube and ring (flat torus, e.g. 2024 NOTE; optional tape `stripes`) shapes; indexed variants permit several piece types in one stable pool. Per-piece collider size, damping and instanced mesh; `restHeight(i)` for correct floor placement. |
| Zone geometry | `src/engine/zones.ts` | **100%** | `pointInPolygon`, `convexOverlap` (SAT), `containedIn` — test bumper rectangles (`robot.corners()`) against zone polygons for "any part of the BUMPERS in…" rules. |
| Robot | `src/engine/robot/*` | **~85%** | Swerve/tank drive, bumpers, intake, hopper, turret + ballistic solver (min-height `clearances`, max-height `ceilings`, `allowRising`/`minEntryAngle` for hooded goals), feed/pass and kinematic climb. A season can configure robot visuals/projectiles and own an elevator/placement mechanism through `handleMechanisms`. The chassis tilts and can tip over (drive force at each wheel that touches something; `wheelsDown`, `traction`, `uprightness`, `tippedOver`; auto-righted after `Robot.TIP_RECOVERY_S`) — season code must not assume a level robot: use `robot.localToWorld()` for mechanism points. Robot-on-robot contact (defense) comes from a per-wheel drivetrain model (`drivetrain.ts`): each wheel pushes with the lesser of its current-limited motor force (falling off near free speed) and tread friction μ·N, slides at kinetic friction once it breaks loose, shares that grip between translating and turning, and tank drives only resist sideways with tread friction; disabled robots sit in brake mode. So pushing matches follow `mass`, `maxAccel` and `wheelCOF`, off-center hits spin a robot, and `PhysicsWorld` keeps Rapier's contact prediction (`PREDICTION_DISTANCE`) below the tightest overhead clearance so robots don't ghost-collide under beams. |
| Input | `src/engine/input/input.ts` | **100%** | Keyboard + gamepad → `DriverInput`; view-relative field-oriented drive. |
| Cameras | `src/engine/camera/cameras.ts` | **100%** | Driver station, follow (3rd-person, mouse orbit/zoom, camera-relative driving), chase, overhead, free orbit. Season only supplies the driver-eye pose. |
| Match clock | `src/engine/match/clock.ts` | **100%** | Any list of periods; `displayGroup` gives the continuous field-timer countdown. |
| Scoreboard | `src/engine/match/scoreboard.ts` | **100%** | Categories, counters, fouls credited to opponent, winner. |
| Steering / pathing | `src/engine/ai/steering.ts` | **~90%** | `routeThroughBands()` handles “cross this row only through these gaps” — true of most FRC fields. Used by the AUTO autopilot. |
| HUD chrome | `src/engine/hud/hud.ts` | **100%** | Scores, timer, banners, toasts, pause/results modals. Seasons fill 4 slots. |
| Game loop | `src/engine/core/game.ts` | **100%** | Fixed-step sim, input/autopilot routing, intake/launch plumbing, pause/restart/results. |
| Multiplayer | `src/engine/net/*`, `server/*` | **100%** | Relay, lobby, host-authoritative sync, interpolation, prediction. Seasons only implement `SeasonRules.netState/applyNetState` (HUD/visual rules state) and use `ctx.humanPlayerIsAuto` + targeted `ctx.toast(…, robot)`. See `docs/MULTIPLAYER.md`. |
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
| `autopilot.ts` | **Adapt.** Optional scripted AUTO routines (players can also drive AUTO manually). `BANDS` definition changes with the field. |
| `passing.ts` | **Adapt/optional.** Where a feed/pass should land + which obstacles it must arc over (pure, tested). |
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
  maxScoringLevel?, climberLabels?, robotLimits?, configureRobot?,
  normalizeRobotConfig?, robotPresets?, robotSummary?,
  robotOptions?, robotSpecBars?, robotFields?,   // archetype menu: segmented mechanism choices, spec bars, numeric fields
  humanPlayerButtons?, humanPlayerHint?,         // up to 4 human-player buttons (H, B, N, M)
  startPose(alliance, station), driverEye(alliance, station),
  buildField(ctx),                   // FieldBuilder calls
  createRules(ctx): SeasonRules,     // stage / onPeriodChange / before+afterStep / onLaunch / aimTarget / passTarget? / climb / human player / visuals / results
  createAutoPilot(ctx, rules, robot, routine): AutoPilot,
  createHud(ctx, rules, slots): SeasonHud,
}
```

The engine owns the loop. Per physics step it: advances the clock (→ `onPeriodChange`), builds each
robot's `RobotCommand` (player input in TELEOP, `AutoPilot` in AUTO), drives robots, handles climb
requests (→ `requestClimb`), aims (`aimTarget`) and launches (→ `onLaunch`), runs intake capture,
calls `beforeStep`, steps physics, then `afterStep` (where seasons detect scoring).

For placement seasons, `handleMechanisms(robot, command, dt)` returns true to replace generic
launching; `handlesIntake` transfers intake ownership to the season. Optional `RobotCommand.scoringLevel`
is carried in multiplayer commands. Season `netState/applyNetState` must include mechanism state so
visuals and client collision prediction agree with the host. The 2025 module demonstrates this path.
`normalizeRobotConfig` applies a season's limits and supplies missing legacy mechanism fields before
robot construction. `robotPresets` provides menu profiles, and `robotSummary` describes their capabilities
in the multiplayer lobby. Optional placement/processor settings and a total cage rise time coexist with
the generic projectile launcher and level-based climber used by 2026.

**Robot realism (2024/2025/2026 rework).** `RobotConfig.intake.ground` / `station` / `stationSide` separate a
floor intake (`Robot.intakeContains`) from a station/funnel intake that catches pieces in the air
(`Robot.stationContains`). `RobotConfig.autoAlign` enables the engine's chassis auto-align for turretless
shooters (`Robot.autoAlign`, applied after `SeasonRules.adjustCommand` and before `drive`); `adjustCommand` is
where a season implements scoring auto-align (2025 reef). `RobotConfig.options` holds season-specific mechanism
flags. `robotOptions` are the menu's mechanism choices; each `set` should re-run the season's normalize. See
INSTRUCTIONS.md §3b and `docs/ROBOT-ARCHETYPES.md`.

**Coordinates:** season code uses WPILib field coordinates (meters, blue wall at x = 0). This is
the same frame as robot code and the official AprilTag JSON, so positions copy straight across.

---

> **Read [../INSTRUCTIONS.md](../INSTRUCTIONS.md) first** — lessons learned turning a manual into a season.

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
- [ ] **List every element that moves on the real field** (hung on chain/rope, hinged, tilting, sprung,
      loose) and model it as a dynamic body, never static: `HangingElement` for hanging parts, jointed
      Rapier bodies for hinges and tilts. Rules that reference it (contact fouls, climbs) use its live
      pose and real collider contacts, and its pose goes in `netState()`. See `CLAUDE.md`. The 2025
      cages were first built static; on the real field they swing.
- [ ] Run `npm run dev`, drive around, check clearances (under/over obstacles).

**Day 1–2 · Game logic**
- [ ] `config.ts` timeline from the MATCH periods table (use `displayGroup` for the field timer).
- [ ] Pure scoring module(s) from the point-value and RP tables + unit tests.
- [ ] `staging.ts` from the setup section + tests (total piece count!).
- [ ] `rules.ts`: goal sensors (position checks inside goal volumes are simplest), zone checks, fouls you can detect automatically, endgame assessment, human player.
- [ ] `hud.ts` widgets; `rulesSummary` for the menu.
- [ ] Multiplayer hooks in `rules.ts`: `netState()`/`applyNetState()` returning every rules field the HUD or
      `updateVisuals` reads (not score/clock — the engine syncs those); use `ctx.humanPlayerIsAuto(a)` and
      pass the robot to `ctx.toast(msg, kind, alliance, robot)` for driver-specific hints. Test with two tabs.

**Day 2 · Physics checks (required)**
- [ ] Implement `testing` in your SeasonDefinition: `scoringSpots` (grid over the legal scoring zone),
      `goalCount`, `goalCenter`, `traversals` (every lane robots must drive, with height limits).
- [ ] `npm test` — `tests/physics.test.ts` automatically fires real pieces for projectile seasons and drives
      every season's lanes through loose pieces. Placement seasons set `testing.mechanism: 'placement'`
      and provide a dedicated real-physics mechanism suite. `scatterCount` can reflect the game's floor supply.

**Day 2–3 · Polish**
- [ ] AUTO routines (`autopilot.ts`) — update `BANDS` for the new field.
- [ ] Robot defaults that fit the year's constraints (height/extension limits, typical speed).
- [ ] `npm test`, `npm run build`, deploy.

---

## 4. Known engine gaps (good next investments)

1. **More piece shapes** — sphere, tube and ring (flat disc collider) are supported; boxes and cones remain extensions.
2. **Mechanism library** — generic arm/wrist components; 2025 has a season-owned elevator behind the mechanism hook.
3. **CAD pipeline** — script to turn the official Onshape/STEP field into a GLB for `cadOverlay.ts` (needs an Onshape account/API key or a STEP→glTF converter).
4. ~~**Multiplayer**~~ — done (host-authoritative, see `docs/MULTIPLAYER.md`). Next step there: optional dedicated headless host so matches survive the host closing their tab.
5. **Replays** — record `RobotCommand`s + seed; replay deterministically.
