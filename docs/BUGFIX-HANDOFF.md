# Bug-fix hand-off — shooting accuracy & trench (2026-09-29)

For any agent taking over. User reports: (1) a tall (~30in) robot with ~80 capacity often misses the HUB;
(2) a ~21in robot sometimes gets stuck under the TRENCH. User requirements: **keep real physics**
(mid-air ball-on-ball collisions stay; robots genuinely beaching on FUEL is acceptable), and make sure
this class of bug can't slip into next year's season.

~~⚠~~ (resolved — game.ts rewrite landed; full suite 67/67, typecheck clean) **A parallel session ("Multiplayer implementation plan") is rewriting `src/engine/core/game.ts`.**
Do NOT edit game.ts until it's done; `npx tsc` currently reports one error there (`humanPlayerIsAuto`
missing in ctx) — that is theirs, fixed by their rewrite. Re-read shared files before editing.

## Root causes found
1. **Balls spawned inside the robot that fired them.** Launcher exit height was `launcher.height` (19in)
   regardless of robot height; a 30in robot's frame collider goes to 30in, so every ball started inside
   it and Rapier shoved it out sideways. Reproduced: moving+turning tall robot hit 17/30 (fixed: 30/30).
2. **Aim solver used the visual hex opening as the rim**, but the physical rim is the square cup wall
   (further out, up to √2× at corners) → steep point-blank shots clipped the wall top.
3. **Aim solver ignored air damping** (analytic no-drag ballistics) → small range errors.
4. **Robot drive had traction with no ground contact** (in the air, or beached on a FUEL ball), so a
   robot riding up a ball under the trench kept shoving itself up into the 22.25in arm.
5. **Trench arm overhung the bump edge** (65.65in trench vs ~62.3in guardrail→bump in our layout).

## Status

- [x] `Robot.launcherExit()` — exit always above the robot's own collider (`max(launcher.height, height) + radius + 3cm`); turret visual moved to the top. (`src/engine/robot/robot.ts`)
- [x] Drag-aware solver: `Robot.simulateFlight()` integrates like the physics step (gravity + Rapier linear damping); `solveShot()` secant-refines speed, requires the piece to be DESCENDING at the target, checks every clearance numerically, returns `{speed, angle, clear}`; best-effort fallback when nothing clears. `robot.lastShotClear` exposed for HUD hints.
- [x] `AimTarget.clearances[]` (multiple obstacles). REBUILT `aimTarget` now checks the real square cup wall (outer + inner edge along the approach direction). (`src/seasons/2026-rebuilt/rules.ts`)
- [x] `robot.projectile = { radius, airDamping }` — solver mirrors the season's game piece. Defaults exist + one-time console warning if never set.
- [x] **Game must set `robot.projectile`** (done by the multiplayer session, game.ts line ~162) right after `new Robot(...)` in game.ts (blocked on the multiplayer rewrite). Exact line:
      `robot.projectile = { radius: season.gamePiece.radius, airDamping: season.gamePiece.airDamping ?? 0.02 };`
      (Asked the multiplayer session to add it; verify it's there.)
- [x] Traction realism: `Robot.checkGrounded()` raycasts (center + 4 wheels) against FIELD colliders only; `drive()` applies no drive/yaw impulse when not grounded (airborne off a bump, beached on pieces). `robot.grounded` exposed.
- [x] Trench arm clipped to end at the bump edge (`field.ts`, marked [EST]).
- [x] Mid-air piece collisions: an "in-flight pieces ignore each other" experiment was **reverted** per user (real physics). Comment in `physics/world.ts` records the decision.
- [x] Headless simulation for tests: `src/engine/testing/headless.ts` (`HeadlessSim`: real field + Rapier + one robot in Node; mirrors Game.step order — keep in sync) and `src/engine/testing/shotHarness.ts` (`runShotTrial`). DOM-free guards: `HEADLESS` in `render/text.ts`, AprilTag textures.
- [x] Season contract: `SeasonDefinition.testing` (`scoringSpots`, `goalCount`, `goalCenter`, `traversals`) — REBUILT implements it in `src/seasons/2026-rebuilt/index.ts`.
- [x] `tests/physics.test.ts` — runs for EVERY registered season: spawn never overlaps robot; every scoring spot has a clear shot; hit rate per robot variant (default, tallest+80, 12in, tiny, 36x36, no-turret, 20/s) both alliances; shoot-on-the-move+turning; drive every traversal lane (default + tallest-allowed height, with/without 30 scattered pieces, full hopper); too-tall robot blocked by trench; feeding never enters own goal.
- [x] Update `tests/passing.test.ts` "shot solver" block: it calls `Robot.prototype.solveShot.call({config})`, which no longer works (solver needs `physics.dt`, `_projectile`, `simulateFlight`). Replace with a `HeadlessSim` robot: `const sim = new HeadlessSim(SEASONS[0], RAPIER, {...}); sim.robot.solveShot(from, target)` (needs `await RAPIER.init()` in `beforeAll`), then check heights with `sim.robot.simulateFlight`.
- [x] Run `npx vitest run` — all green for these fixes (66/67; the 1 failure is `tests/prediction.test.ts`, the multiplayer session's in-progress work) (physics suite takes ~15–30 s). Tune thresholds only if a failure is genuine real-physics variance, never to hide a bug.
- [x] Optional HUD hint: in `src/seasons/2026-rebuilt/hud.ts` show "No clean shot from here" when `p.lastShotClear === false` after shooting.
- [x] Browser check (live game): 30in/80-cap robot shooting while moving+turning from 3 spots = 30/30; 30in robot correctly blocked at the trench; bump crossing OK. 21in trench-with-loose-FUEL covered by tests/physics.test.ts. Originally: menu → robot height 30, capacity 80 → shoot from around the alliance zone while moving; drive a 21in robot through both trenches, including over loose FUEL.
- [x] Docs: add the physics suite + `testing` hook to `docs/FRAMEWORK.md` kickoff checklist ("implement `testing` in your season; `npm test` must pass"), and a line in `PLAN.md` log.
- [ ] Consider (not done): menu "Shot accuracy %" is not a hit-rate — 50% setting ≈ 69% hits, default 83% ≈ ~100%. Could relabel ("Shot consistency") or recalibrate.

## Measured results (headless, real physics)
- Tall 30in/80-cap, stationary, 14 spots × 10 shots: **140/140** (was 134/140; moving+turning **30/30**, was 17/30).
- Default, red & blue, no-turret, 20 shots/s, 36x36: 140/140 each. 12in: 137–139/140 (remaining misses = real mid-air ball collisions). Low accuracy (50%): 96/140 — expected spray.
- Feeding from 5 neutral/opponent spots: 50/50 landed in own zone, 0 entered hub.
- Trench/bump lanes incl. 30–45 loose FUEL: 0 stuck / 32 runs; lifts > 2cm dropped from 3/48 to 0/32 after traction fix.
