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

## Additional user-supplied 2026 CAD

| Team / model | Supplied original | Optimized asset | Triangles |
| --- | --- | ---: | ---: |
| 9470 Ctrl-Alt-Defeat | `9470-2026-MAIN.glb` | 1.79 MB | 313,024 |
| 6800 Downpour | `VR26A-0000 Main.glb` | 3.28 MB | 584,268 |
| 971 Mixtape (Championship) | `971 Final Championship Robot.glb` | 3.67 MB | 601,398 |

All originals remain untouched in Downloads. Asset reports record the exact source/retained counts. 9470 additionally loads a 0.54 MB / 97,271-triangle intake extracted from the original 581 CAD; it has its own asset so preview disposal and adaptation cannot change 581. The donor's hopper panels, upper corner pieces and energy chain are omitted. Its width is fitted to 9470 and its rack translates 0.22 m. This is an explicitly adapted mechanism, not 9470's original intake CAD. 9470's clear hopper walls and white roof are photo-fitted additions because that geometry is absent from the supplied file.

Sources: the user-supplied CAD is authoritative for these specific variants; TBA 2026 photo sheets for 9470, 6800 and 971 establish finishes and containment. Valor's [CAD release](https://www.chiefdelphi.com/t/frc-6800-valor-2026-robot-cad-release/520715) identifies Downpour; its [early technical binder](https://www.chiefdelphi.com/uploads/short-url/aiIYU0Pv6kleLK5yW5mDDAaE2n9.pdf) describes a different turret version. The supplied VR26A model is the wide drum version, which the simulator follows. Its original intake and horizontal hopper translate together through the 7.5 in travel described by the binder. Its fabric net is added from the photos. Capacities/rates/speeds for the two new roster entries are explicitly simulator estimates. 971 retains its previous capacity/rate/speed tuning while its frame envelope follows the supplied Championship CAD.

Hood pivots are measured from concentric CAD faces: 6800 at `(0.260350, 0.474486)`, 9470 at `(0.247650, 0.492823)`, and 971's left drum at `(0.205334, 0.477139)` after its 44.45 mm floor offset. 971's right turret is exported approximately 60 degrees in yaw and 0.647268 rad below the left hood pose; animation removes those configuration differences before applying their common aim. Each hood/flywheel stays parented to its own turret and fuel feed alternates between heads. Full linkage behavior, swerve modules, fabric tension and shot ballistics remain approximations.

Limestone follow-up: the lower 0409 shaft is its intake hinge. The former 1507 pivot was an upper roller shaft, and its rotation sign sent the assembly upright outside the frame. The intake now swings outward/down around the fixed lower hinge, independently of the horizontal hopper slide. Hopper containment stays upright.

Final validation: 76 focused CAD/roster/piece-path tests pass and production build/typecheck pass. The full suite has 559 passes and one unrelated CRESCENDO opponent-difficulty failure (Hard score 500 vs Normal 642). The same failure reproduces on an untouched HEAD checkout (2265f9b), independently of the CAD changes. Gallery checks cover both sides, low/high hoods, intake and full hopper poses.

Travel-hood correction: 971's two hoods return to a common compact 1.28 rad reference when aim/fire is released; 6800 parks at 1.50 rad. Its 100T hood belt moves with the hood around the drum center. Both compact CAD envelopes stay below 0.55 m. Their collision height defaults are 0.55 m, replacing raised export measurements; saved configurations with those exact former defaults migrate, while custom heights remain unchanged. The static collision envelope describes travel, not the raised shooting pose. Validation covers CAD return from shooting, saved settings, and physical trench crossing with full hoppers (66 focused tests), plus the production build.

## 1114 Simbot Tim supplied intake/hopper

`S26-A000.glb` contains the `S26-IN-A200` intake/hopper subassembly, not a complete robot. The browser model uses its reduced side plates, upper panels, rollers, cross shafts, gears and motors. Source meters and panel cutouts are retained; the source Y coordinate is mapped to robot X with a 0.3048 m offset. Screws, washers, bearings and unnamed tiny rivet interiors are omitted. The original 29.81 MB / 1,035,160 rendered triangles becomes 0.57 MB / 110,678 triangles.

The drivetrain and fixed wide drum shooter are fitted procedural assemblies. The lower pickup carriage uses an estimated 0.36 m horizontal deployment with supplemental telescoping supports; the attachment provides only one pose and does not establish the real linkage motion. Upper hopper panels remain fixed. Intake and feed paths follow the assembled model, and the roster retains its existing gameplay estimates. Validate in the workshop using CAD export, stowed, intake, full hopper and low/high aim poses on both sides.

Reproduce with `npm run cad:prepare -- /path/to/original/downloads simbot-tim-1114`.

## Supplied 2025 REEFSCAPE assemblies

| Team | Source | Optimized size | Triangles |
| --- | --- | ---: | ---: |
| 111 | `25W - WildStang 2025.glb` | 7.92 MB | 538,099 |
| 118 | `Firefly snapshot STEP assembly` | 6.84 MB | 442,784 |
| 581 | `BB581 2025 TLA.glb` | 11.23 MB | 868,453 |
| 1678 | `1678-2025-O-0000.glb` | 8.88 MB | 599,664 |
| 1778 | `1778.gltf` | 7.52 MB | 576,417 |
| 604 | `2025 FRC604 Robot.glb` | 8.22 MB | 608,135 |

These replace existing roster entries; 604 is newly added. The 1778 glTF embeds its buffers and needs no separate GLB. Firefly comes from the ZIP's STEP assembly: `tools/prepare-step-cad.py` uses OCP/XCAF to retain assembly names, transforms and colors before the shared converter. Its converted input is named `firefly-118-source.glb`. Pass a model ID to `npm run cad:prepare -- <source-directory> <model-id>`.

The converter merges each rigid assembly separately, removes fasteners/electrical interiors, simplifies surfaces and encodes lossless meshopt compression. Position quantization is deliberately avoided because it distorted small meshes in large assemblies. SubLime's camera field-of-view reference meshes are removed. The gallery season selector shows all six, including original export, transfer, dual-storage, deployed-climber and pulled-in poses.

WildStang has a deployable side ground intake. Quixilver is station-fed with no ground intake; its named Pinnacles climber arm is separated from the scoring arm. Zuma and SubZero retain their sideways shoulder rotation instead of twisting a forward-pitch arm. Actuator travel, performance and climb timing remain simulator estimates.

Firefly and SubLime hold CORAL and ALGAE in separate end-effector regions. Zuma holds ALGAE in its claw while CORAL waits in its ground intake. Held ALGAE uses a cached radial clearance profile against rigid mouth geometry; compression follows contact surfaces without changing field-ball physics. Zuma additionally pinches the lower U-shaped throat, following the supplied competition photos.

Climbers remain stowed during normal play, deploy in the last 30 seconds of teleop, grab only within 0.4 m and 30 degrees of alignment, and retract progressively while lifting. Gallery previews expose each phase separately.

### 1690 WHISPER (2025) and WildStang intake direction correction

- Source: `1690-25-0000 Post.glb`, supplied by the user. This export is already Y-up in meters; use identity axes. The ground intake extends toward local +Z, while the elevator arm scores across the X/Y plane.
- Groups: vacuum head `1690-25-5100`, arm stub `1690-2025-4140`, carriage `1690-2025-4100` and `1690-25-1230`, moving stage `1690-25-1220`, ground mechanism `1690-25-2600`, upper climber `1690-25-6140`. Intake motors under `2680/2681` remain fixed.
- Measured shoulder `[-.2147,.8365,0]`, tool joint `[0,.46,0]`, intake shaft `[0,.285,.3859]`, deployed pickup `[0,.10,.67]` meters. The exported arm tube reference is missing; a simplified carbon connector spans the measured joints. Its section, wrist aiming, intake fold travel, and climb travel are simulation estimates. Intake four-bar motion is represented by a rigid fold around its measured shaft.
- Team reference: [Orbit's WHISPER reveal](https://www.chiefdelphi.com/t/orbit-1690-2025-robot-reveal-whisper/492064). Local TBA contact sheet `refs/1690-2025/sheet.jpg` was inspected to check the vacuum arm and intake relationship.
- WildStang111's measured side-intake hinge is `[.0603,.2556,.33435]`; roller pickup is `[.0603,.096,.735]`. Legacy presets now migrate to side pickup. The orange bumper stripe, carpet guide, and gallery pickup stream also use `groundYaw`, so they agree with the CAD mouth rather than the old generic rear face.
- Agent handoff instructions: [CAD robot modeling guide](CAD-ROBOT-MODELING-GUIDE.md).

- CORAL uses a tool-local axis for the supplied 2025 rigs, including sideways roller carries on 1778/581. A bounded seating fit preserves the rigid tube and hollow bore; it does not shrink CORAL.
- Firefly118's separate `03_3000_CAGELATCH` is parented to its moving climber arm and folds inward during normal play. Deployed cage contacts are configured per robot; cage approaches and actual moving contact anchors replace the generic front attachment.
