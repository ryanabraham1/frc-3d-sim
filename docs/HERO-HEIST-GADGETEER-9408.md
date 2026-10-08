# 9408 Gadgeteer — playable Hero Heist CAD

Select **WCP CADathon: Hero Heist → team 9408 · Gadgeteer**. Source: [Onshape assembly](https://cad.onshape.com/documents/62596cdc81bb8ddb30be7a64/w/bca4094c412230aacf299609/e/e2ba57da6aec137f2ef4fe0b) (robot only; the document's separate Block CAD field assembly is not part of this export) and the team's row in the submission sheet: Gadgeteer, 4 bubbles, 2 panels, HIGH climb. The team's design-documentation binder was not accessible, so everything not read from the CAD or the sheet is an estimate `[EST]`.

What the CAD contains (source Z-up, mapped `(-Y,Z,-X)` in meters, so source +Y — the floor intake — is robot back):

- **Swerve** (four SwerveX2 modules, ~0.71 m frame). Bumpers are omitted from the asset; the engine draws its own.
- **Floor intake**: over-the-bumper arm with three 1.25 in roller tubes on a ramp, hinged on the 28.5 in hex shaft (source y .198, z .177). The export pose is deployed; the model folds it up about that hinge when the robot is disabled or climbing (travel 75° `[EST]`). The lowest roller carries the orange intake marker.
- **Shooter**: roller shooter with a spiked hopper and a 190-tooth gear sector; the 2 in wheel row near z .71 spins as the flywheel. No hood or turret motion is modelled (the sector's role is unconfirmed); launch angle 30–75° is an estimate.
- **Elevator + claw**: a chain elevator mast with an arm and wrist claw. In the CAD the claw is on the robot's left side while the engine places panels at the front, so the held panel rides the claw at rest and moves out to the placement pose during a placement. Wrist tilt (0.55 rad) is an estimate.
- **Climber**: WCP 3-stage telescope (Base, Mid1, Mid2, End) with a suction cup. Stage travel 0.3 m each `[EST]`; HIGH is legal at the 30 in start height (45 in + 30 in < 78 in).
- **Held pieces**: up to 4 visual bubbles in the hopper (`fill`); panels are drawn by the season at the claw.

Estimates: speed 4.4 m/s, mass 120 lb, shooter rate 2/s, launch angle, intake reach, joint travel.

Prepared asset: 10.4 MB / 692k triangles from a 256 MB export (fasteners under 25 mm dropped). Reproduce: export the Main Assembly as GLB (`angularTolerance 0.109, distanceTolerance 0.00012, maximumChordLength 10`) to `hero-gadgeteer-9408-source.glb`, then `npm run cad:prepare -- <dir> hero-gadgeteer-9408`.

Validation: `tests/hero-gadgeteer-cad.test.ts` (real decoder, joint motion, fixed frame, held bubbles, intake marker, collection on both alliances) and the gallery at `/tools/robot-gallery.html?season=wcp-hero-heist&cad`.
