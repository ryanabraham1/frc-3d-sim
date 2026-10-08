# 9408 Gadgeteer — playable Hero Heist CAD

Select **WCP CADathon: Hero Heist → team 9408 · Gadgeteer**. Source: [Onshape assembly](https://cad.onshape.com/documents/62596cdc81bb8ddb30be7a64/w/bca4094c412230aacf299609/e/e2ba57da6aec137f2ef4fe0b) (robot only; the document's separate Block CAD field assembly is not part of this export) and the team's row in the submission sheet: Gadgeteer, 4 bubbles, 2 panels, HIGH climb. Mechanisms follow the team's [technical binder](https://docs.google.com/document/d/1vRZ0lN3PmrpUAZtAFolbF1bP64ZOyNjXS0jme8MWF5I) (28 in swerve X2i, pivoting upright-stowing intake with 1.25 in stub rollers, 4 in flywheel + 2 in backspin wheels with adjustable hood, 2-stage cascade elevator, two-joint arm with a two-panel end effector, telescope + 16 in suction cup). Anything not in the binder, CAD or sheet is an estimate `[EST]`.

What the CAD contains (source Z-up, mapped `(-Y,Z,-X)` in meters, so source +Y — the floor intake — is robot back):

- **Swerve** (four SwerveX2 modules, ~0.71 m frame). Bumpers are omitted from the asset; the engine draws its own.
- **Floor intake**: over-the-bumper arm with three 1.25 in roller tubes on a ramp, hinged on the 28.5 in hex shaft (source y .198, z .177). The export pose is deployed; the binder says it stows upright, so the model folds it up about that hinge when the robot is disabled or climbing (travel 83° `[EST]`). The lowest roller carries the orange intake marker.
- **Shooter**: the 2 in stealth wheel row near z .71 (binder: backspin wheels) spins while aiming/firing; the adjustable hood (190-tooth sector, side plates) tilts with the shot elevation about a pivot estimated from the plates `[EST]`. The 4 in flywheel wheels were not separately identifiable in the export, so they are not spun. Launch angle 30-75° is an estimate.
- **Elevator + end effector**: the elevator carriage (arm and end effector) rises up to 0.55 m during a placement, with the first stage moving half as far (cascade); the end effector swings about the arm's elbow shaft. The CAD end effector is on the robot's left side while the engine places panels at the front, so the held panel(s) ride the end effector and move to the placement pose during a placement.
- **Climber**: WCP 3-stage telescope (Base, Mid1, Mid2, End) with a suction cup. Stage travel 0.3 m each `[EST]`; HIGH is legal at the 30 in start height (45 in + 30 in < 78 in).
- **Held pieces**: up to 4 visual bubbles in the hopper (`fill`); panels are drawn by the season at the claw.

Estimates: speed 4.4 m/s, mass 120 lb, shooter rate 2/s, launch angle, intake reach, joint travel.

Prepared asset: 10.4 MB / 692k triangles from a 256 MB export (fasteners under 25 mm dropped). Reproduce: export the Main Assembly as GLB (`angularTolerance 0.109, distanceTolerance 0.00012, maximumChordLength 10`) to `hero-gadgeteer-9408-source.glb`, then `npm run cad:prepare -- <dir> hero-gadgeteer-9408`.

Validation: `tests/hero-gadgeteer-cad.test.ts` (real decoder, joint motion, fixed frame, held bubbles, intake marker, collection on both alliances) and the gallery at `/tools/robot-gallery.html?season=wcp-hero-heist&cad`.
