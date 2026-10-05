# Imported robot CAD: first inspection batch

These three 2026 models use the user's supplied Onshape GLB exports, linked from the [Spectrum CAD Collection](https://docs.google.com/spreadsheets/d/1acT6PpdR5l3zVhPqrehgamPsnUbk6yg-2JC5FcwIbb4/edit). Original downloads remain untouched.

| Robot | Original file | Source size | Optimized size | Rendered triangles before / after |
| --- | --- | --- | --- | --- |
| 604 Toploader | Toploader Assembly.glb | 270 MB | 4.50 MB | 15,407,630 / 779,981 |
| 1678 Limestone | 1678-26c-0000.glb | 100 MB | 2.54 MB | 2,415,782 / 409,769 |
| 581 Rubble | 2026 Dumper Champs Bot581.glb | 172 MB | 2.62 MB | 10,240,481 / 454,693 |

Triangle counts include repeated occurrences. File sizes use decimal MB. Optimized files and conversion reports are in `public/models/robots/2026/`.

## Reproduce

Run `npm run cad:prepare -- <original-download-directory>` to prepare all three, or append a model ID to prepare only that robot. This uses glTF Transform and meshoptimizer; Blender is unnecessary. Inputs are local files; no CAD credentials or cloud writes are involved.

The converter preserves meters, changes CAD Z-up coordinates to simulator Y-up, removes small fasteners/electrical interiors, merges meshes separately within named rigid mechanism groups, simplifies surfaces with bounded error, and applies meshopt compression. Generic alliance bumpers and team labels are retained. Structural bearing supports/arm plates remain; tiny bearings and screws are omitted. Limestone's loose unnamed six-triangle reference sheet is excluded from its robot model.

## Inspect

Run the development server and open `/tools/robot-gallery.html?cad=1`. This shows only these three robots. Use **Imported CAD / Previous models** for comparison, **CAD export pose** for the supplied geometry, and the normal mechanism poses to inspect the initial animation mapping. Click a card to orbit/zoom; **Other side** and **Blue / red** work for both versions.

The same imported models load in the menu previews and playable simulator. A missing/unloadable asset falls back to the procedural builder. Headless simulation does not download visual assets.

## Scope and limitations

This is a geometry and initial articulation pass. Toploader has separate turret, hood, flywheel, serializer, intake arm, and sliding hopper groups. Limestone's fixed intake gearbox/containment panels are separated from its moving intake; its drum turns. Rubble's intake translates on its rack instead of swinging through the hopper; its drum and hood are separate.

Mechanism angles/rates and piece paths remain simulator approximations, not calibrated from footage. Limestone uses the imported Part 60 containment, 1924 horizontal roof rails, and 1902 telescoping posts for its raised hopper; these were nested under the CAD assembly named "Climber." They translate vertically inside the chassis. The imported intake-end wall translates horizontally, separately from that roof. Added net lines bridge the raised roof to the extended lip. The net is an approximation of the supplied competition photo, not a CAD export of the fabric. CAD swerve modules are currently visually fixed. These limitations do not change the existing physics, robot capabilities, capacities, or scoring configuration. The exported CAD pose is available for geometry comparison independently of the animation mapping.

Validation: optimized assets decode through the actual runtime loader, retain intake/hood/flywheel geometry, meet file/triangle budgets, and remain finite through intake/aim/hood sweeps. Focused CAD, team-robot, and mechanism-path suites pass (71 tests). Production build passes. Browser checks cover both sides, intake/shooter poses, comparison switching and alliance colors.

## Follow-up fixes

Thin panels retain CAD face boundaries and use flat normals, avoiding the folded-looking highlights from permissive simplification. Team accent finishes are gold for 604, green for 1678 and orange for 581. Original metal, rubber and white containment surfaces remain distinguishable.

Fuel now occupies each robot's hopper rather than a shared small cube. Limestone's fuel envelope follows the sloping front retention net, its horizontal extension and the raised interior roof; its capacity remains 60. Extension height follows the existing above-40-FUEL contract.

Hood reference angles are calibrated from the CAD roller/drum geometry rather than assuming the export is the middle-shot pose. Rubble's hood bearing and concentric plate faces fit the drum center at `(0.28575, 0.47625)` in simulator X/Y. The gallery's shot selector switches to the aiming pose so the chosen angle is actually applied. Low/mid/high targets are 29/52/72 degrees; the linkage remains a visual approximation, not a physical launch calibration.

Toploader’s dye rotor and turret share the CAD centerline at X=0.0254 m, Z=0; the earlier serializer pivot was offset by ~79 mm and made the rotor orbit.
