# Team 4414 supplied CAD

Team 4414's `ripcurrent-4414` now loads the user's **Top Assembly.glb**, a clone of the team's robot, instead of the procedural approximation. No geometry simplification or material recoloring is applied to the robot, except its bumper lettering. The source's 12 white digit faces are changed to the adjacent fabric material and three white `4414` prints replace them. All original CAD triangle surfaces remain.

Assets:

- `public/models/robots/2026/ripcurrent-4414.glb`
- `public/models/robots/2026/match/ripcurrent-4414.glb`
- `public/models/robots/2026/ripcurrent-4414.report.json`

Rebuild using `node --max-old-space-size=8192 tools/prepare-4414-cad.mjs '/path/to/Top Assembly.glb'`. The source is not committed. Both assets use lossless meshopt compression supported by the game's existing GLTF loader. The match conversion script preserves this asset without simplification.

The supplied source is 168.2 MB; the output is 32.5 MB and about 4 million triangles, so it costs more to download and render than the simplified robots. Positions map from CAD `(X,Y,Z)` to game `(Y,Z+0.0127,X)`, placing the wheel contact surface on the ground and the intake at the back. Material appearance bypasses the usual CAD color darkening.

The runtime net fits the measured CAD rim (0.554 m), full hopper/extension footprint and chamfered corners. Fine diagonal strands, sewn perimeter and a circular turret opening replace the old smaller net footprint. It drapes over the actual held-ball surface; its full-load packing retains the configured 105-ball capacity. Game-generated net and FUEL are separate from the CAD asset.

The source contains one mechanism pose without joint limits. The complete pancake turret follows the game aim; intake and hood retain the export pose. Its exported hood reaches 0.671 m above the ground. Existing drive, capacity, scoring and collision settings remain the game's 4414 settings; this visual replacement does not claim calibrated physics or trench clearance for the clone's exported pose. Procedural fallback remains available if CAD loading is disabled or fails.
