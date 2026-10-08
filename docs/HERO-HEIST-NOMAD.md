# 6995 NOMAD — playable Hero Heist CAD

Select **WCP CADathon: Hero Heist → team 6995 · Nomad**. Gadgeteer-role robot from the team's CADathon submission (sheet row "6995", class column "Multiclass").

Source: [Onshape assembly](https://cad.onshape.com/documents/dc43b19f2e46981255d7d233/w/0a4080792ce2fab8a15b6f4c/e/e2fb5b73bb40afbd07be44d8) and the team's [documentation](https://docs.google.com/document/u/1/d/e/2PACX-1vS2K0seSkNjFmpugfWFk1Rp55Sor16VT1d5jn5YLCBy_-K4W8SjXYwIvG9-hcBXacyDDcMGbbg4Utgo/pub).

## What the binder says (and what is estimated)

- 25.5 x 25.5 in frame, MK5n L3 swerve with lowering blocks to meet the 30 in Gadgeteer start height, 95 lb. Drive speed 4.3 m/s and acceleration are simulator estimates.
- Slapdown for STORY PANELS (holds two) plus a linear BUBBLE intake, both on one end; two side-belt midtake feeding a hooded shooter with one 3 in flywheel and two 2 in back rollers ("27 degrees" of hood). Hood range 40-67 degrees, shot rate 2.5/s and muzzle height are estimates.
- Two-stage continuous belted elevator (two Kraken X60) carrying a pivoting four-roller end effector for panels; reaches the low FOOTHILL baskets (estimate: the binder says "almost every district except the top FOOTHILLS").
- No climb: the sheet says Park, so `climber.maxLevel = 0`.
- Capacity: 2 panels or 1 panel + 3 bubbles / 4 bubbles. The sheet lists 5 bubbles, which a Gadgeteer cannot legally hold (4), so the sim uses the class limit.

## Simulation approximations

- The export is one pose. The elevator is at full extension (stage 1 bottom matches the static stage bottom once lowered .33 m), the slapdown is stowed. Stage 1 and the carriage each travel .33 m, slapdown angle (.95 rad about an estimated hinge) and hood tilt are fitted [EST].
- In the real robot the panel end effector and the intakes face the same end and the shooter the other. The sim places panels with the front and collects with the back, so the elevator/end effector is turned 180 degrees about the vertical axis onto the shooter (front) side. The intakes stay on the back.
- Held bubbles are visual spheres on the midtake (`fill`). Held panels ride flat on the end-effector rollers at `heldAnchor`.
- The CAD export includes a reference "Origin Cube" that is removed. Both mouths (linear intake, slapdown) carry the orange intake marker.

## Asset

Exported through the Onshape REST API (`GLTF`, assembly translation) and prepared with `npm run cad:prepare -- <dir containing hero-nomad-6995-source.gltf> hero-nomad-6995` (spec `hero-nomad-6995` in `tools/prepare-robot-cad.mjs`). Coordinates `(Y,Z,X)` in meters; bumpers, PDH, breaker and battery removed. The export contains only the robot (no field).
