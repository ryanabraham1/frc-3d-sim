# 2025 held pieces and transfers

Reference audit: October 6, 2026. All 13 selectable team robots were checked against their 2025 TBA photo contact sheets (`refs/<team>-2025/sheet.jpg`). Team release images and technical binders were used where available. The photos and downloaded binder pages are local, git-ignored research artifacts. Source links below let the audit be repeated.

Piece centers and compression remain visual estimates, not metrology. CAD defines the exported mechanism geometry; an exported pose alone does not establish travel limits, intake linkage kinematics, or timing. Transfers use the simulator's configured handoff duration. The 65% carry / 35% receiving split and Miss Daisy's toss arc are animation estimates. These changes do not alter scoring, inventory, or the field pieces' physical size.

| Robot | References | Holding / transfer treatment |
| --- | --- | --- |
| 111 WildStang | [Team reveal](https://www.chiefdelphi.com/t/492790), [2025 photos](https://www.thebluealliance.com/team/111/2025), supplied CAD | Independent heads on opposite ends of the shared arm; retain separate coral and algae anchors. Fold the intake during a transfer. Exact loaded-head seating is less certain because the inspected reveal photos are unloaded. |
| 118 Firefly | [Team CAD/binder release](https://www.chiefdelphi.com/t/502317), [2025 photos](https://www.thebluealliance.com/team/118/2025), supplied CAD | Photo shows coral in one head and algae in the opposing curved cradle. Keep separate centers and tool-relative coral orientation. Simplified arm transfer and CAD conveyor route remain approximations. |
| 254 Undertow | [Team technical binder](https://media.team254.com/2025/09/985607eb-2025-Tech-Binder-254.pdf), pp14,18-19; [photos](https://www.thebluealliance.com/team/254/2025) | Indexer aligns coral for the hood/flex-wheel end effector. Algae sits outside its dedicated wheel/stud grip, not at the coral center. Explicit lengthwise coral axis and conveyor transfer. |
| 341 Miss Daisy | [Team documentation release](https://www.chiefdelphi.com/t/500739), linked design binder pp17,28; [photos](https://www.thebluealliance.com/team/341/2025) | Binder explicitly describes the OTB roller tossing coral into the waiting claw. Use a late receiving arc with the floor intake deployed, rather than a folding-intake transfer. Coral sits lengthwise between the claw wheels. |
| 581 Zuma | [Champs reveal](https://www.chiefdelphi.com/t/499182), [reveal video](https://www.youtube.com/watch?v=PQXPnj1kkpc), [loaded photo](https://www.thebluealliance.com/team/581/2025), supplied CAD | Keep the rigid head's measured coral axis transverse to the arm. Separate algae center in the mouth and coral buffer in the intake. Conveyor route and folding timing are estimated. |
| 604 Quixilver | [Loaded match photos](https://www.thebluealliance.com/team/604/2025), [team mechanism interview](https://www.youtube.com/watch?v=vNXxb_Tdr4w), supplied CAD | Coral sits lengthwise through the roller head and rotates with its wrist; separate algae center outside the mouth. Station-fed coral skips a floor-transfer animation. |
| 971 Fiddler | [Team CAD/documentation release](https://www.chiefdelphi.com/t/504817), technical documentation p14; [loaded photos](https://www.thebluealliance.com/team/971/2025), [team reveal](https://www.youtube.com/watch?v=tBW1xUJT-4Y) | Tube sits lengthwise between the orange wheel rows (with a retaining spike). Ball sits farther out in the opening. Direct floor pickup by the scoring claw; no fabricated transfer from another intake. |
| 1323 MadTown | [Team technical binder](https://www.chiefdelphi.com/t/500435), p13; [loaded photo](https://www.thebluealliance.com/team/1323/2025) | Two independent wheel sets manipulate coral horizontally/vertically. Use transverse L1 and lengthwise upper-level seating; ball center is farther forward between the larger gripping wheels. Folding transfer is a simplified approximation. |
| 1678 SubLime | [Team reveal](https://www.chiefdelphi.com/t/493150), [photo](https://www.thebluealliance.com/team/1678/2025), supplied CAD | Keep separate coral/algae centers in the head, wrist-relative tube orientation, and conveyor transfer. Correct the CAD intake pivot to its inboard support so folding does not rotate that support below the floor. Loaded seating and conveyor details are estimated from CAD and the available views. |
| 1690 WHISPER | [Team mechanism description](https://www.1690orbit.com/robots), [team reveal](https://www.chiefdelphi.com/t/492064), [loaded photo](https://www.thebluealliance.com/team/1690/2025), supplied CAD | Suction contacts the coral's cylindrical wall. Pipe axis is perpendicular to the cup normal, not aimed into the cup as an end-on grip. Ball center is one radius beyond the suction face. The supplied user photos establish a rigid cup on one arm shaft swinging sideways, scoring over the +Z intake and the opposite -Z side. Coral runs across the cup, rotated 90° from the previous seat. The pass-through intake remains down during transfer; the arm lowers its cup to the inboard conveyor. |
| 1778 SubZero | [Team CAD release](https://www.chiefdelphi.com/t/501460), [team POV transfer footage](https://www.youtube.com/watch?v=QjgmQr1kNBo), [photos](https://www.thebluealliance.com/team/1778/2025), supplied CAD | Intake folds up carrying coral while the arm hangs down. Carriage follows the intake's receiving height. Coral stays on the moving bank until the final receiving phase; both CAD and simplified models implement this. Ball has its own seat in the same head. |
| 2056 LIGHTNING | [Team binder release](https://www.chiefdelphi.com/t/502550), [photo](https://www.thebluealliance.com/team/2056/2025), [reveal](https://www.youtube.com/watch?v=zMFky_YAr40) | Tube center in the gripper, separate outward ball center, explicit tool-relative axis, and existing straightenator/cradle conveyor. Exact later-season grip seating remains an estimate; the binder's PDF endpoint returned HTML during this audit. |
| 2910 Spectre | [Team technical binder release](https://www.chiefdelphi.com/t/500310), binder p8; [loaded coral/algae photos](https://www.thebluealliance.com/team/2910/2025), supplied CAD | Binder specifies lengthwise L2-L4 and transverse L1 coral orientation. Both model variants switch the local axis accordingly. Separate algae center between the upper and lower roller banks. Shared scoring claw picks up directly from the floor. |

## Implementation and inspection

`RobotModel.handoffStyle` distinguishes folding, conveyor, toss, and direct collection. `coralTransferPose` is shared by match rendering and the workshop; it samples the moving intake each frame, keeps the tube attached during the carry phase, and uses the actual tool pose at the receiving end. It removes the previous unconditional bumper-clearing lift.

The workshop's **CORAL transfer (scrub)** pose and **Transfer** slider inspect the same calculation as matches. **Piece flow** loops intake, transfer (only if configured), and scoring. Compare imported CAD and previous models, and use **Other side** to check the receiving head behind the elevator.

Regression checks cover every robot's explicit piece anchors, moving/yawed intake orientation, direct pickup, the simplified 1778 folding sequence, and the CAD 1778 intake rise, receiver alignment, and carpet clearance throughout folding. Existing team pose and mechanism tests cover the other scoring poses and inventory behavior.

## Continuous piece motion (October 10, 2026)

A headless audit drove every team robot through a real pickup, handoff and scoring loop and measured where the drawn
CORAL was against the physics piece. With the imported CAD models, CORAL teleported 10–44 cm (and turned up to 90°)
at the moment of release, and 30–48 cm from the carpet into the intake on pickup. Fixes:

- **Eject.** Scoring now starts a short eject (`EJECT_SECONDS` in `rules.ts`, 0.15 s [EST]) instead of releasing at
  once. The mechanism holds still, the rollers spin out (`place.eject` raises `firing`), and the drawn CORAL slides
  from its tool seat to the exact pose `ejectCoral` then releases from (`coralReleasePose` / `ejectTravel` in
  `transferVisual.ts`). Fixed ejectors (3005, 190, 1706, 422) visibly shoot the tube forward. Remaining release jump:
  under 3 cm on every robot (one physics step of flight).
- **Pickup.** A newly held CORAL is drawn from where it lay into the intake over `PICKUP_SECONDS` (visual only).
- **Handoff end.** The tube is seated in the tool before the handoff is drawn, so the transfer ends on the seat.
- **Arm speed.** 2025 arms and wrists use `scoringSlew` (top speed `ARM_SWING_RATE`, 6 rad/s [EST]) and CAD carriages
  3 m/s, so a target jump (leaving the handoff, flipping for a level) no longer covers ~15 cm per frame.
- **CAD tool point.** The generic, WildStang and side-scorer CAD rigs aimed the wrist joint, not the exported tool
  point; `SeatFix` feeds the measured seat offset back into the solve (1678 L2/L3: 34 → 14 cm before the eject).
- **341 Miss Daisy.** The handoff angle was written a full turn from the stowed angle, so the arm swung up over the
  front after every transfer; it now takes the short way. The claw stows at bumper height (TBA photos), not 9 cm.
- **1323 MadTown.** The leaned rest pose held the CORAL ~10 cm past the front bumper; it now sits over the bumper.

Known limits: 1678's CAD claw is exported ~6 cm off center, so its tube slides sideways slightly during the eject
(1778 and 581 are fixed below). 111 and 118 (L4) can't reach the configured scoring reach and their rollers carry the tube the rest of
the way. `tests/reefscape-piece-motion.test.ts` covers the eject, pickup and 341 swing.

## Per-robot motion from team code (October 10, 2026)

Mechanism angles and offsets now follow each team's published robot code where it exists (setpoint constants in
the repos below), binders and Chief Delphi threads otherwise. YouTube match video could not be fetched from the
build environment, so motion timing is still estimated.

- **Off-center claws.** `placement.toolOffset` (robot frame) moves the release point and the auto-align so the claw,
  not the robot center, lines up with the branch: 1778 `[-0.241, 0]` (team `CORAL_CENTER_OFFSET`, 9.5 in), 581
  `[-0.168, 0]` (team CompConfig, 6.6 in). Without it those robots miss the branch.
- **Rigid tools.** 254, 1678, 118, 2056, 341 and 581 hold the tube at a fixed angle in the claw, so the drawn tube
  follows the release angle instead of snapping to it (`followRelease`).
- **254 Undertow.** Rigid 0.39 m arm on the elevator; scoring angle from the reach (`acos`), stow / handoff at the
  team's angles, climber on the left.
- **2910 Spectre.** Claw pitch from the team's absolute claw setpoints (L4 110.5°, L3 151°, L2 156°), mirrored for
  the back side.
- **1323 MadTown.** Wrist IK puts the seat on the target off either end (`scoreSide: 'ends'`).
- **341, 971.** Score off either end; 341 stows arm up and dunks on release. 581 and 1778 also dunk.
- **604 Quixilver.** Arm pivot at 31.75 in, real claw angles per level, elbow-down reach for L2/L3.
- **3005 Relay.** The laterator slides the ejector fore-aft over the bumper; ALGAE gripper takes REEF, PROCESSOR and
  NET angles.
- **1706, 422, 5940, 190.** Per-level pivot / wrist angles from team code; 5940 waits swung back over the indexer;
  190's claw goes over the top for the NET and the carriage lifts before the stage.

Sources: Team254/FRC-2025-Public, 2910 public code, ArchdukeTim/2025-Firefly (118), BREAD5940, team422/FRC-25,
FRC3005/Reefscape-2025, Team-190/2k25-Robot-Code, Team341/FRC2025-Public, frc1678/C2025-Public, team581/2025-beta,
FIRST1778, frc604/2025-public, frc971 y2025 (all on GitHub).

Still approximate: 111's arm scores sideways (as configured) although its code swings fore-aft; 254's NET shot off
the back, L1 from the intake (1323, 1778, 111, 5940) and NET flicks (118, 341, 604, 1678) are not drawn; fixed
ejectors (422, 1706, 190) release 17–39 cm ahead of their rollers because they shoot the tube.
