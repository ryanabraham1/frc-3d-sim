# Robot archetypes and driver-assist features

The simulator is meant for **kickoff strategy**: which robot archetype scores the most in a given game, and
whether a given mechanism (for example a ground intake) is worth building. That only works if the robots you can
configure are ones teams would really build, with the same trade-offs.

**For a new game there is nothing to research yet:** at kickoff nobody has built a robot. Archetypes have to be
*derived* from two things: how robots were built for similar tasks in past games (the pattern library below), and
the new manual (its tasks, pieces, field constraints and rules). The section "Deriving archetypes for a new game"
is the procedure. The per-season sections after it record what was actually built in 2024–2026, as extra
reference for the pattern library.

## Deriving archetypes for a new game

Do this from the manual alone, before writing `config.ts`, and write the result into a new section of this file.

### Step 1 — task table from the manual

List every way to score (the point table plus the endgame) as a row:

| Task | Game piece | Where it's acquired | Goal: shoot at, place on, or drive to | Points AUTO / TELEOP | Constraints (height, reach, zone, capacity) |
|---|---|---|---|---|---|

Also note: how many pieces a robot may hold (control rules), robot height/perimeter/extension limits, field
obstacles with a clearance height (these create "short" vs "tall" robots), where pieces enter the field (floor
staging, human-player chutes/stations), and protected zones.

### Step 2 — match each task to its past analog

| If the new task is… | Past analogs | Mechanisms teams build | Simulator model |
|---|---|---|---|
| Launch many balls into a high goal | 2017 FUEL, 2020 POWER CELLS, 2022 CARGO, 2026 FUEL | Full-width roller ground intake, hopper/indexer, flywheel shooter with hood; vision auto-aim | launcher + `hopperCapacity` + ballistic solver |
| Launch into a goal you can see from most of the field (central/elevated) | 2020 power port, 2022 hub, 2026 hub | **Turret** on top teams (shoot on the move); fixed shooter + chassis auto-align for most | `launcher.turret` or `autoAlign` option |
| Launch into a wall-mounted or hooded goal | 2024 SPEAKER | Fixed shooter on a pivot, chassis rotates to aim; turrets rare | pivot (`minAngle < maxAngle`) + `autoAlign` default |
| Low / close-range goal | 2020 low port, 2022 low hub, 2024 AMP | Simple dumper/roller: the kitbot and low-resource archetype | fixed shooter with a speed cap, or an assisted deposit |
| Place pieces on posts/pegs/shelves at several heights | 2018 scale, 2019 rocket, 2023 grid, 2025 reef | Elevator and/or arm with an end effector; **height tiers are archetypes** (low-only, mid, top); vision alignment to the scoring spot; never a turret | placement mechanism + physical release + `adjustCommand` auto-align |
| Two different piece types in one game | 2019 hatch/cargo, 2023 cone/cube, 2025 coral/algae, 2024 note (speaker/amp) | One primary piece on every robot; the second piece handled by elite robots or specialists | capacity per piece type, per-piece intake options |
| Pieces come from a human-player chute/station | 2023 substations, 2024 SOURCE, 2025 CORAL STATION, 2026 OUTPOST | Station-fed robots with no ground intake (funnel, hopper opening, shooter-intake) vs ground-intake robots. **This is almost always the season's key trade-off** | `intake.ground` / `intake.station`, physical chute with the H button |
| Endgame hang with tiers | 2019 HAB, 2022 traversal, 2024 chain + TRAP, 2025 shallow/deep, 2026 TOWER levels | Most robots take the lowest reliable tier; elite robots the top tier | climber level option |
| Balance/park on a moving element | 2023 CHARGE STATION | Everyone parks; auto-balance is a software assist | dynamic field element + assist option |
| Field obstacle with a clearance height | 2016 low bar, 2020 trench, 2024 STAGE, 2026 TRENCH | Short robots take the shortcut; tall robots carry more or reach higher | height option (real collider) |
| Passing/feeding pieces across the field | 2022, 2024, 2026 | Shooters that can lob; a feeder specialist on deep alliances | `passTarget` |

### Step 3 — build the presets (4–5)

1. **Common competitive build (the default):** the mechanisms for the highest-value task that a typical good
   team can build in 6 weeks. Usually: ground intake + the main scoring mechanism + the driver assist that task
   needs + the lowest reliable climb tier.
2. **Elite do-everything build:** every task, the top tier, and a turret where the goal type allows one.
3. **No-ground-intake variant:** the default without a ground intake, fed only by the human-player station.
   This preset tests "is a ground intake worth it?".
4. **Kitbot / low-resource build:** the simplest mechanism that scores the easiest goal, station-fed, driver-aimed,
   usually no climb. FIRST's KitBot has followed this pattern every year.
5. **Specialist(s):** the second game piece, the low goal, or the endgame.

Then add `robotOptions` for every decision where the analog table lists more than one real choice: intake type,
aiming, shooter type (fixed or pivot), scoring tiers, capacity (only if the rules don't fix it), height class and
climber.

### Step 4 — sanity checks

- Would a team really build this for this game? No turrets on placement robots, and nothing beyond the extension
  or height rules (`normalizeRobotConfig` enforces the rules).
- Every archetype must be able to score something and collect pieces somewhere (a station-fed robot needs a
  station intake).
- Speeds, cycle times and accuracy are estimates. Mark them `[EST]` and keep them the same across archetypes
  unless the mechanism really differs (a fixed shooter only scores from one spot).
- Use the simulator to compare the archetypes, not to confirm a guess: run matches with each preset and write the
  results down.

### Step 5 — record it

Add a `## <year> <GAME>` section here with the task table, the analog chosen for each task (and why), and each
preset. Say clearly that the archetypes are **derived from past games and the manual, not observed**. If
real-season information becomes available later, add it with sources and adjust the presets.

## Cross-season patterns (observed 2022–2026)

| Feature | What real robots do | Simulator model |
|---|---|---|
| **Ground intake** | Usually the defining trade-off of a season. Full-width "touch it, own it" intakes (often under the bumper) on most competitive robots; simpler robots skip it and depend on the human-player station. | `intake.ground` (engine). Without it, a piece on the carpet can't be picked up. |
| **Station / human-player intake** | Funnels, hopper openings or shooter-intakes that catch pieces as they leave the human-player chute. | `intake.station` + `stationSide`: `Robot.stationContains` catches pieces **in the air** in front of or above that side of the robot. |
| **Human-player feeding** | Human players physically drop or roll pieces down a chute, aimed at the robot. | The season models the real chute geometry and drops a free rigid body down it (H button, or automatic human player). |
| **Turret vs chassis aim** | Turrets were common in 2022 (shoot on the move with vision). In 2024 and 2026 most shooters were fixed to the chassis, and the robot rotated to aim (vision "auto-align" / heading lock). Pick-and-place games (2023, 2025) have no turret. | `launcher.turret` or `autoAlign` (heading servo with a fire gate, `Robot.autoAlign`) or driver aim. Pick-and-place seasons force `turret = false`. |
| **Scoring auto-align** | 2025 robots used vision / pose-estimate alignment to a chosen reef branch (left/right buttons), and 2024 robots auto-aligned to the AMP/TRAP. | Season `adjustCommand` hook drives the robot to the scoring pose, with sensor noise. Without it, the driver lines up and physics decides whether the piece goes on. |
| **Shooter type** | Fixed-angle shooters (e.g. kitbots) only score from one spot. Pivot/hood shooters score from a range. | `launcher.minAngle == maxAngle` + a speed cap for fixed shooters; the ballistic solver decides the rest. |
| **Capacity / hopper** | Fixed by the rules in some games (1 NOTE, 1 CORAL + 1 ALGAE); a key design variable in others (2022 cargo, 2026 FUEL hopper). | `hopperCapacity`, clamped by the season's `normalizeRobotConfig`. |
| **Size vs field obstacles** | Height set by field features (2024 STAGE 27⅞ in, 2026 TRENCH 22¼ in). | Real colliders; the robot's height really blocks it. |

## 2025 REEFSCAPE

- **Funnel-fed L4 elevator cycler**: the most common competitive design. An elevator with a CORAL end effector,
  fed by a funnel at the CORAL STATION instead of a ground intake. Many used vision alignment to the reef branch,
  with driver buttons to pick left or right.
- **Ground-intake all-rounder**: elite robots added a CORAL ground intake (for pieces knocked off or dropped) and
  ALGAE handling for the NET and PROCESSOR.
- **Mid-tier**: single-stage elevators (L2–L3) and L1 trough robots. ALGAE specialists existed on strong
  alliances.
- **Climb**: the deep CAGE was the high-value endgame.
- **No turrets.** A turret doesn't help a pick-and-place game, and in the simulator it made placement unrealistically
  easy.

Presets: *Funnel-fed L4 cycler* (default), *Ground-intake all-rounder*, *L2–L3 elevator*, *L1 trough bot*,
*ALGAE specialist*. See [REEFSCAPE.md](REEFSCAPE.md#robot-archetypes).

## 2024 CRESCENDO

- **Under-bumper intake + pivot shooter** was dominant. The robot rotates to aim at the SPEAKER, often with
  vision "auto-aim". The AMP is scored with the shooter or a small amp bar.
- **Turrets** were rare (heavy and complex) but let top teams shoot while moving.
- **SOURCE-fed robots** took NOTES from the human player through the shooter intake. The KitBot was a SOURCE-fed
  fixed shooter that scored from against the SUBWOOFER and in the AMP.
- **Amp/TRAP robots** skipped the SPEAKER shooter. Most competitive robots climbed; fewer scored the TRAP.

Presets: *Under-bumper pivot shooter* (default), *Turret shooter*, *SOURCE-fed shooter*, *KitBot (SUBWOOFER
shooter)*, *AMP + TRAP specialist*. See [CRESCENDO.md](CRESCENDO.md#robot-archetypes).

## 2026 REBUILT

- **Hopper size and fire rate** decide cycle time: "how much FUEL can you carry, and how fast can you empty it".
- **Turret vs fixed shooter**: turrets allow shooting on the move. Fixed double-wide shooters with chassis
  auto-align were more common and simpler.
- **Dumpers**: the shooter spans the whole front of the robot and FUEL leaves in several parallel streams (derived
  from Chief Delphi build threads; e.g. Team 9072 "Sandstorm": a 4-ball-wide shooter, 75-ball hopper, ~19 balls/s,
  and Team 7769's 2.75-ball-wide shooter). Throughput is the total balls/s, so the streams only widen the footprint
  of the shot (easier to hit the HUB opening, no turret). Modelled as `launcher.exits` / `launcher.exitSpan`: shots
  rotate through the exits, `rate` stays the total. Never combined with a turret.
- **Trench-capable (≤ 22¼ in)** robots take the short path under the TRENCH. Taller robots with bigger hoppers
  must cross the BUMPs.
- **OUTPOST-fed** robots (no ground intake) depend on the human player's CHUTE.
- Climbers ranged from TOWER LEVEL 1 to LEVEL 3.

Presets: *Turret trench bot* (default), *Dumper + auto-align*, *Big-hopper BUMP bot*, *OUTPOST-fed
shooter*.

## Earlier seasons (patterns only, not yet in the simulator)

- **2022 RAPID REACT**: turret + Limelight auto-aim shooters that shoot on the move; ground intakes universal;
  traversal climbers.
- **2023 CHARGED UP**: the ground-intake vs substation-only trade-off; elevator or arm placers; auto-balance on the
  CHARGE STATION.

## Sources for the observed patterns

Gathered by web search after these seasons were played (page fetches were blocked, so from search-result
summaries). A new game won't have sources like these at kickoff; use the procedure above.


- [Chief Delphi: Share your REEFSCAPE controller layout](https://www.chiefdelphi.com/t/share-your-reefscape-controller-layout/504821): reef auto-align and left/right branch buttons.
- [Chief Delphi: Generating reef alignment poses](https://www.chiefdelphi.com/t/generating-reef-alignment-poses-an-example-showcase/491876): pose-based reef alignment.
- [Team 2910 2025 recap](https://frcteam2910.org/2025/05/07/2025-recap-post/): an elite 2025 design.
- Team 254 robot write-ups: [1](https://www.team254.com/?p=18644), [2](https://www.team254.com/?p=18432).
- [Chief Delphi: Stop overcomplicating REBUILT](https://www.chiefdelphi.com/t/stop-overcomplicating-rebuilt/513157): 2026 archetypes, hopper-first design.
- [DeLaSalle Robotics 2024 repository](https://github.com/DeLaSalle-Robotics/DLS-Robot-2024): a 2024 team repository (also the mirror of the 2024 manual PDF).

## Intake side

Every archetype puts the floor intake on the **back** of the chassis (`intake.groundSide: 'back'`), opposite the
scoring mechanism (shooter, elevator or arm at the front). Real robots do this so the driver collects with their back
to the goal, then turns (or lets auto-align turn) to score. The orange roller, striped bumper and glowing pickup patch
in the 3D model, and the INTAKE/SHOOTER labels on the menu robot, mark the side. [derived]

## Real team robots (playable, `season.teamRobots`)

Past seasons also offer real top robots (at least six per season, including nine for 2026), picked in the menu under "Play as a real robot" (QoL only; not
needed for a new game at kickoff). Each is a normal `RobotConfig` (capabilities the team published; anything not
published is marked `[EST]` in `src/seasons/<season>/teamRobots.ts`) plus `config.model`, a simplified animated 3D
model registered with `registerRobotModel` (`src/engine/robot/models.ts`). Models are built from the team's photos /
CAD renders to match the silhouette and signature features, not internals. They are visual only: capture zones,
launch points and scoring still come from the config, and the floor intake follows each profile’s configured side. Roller colors follow the robot references where available.

| Season | Robot | What the model shows | Sources |
| --- | --- | --- | --- |
| 2024 | 254 Vortex | blue "goalpost" climber uprights + black truss crossbar, NASA sponsor panel, turret with tall D-plates and two pairs of flywheels out the sides, amp arm | 254 2024 Technical Binder; team254.com/first/2024 photos; Chief Delphi "2024 VORTEX" |
| 2024 | 1690 Doppler | 11 in pancake deck with exposed motors, silver ladder arm that swings the shooter box from flat to vertical, thin climb hooks. Intake and shooter share the front (the arm takes the NOTE straight from the intake) | Chief Delphi "Orbit 1690 Presents: Doppler"; reveal video |
| 2024 | 4522 AXL | raw silver frame + X brace, braced elevator, carriage with 2×2 flywheels that rises for AMP/TRAP, twin outer climber tubes with bronze hooks and exposed belts | Team SCREAM Open Alliance thread; The Blue Alliance 2024 media |
| 2024 | 2056 LOW-KEY | white triangular sponsor tower that fits under the STAGE, 17 in shoulder arm with a pocketed shooter box and blue 4 in flywheels, under-bumper intake + conveyor, riveted baseplate, pneumatic double hook | OP Robotics 2024 Crescendo Technical Binder (2056.ca) |
| 2025 | 2910 Spectre | lattice-truss telescoping arm on a geared pivot, green LED strips, brass ballast, arm climber carriage | Onshape "Spectre" article; frcteam2910.org 2025 recap; TBA 2025 media |
| 2025 | 1323 MadTown | blue pivoting four-stage elevator with cable chains, black sponsor gussets, CORAL + ALGAE floor intakes | Chief Delphi "1323 MadTown Robot Reveal?"; TBA 2025 media |
| 2025 | 254 Undertow | blue two-stage elevator with zig-zag top, smoked CORAL funnel with NASA logo, ground intake linkage, roller-claw climber | 254 2025 Technical Binder; team254.com/first/2025 photo |
| 2025 | 1778 SubZero | silver belt elevator with an A-frame brace, two cascading stages, carriage arm that swings 290° to either side (scores side-on to the REEF), floor intake that folds up under the hanging arm for the handoff, no climber | Chief Delphi "1778 Chill Out \| REEFSCAPE Robot Reveal" and "1778 2025 CAD & Code Release" |
| 2026 | 4414 RIPCURRENT | smoked bumper walls, teal trusses, flat spoked dye rotor, pancake turret on a column, hopper extension that slides out with the latched intake | 4414 2026 Technical Binder (2026.team4414.com) |
| 2026 | 1323 MadTown | black sponsor-panel hopper box, slatted top cage, dye rotor + turret on a column (a smaller, slower-firing RIPCURRENT), and a slatted SHOT BLOCKER hinged on the intake-side top edge | 2026 Champs match photos/video; Chief Delphi "How does 1323 get away with such a complicated robot?" |
| 2026 | 254 Overload | smoked hopper box with sponsor decals, full-width plate-wall shooter, intake on blue truss rails that retracts while shooting | Chief Delphi "Team 254 Presents: Overload" |
| 2026 | 1690 Kepler | black X-lattice walls, top arch, turret on an 8 in bearing, gear-driven shooter | Chief Delphi "FRC Orbit 1690 2026 Robot CAD Release" |
| 2026 | 4946 Moto Moto (BUMP) | half-circle "roomba" ~30 in tall: D-shaped bumper, round clear hopper, dye rotor, turret on a center column, silver goalpost over the flat-side intake | 4946 2026 Engineering Report; Chief Delphi "4946 The Alpha Dogs 2026 Robot: Moto Moto" |
| 2026 | 3476 Sandspit (BUMP) | tall closed clear hopper, black dotted corner posts, orange rails + A-frame, teal printed lattice, wide multi-lane shooter, retracting intake | Chief Delphi "Team 3476: Code Orange 2026 Sandspit Robot Reveal"; TBA 2026 media |
| 2026 | 9483 Enigma (BUMP) | too tall for the TRENCH: black hopper box with big team numbers, silver corner extrusions, spindexer bowl, turret | Chief Delphi "Team 9483 Presents: Enigma"; TBA 2026 media |


**Shot blocker (1323).** `config.shotBlocker` is a full-width panel hinged on the top edge of the intake side, so it
extends past the same side as the intake (R: 12 in past the FRAME PERIMETER, on one side; 30 in max height). It swings
from folded on top to `atan2(rise, reach)` above horizontal in `seconds`, driven by `RobotCommand.block` (toggle F /
gamepad L3, rebindable). Its collider is a real 4 cm Rapier plate on the robot body that stops game pieces and hits
field structure, so a raised blocker catches the TRENCH arm and the robot can't drive under it; it can't be raised
while under the arm. Other robots don't touch it (it sits above bumper height, and a thin plate would wedge robots),
which is the one approximation. The intake can't run while it is up or moving (it covers the intake side). Against a
front-edge dumper (254) parked bumper to bumper, 0 of 20 shots get past it raised vs 20 of 20 stowed
(`tests/shot-blocker.test.ts`); streams outside its width, or from a turret set back from the edge, can still clear
it. AI-driven 1323s don't raise it yet.

**Stock 2026 weight and chassis-aim tolerance.** Every stock 2026 robot (presets and team robots) weighs 150 lb
(`REBUILT_ROBOT_MASS`, user decision; R408's 135 lb + battery is 148 lb, so the weight slider goes to 150). The presets'
`weight` field now only scales acceleration. Chassis-aimed 2026 shooters fire within 0.15 rad (~9°) of the HUB
(`launcher.alignTolerance`; other seasons keep ~3°), so a shove costs accuracy instead of stopping the stream.

### Additional top-team profiles

The additional profiles live in each season's `additionalTeamRobots.ts`, keeping independently contributed
robots separate. Their sources are linked in each profile's `source`. Geometry is a simplified recreation;
unpublished drive speeds, dimensions, capacity, accuracy and mechanism timings are simulator estimates,
not measured team rankings. 2025 profiles vary the actual lift/release/harvest/climb parameters that rules use.

| Season | Added robots | Distinguishing behavior |
| --- | --- | --- |
| 2024 | 1323 MadTown, 118 Twister, 4414 TIDEPOD | Separate AMP arm, turret/diverter, and pivot shooter/forks; drive acceleration and climb timing differ. |
| 2025 | 1690 WHISPER, 2056 LIGHTNING, 118 Firefly | Vacuum end effector, continuous-belt elevator/gripper, and separate roller channels. Lift speeds 2.2/2.5/1.9 m/s; release delays 0.30/0.40/0.25 s; harvest delays 0.35/0.45/0.30 s. All support full scoring; differences are throughput and mechanism design. |
| 2026 | 2910 Re•Blitz, 1678 Limestone, 971 Mixtape | Champs hard-roof drum/roller-floor rebuild, expanding net hopper, and twin turret model. Rates 33/24/16 FUEL/s are estimates. Re•Blitz uses 40 capacity and 33 FUEL/s following user guidance (~40 balls, 30–35 FUEL/s). Mixtape holds 33 FUEL following user tuning. Its heads share the engine's one aim and launch point; independent turret streams are not simulated. |

### Robots added from CAD / reveal research (3 per past season, 6 for 2026)

Each was picked from a Chief Delphi reveal or CAD release with photos or renders, modeled in
`src/seasons/<year>/moreTeamRobots.ts` in the clean flat style of rebuildsim.com (solid colours, clear walls, every
part on a post or plate). Stats the team published are used as stated; everything else is `[EST]`, scaled from the
robot's hardware so the comparison stays fair.

| Season | Robot | What the sources showed | Stats used |
| --- | --- | --- | --- |
| 2026 | 6329 ROMAN | 20.75 in spindexer drum, roller floor, "upkicker", turret, long-armed four-bar intake that folds on impact | cap 45 [EST], 14 FUEL/s, intake 15/s |
| 2026 | 1778 HAILSTORM | spindexer with grip-taped "bottle rocket" cone (from 4180), compact turret, slapdown intake | cap 40 [EST], 11/s, intake 11/s |
| 2026 | 5940 Croquembouche | double turret on a floor conveyor, black net roof; later rebuilt because of brownouts | cap 40 [EST], 16/s, intake 13/s |
| 2026 | 7769 CHUNK | static-hood wide shooter on 4 in stealth wheels, intake racks that slide out and shuffle | cap 45 [EST; the team quotes "almost 70" but a non-expanding trench-height hopper holds far less], 15/s [EST], intake 12/s |
| 2026 | 9128 Triple Threat | three fixed lanes, hex-perforated hopper | cap 40 [EST: team's ~80 doesn't fit a non-expanding trench-height box], 16/s sustained (team; 20–25/s first volley), intake 17/s [EST] |
| 2026 | 604 Toploader | tall 27 in BUMP robot, single-stream turret over a dye rotor (team prototype ~15 BPS), white corrugated walls, hopper slides out with the intake, no climber | cap 60 [EST], 14/s, intake 16/s [EST] |
| 2025 | 1678 SubLime, 971 Fiddler, 341 Miss Daisy | tall-tower tipping arm / truss elevator with maroon claw / continuous elevator + lantern shoulder | lift, cycle and speed [EST] |
| 2024 | 1114 Skyfall, 2910 Typhoon, 581 Titan | pivoting shooter arm (code repo: arm + intake only) / TURRET with any-angle feed, slow climb / 25.5 × 28.5 in, long hooks | speed, accel, climb time [EST] |

**Intake rate (2026).** `RobotConfig.intake.rate` caps how many FUEL/s the floor intake swallows (`Robot.tickIntake`; unset
= unlimited). Nobody publishes it, so `INTAKE_RATE` in `src/seasons/2026-rebuilt/teamRobots.ts` scales it from the
intake's width and how uninterrupted the ball path is (4414 fastest, small slapdown intakes slowest). Together with
hopper capacity and fire rate it is shown on each robot's picker card.

### Flexible hopper nets and loaded clearance

254 Overload is configured at 25 FUEL/s, 3476 Sandspit at 20 FUEL/s (requested tuning).
Overload has 50 total capacity including net stretch, and Limestone has 60 with its hopper raised,
following user guidance. Expansion starts at 40 for both as simulator tuning; RIPCURRENT keeps 85 total
with expansion above 70. Full-load roof heights
(28 in for 254, 27 in for 4414, 29 in for Limestone) are estimates. Above the threshold, `hopperExpansion`
interpolates the loaded envelope, bows a crossed-strand net upward over visible FUEL, and adds a massless
upper collider. Emptying lowers both the roof and collider. Robot routing uses `clearanceHeight`, so an
overfilled net robot chooses the BUMP instead of planning through the TRENCH. The fixed shooter exit height
stays unchanged. While a net/telescoping robot is over a TRENCH arm, or within 0.6 m of one, its intake stops taking FUEL once the
envelope would exceed `TRENCH_SAFE_HEIGHT` (22.25 in minus ½ in), via `SeasonRules.overheadClearance` and
`Robot.intakeRoom`; it resumes after it clears the TRENCH. This keeps an intaking driver from swelling the hopper into
the arm and jamming. Multiplayer derives the same net shape from the existing replicated held-piece count.
This is an approximate rigid collision envelope for a flexible net; individual strand elasticity is not simulated.
Use the gallery's “Full hopper (100%)” pose to inspect the bulge and “Stowed” to inspect the relaxed roof.


Limestone’s `hopperExpansion.mechanism = 'telescoping'` uses a rigid raised rectangular rim,
exposed nested lift tubes and slider collars. A crossed net bridges the roof to the intake lip;
it is separate from the elastic domes on 254/4414. The simulator automatically raises and
contracts this mechanism from held count (40–60 FUEL), so its visual roof, collision height
and routing agree. Real Citrus uses hybrid driver/automatic controls; this implementation
approximates the contract sequence rather than adding another driver button. The 40-FUEL
threshold is simulator tuning, not a published Citrus measurement. Source:
https://www.chiefdelphi.com/t/1678-citrus-circuits-2026-cad-and-robot-code-release/521535?page=2

Additional visual detail includes pulley flanges, transmission belts, motor cans, shaft hubs,
pocketed plates with fasteners, camera brackets, elevator belts, and vacuum-cup bellows.
2024 layouts distinguish MadTown’s long blue side rails and low roller path, Twister’s gold
truss turret with eight wheels, TIDEPOD’s broad roller channel and angled teal rails, and
AXL’s silver elevator with two outer hooks. These are procedural reference-based models,
not exact CAD imports. MadTown reference: https://www.thebluealliance.com/team/1323/2024
(pit photo https://i.imgur.com/bdVVTHY.jpeg).
