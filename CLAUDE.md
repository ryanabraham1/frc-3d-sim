# FRC 3D Sim — notes for implementing a season

Engine in `src/engine`, one module per season in `src/seasons/<year>-<name>`. Adding a game from a Game
Manual? **Read [INSTRUCTIONS.md](INSTRUCTIONS.md) first** (lessons from building 2024 CRESCENDO), then
`docs/FRAMEWORK.md` (reuse map + kickoff checklist). `npm test`, `npm run typecheck` and
`npm run build` must pass.

## Model the field as it behaves in real life

The first implementation of a season must physically model every field element that **moves, swings,
tilts, flexes or can be pushed** on the real field. Don't lock it in place as static geometry.
Before writing `field.ts`, go through the manual's ARENA section and list each element that is hung
(chain, rope, eyebolt), hinged, pivoting, sprung, on wheels or loosely placed. For each one, decide
how it moves and implement that motion.

- Hanging elements (e.g. 2025 CAGES on chain) use `HangingElement` (`src/engine/field/hanging.ts`), a
  dynamic pendulum that robots and pieces can push. It also covers climbing robots gripping it
  (`hold`/`release`) and multiplayer replication (`netState`/`applyNetState`).
- Hinged, tilting or sliding elements (doors, flaps, tilting platforms like 2023's CHARGE STATION) get
  a dynamic Rapier body with the right joint (revolute/prismatic) and limits. Add a reusable engine
  helper next to `hanging.ts` when a new kind appears.
- Rules that depend on these elements must use their **current** pose and real collider contacts:
  "contact" fouls, "grab where it is" climbs, zone checks.
- Moving field elements belong in the season's `netState()` so multiplayer clients see the same motion.
- Write a test that pushes the element and checks it moves and settles, plus one for each rule that
  depends on it.

Only fall back to an animation or a static approximation when physics is infeasible, and say so in
the season's doc (e.g. `docs/REEFSCAPE.md` "Simulation approximations").

## Model robots as real teams build them

The sim is for comparing robot archetypes at kickoff, when no robots for the new game exist yet. Follow
INSTRUCTIONS.md §3b: derive the archetypes from the manual's tasks and constraints plus how past games' robots were
built (the pattern library in `docs/ROBOT-ARCHETYPES.md`; record your derivation there, marked as derived). Offer
them as `robotPresets` plus `robotOptions` for the real trade-offs, and never assume a ground intake (`intake.ground`). Don't allow mechanisms no real team would
build for the game (no turrets on pick-and-place robots). Human-player stations drop physical pieces down the real
chute geometry (button H), driver assists (chassis auto-align, scoring auto-align) are robot options, and placing
a piece is physical: misaligned placements miss.

**Intake faces opposite the scoring mechanism.** The launcher, elevator and arm always face the robot's front (+x), so
the floor intake goes on the back (`intake.groundSide`, default `'back'`; station funnels use `stationSide`, also
`'back'`). Use `groundSideSign` / `stationSideSign` (`src/engine/robot/config.ts`) and `Robot.groundMouthContains` /
`intakeContains` instead of testing "in front of the bumper", drive bot/auto-pilot collection with `robot.intakeYawOffset`
(intake-first heading), and keep the orange intake model in `Robot.buildGroundIntake` in sync with the capture zone.

## Team robot models look like the real robot

Building or fixing a real team's model (`registerRobotModel`)? Follow [docs/ROBOT-MODELS.md](docs/ROBOT-MODELS.md):
research the team's binder, Chief Delphi topics and TBA photos first (`tools/robot-refs.py`), write one builder per
robot (no shared `style` templates), give every part a load path to the frame (nothing floating), and check every
pose from several angles in `tools/robot-gallery.html`.

## Other conventions

- Field coordinates are WPILib's (meters, blue alliance wall at x = 0). Tag manual values with their
  section; mark estimates.
- Follow the manual literally for who/what qualifies for points and fouls (e.g. any alliance cage
  counts in 2025, not just the driver station's).
- Keep scoring pure and unit-tested; exercise mechanisms through the real Rapier loop in `HeadlessSim`.
- Browser smoke test: `tools/browser-smoke.mjs` (setup in its header).

## Never model a robot from a guess: verify before you build, and again after

A real team robot built from a wrong assumption (a turret drawn as a pivot, the wrong colours, an intake on the wrong
end) is worse than no robot. Before `registerRobotModel` for a real team's robot, and again before calling it done:

1. **Photos first.** Run `python3 tools/robot-refs.py tba <team> <year>` and open the `sheet.jpg`. Look at the real robot
   (match / pit photos), not only a reveal thumbnail or CAD. Note frame colour, what is clear vs solid, where the intake
   and scoring mechanism sit.
2. **Read the team's own words for the archetype.** Search the Chief Delphi reveal / CAD / binder thread for the
   words that decide the config: turret vs pivot vs fixed, which end scores, which end collects (and whether one
   mechanism does both, like 971's claw), capacity, balls per second. Photos can't tell you "turret".
3. **Write the checklist in the file's header comment**: archetype (turret / pivot / elevator + arm), intake end, scoring
   end, colours, capacity and rate with a source or `[EST]`, and the photo or post each came from.
4. **Capacity must fit the robot.** A non-expanding trench-height box holds about 40-50 FUEL, not 70-80, whatever a
   quote says; only an expanding hopper (1678, 4414) goes beyond. Compare with the existing robots of the same archetype.
5. **After building, compare side by side** with the TBA sheet in `tools/robot-gallery.html` (several angles) and fix the
   mismatches. Don't report a model as accurate until you have done this comparison.
6. If you can't confirm something, say so in the comment and the final message; don't present it as fact.
