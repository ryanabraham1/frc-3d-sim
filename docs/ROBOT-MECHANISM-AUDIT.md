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
