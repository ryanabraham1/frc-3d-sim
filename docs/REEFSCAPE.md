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
| Barge, cages, nets | §5.4, pp25–27 | Truss with center support, six cages at stated lateral offsets; preselected shallow/deep bottoms; 4 ft × 12 ft nets at 76 in minimum height |
| Processors, stations | §5.5–5.6, pp28–32 | 28 × 20 in processor opening, 7 in bottom; four station mouths at 37½ in |
| Pieces | §5.7, pp33–35 | Hollow CORAL visuals: 4½ in OD, 4 in ID, 11⅞ in length; ALGAE diameter 16¼ in |
| AprilTags | §5.8, pp35–39 | All 22 IDs at the depicted structures and stated mounting heights; visual markers |
| Staging/cages | §6.3.4–6.3.5, pp45–46 | 126 CORAL, 18 ALGAE; one optional preload per robot, six CORAL MARK CORAL with ALGAE atop (48 in from the wall, ±72 in, measured from Fig. 6-2), twelve staged reef ALGAE, remaining CORAL in alliance station reserves; each station's team sets its cage depth, the rest stay deep |
| Match timing | §6.4–6.5, pp46–48 | 15 s AUTO + 3 s scoring delay; 135 s TELEOP (last 20 s endgame) + 3 s final assessment |
| Scoring | §6.5.1–6.5.4, pp48–50 | AUTO CORAL 3/4/6/7, TELEOP 2/3/4/5, processor 6, net 4, leave 3, park 2, shallow 6, deep 12 (by the cage actually climbed; any of the alliance's three cages qualifies) |
| Ranking points | Table 6-2, p50 | AUTO, CORAL, BARGE bonuses; win 3, tie 1; Coopertition needs two processor ALGAE per alliance and relaxes CORAL to three levels |
| Robot size | R104, p78 | 42 in starting height and 120 in frame perimeter; G409 restricts inventory to one CORAL + one ALGAE |

## Playing the mechanisms

The 2025 robot editor has **All-rounder**, **CORAL + cage** and **ALGAE + cage** profiles. These are
simulator designs inferred from the scoring tasks, not robot designs mandated by FIRST. You can
enable CORAL intake/scoring, ALGAE intake/removal, PROCESSOR feeding and NET shooting independently.
The processor does not require a net shooter, and CORAL scoring does not require a projectile launcher.
The lobby summarizes these capabilities and transmits the complete configuration to the host.

Rule-derived limits are 42 in starting height, 120 in frame perimeter (R104), up to 18 in mechanism
reach beyond the frame (R105/G415), one of each piece (G409), and 0–1 CORAL preload (§6.3.4).
There is no bulk hopper setting for 2025. Disabled pickup mechanisms remove that piece's inventory slot;
an ALGAE profile starts without CORAL. Highest elevator level limits CORAL scoring and the L2/L3 ALGAE
that the mechanism can reach. Size/extension limits apply to menu, saved and multiplayer configurations.

The all-rounder defaults to a 27 × 27 in frame, 36 in starting height, all four reef levels, 18 in reach,
1.3 m/s elevator speed, 0.6 s CORAL cycle, 0.45 s ALGAE removal and 3.6 s cage rise. Those speeds and
times, along with drive speed, net accuracy/rate and release height, are simulation tuning choices:
the manual does not specify them. Cage rise time is independent of the shallow/deep point value.
Old saved 2025 configurations receive defaults for the new mechanism fields. 2026 retains its own editor.

Keys **1–4** select the elevator's reef level; brackets and gamepad D-pad also change it. Drive close to
your reef and hold **Space**. Aim assist chooses the closest open branch on the approached face;
with aim assist reduced or the turret disabled, face the branch. The elevator must reach its height
before placement. L1 accepts multiple pieces; other branches hold one. Staged ALGAE blocks L2 or L3
on alternating faces until collected. Hold **J** or enable auto-intake with **F** to collect nearby ground
pieces or reef ALGAE. ALGAE is neutral and can be harvested from either reef. A robot that can't store it
(no ALGAE intake, or already holding one) knocks it off the reef onto the carpet instead, which also
clears the blocked level; the CORAL profile uses this to open L2/L3.

With ALGAE and no CORAL, **Space** launches toward your net using the ballistic solver. **G** feeds
ALGAE into your processor when nearby. Processor passage scores six points and transfers that ALGAE
to the opponent's human player. Human players can throw those pieces into their own net only in
TELEOP. Automatic station feeding supplies nearby robots from the finite CORAL reserve: back your
intake up to a CORAL STATION opening with intake running and CORAL comes straight from the CHUTE into the
robot; otherwise it drops onto the carpet in front of the station (never onto a robot parked in the
opening). **H** toggles CORAL supply and acts once; the lobby also lets the host choose automatic human players.

**X** near your own reef retrieves a scored CORAL at the selected level. Points and branch occupancy
are adjusted; original AUTO location credit is restored on re-scoring, including the manual's L1
TELEOP-first removal / AUTO-first restoration order. Opponent CORAL cannot be retrieved.

Choose your shallow/deep climber in robot settings before the match; per §6.3.5 it also sets the depth of
the cage nearest your driver station, and cages without a team choosing stay deep. Drive near any of
your alliance's cages of that depth and press **C** during TELEOP (§6.5.2 accepts any one of the
alliance's cages). **X** descends. Climbing is assisted; cage occupation is exclusive. Points follow the
cage climbed. Park/cage points are assessed at the end of the final scoring window.

Scripted AUTO options are leave + L4, leave + L1, leave only and do nothing. Manual AUTO remains a
practice option, as in the existing 2026 simulator.

## Automatic rule handling

- G409: inventory capture enforces one CORAL and one ALGAE.
- G410: the assisted retrieval mechanism only accesses your own scored CORAL.
- G412: CORAL placement requires reef reach; a gentle reverse-intake ejection follows its exception.
- G403: direct robot contact beyond the opposing barge boundary during AUTO produces a major foul.
- G405/G418: opponent cage contact produces a major foul; TELEOP also awards the opponent BARGE RP.
- G421: multiple defenders beyond the barge zones produce a minor foul, then a major every three seconds (AUTO and TELEOP).
- G427: direct contact with an opponent in its protected reef/barge zone produces a major foul.
- G428: direct contact with an opponent climbing in the final 20 seconds awards a major and BARGE RP.

Minor and major foul values are two and six points. Intent, herding, transitive contact through pieces,
pinning, damage, cards, inspection, human safety rules and tournament administration are not referee
simulations. Climbing/placement controls prevent several illegal actions instead of assessing penalties.

## Simulation approximations

The PDF explicitly directs readers to separate drawings for exact construction details. Those drawings
were excluded by the manual-only scope. Processor/station longitudinal positions, CORAL mark positions,
net suspension offsets, driver station spacing, barge/tag horizontal offsets and cosmetic structure are
estimated from its figures. The 12 ft reef offset is interpreted as the near face's distance from the
alliance wall, consistent with the plan views. Tags are stylized visual patterns, not camera-decodable
36h11 targets or surveyed poses.

CORAL is visibly hollow but uses a solid cylindrical rigid-body collider. ALGAE uses a spherical
rigid-body collider. CORAL mass is 0.65 kg within the manual's 0.5–0.8 kg range; ALGAE mass of 0.45 kg,
friction, rebound, damping, elevator speed and human-player launch speed are simulation assumptions.
Scored CORAL is placed and retained by the assisted mechanism, rather than simulating pipe insertion
and every subsequent dislodgement. Nets use a rigid cup/sensor instead of deformable fabric. Staged
reef ALGAE is retained until harvested. Cage engagement uses the engine's kinematic climb animation;
anchor-contact qualification and cage sway are not physically adjudicated.

Multiplayer is host authoritative. CORAL placements, harvested reef ALGAE, held pieces, piece rotations,
elevator state, cages, scores, clock, fouls and results are replicated. Clients predict driving against
the field and the replicated elevator collider; mechanisms and scoring execute on the host.

## Verification

`tests/reefscape.test.ts` exercises real Rapier placement/reach, both alliances and all reef faces/levels,
branch occupancy, harvest, intake limits, processor/net flight, human-player transfer, scripted AUTO,
both cage heights, AUTO re-scoring, ranking points, tags and replica state. Shared physics regressions
exercise both registered seasons. Browser checks cover year selection, room year changes, driver and
spectator synchronization, remote scoring/driving, results and restarting a room.
