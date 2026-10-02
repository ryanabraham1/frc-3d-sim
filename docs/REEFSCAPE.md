# 2025 REEFSCAPE implementation

Select **2025 REEFSCAPE** on the home screen. The host's selection also controls the multiplayer room.
Joining peers adopt the room's season and defaults; each driver can configure their own robot and cage.
Rooms support the existing six driver slots and spectators in either season.

## Manual source

The sole 2025 source is the supplied **2025GameManual.pdf**, 164 pages: ARENA V4, Game Details V13,
Game Rules V11 and Robot Construction Rules V11. Page numbers below are the printed manual pages.
No external field CAD, WPILib tag layout or later team updates were used for 2025.

| Feature | Manual reference | Implementation |
|---|---|---|
| Field and markings | §5.1–5.2, pp19–22 | 57 ft 6⅞ in × 26 ft 5 in; clipped station corners, guardrails, starting lines, reef zones, 46 × 146½ in barge zones running to the guardrail, PROCESSOR AREAS outside the guardrail beside the opponent's processor |
| Reefs | §5.3, pp23–24 | Two hexagonal reefs; L1 troughs; 12 branches per level at L2/L3/L4; 13 in pipe spacing, specified heights/insets and 35° lower branches |
| Barge, cages, nets | §5.4, pp25–27 | Truss with center support; six free-swinging cages (pendulums hung from the 62 in truss, deep ones on chain) at stated lateral offsets with shallow/deep bottoms; 4 ft × 12 ft nets at 76 in minimum height |
| Processors, stations | §5.5–5.6, pp28–32 | 28 × 20 in processor opening, 7 in bottom; four station mouths at 37½ in |
| Pieces | §5.7, pp33–35 | Hollow CORAL visuals: 4½ in OD, 4 in ID, 11⅞ in length; ALGAE diameter 16¼ in |
| AprilTags | §5.8, pp35–39 | All 22 IDs at the depicted structures and stated mounting heights; visual markers |
| Staging/cages | §6.3.4–6.3.5, pp45–46 | 126 CORAL, 18 ALGAE; one optional preload per robot, six CORAL MARK CORAL with ALGAE atop (48 in from the wall, ±72 in, measured from Fig. 6-2), twelve staged reef ALGAE, remaining CORAL in alliance station reserves; each station's team sets its cage depth, the rest stay deep |
| Match timing | §6.4–6.5, pp46–48 | 15 s AUTO + 3 s scoring delay; 135 s TELEOP (last 20 s endgame) + 3 s final assessment |
| Scoring | §6.5.1–6.5.4, pp48–50 | AUTO CORAL 3/4/6/7, TELEOP 2/3/4/5, processor 6, net 4, leave 3, park 2, shallow 6, deep 12 (by the cage actually climbed; any of the alliance's three cages qualifies) |
| Ranking points | Table 6-2, p50 | AUTO, CORAL, BARGE bonuses; win 3, tie 1; Coopertition needs two processor ALGAE per alliance and relaxes CORAL to three levels |
| Robot size | R104, p78 | 42 in starting height and 120 in frame perimeter; G409 restricts inventory to one CORAL + one ALGAE |

## Playing the mechanisms

### Robot archetypes

The Robot panel offers five **archetype presets** based on what 2025 teams actually built (see
[`ROBOT-ARCHETYPES.md`](ROBOT-ARCHETYPES.md) for the research and sources), plus per-mechanism options so
you can compare trade-offs such as *ground intake vs. funnel only*:

| Preset | CORAL | CORAL intake | ALGAE | Auto-align | Climb |
|---|---|---|---|---|---|
| **Funnel-fed L4 cycler** (default) | L1–L4 elevator | CORAL STATION funnel only | knock off with the elevator | yes | deep |
| **Ground-intake all-rounder** | L1–L4 | ground + funnel | reef + floor → NET + PROCESSOR | yes | deep |
| **L2–L3 elevator** | L1–L3 | funnel | reef → PROCESSOR | yes | shallow |
| **L1 trough bot** | L1 only | ground | reef + floor → PROCESSOR | no | shallow |
| **ALGAE specialist** | none | none | reef + floor → NET + PROCESSOR | yes | deep |

Options: *CORAL scoring* (none / L1 / L1–L3 / L1–L4), *CORAL intake* (funnel / ground / both),
*ALGAE* (knock off / reef only / reef + floor), *ALGAE scoring*, *reef auto-align* and *climb*. There is
no turret: a pick-and-place game has no use for one, and a turret made placement unrealistically easy,
so saved configs with a turret are normalized to a fixed end effector.

Rule-derived limits are 42 in starting height, 120 in frame perimeter (R104), up to 18 in mechanism
reach beyond the frame (R105/G415), one of each piece (G409), and 0–1 CORAL preload (§6.3.4).
Elevator speed, cycle time, reach and drive speed are simulation tuning values (the manual doesn't set them).

### Placing CORAL (physical)

Keys **1–4** select the level. Drive to your REEF and hold **Space**:

- The elevator rises to the level and the end effector extends toward the nearest open BRANCH on the
  face you're approaching (the other BRANCH once one is full; the emptier half of the trough for L1).
- **With reef auto-align** (as most 2025 robots had: vision / pose-estimate alignment with left/right
  branch targets) the robot drives itself onto that BRANCH's scoring pose and releases when lined up.
  A small random vision error (σ ≈ 0.25 in) is added per attempt.
- **Without auto-align**, *you* line up; the HUD shows how far left/right the BRANCH is. Space releases
  as soon as the mechanism is in position — wherever the robot is.
- The released CORAL is a free, hollow rigid body (a tube of collider staves) launched along the
  BRANCH's axis (down onto L4, 35° down onto L2/L3, sideways into the L1 trough). It scores only if the
  real BRANCH pipe ends up inside its bore (§6.5.1) and it stays there 0.3 s. From testing: L2/L3 score
  within about ±0.9 in laterally and miss at ~1.3 in; L4 tolerates ~1.3 in and a few degrees of yaw.
  A missed CORAL bounces off the REEF onto the carpet.

Staged ALGAE physically sits in front of L3 (even faces) or L2 (odd faces) and blocks placement there
until it's removed. Hold **J** at the REEF to remove it: robots with an ALGAE intake keep it, others knock
it onto the carpet. ALGAE is neutral and can be harvested from either REEF.

With ALGAE and no CORAL, **Space** shoots the NET (chassis auto-align turns the robot toward it), and **G**
feeds the PROCESSOR, which transfers that ALGAE to the opponent's human player (thrown at their NET only in
TELEOP, button **B**).

### CORAL STATION

The human player button (**H**) drops a CORAL into the nearest CORAL STATION's 55° CHUTE, aimed at your
robot's side of the opening. It slides out of the 7 in slot and falls:

- a **funnel** robot backed up to the opening (intake running) catches it at the CHUTE exit;
- otherwise it lands and rolls on the carpet, where a **ground intake** can pick it up — a funnel-only
  robot cannot.

With *Human player: Auto* the human player drops one whenever one of your robots is waiting near a station
without CORAL (one every ~1.1 s, none while one is still in the CHUTE).

Scored CORAL stays on the REEF as a physical piece. If it is knocked off, points and occupancy follow it;
original AUTO location credit is restored when that location is re-scored (§6.5.1), including the L1
TELEOP-first removal / AUTO-first restoration order.

Choose your shallow/deep climber in robot settings before the match; per §6.3.5 it also sets the depth of
the cage nearest your driver station, and cages without a team choosing stay deep. Drive near any of
your alliance's cages of that depth and press **C** during TELEOP (§6.5.2 accepts any one of the
alliance's cages). **X** descends. Climbing is assisted; cage occupation is exclusive. Points follow the
cage climbed. Park/cage points are assessed at the end of the final scoring window.

Cages are not locked in place: each one hangs from the truss as a pendulum, so driving into it pushes it
and it swings, then settles. **C** grabs the cage wherever it has swung to; robot and cage then settle
plumb under the pivot with the cage just ahead of the front bumper. After you descend, it swings freely again.

Scripted AUTO options are leave + L4, leave + L1, leave only and do nothing. Manual AUTO remains a
practice option, as in the existing 2026 simulator.

## Automatic rule handling

- G409: inventory capture enforces one CORAL and one ALGAE.
- G410: there is no CORAL retrieval mechanism; knocked-off CORAL is re-collected from the carpet.
- G412: CORAL placement requires reef reach; a gentle reverse-intake ejection follows its exception.
- G403: direct robot contact beyond the opposing barge boundary during AUTO produces a major foul.
- G405/G418: real collider contact with a (possibly swinging) opponent cage produces a major foul; TELEOP also awards the opponent BARGE RP.
- G421: multiple defenders beyond the barge zones produce a minor foul, then a major every three seconds (AUTO and TELEOP).
- G427: direct contact with an opponent in its protected reef/barge zone produces a major foul.
- G428: direct contact with an opponent climbing in the final 20 seconds awards a major and BARGE RP.

- G425: pinning is a 3-count: a robot holding an opponent boxed in (stopped, driven, against a wall, FIELD element or
  robot) for 3 s gets a minor foul, then a major foul for every further 3 s. The pinning driver sees a live
  "PINNING nnnn" countdown (`src/engine/match/pinning.ts`).

Minor and major foul values are two and six points. Intent, herding, transitive contact through pieces,
damage, cards, inspection, human safety rules and tournament administration are not referee
simulations. Climbing/placement controls prevent several illegal actions instead of assessing penalties.

## Simulation approximations

The PDF explicitly directs readers to separate drawings for exact construction details. Those drawings
were excluded by the manual-only scope. Processor/station longitudinal positions, CORAL mark positions,
net suspension offsets, driver station spacing, barge/tag horizontal offsets and cosmetic structure are
estimated from its figures. The 12 ft reef offset is interpreted as the near face's distance from the
alliance wall, consistent with the plan views. Tags are stylized visual patterns, not camera-decodable
36h11 targets or surveyed poses.

CORAL is a hollow tube: its collider is ten thin staves around a 3.7 in bore, so a BRANCH pipe can really pass
through it. The CORAL STATION CHUTE is a 55° ramp with a short 35° exit lip: at a flat 55° a 4.5 in CORAL
would jam in the 7 in slot (only ~4 in of perpendicular clearance), so the lip is an approximation of the
real chute exit geometry, which the manual doesn't dimension. ALGAE uses a spherical
rigid-body collider. CORAL mass is 0.65 kg within the manual's 0.5–0.8 kg range; ALGAE mass of 0.45 kg,
friction, rebound, damping, elevator speed and human-player launch speed are simulation assumptions.
The end effector is kinematic: it holds CORAL rigidly and releases it at a fixed speed along the BRANCH axis
(the real intake-wheel ejection is not simulated). Reef auto-align drives to the ideal pose with a P-controller
plus Gaussian noise rather than simulating a camera. Nets use a rigid cup/sensor instead of deformable fabric. Staged
reef ALGAE is retained until harvested. Cages swing as rigid pendulums (the chain is treated as a rigid link,
~8 kg estimated mass). The climb itself is the engine's kinematic animation, during which the robot
carries its cage. Anchor contact (G419) is not adjudicated.

Multiplayer is host authoritative. CORAL placements, harvested reef ALGAE, held pieces, piece rotations,
elevator state, swinging cage poses, scores, clock, fouls and results are replicated. Clients predict driving against
the field and the replicated elevator collider; mechanisms and scoring execute on the host.

## Verification

`tests/reefscape.test.ts` exercises physical CORAL placement (auto-aligned on every face and level, manual misalignment misses), the CHUTE feeding funnel and ground-intake robots, archetype options, real Rapier reach, both alliances and all reef faces/levels,
branch occupancy, harvest, intake limits, processor/net flight, human-player transfer, scripted AUTO,
both cage heights, AUTO re-scoring, ranking points, tags and replica state. Shared physics regressions
exercise both registered seasons. Browser checks cover year selection, room year changes, driver and
spectator synchronization, remote scoring/driving, results and restarting a room.
