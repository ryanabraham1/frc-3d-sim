# 5800 Wolverine · Multiclass — playable Hero Heist CAD

Select **WCP CADathon: Hero Heist → team 5800 · Multiclass · Mystic** or **· Gadgeteer**. Both entries are the same CAD
robot (`hero-multiclass-5800`); the sheet lists it as *Multiclass, 6 bubbles, 1 panel, Park* and the sim's class rules
(manual p. 18) never allow 6 bubbles together with a panel, so the robot is offered as the two classes it can declare:

| Entry | Class | Storage | Placement | Preload |
| --- | --- | --- | --- | --- |
| Multiclass · Mystic | MYSTIC | 6 bubbles | none | 3 bubbles |
| Multiclass · Gadgeteer | GADGETEER | 1 panel + up to 3 bubbles (4 bubbles with no panel) | low FOOTHILL baskets and slits | 1 panel + 3 bubbles |

Source: [Onshape assembly](https://cad.onshape.com/documents/c2dc8ce89390e85cfb5cc7c0/w/6edfacad0375c29c51ee8642/e/1e2cf780d4393e634018fd90)
(sheet row 47) and the [Wolverine Technical Binder](https://docs.google.com/document/d/1uQlk8dYg9rCQj7ISWtSgd81_mMuvWkwXKIARUOtX00M). The binder says: Mystic-first hybrid, 27 x 25 in frame, 98 lb, X2i swerve, over-the-bumper 4-bar ground intake with 2 in polycarbonate rollers, 5-star spindexer, turret (180° range) with dual-wheel flywheel and variable-angle hood, belt elevator with 21.875 in stroke for panels from the Source.

## What was modeled from the CAD

Axes: CAD (x, y, z) → robot (forward = +Y, up = +Z, right = +X) (`axes: 'yzx'` in `tools/prepare-robot-cad.mjs`), so the elevator
and wrist face the front and the floor intake faces the back, as the sim expects. Joint centers were read from the
assembly's mates in world coordinates (`GET /assemblies/.../?includeMateFeatures=true`).

- **4-bar floor intake (back)**: gearbox pivots A (driven inner link, CAD limit 0..0.797 rad) and B (middle link),
  coupler joints P and Q. `solveFourBar` solves the planar four-bar each frame, so all three links, both tube rollers and the
  gearbox plates move as one rigid mechanism and the link lengths hold (tested).
- **Turret + shooter**: vertical axis at (0.033, 0.416). Three 4 in wheels share one axle (direction (0.852, 0, 0.523)) and spin
  while aiming; the ramp of hood rollers is fixed (the CAD has no hood actuator). The ball leaves 58.5° off the CAD x axis,
  so the turret carries that fixed offset and "yaw 0" fires forward. The binder's variable-angle hood is in the config (25–70°); the CAD has no hood actuator, so the hood rollers are not tilted visually, and the 180° turret range is not enforced by the engine.
- **Elevator (front)**: continuous belt cascade; binder stroke 21.875 in (0.556 m) for the carriage, first stage half of it.
- **5-star spindexer**: the star, shaft and gear rotate while intaking/feeding and the held bubbles ride it on the floor plate.
- **Wrist / arm with wheel face (front)**: pivots at the carriage (0.248, 0.182) and tips forward for reach; it carries the held
  panel (Gadgeteer) and is the second intake mouth.
- **Held bubbles**: up to six spheres ring the spindexer (visual, `RobotAnimState.fill`); four in Gadgeteer mode.
- **Intake marker**: orange bar on the rear roller link (the engine draws the rear bumper stripe and carpet capture patch).

## Intake

Per the binder the 4-bar at the back is the only ground intake (width 0.60 m, reach 0.22 m [EST]); the front wrist handles panels from the Source and placement, so there is no second bubble mouth (an earlier draft added one by mistake).

## Estimates (not in the CAD or sheet)

4.6 m/s, 7.5 m/s², default launch angle 45°, 3 bubbles/s, muzzle height 0.62 m / forward 0.20 m, intake width
and reach, panel grip point on the wheel face, placement cycle 0.9 s. Climb is **Park only** (sheet), so no climber is drawn.
Frame 27 × 25 in and 98 lb are from the binder; height 0.757 m is the top of the elevator.

## Reproduce

Export the assembly as glTF with the Onshape translations API
(`POST /assemblies/d/{doc}/w/{ws}/e/{el}/translations`, `formatName: GLTF`, `yAxisIsUp: false`, `grouping: true`), convert it to a
single `.glb` with `@gltf-transform/core` (`NodeIO`), name it `hero-multiclass-5800-source.glb` (156 MB, not committed), then

```
npm run cad:prepare -- <dir> hero-multiclass-5800
```

(output 10.5 MB / 862 k triangles, 1058 fasteners/electronics/bumper occurrences omitted). Gallery:
`/tools/robot-gallery.html?season=wcp-hero-heist&cad`.

Validation: `tests/hero-5800.test.ts` (real GLB through the runtime decoder, four-bar invariants, finite joint sweeps with a
stationary frame, bubble count and intake markers, collection through the rear intake only, on both alliances, turret shot into a
CITY BLOCK, Gadgeteer panel placed into a DOWNTOWN slit).
