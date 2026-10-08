# 254 Cheesy Poofs — playable Hero Heist CAD

Select **WCP CADathon: Hero Heist → team 254 · Cheesy Poofs**. This is Bellarmine's CADathon Gadgeteer (not a 2026 robot).

Source: [Onshape assembly "TLA"](https://team254.onshape.com/documents/e13cf09d6c701404c3324795/w/09bdbe7bc1def77234d6b4e7/e/c0b6c3ba6d288d37dadfce27) (link-shareable and exportable) and row 17 of the [submission sheet](https://docs.google.com/spreadsheets/d/1puhGmcSgHVSIsmb2TWnyxC6fqbZaQrJXKUxNsb7Mt-s/edit?gid=0): Gadgeteer, 3 bubbles, 1 panel, High climb. The sheet's tech-binder column only names "2025 WCP Cadathon Documentation" (no link), so the archetype is read from the CAD itself.

## What the CAD contains

Swerve (SDS MK5n) drivebase, a pivoting three-roller floor intake at the back, a low serializer feeding a vertical feeder, a turret (ring gear, two X60 flywheel rollers, hood), a three-stage belt-driven elevator (two X60), a disk-manipulator claw (a roller pair that pinches a STORY PANEL's rim, swinging on a pivot tube at the elevator top) and a vacuum suction pad on the elevator carriage. Source axes are Z up with the intake toward -Y; `tools/prepare-robot-cad.mjs` maps them with `'yzx'` so the intake sits at robot -X (intakes face away from the scoring side).

Rig groups in `hero-poofs-254.glb`: frame, intake, turret, hood, flywheel, stage2, stage3, claw-base, claw, pad. Bumpers, electronics and belts are omitted (the sim draws generic bumpers; elevator belts would not stretch).

## Animation (`src/engine/robot/hero254CadModel.ts`)

- **Intake** pivots on the hex shaft (the CAD pose is deployed on the floor; stowed folds up 0.7 rad [EST]). The front roller wears an orange sleeve marking the intake mouth; the engine's orange bumper stripe marks the capture zone.
- **Turret / hood / flywheel** follow the engine turret. The CAD shooter exits along source +X, so the group carries a +90° offset. Hood pitch follows the shot elevation (scaled 0.6 [EST]).
- **Elevator**: the export is the fully extended pose. Stage travel is measured from the resting plates: stage 2 rises 0.45 m, stage 3 (with claw base, claw and pad) 0.90 m. Stowed pad top is about 0.85 m.
- **Claw / panel**: the claw swings 0 to 180° about its pivot tube (jaws back to forward) and the jaw rollers slide the disc, so the panel centre lands near each mailbox family's lift and reach (DOWNTOWN 0.38 / 0.65 m, UPTOWN 0.41 / 1.09 m, low FOOTHILL 0.54 / 1.08 m). The nearest pose is solved per frame and the held-panel anchor rides the claw.
- **Climb**: the elevator extends to put the suction pad at the 66 in truss underside, then retracts while the robot is lifted.
- **Held bubbles**: three visual-only bubbles sit in the serializer/feeder, shown by `fill`.

## Estimates and approximations

Drive speed 4.5 m/s, acceleration, playing mass 110 lb, shooter rate 4/s, intake reach, hood travel and the station funnel (the back mouth also takes human-player pieces) are estimates. Frame size (0.737 × 0.661 m), turret centre and flywheel height (0.735 m), elevator travel and claw pivot are measured from the CAD. The stowed CAD is about 0.85 m tall; the config uses the 30 in start limit (0.762 m), which keeps the High climb legal under the 78 in tower limit. The claw's real swing arc and panel hand-off are not documented; they are fitted so the panel reaches the mailboxes.

Reproduce: export the TLA assembly from Onshape as glTF (`POST /api/assemblies/d/{doc}/w/{ws}/e/{el}/translations` with `formatName: GLTF`; the result is JSON glTF with embedded buffers), convert it to `hero-poofs-254-source.glb`, then `npm run cad:prepare -- <dir> hero-poofs-254`. Gallery: `/tools/robot-gallery.html?season=wcp-hero-heist&cad`.

Validation: `tests/hero-254.test.ts` (legal config, fixed frame with moving rig, claw reach per mailbox, held bubbles and intake marker on both alliances, back-mouth-only collection, High climb, panel delivery) plus the gallery poses.
