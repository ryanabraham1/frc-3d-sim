# Skyfall 2.0 and mechanism corrections

The six user-supplied CAD screenshots define the exposed Skyfall 2.0 model: a red open A-frame, broad red pivot tray, large concentric side gears, tan guide panels, purple inner wheels, three white outer rollers, and climbing hooks attached to the rotating arm. TBA's match photos include black sponsor covers; the model exposes the underlying CAD structure requested here. Dimensions, encoder-to-CAD angular datum, and actuator speeds are visual estimates. Gameplay tuning remains unchanged.

Sources: [Simbotics CAD release and AMP/climb explanation](https://www.chiefdelphi.com/t/team-1114-simbotics-2024-simbot-skyfall-1-0-2-0-cad-release/475819), [public ArmConstants](https://github.com/Simbotics/2024-Simbot-Skyfall/blob/main/src/main/java/frc/subsystems/arm/ArmConstants.java), [2024 TBA photos](https://www.thebluealliance.com/team/1114/2024).

Skyfall's arm carries its hooks through reach and pull-in poses. The feed path uses the opposite tray end for AMP. Gas struts remain attached to fixed and moving mounts throughout the sweep.

2910 Typhoon's previous CAD hinge mistakenly used a flywheel axle. Its paired 64T pivot sprockets and fixed feeder bearings share the actual hinge at source Y=0.19163045, Z=0.28691241 m. The source flywheel outlet faces negative Y. The runtime turret now normalizes that direction toward its commanded scoring heading, and the held NOTE and feed path follow the pitching shooter.

6036 Snoopy's complete turret (including A-frame and pitching shooter) follows gameplay yaw using bounded motion over the shortest angular path. The gallery now exercises yaw with a sweep or fixed front/left/right/back targets; previously it always supplied yaw zero. Intake and climb still use their published fixed turret directions.

604 Domotron's embedded `Note` CAD occurrence is excluded during preparation. The simulator draws its held NOTE separately.

604's 2025 Quixilver floor ALGAE pickup is enabled using the front gripper with a low elevator/arm/wrist pose. CORAL remains station-fed. The [team's published description](https://www.chiefdelphi.com/t/team-604-quixilver-cad-code-release-for-our-2025-robot-the-flush/502824/34) confirms the ground ALGAE sequence. The pose is fitted to the supplied CAD, with a carpet-clearance check; the actuator trajectory is a visual approximation.

Validation: gallery comparisons from both sides, turret direction changes, Roti low speaker/raised AMP poses, Presto climb, and Quixilver floor pickup. Focused tests check moving holders, source bounds, floor clearance, outlet direction, turret response, and Skyfall arm-mounted hooks. Individual wheels in merged CAD assets retain their geometry but are not separately simulated as rigid bodies.
