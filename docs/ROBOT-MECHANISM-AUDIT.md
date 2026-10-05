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
