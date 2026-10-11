# CAD model animation and piece-path follow-up (2024–2026)

Uses the same robot variants and references recorded in [ROBOT-CAD-AUDIT.md](ROBOT-CAD-AUDIT.md). Dimensions and actuator timings remain simplified estimates, rather than exported CAD mates or measured motion profiles.

| Season | Corrections |
| --- | --- |
| 2024 | Doppler's fixed shooter head follows its pitching arm; AXL's carriage pitches to the solved elevation; Skyfall, Typhoon and Titan track aim when commanded. Typhoon's pulleys spin around their shaft axis. |
| 2025 | WHISPER, SubLime, Miss Daisy and Zuma return conveyor/cradle routes for floor CORAL transfers. SubLime, Miss Daisy and Zuma lower their grippers to the handoff cradle instead of transferring through their driving poses. Zuma's wrist changes pitch for the scoring level. Spectre solves to the piece center and lowers its direct-collection arm to the front capture zone; Fiddler's claw clears the carpet. |
| 2026 | ROMAN uses a parallelogram intake, keeping its roller bank level and both links pinned. Mixtape and Croquembouche alternate feed paths and physical launch origins between their two turret mounts. Simbot Tim routes FUEL past its floor belt and active wall rollers; passive side rollers follow collection/feed motion. Rubble follows its rising roller floor and drum throat. CHUNK's duplicate overlapping drum was removed, its feed exits above the wheel, and its documented static hood stays fixed. Its solver adjusts speed at the fixed launch angle. |
| Shared | Roller-relative feed offsets ignore tread rotation, while still following parent pitch/yaw. This fixes wandering path points throughout the existing 2024/2026 model roster. |

Floor intake and scoring faces were checked against the earlier CAD audit. Existing REEFSCAPE front/side/both-end scoring rules remain in use; all team end effectors still reach their tested L4 poses. Separate-turret origins are config-driven, so physical shots work independently of rendered animation. The existing conservative spawn height above the robot's collision envelope is retained to prevent shots colliding with their own robot; the twin turret horizontal positions now match their separate mounts. Both heads share simulated aim and total firing rate.

The model workshop now draws CORAL and loops collection → handoff → L4 → retract. Its conveyor sampling uses the same helper as the match. It also offers an aiming pose and low/mid/high elevation controls for checking shooter pitch.

Validation: focused path tests cover roller spin versus parent motion, four-bar pin closure, low handoff endpoints, direct floor-claw poses, pitch tracking, fixed hood behavior, conveyor bends, and physical alternating turret shots. Team-robot, Reefscape mechanism and hood-aim checks cover registration, stable legal configs, finite animation, multiplayer mechanism state, L4 reach and scoring trials. Typecheck/build and browser gallery checks were run. The broader shared-tree run recorded 480 passes, 3 failures and 3 skips; failures were the existing Crescendo TRAP AI, Reefscape empty station wait and Crescendo Hard-versus-Normal AI checks. This follow-up does not claim those AI checks are fixed.

## 2025 storage and scoring correction

Fiddler and Spectre now prioritize the requested scoring/harvesting pose over a still-active intake command. Fiddler has a direct floor claw (no conveyor handoff), compensates the arm/wrist offsets when solving to the piece center, and uses overlapping elevator stages at full extension.

Piece handling and storage are separate settings:

- 971, 2910, 254, 1323, 1678, 341 and 581 use a single shared holder in these profiles: one CORAL **or** one ALGAE.
- 1690 buffers CORAL in its indexer; 2056 uses its printed CORAL cradle. 1778 buffers it on the intake, per the user's correction (replacing the earlier knock-off-only profile). ALGAE must leave before CORAL can transfer to the arm. Holding G after the ALGAE release does not accidentally eject the waiting CORAL.
- 118 uses an intake buffer: the team's [intake explanation](https://www.chiefdelphi.com/t/2025-robonauts-cad-and-code-release/502317/22) and [reveal Q&A](https://www.chiefdelphi.com/t/the-robonauts-118-2025-video/493588/43) describe retaining CORAL in the floor intake or delivering it to the end effector. The buffer model infers ALGAE-first sequencing from its shared head and separate CORAL holding zone.
- New 111 WildStang has independently driven CORAL and ALGAE heads on opposite ends of one rotating elevator arm. 111 has station-fed CORAL and no ground intake, following the user’s specified variant. Both pieces have distinct visual anchors; either head can score while the other retains its piece. The model follows the [team reveal portrait](https://www.chiefdelphi.com/t/wildstang-and-plus-one-2025-robot-reveals/492790) and published [CoralPath](https://github.com/wildstang/2025_111_robot_software/blob/main/src/main/java/org/wildstang/sample/subsystems/CoralPath.java) and [superstructure positions](https://github.com/wildstang/2025_111_robot_software/blob/main/src/main/java/org/wildstang/sample/subsystems/Superstructure/SuperstructurePosition.java). Geometry and timings are simplified estimates; NET ball flight retains the season's existing outtake simulation.

Generic custom robots retain their previous separate storage by default and offer a shared holder, buffered CORAL, or separate storage setting. Named profiles set their storage explicitly. Tests exercise intake with an occupied holder, actual collection into a buffer, ALGAE-first release/handoff/scoring, sustained G safety, 111's independent holders and CORAL-first scoring, and intake/scoring animation conflicts. The workshop also exposes an ALGAE scoring pose for inspecting the opposite arm end.

Held ALGAE now eases into a visual compression shape in the gripper’s local axes. 111’s roller spacing and squash profile match one another; vacuum-held WHISPER stays nearly spherical. Released/field balls retain their normal geometry and collision radius.

111’s shared arm pivots about a fore/aft axle and swings sideways, with its sweep offset in front of the elevator rails. Both independent holders reach either side of the robot; match alignment uses side scoring. Clearance checks cover the full arm sweep and the compressed held ALGAE envelope, along with both holders' scoring targets and stowed carpet clearance.

## 2026 hood travel and indexer staging

**Shot map.** The HUB aim target used to prefer one 60 degree launch at every range, so past about 3 m every hooded robot launched at 63-64 degrees and its hood sat still. REBUILT shooters run a distance table instead: a steep lob close in and a flatter, faster shot from deep, with the hood moving monotonically between them (2412's [REBUILT2026 launcher table](https://mintlify.wiki/robototes/REBUILT2026/configuration/launcher-constants): hood 1.5 to 6.6 rot from 1 to 5.8 m; 581's hood has 35 degrees of travel, [CD 521762](https://www.chiefdelphi.com/t/521762)). `hubShotAngle` (2026 `config.ts`) prefers 60 degrees at the 3 m accuracy-calibration range, 7 degrees per metre steeper closer in and 3 degrees per metre flatter farther out [EST slopes], clamped to 45-80 degrees. The solver still steepens any shot that would clip the rim. Settled launch angles now run from about 82 degrees at 1.2 m through 64 degrees at 3 m to about 58 degrees at 5.5 m, so the hoods sweep about 25 degrees across the ALLIANCE ZONE. A steeper far slope (7 degrees per metre) dropped the default robot's hit rate at 4 m from 83% to 67%, because shallow entries clip the HUB rim, so the far side stays gentle. Fixed-hood robots (`minAngle = maxAngle`: ROMAN, CHUNK, Matterhorn and now Triple Threat, whose documented hood is static) ignore the map and vary wheel speed. Because the 3 m angle is unchanged, the accuracy table keeps its calibration.

Hoods that only used part of that sweep now use their full travel: Simbot Tim (procedural and CAD), Rubble (581's 35 degrees) and Cyclone's floating hood. Simbot Tim's travel is unpublished [EST].

**Indexer staging.** While the shooter is spun up (shoot or pass held, or a shot just left), `PieceFlow` lines FUEL up nose to tail along each feed lane, one lane per shooter exit or turret, the way hopper floors, dye rotors and feed columns stage FUEL against the flywheel. Each launch takes the lead piece of the lane it left from (the host knows the exit; multiplayer clients alternate) and the rest step up one piece, at a conveyor speed matched to the fire rate. A lane holds as many pieces as fit along its path (up to 8). It never shows more pieces than the robot holds, and it backs them into the stow 1.2 s after the shooter is released. Staged pieces count toward `piecesInTransit`, so the hopper visual holds the rest. On a real-body hopper (`StowBay`), the stowed balls nearest the shooter are hidden while the lanes draw them (`GamePiecePool.drawnElsewhere`). They keep simulating, and `pickForLaunch` launches them first. Random per-shot feed paths (254, 1690, 3476, 9128, 1778, dye rotors, center columns) became fixed lanes so staged pieces don't jump between frames. All of this is render-only: launches, scoring and multiplayer state are unchanged.

**Intake retraction while shooting** stays as it was (254, 3476, 1678, 2910 and 971 pull their intakes in once FUEL is leaving). Making it follow the load down was tried: the moving hopper extension is part of the real hopper cavity, and it spilled FUEL out of 971's open hopper in AI matches (hit rate about 0.41 to about 0.30 over three matches each), so it was left out.

Tests: `tests/rebuilt-shot-animation.test.ts` (shot-map sweep for 4414 / 254 / 581, fixed hoods, dumper lanes staging over real hopper bodies and draining) and `tests/pieceFlow.test.ts` (lane staging, per-exit lanes, never staging more than held).

### Intaken FUEL lands on the pile

A ball the intake hands to the particle pile (other robots, multiplayer replicas) now ends its intake path on the pile
surface beside the intake (`FuelPile.entry`), instead of at the height of the intake lane: an empty hopper used to show
each new ball one ball-height up, then drop. Hand-over points expire after 0.5 s so a stale one (from a full hopper) never
places a later ball, and FUEL the indexer backs down out of its lanes rejoins the pile at the lane's start.
`tests/rebuilt-shot-animation.test.ts` checks the empty-hopper case.
