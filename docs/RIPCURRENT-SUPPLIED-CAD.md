# Team 4414 supplied CAD

Team 4414's `ripcurrent-4414` now loads the user's **Top Assembly.glb**, a clone of the team's robot, instead of the procedural approximation. The CAD geometry is retained without simplification. Gray manufacturing swatches receive a 4414 finish: teal anodized structure, black mechanisms, smoked polycarbonate, aluminum hardware, and alliance-colored fabric bumpers. The source's 12 white digit faces are changed to the adjacent fabric material and three white `4414` prints replace them. All original CAD triangle surfaces remain.

Assets:

- `public/models/robots/2026/ripcurrent-4414.glb`
- `public/models/robots/2026/match/ripcurrent-4414.glb`
- `public/models/robots/2026/ripcurrent-4414.report.json`

Rebuild using `node --max-old-space-size=8192 tools/prepare-4414-cad.mjs '/path/to/Top Assembly.glb'`. The source is not committed. Both assets use lossless meshopt compression supported by the game's existing GLTF loader. The match conversion script preserves this asset without simplification.

The supplied source is 168.2 MB; the output is 32.5 MB and about 4 million triangles, so it costs more to download and render than the simplified robots. Positions map from CAD `(X,Y,Z)` to game `(Y,Z+0.0127,X)`, placing the wheel contact surface on the ground and the intake at the back. The import writes physically based team materials in linear color space; runtime bypasses the usual extra CAD color darkening. The bumper fabric has its own material so alliance tint never affects other dark parts.

The runtime net fits the measured CAD rim (0.554 m), full hopper/extension footprint and chamfered corners. Fine diagonal strands, sewn perimeter and a circular turret opening replace the old smaller net footprint. It drapes over the actual held-ball surface; its full-load packing retains the configured 105-ball capacity. Game-generated net and FUEL are separate from the CAD asset.

The supplied mesh is split into independent rigid groups before draw-call consolidation. Fixed top support plates, net rails and the two ELP side cameras stay on the chassis. Central spur rings and Limelight mounts follow the shooter turret. Hood cheek/support plates, both 77T belt loops, lower drive pulleys, upper feeder, axle and hubs pivot together about the measured flywheel axis; powered wheels spin about their own shafts. The dye rotor hook/fin turns independently from the stationary indexer and bearing structure. Intake side panels and rollers translate on the rack; its motor mounts and fixed outer rack stay put. Four drive wheels steer and roll with chassis velocity. The existing automatic preview camera movement remains enabled, and the live 4414 preview demonstrates aiming as well as intaking.

Motion references: [NOMAD 6995 release](https://www.chiefdelphi.com/t/nomad-6995-offseason-cad-and-code-release/526030), [RobotVisualizer.java](https://github.com/frc6995/Offseasonbot-2026-public/blob/5531a570264579c05100616b25c4bae84c15f2b3/src/main/java/frc/robot/RobotVisualizer.java) and that revision's Hood, Intake, Turret and DyeRotor subsystem constants. These distinguish separate hook/turret/hood/intake components, 0–40 degree hood travel, 0.31 m intake travel on a 10.8 degree rack, and dye-rotor speeds of 120 RPM forward / 30 RPM reverse. Actual visual pivots are measured from this supplied GLB; a one-degree export-zero registration is an explicit simulator estimate while the actuator retains the code’s 0–40 degree stroke. The legacy hood seating offset applies to the complete shooter mount, preserving hood/flywheel alignment; the source export's shooter yaw is removed before applying game aim. Appearance references are the existing 4414 match photos in `refs/4414-2026/sheet.jpg`. These are visual/kinematic references, not a port of the team's robot control software or a calibrated motor simulation.

Existing drive, capacity and scoring settings remain the game's 4414 settings. Procedural fallback remains available if CAD loading is disabled or fails.
