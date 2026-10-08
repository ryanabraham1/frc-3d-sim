# 498 Mystic — playable Hero Heist CAD

Select **WCP CADathon: Hero Heist → team 498 · Mystic**.

Source: [Onshape assembly](https://cad.onshape.com/documents/308c2281e3ff59722e4dd3fb/w/d059f7fdd2c497ad09ad9396/e/fea64e26c2dcad32744bfd47) and yellow row 54 of the [submission sheet](https://docs.google.com/spreadsheets/d/1puhGmcSgHVSIsmb2TWnyxC6fqbZaQrJXKUxNsb7Mt-s/edit?gid=0) (Mystic, 6 bubbles, 0 panels, HIGH climb). The technical binder named in the sheet has no link, so every joint below is read from the CAD geometry itself.

**Mechanisms (CAD, source axes `(Y,Z,X)` in meters):**
- Frame: 26 × 26 in (104 in perimeter, exactly the Mystic limit), MK5n swerve, 3.25 in bumpers (the sim draws its own).
- Intake (back): one swing arm carrying three 2 in tube rollers on a belt-driven ladder, pivoting on its 25.5 in roller shaft at (-0.2795, 0.3535). The CAD pose is the stowed, upright arm; deploying swings it 2.5 rad outward so the lowest roller meets the floor 0.06 m past the bumper. Orange sleeves on all three rollers mark the intake.
- Indexer and hopper: a floor-belt indexer (three bubbles across), then a one-bubble-wide vertical column under the turret. Held bubbles are drawn as visual-only spheres (`HELD_SLOTS`: three on the indexer floor, two stacked in the column, one on top) driven by `RobotAnimState.fill`.
- Shooter: turret on an 8 in X-contact bearing at (0.178, 0.505); the tilting roller hood and the 4 in flywheel share the 11.15 in shaft at (0.2755, 0.584). The sim hood follows launch elevation; the flywheel spins while aiming or firing.
- Climber: base stage, stage 1 and carriage telescope plus a hooked wrench on the carriage pivot shaft at (-0.0385, 0.93, -0.216). The sim climbs by suction-pad contact like every Hero Heist robot, so the telescope rises and the wrench swings out while grabbing.

**Estimates:** the CAD is exported with the telescope extended and the wrench out, so the stowed nesting (stage 1 down 0.21 m, carriage down 0.42 m, wrench folded down) is derived from stage lengths, giving a 0.826 m (32.5 in) stowed height that keeps the HIGH climb legal; intake swing angle is fitted to floor contact; hood tilt range, flywheel speed, fire rate (4 bubbles/s), drive speed (4.5 m/s), acceleration and playing mass (112 lb) are simulator estimates. Climb stays HIGH as the sheet claims. Stowed-nesting clearance against the folded body was not verified in CAD.

Prepared asset: `hero-mystic-498.glb` (~10 MB, ~0.77 M triangles). Bumpers, battery, PDH, breaker and the climber rope are omitted; the wrench keeps its original face normals so its tube holes stay clean. Reproduce with the Onshape glTF export (assembly translation, `resolution: medium`, `grouping: true`) saved as `hero-498-source.gltf`, then `npm run cad:prepare -- <dir> hero-mystic-498`. Gallery: `/tools/robot-gallery.html?season=wcp-hero-heist&cad`.

Validation: runtime decoder, stowed height, deploy/climb pose sweeps with a stationary frame, held-bubble visibility by fill in both alliance colors, back-only collection on both alliances, full test suite, typecheck and build, and browser gallery poses (stowed, intaking, aiming, full hopper, climbing, hanging).
