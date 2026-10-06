# 2024 CAD additions and articulation

Added Roti 5940, Presto 6328 and Snoopy 6036; retained the existing Domotron 604 ID. Original supplied files are unchanged. The default renderer uses optimized native geometry; lightweight procedural versions remain available in the workshop.

| Robot | Source | Runtime asset | Triangles |
| --- | --- | ---: | ---: |
| Roti 5940 | `2024 5940.glb` (198.95 MB) | 10.53 MB | 715,214 |
| Presto 6328 | Supplied intake plus official AdvantageScope chassis and arm | 10.02 MB | 695,277 |
| Snoopy 6036 | `6036.glb` (380.17 MB) | 12.43 MB | 849,968 |
| Domotron 604 | Existing `2024 FRC604.glb` asset | 18.53 MB | 1,179,020 |

## Mechanisms

- **Roti:** fixed under-bumper intake, continuous two-stage elevator, carriage-mounted pitching pod. The export's carriage is approximately 310.72 mm above its low position; animated mode removes that offset while CAD-export mode preserves it. Normal SPEAKER shots keep the elevator at its low 15 mm goal. AMP lifts 430.4 mm and points the outlet down by 24 degrees; climb preparation uses 620 mm, pull-in retracts, and TRAP release extends to 580 mm. Cascade motion divides lift across nested stages. Pitch center is the supplied carriage dead axle `[.0889,.705518,0]` before lowering. Feeder-to-flywheel centers give a fitted -0.508 rad source outlet direction. The upper idler mouth is used for reverse feeding into AMP/TRAP. There is one SPEAKER shooting side, as confirmed by the user; no bidirectional gameplay feature was added.
- **Presto:** the attachment contains only `6328-24b-5000 Intake`. The team's complete public AdvantageScope models supply the real blue chassis, pivot arm, indexer, shooter, backpack and chain climber. Arm bearing center is `[-.238,.29845,0]`; public goals are 5.8 degree minimum carry, 110 degree AMP, 105 degree climb preparation and 88 degree hanging. The hook carriage translates 400 mm along the arm, then retracts to hang. The backpack's moving rack/roller assembly extends along its inclined guide for TRAP release. Its 180 mm stroke is a visual fit, not a published measurement. Native hook plates (`Part 25`) travel with the carriage. Supplied intake is aligned to the official Y-up CAD before conversion.
- **Domotron:** public final `FRC-2024` constants specify 16 inch elevator travel, 8 inch AMP extension, -105 degree AMP and -128 degree TRAP launcher positions. Carriage translation follows the 15 degree rail tilt. Launcher pivot `[.181376,.4624,0]` follows the carriage; intake bearing `[-.3175,.2794,0]` deploys from the exported approximately 90 degree pose to the published -50 degree intake goal. The climber's folding hooks remain on the fixed frame. Hook rotation is fitted to the demonstration, rather than applying motor-shaft radians directly to the arm.
- **Snoopy:** the turret carries the complete A-frame and pitching shooter; chain hooks are part of the shooter, not separate world-vertical arms. Paired output thrust bearings locate the pitch center `[.125005,.479425,.087175]` in the exported 145 degree turret yaw. Source roller centers give approximately 0.547 rad pitch. Public code specifies AMP 0.27 rotations, climb preparation 0.31, pull-in 0.001 and TRAP 0.14. Intake is on runtime +X; the turret returns toward it for handoff. Source-export mode restores the original yaw and complete bounds.

Animation uses bounded visual actuator rates. Motor control, chain/rope dynamics, gas-spring compression, drivetrain speed and scoring ballistics remain simulator approximations. Interior hardware and CAD bumpers are omitted; generic simulator bumpers are retained. Native drivetrain modules and merged individual rollers are visually fixed in this asset pass.

## References inspected

- [Roti team description and reveal](https://www.team5940.org/2024), [technical binder and CAD/code release](https://www.chiefdelphi.com/t/5940-bread-2024-cad-and-code-release-uncensored-6-piece/466729), [BREAD public constants](https://github.com/BREAD5940/2024-Onseason), and TBA photos in `refs/5940-2024`.
- [Presto code and complete CAD](https://github.com/Mechanical-Advantage/RobotCode2024Public), [2024 build thread](https://www.chiefdelphi.com/t/frc-6328-mechanical-advantage-2024-build-thread/442736), [Behind the Bumpers](https://www.youtube.com/watch?v=4BlE5zDQwBE) (indexer/backpack 2:18–4:17; hooks/chain routing/TRAP 4:19–5:56), and TBA photos in `refs/6328-2024`. Upstream MIT notice is retained in `PRESTO-CAD-LICENSE.txt`.
- [Domotron CAD/code release](https://www.chiefdelphi.com/t/team-604-quixilver-presents-our-2024-robot-cad-and-code-release/477799), [public final code](https://github.com/frc604/2024-public), [Behind the Bumpers](https://www.youtube.com/watch?v=bGivb7bY7kI) (AMP around 5:30; climb/TRAP 6:20–7:35), and TBA photos in `refs/604-2024`.
- [Snoopy technical binder](https://www.chiefdelphi.com/t/6036-2024-cad-and-tech-binder-release/465406), [public robot code](https://github.com/team6036/FRC-2024-Public), and [TBA robot profile](https://www.thebluealliance.com/team/6036/2024).

## Reproduce

Run `npm run cad:prepare -- /path/to/downloads roti-5940 snoopy-6036 domotron-604`. For Presto, clone the team's public repository, then run `node tools/prepare-presto-source.mjs /path/to/RobotCode2024Public '/path/to/6328-24b-0000 MA24B.glb' /tmp/presto-6328-complete-source.glb`, followed by `npm run cad:prepare -- /tmp presto-6328`. Asset reports record exact counts and bounds.
