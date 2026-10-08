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

## Photo-fitted donor mechanisms for additional teams

The original robot layouts remain individual builders. `adaptedCadParts.ts` clones owned donor geometry, fits it in source meters, and preserves separate hood, drum, turret and rotor pivots. These are adapted mechanisms, not newly obtained CAD for the destination teams. Robot configurations and scoring capacities/rates are unchanged.

| Destination | Donor detail and adaptation |
| --- | --- |
| 254 Overload | 581 shooter cheeks, gearboxes, cross shafts, drum and hood; black finish, shortened depth/height, widened to the lane span. Existing blue sliding intake, sponsor hopper and load-dependent net retained. |
| 2910 Re•Blitz | Same 581 drum module with silver cut plates, fitted to its forward drum and existing conveyor/intake. |
| 3476 Sandspit | Same drum module inside the orange A-frame; clear enclosure and teal gussets retained. |
| 4414 RIPCURRENT | 604 ramp/chain/roller feed column shortened to the low turret; stationary support and moving cap/feed rollers separated. Compact 971 head fitted above it, teal plate finish and corner trusses. |
| 1323 MadTown | Shortened 604 column concentric with the floor rotor and blue turret at the chassis center; physical shot origins follow the central bearing. 971 head with blue cut plates. User photo matched with an upright lift frame, solid vertical blocking wall and horizontal slotted shot shield, replacing the diagonal flap. Shield, wall and upright support colliders follow deployment; its linkage travel remains an estimate from the still photo. |
| 1690 Kepler | One compact 971 head at the right corner opposite the intake, matching TBA photos; corner pedestal/deck, low adjacent walls and roof aperture clear its hood sweep. Fuel and physical shot origins follow the corner bearing, including saved picks. Existing exposed gear retained. Internal transmission still follows the donor, not an exact reconstruction of Kepler's beltless drive. |
| 5940 Croquembouche | Two independent cloned 971 left heads, each with a real hood pivot and drum; existing two feed lanes retained. Rear net roof clears the heads; fuel avoids the turret pods. |

Photo comparisons: TBA 2026 team media for [254](https://www.thebluealliance.com/team/254/2026), [2910](https://www.thebluealliance.com/team/2910/2026), [3476](https://www.thebluealliance.com/team/3476/2026), [4414](https://www.thebluealliance.com/team/4414/2026), [1323](https://www.thebluealliance.com/team/1323/2026), [1690](https://www.thebluealliance.com/team/1690/2026), and [5940](https://www.thebluealliance.com/team/5940/2026), saved in `refs/<team>-2026/sheet.jpg`. Mechanism references include [4414's binder](https://2026.team4414.com/), [254's Overload release](https://www.chiefdelphi.com/t/team-254-presents-overload/516252), and [1690's CAD release](https://www.chiefdelphi.com/t/frc-orbit-1690-2026-robot-cad-release/520673). Finish/layout fits are visual estimates from those references. 5940's current TBA sheet includes a later drum variant; this builder continues to depict its named double-turret variant.

Additional optimized donor files: `shooter-581-donor.glb` (shooter only; original hopper and reference triad omitted), and `rotor-604-donor.glb` (604 feed column, separated fixed frame, cap, infeed and upfeed). The loader resolves donor dependencies for single robot previews as well as matches. The detailed gallery includes these seven teams, while “Previous models” provides the lightweight comparison. Source assemblies and cached geometry remain independent of fitted clones.

Validation for this adaptation pass: 97 focused CAD/roster/mechanism-path/trench tests pass after the final changes, production typecheck/build pass, and gallery inspection covers both sides, low/high shots, full hoppers, piece flow, alliance colors and the previous-model comparison. The full suite finishes with 583 passes, 3 skips and the same pre-existing CRESCENDO difficulty failure (Hard 500 vs Normal 642); no new failure was introduced. These adaptations are local and available for gallery inspection.

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

## 2910 Re•Blitz — supplied Robot 2 assembly (2026)

The user-supplied `12 - Robot 2 Top Level Assembly.glb` replaces the photo-fitted 581 donor shooter for the existing `reblitz-2910` ID. Original CAD remains outside shipped assets. Source coordinates map `(Y,Z,X)` to simulator `(X,Y,Z)` in meters. Frame rails measure 0.6985 m length and 0.6858 m width; the compact roof reaches 0.5461 m, represented by a 0.55 m collision envelope. Only former default saved dimensions migrate; custom dimensions and existing 40-FUEL / 33-FUEL/s tuning remain subject to the normal legal limits.

Native geometry includes the hard containment roof, bent rear sheet, pocketed shooter supports, roller floor, pivoting intake, hood linkage and brass overspeed flywheel. Ordered groups are `hood` (`32-17`), `flywheel` (brass wheel), `intake` (Pivoting Intake Assembly), `hopper` (`62`), `feeder` (floor roller assemblies), and fixed `frame`. Simulator bumpers replace CAD bumper assemblies. Fasteners, bearing interiors, electrical detail and the static reference `Fuel` sphere are omitted. Lossless positions avoid distortion of the thin pocketed sheets; an additional bounded 0.5 mm reduction pass removes excess coplanar tessellation.

Measured robot-local joints: intake bearing `[-0.27305,0.1698625,0]`, hood bearing `[0.282575,0.4699,0]`, brass flywheel center `[0.2651125,0.3726602,-0.3309938]`. Deployed intake roller center `[-0.610318,0.160655,0]`; capture remains on the rear face. Native CAD drivetrain is retained, with visually fixed swerve modules. No climber is added.

The source supplies one extended pose. The 2.65 rad intake fold, 0.25 m hopper compression, hood angle mapping, flywheel speed and fuel transfer paths are fitted simulation estimates, not measured actuator travel. Hopper fill fits under the actual roof and along the extended containment. CAD-export mode preserves the transformed source pose; Previous models retains the lightweight procedural comparison.

Reproduce with `npm run cad:prepare -- /path/to/downloads reblitz-2910`. The generated report records exact counts, size, bounds and omitted occurrences. Tests cover decoding, bounded reduction, finite motion throughout forward/reverse deployment, stationary frame, intake floor clearance, saved settings, retained capacity/rate, and actual rear pickup versus shooter-side rejection.

Final asset: 89.65 MB / 4,603,004 triangles reduced to 6.68 MB / 487,204 triangles, with 964 occurrences omitted. Production build and 29 focused CAD/capacity/gameplay tests pass. Browser inspection covers source pose, stowed/deployed intake, both sides, low/high hood settings and full hopper; planar shading keeps the folded containment sheets readable.


## Public 2026 CAD batch: 6329, 1706, 7769, 1987, 9496

Next five 2026 teams by EPA with public Onshape releases (Spectrum CAD Collection). Each source GLB was exported from the public document, stays outside the repository, and is reduced with `npm run cad:prepare -- <dir> <id>`. All five export the deployed intake. Rigs live in `src/engine/robot/{roman,mirage,chunk,cyclone,matterhorn}CadModel.ts`; shared four-bar, net and clear-sheet helpers in `rebuiltCadKit.ts`. Each rig's header carries the "verify before you build" checklist (archetype, intake/scoring ends, colours, frame, capacity source). The preparer gained two generic per-spec hooks: `classify` (assign a part to a group, or omit it, from its path, name and bounds) and `finish` (replace a CAD swatch, e.g. clear or smoked polycarbonate). All five are trench robots (CAD top 0.548–0.557 m, collision box 0.55 m). Stock 2026 robots start without a climber; none of these changes that. Tests: `tests/rebuilt-cad-batch.test.ts`.

| ID | Source | Output | Groups |
| --- | --- | --- | --- |
| `roman-6329` | "6329-2026.2, Roman II - Public Release", 117.2 MB / 3,600,196 tris | 7.91 MB / 673,874 tris | frame, flywheel (drum), shooter-roller-0..3, floor-roller-0..5, intake (head), intake-roller-0/1, intake-drive-arm, intake-driven-arm, intake-dropdown |
| `mirage-1706` | "RB-MIRAGE" / "Mirage Public Release", 159.3 MB / 4,556,622 tris | 9.36 MB / 728,944 tris | frame, turret-left/right, wheels-left/right, flywheel-left/right, rotor-left/right, intake, intake-roller-0/1 |
| `chunk-7769` | "Full Robot" (assembly "Chunk"), 158.2 MB / 6,110,946 tris | 7.30 MB / 594,685 tris | frame, intake, intake-roller, kick-bar, flywheel, hood, feeder, climber |
| `cyclone-1987` | "2026_1987_Main", 161.1 MB / 5,205,786 tris | 8.56 MB / 705,922 tris | frame, turret, hood, flywheel, rotor, intake |
| `matterhorn-9496` | "9496_2026_LYNK_Matterhorn_Public", 104.1 MB / 4,608,258 tris | 8.15 MB / 692,381 tris | frame, flywheel (drum), feeder-roller-0..2, intake, intake-roller-0/1, hopper-ext |

### 6329 ROMAN II (`roman-6329`, existing ID)

Roman II is the team's fixed-drum rebuild of the turret Roman I, so the roster entry changes archetype: four-stream drum dumper, no turret, fixed hood (70° [EST]), 24 x 30 in frame. Saved picks of the old turret preset (turret, 47 FUEL, 14/s) migrate to the new defaults; custom configs are kept. Axes `yzx`. FUEL climbs a vertical feed column (cat-tongue rollers against a rolled plate) into the gap between the 4 in drum and two powered hood rollers and leaves over the front. The back intake is a long driven four-bar: drive arm on `(-.267,.2095)`, driven arm `(-.165,.254)`, coupler pins `(-.567,.444)` / `(-.461,.514)` measured from the Pivot Stub Shafts; the head is solved as a real four-bar (fixed assembly branch, so the pose depends only on the drive angle). Drum `(.2285,.4825)`, six sloped floor rollers and four shooter rollers spin about their own shafts. Finishes: the hopper side panels, front plate and deflector are clear (TBA photos), the net roof is drawn because fabric is not in the export. [EST] stow travel (drive arm -1.0 rad: head tucked above the hopper, inside the bumper line), the dropdown swing and the capacity (40, packed under the net).

Visual check against `refs/6329-2026/sheet.jpg`: drum end (clear front plate, purple brackets, black drum) and intake end (black curved arms up the sides, head high, roller row at bumper level when stowed) match.

### 1706 MIRAGE (`mirage-1706`, new)

Championship configuration: two turrets side by side, each with two 3 in shooter wheels at the front, 1 in rear accelerator wheels and a 5 in aluminium inertia flywheel, fed by its own spindexer floor (team CAD-release thread). Axes `xzy`. Turret rings `(.165,.33,±.2225)`; the two heads were exported at different yaws (left -0.4896, right -0.3437 rad, measured from the 1 in to 3 in wheel line), which each rig removes before applying the shared simulated aim. Spindexers `(-.0885,±.1775)`. The intake and the black-walled extension box slide out the back together; [EST] travel 0.30 m. Bumper parts and the low bumper-mount hardware in the chassis assembly are omitted. The climber was removed for Champs; the remaining telescoping tube only carries the Limelight. Roster: twin-turret mounts at ±.2225 m, 40 FUEL [EST] (what the physical stow bay holds at rest), 18/s alternating between the heads [EST].

Visual check against `refs/1706-2026/sheet.jpg` and `refs/cd-522276`: black walls, aluminium, blue turret rings and prints, two heads moving together.

### 7769 CHUNK (`chunk-7769`, existing ID, now CAD-backed)

Wide fixed shooter: 4 in Stealth wheels across the front, compliant-wheel feeder `(.106,.3175)` below, flywheel `(.2285,.4955)`. The "Adjust Hood" plates, hood plates, hood tube and the 32t plate sprockets ride on the flywheel shaft and are chain-driven from a Kraken X44, so the hood pivots about the flywheel axis; it rises for the shot (team: "up in shooting position") and drops for the TRENCH. The "Fixed Hood" guides stay with the frame. The intake rides out on racks with the moving hopper walls and a floor kick bar; [EST] travel 0.22 m (front back to the bumper line); while firing it shuffles (team's anti-jam). The L1 climb arm (vertical tube with a spear) rises 0.20 m [EST] when a TOWER climb is enabled; the stock robot keeps no climber. The team's "Limits" envelope assembly (max height / trench reference blocks) is omitted. Finishes: hopper side walls are smoked polycarbonate; APTIV/CHUNK decals are drawn because the CAD has no artwork. Frame 25 x 29 in; saved picks with the old generic 27 x 27 x 21 in box adopt it. Capacity stays 37 [EST] (team quotes "almost 70", which a non-expanding trench-height box cannot hold).

Visual check against `refs/7769-2026/sheet.jpg` and `refs/cd-521008`: blue Stealth wheels and prints, black smoked walls with white sponsor text, net roof.

### 1987 CYCLONE (`cyclone-1987`, new)

One turret on the axis of a "dye rotor" floor (spinning disc with a sweeper arm and a flex-wheel kicker up the centre column); the turret is held at the top by a fixed 1.5 in "cell tower" column, which stays with the frame together with the turret motor and chain. Axes `yzx`. Turret and rotor axis `(.038, ·, 0)` from the coaxial sprocket plates; 4 in urethane flywheel `(-.0655,.5015,-.0125)`; floating hood on a Thrifty cycloidal about `(-.0735,.5015)`, its 1 in rollers 0.20 m from the shaft (flywheel radius plus one FUEL), so the ball wraps over the wheel and leaves away from the turret axis: the export heading is -X, which the rig removes before applying the aim. The hood opens up to 0.35 rad for steeper shots [EST]. The intake and the hopper end wall run out the back on racks; [EST] travel 0.20 m. Finish: the end wall and its wings are clear polycarbonate (TBA photos); the clear side walls on the real robot are not in the export. Roster: turret at 0.038 m forward, 25 x 30 in frame, 35 FUEL (what the physical stow bay holds at rest) / 14/s [EST].

Visual check against `refs/1987-2026/sheet.jpg`: black turret head over the rotor bowl, clear end wall, aluminium frame.

### 9496 MATTERHORN (`matterhorn-9496`, new)

Fixed full-width drum with brass inertia flywheels on its ends `(.127,.454)`, three-roller vertical feeder at x 0.158 (y .28 / .334 / .388) in front of it, and three printed shot guides at the front. Axes `yzx`. "Intake V2" pivots on a sector "Pivot Gear" driven by an 11t pinion in the hopper floor; the slotted hopper panels and end panel telescope out with it. [EST] intake pivot `(-.38,.20)` from the gear layout, stow angle 1.75 rad (head folds up inside the bumpers), telescope travel 0.24 m. Finish: the drum is black between the brass flywheels (TBA photo). Net roof drawn. Roster: 27 x 27 in, three-stream dumper, 40 FUEL (what the physical stow bay holds at rest) / 15/s [EST].

Visual check against `refs/9496-2026/sheet.jpg`: dark slatted shot guides with orange edges at the shooter end, net roof, black drum with brass ends.

All five keep the unanimated CAD-export view (no pose is applied while animation is off), have procedural fallbacks registered with `registerRobotModel`, and collect only through the rear mouth in `HeadlessSim`.

## Supplied 2024 CRESCENDO batch

Existing IDs `doppler-1690`, `typhoon-2910` and `twister-118` are preserved. Gold RUSH (`gold-rush-27`) and Domotron (`domotron-604`) are new 2024 roster entries. Their speeds and climb timing are explicitly simulator estimates. All five load in the workshop, menu previews and playable browser simulator, with independent procedural fallbacks.

| Team | User source | Runtime axes | Asset MB | Triangles |
| --- | --- | --- | ---: | ---: |
| 1690 Doppler | `1690-24-0000-manufacture v1 closed.SLDASM.glb` | `(Y,Z,X)` | 3.73 | 543,329 |
| 2910 Typhoon | `11 - 2024 Robot.glb` | `(Y,Z,X)` | 4.78 | 730,063 |
| 27 Gold RUSH | `0000_2024RobotTopLevelAssembly.STEP` | `(-Z,Y,X)` after STEP tessellation | 8.20 | 503,950 |
| 118 Twister | `robonauts-118-2024-robot-twister-1.snapshot.2.zip` → `00_0000_2024_top_robot_asm_asm.stp` | `(-Z,Y,X)` after STEP tessellation | 10.60 | 741,238 |
| 604 Domotron | `2024 FRC604.glb` | `(-Y,Z,-X)` | 18.53 | 1,179,020 |

Source files remain untouched. STEP imports use `tools/prepare-step-cad.py` with OCP/XCAF to retain assemblies, source units and available colors. Converted inputs are `rush-27-source.glb` and `twister-118-source.glb`; run the shared preparer against their directory. The 604 model retains more thin structural geometry and uses a 20 MB asset budget. New conversions avoid position quantization.

Rigid groups preserve the frame, shooter, intake, turret/feeder, elevator carriage, AMP mechanism, climber and skis where present. RUSH's hook carriage is separated from its fixed gearbox and uprights. Generic simulator bumpers replace exported bumpers. Internal bearings, fasteners and selected electronics are omitted; visible rails, shafts, plates and rollers remain.

Measured simulator-local joints (meters): Typhoon turret `[.1397,.1524,0]`, pitch `[-.11315,.2742,0]`; Doppler rear conveyor axis `[-.2422,.1027,0]`; Twister turret `[0,.28085,0]`, pitch `[-.1651,.4223,0]`; RUSH shooter `[.28745,.48165,0]`; Domotron carriage/pitch `[.12225,.24155,0]`. Actual actuator travel, hood reference offsets, AMP travel and climber linkages remain fitted visual approximations. The source export pose is preserved independently of those animations. NOTE storage/feed anchors follow the corresponding mechanism; existing shot ballistics remain unchanged.

RUSH's STEP has a uniform pale manufacturing swatch. Its gold cut structure, black rubber/motor finishes and brass flywheels are fitted to the TBA competition photo and [Team RUSH reveal](https://www.chiefdelphi.com/t/frc-27-team-rush-robot-reveal-2024/456331). Twister's orange structural CAD swatch receives gold anodizing from its included competition photo. Orbit's cut plates/covers and white CAD roller swatches receive black competition finishes using the user's two photographs. The source model is the closed pose: it should look flat when stowed. The orientation correction applies to complete occurrence transforms, preventing the displaced and below-floor components seen during the initial import. CAD-export bounds are checked against the decoded asset report to prevent recurrence.

References: user-supplied CAD and photos; local TBA contact sheets under `refs/<team>-2024/`; [Orbit reveal](https://www.chiefdelphi.com/t/orbit-1690-presents-2024-robot-reveal-doppler/455350), [2910's CAD/binder release](https://www.chiefdelphi.com/t/2910-cad-code-and-tech-binder-release-2024/467192), Twister's included `twister24.PNG`, and [604's Domotron identification](https://604robotics.com/wordpress/new604/).


Validation for the 2024 batch: 86 affected CAD, roster and CRESCENDO scoring tests pass, including decoded export/report bounds, mechanism sweeps, fixed-frame stability and NOTE paths. The final five CAD tests and production build pass after the finish corrections; `git diff --check` passes. Browser checks cover all five in export, aiming and reverse-side endgame poses. The broader run records 610 passing tests and the known CRESCENDO Hard-versus-Normal failure (499 vs 644); an early CAD test run before assets existed was superseded by the successful focused run. Screenshot: `/tmp/2024-cad-final.jpg`. Changes are local; no push or deployment was requested.


## Public Onshape 2024 CRESCENDO batch (next five by EPA)

Five public team documents, exported as GLB through the Onshape API (Z-up, meters) and reduced with
`npm run cad:prepare -- <dir> <id>`. Joint origins come from each document's mates (assembly API,
`includeMateFeatures`), mapped through the occurrence transforms; 3467's document refused the assembly API (403), so its
pivot is the arm shaft's centre. None of these teams had a 2024 roster entry; all five are new `moreCrescendoTeamRobots`
entries with procedural fallbacks (`registerRobotModel`). Specs use the new `classify({full,name,bounds,group})` hook in
`tools/prepare-robot-cad.mjs` to split sub-assemblies by part name or position, `offsetZ`, and an opt-in `finalPass`
(the bounded 0.5 mm pass 2910 already used) to stay near the size budget. Bumpers are omitted (2024 rule) and drawn by the
simulator.

| Team | Onshape source | Runtime axes | Asset MB | Triangles |
| --- | --- | --- | ---: | ---: |
| 1678 Nik | [1678 2024 "Epsilon"](https://cad.onshape.com/documents/05760c4d8b40fba37db8fa48/w/f31b499c519e8471cced93dc/e/b53dde24ab8b46d679af9944) | `(Y,Z,X)`, +25.4 mm floor | 9.35 | 600,537 |
| 1706 Riot | [CR-000-00](https://cad.onshape.com/documents/a41c17fdc034d46f856ebcc7/w/934e52886a6f6873c4be7558/e/a351f37bcb33c52e479db756) | `(-Y,Z,-X)` + (-.1555, .0025, -.2735) | 8.24 | 529,211 |
| 3005 Surge | [3005 2024: FULL ROBOT (PUBLIC)](https://cad.onshape.com/documents/f1c0c9ce2309b0be3a22a379/w/c8169ca8774f2b499875ab45/e/b1639093afdfd702347929f0) | `(Y,Z,X)` | 11.14 | 718,867 |
| 3847 Ultraviolet | [2024 Ultraviolet](https://cad.onshape.com/documents/b6dec321d434a78b0c8b1f4a/w/e95933a4dd5ad878cfc66b01/e/273aa0ab00603937671346c1) | `(-Y,Z,-X)` + (0, 0, .006) | 8.51 | 566,901 |
| 3467 Nocturne | [Nocturne - 2024](https://cad.onshape.com/documents/2fc7c67cf0caa47d6fd88b44/w/50f8171b9e5f18a6a9f1f1d8/e/6bf3af59f010e7afe9e0d482) | `(Y,Z,X)` + (-.128, .003, 0) | 10.64 | 726,148 |

Rig files carry the CLAUDE.md checklist (archetype, intake/scoring ends, colours, capacity and sources) in their header:
`nik1678CadModel.ts`, `riot1706CadModel.ts`, `surge3005CadModel.ts`, `ultraviolet3847CadModel.ts`, `nocturne3467CadModel.ts`.
All five keep the unanimated CAD-export pose (bounds checked against the report) and the 2024 `climb` convention
(1 = deployed/reaching, 0.25 = pulled in).

### 1678 Nik (`nik-1678`)
The public assembly is named "Epsilon"; 1678's C2024-Public README calls the 2024 robot Nik and the code's
`isEpsilon` switch selects this robot's 15 deg intake deploy. Groups: `intake` (E-0800 below the frame line), `shooter`
(E-1000), `amp` (E-0900 carriage plates, roller head and its bearing blocks), `climber` (P-1108..1121 arms),
`climber-strut`/`climber-rod` (gas springs), frame. Joints (sim m): shooter pivot `[.0248,.189]` (root Revolute 1),
intake hinge `[-.2969,.16]`, climber arms `[-.0687,.4461]`, AMP slide along `(-.342,.94)`. Code limits: hood 15-62 deg
(CAD at 15), intake stow 128.1 / deploy 15 deg (CAD deployed), elevator 0 / 0.303 AMP / 0.42 TRAP at 1 m/s. The export
elevator extension (0.42 m) and the folded climber-arm angle (-0.95 rad) are [EST]; gas-spring struts re-aim at the arm
attachment and the rod slides along the strut. The CANdle LED and the bumper shells (Part 14/15) are omitted.

### 1706 Riot (`riot-1706`)
Groups: `shooter` (CR200, rack-and-pinion pivot `[-.0941,.2533]`, CAD exit 8 deg), `elevator-stage` (CR600 inner
stage), `carriage` (CR800, Slider 2 axis `(-.276,.961)`), `climber`/`climber-mid` (TTB 2-stage telescopes, split by tube
size). The floor roller train runs from the front bumper (squish wheels at x +.29) to the rear (indexer wheels at x -.28),
so the roster entry sets `dualSideIntake`. The team's code release confirms the elevator TRAP ("hold Y to put the elevator
at max height after the driver climbed"); AMP 0.30 m / TRAP 0.55 m carriage travel and the 0.45 m climber stroke are [EST]
from rail and tube overlaps. Bumpers (CR-900) and Limelights are omitted.

### 3005 Surge (`surge-3005`)
Reveal: "under-the-bumper, double-sided intake", "pivoting launcher with a diverter to allow for amp and speaker shots",
"single telescoping climber" ([Chief Delphi](https://www.chiefdelphi.com/t/456489)). Groups: `shooter` (3: Launcher plus
the diverter's side links that ride its pivot shaft, pivot `[-.2222,.3302]`, CAD 18.4 deg), `diverter` (5: Diverter head,
nose pivot `[.2685,.4983]`, child of the launcher), `climber`/`climber-mid` (7: Telescoping Climber, axis
`(0,.994,-.108)`). The grey appearance swatch on the launcher plates is recoloured black (the team: plates are SRPP, not
carbon fibre). Launcher range 10-60 deg, AMP pose 55 deg, diverter swing -1.6 rad and 0.45 m climb stroke are [EST]; the
lead-screw drive stays fixed. Roster: `dualSideIntake`, chain climb without TRAP.

### 3847 Ultraviolet (`ultraviolet-3847`)
Groups: `shooter` (Launcher, pivot `[0,.2604]`, 0 deg = horizontal = export pose), `amp` (AmpTrap inner rail, cross bar,
lower bearing blocks and the roller Tower on the 15 deg "Elevator Motion" slider `(-.259,.966)`), `climber` (5-01 slides on
Slider 1/2 `(-.748,.663)`). Spectrum's 2024-Ultraviolet code gives percent setpoints (pivot subwoofer 81 / intoAmp 78,
elevator amp 15 / trap 5 of 29.8 rotations, climber top 100 / bottom 0); the 72 deg full pivot travel, 0.45 m elevator
stroke and 0.35 m slide stroke behind those numbers are [EST]. The back under-bumper intake is fixed. No usable TBA photo
existed (both imgur links are gone), so the purple/silver finish is the CAD's own.

### 3467 Nocturne (`nocturne-3467`)
Groups: `arm` (arm tubes and chain hooks above the shaft) and `shooter` (the "Current" head, blower, harmony hooks and
the loose top-level head plates), both on one joint at `[.165,.5145]`; the front tower stays with the frame. The source
faces the shooter toward -Y, so the spec maps `(Y,Z,X)` to put the flywheel exit at +X and the under-bumper intake at -X.
Skip-5.14-Nocturne constants give arm setpoints in degrees from a stop 19 deg below horizontal (STOWED 0, SUBWOOFER 1,
PODIUM 23, WING 30, CLIMB 88, AMP 93, HARMONY 122); the CAD is at 78, and the exit (-26 deg in the CAD) gives a shot
elevation of 52 deg minus the arm angle. The hanging angle (30) is [EST]. No TRAP (team build blog). The field elements
in the document (SOURCE, AMP, stage), spare swerve modules and bumpers are omitted.

Verification: `npx tsc --noEmit`; `tests/crescendo-cad.test.ts` (decode, export bounds, sweep, fixed frame, floor
clearance, asset budget), `tests/crescendo-cad-imports.test.ts` (measured joints move the right parts, HeadlessSim pickup
from the real mouth and rejection at the shooter end, both faces for 1706/3005, saved-preset normalization),
`tests/team-robots.test.ts`, `tests/crescendo.test.ts`. Workshop screenshots (`/tools/robot-gallery.html?cad=1`) were
compared against the TBA sheets in `refs/<team>-2024/` in export, stowed, AMP, endgame and hang poses. The workshop
does not run the physics-loop shooter pitch, so aim poses were checked through the unit tests rather than screenshots.

### 2910 Spectre (2025 pivotvator)

Supplied `2025 2910glb` replaces the existing `spectre-2910` roster model, preserving its ID. Source coordinates map (-Y, Z, -X) to simulator (X, Y, Z). Optimized output is 8,153,356 bytes and 538,010 triangles from 234,970,028 bytes and 9,550,984 triangles. Bumpers, origin/reference solids, hidden fasteners and electrical detail are omitted; the real drivebase, brass ballast, fixed A-frame, gearbox, nested rails, powered wrist and cage gripper are retained.

Groups are fixed `frame`, `arm` (Phantom Stage 0), `elevator-stage` (Stage 1), `carriage` (Stage 2), `effector` (53 Intake & Wrist V3), and `climber` (41 Climber). Measured shoulder is `[-.26035,.32385,0]`; wrist shaft is `[.47110156,1.79530156,0]`. The source rail angle is 68 degrees and the source extension is fitted to the team's 40.5 inch maximum pose. Cascade translation is split equally between nested stages; the wrist rotates independently about its real shaft. Held CORAL crosses the tool on local Z. ALGAE uses the same tool, without simultaneous storage. The end effector itself collects from the front; front and rear scoring are supported in both CAD and fallback models.

References inspected: three TBA pit/match photos (including CORAL carry, ALGAE carry, and hanging), the [team reveal](https://www.chiefdelphi.com/t/2910-robot-reveal-2025-spectre/494648), the [team-authored Onshape explanation](https://www.onshape.com/en/blog/spectre-2025-first-world-championship-robot-built-in-cloud-native-cad), and [public ArmPoseConstants](https://github.com/FRCTeam2910/2025CompetitionRobot-Public/blob/main/src/main/java/org/frc2910/robot/constants/ArmPoseConstants.java). The public code specifies 110 degree climb collection, -5 degree pull-in, 3.25 inch lock extension, and 7.5 inch cage-carriage collection travel. The simulation interpolates these poses through its existing endgame/alignment/climb states; it does not simulate the team's actuator dynamics or motor-current cage detection. Intake/wrist aiming between the published poses and visual ALGAE compression remain fitted estimates.

## 2025 REEFSCAPE: next five by EPA (Spectrum CAD collection)

The next five 2025 teams by EPA with public Onshape CAD (5940, 422, 1706, 3005 and 190) are new roster entries
(`src/seasons/2025-reefscape/topEpaCadRobots.ts`). Each has its own rig file (`taiyakiCadModel.ts`, `wispCadModel.ts`,
`singularityCadModel.ts`, `relayCadModel.ts`, `redundancyCadModel.ts`) sharing the helpers in `reefscapeCadRig.ts`.
The headless simulator and no-asset runs use a light procedural fallback with the same layout. All five keep the unanimated
CAD-export mode. Source GLBs are the default Onshape GLB export (Z up, meters). Heavy specs use the bounded 0.5 mm `finePass`
reduction (lossless, no quantization). Unpublished rates (lift, cycle, harvest, climb, drive speed where not stated) are
simulator estimates. 3005 is the largest source (502 MB, 38 M triangles); it uses a 1 mm final pass and still lands at
12 MB, above the usual 10 MB budget but near 581's 11.2 MB.

| Team | Model ID | Source (public Onshape) | Optimized size | Triangles |
| --- | --- | --- | ---: | ---: |
| 5940 | `taiyaki-5940` | [5940 BREAD 2025 - Taiyaki](https://cad.onshape.com/documents/96a5f9f437337066b2987626/w/9644a0c5069d0349ab3cf5a6/e/01df3e1fb18f1f03077c9c5d) | 8.08 MB | 532,386 |
| 422 | `wisp-422` | [Wisp Public / Main Assembly](https://cad.onshape.com/documents/2bae4024a467119e47dc96b0/w/6c850cd2bf85d2162a5bb7d6/e/b4c78beff50beb69b98ad0b6) | 8.20 MB | 526,949 |
| 1706 | `singularity-1706` | [RS-000 Singularity - Public Release](https://cad.onshape.com/documents/4b02abefda59b1f999042049/w/bf40141578ddedca6b900af0/e/5e919c0d868af85f4440ce2a) | 9.66 MB | 617,642 |
| 3005 | `relay-3005` | [3005 2025: FULL ROBOT (PUBLIC)](https://cad.onshape.com/documents/be7ecb57773083221899273d/w/3ffbf14ecde31212fdcb4a6a/e/fe6648ecf44d2b65b2b452a4) | 12.00 MB | 764,011 |
| 190 | `redundancy-190` | [A-25B-0000 (V2 Redundancy)](https://frc190.onshape.com/documents/b6c840749d995b1ac1b29215/v/c2f65e25658d56c674449d2f/e/271cc80064eb69c77815f945) | 6.89 MB | 448,288 |

### 5940 BREAD Taiyaki

- Mapping `yzx` (source Y forward). Groups: `effector` (A-0500 End Effector, plus the pivot hub regrouped off the carriage), `carriage` (Stage 2), `elevator-stage` (Stage 1), `intake` (A-0300, minus its fixed deploy gearbox and side mounts), `climber` (only the spear/fly-swatter arm parts).
- Omitted: bumpers, electronics (Pi-Motel, PDH, Rio shroud, battery, cameras, CANrange, PCBs, connectors), the cable chain (exported extended to 1.65 m) and the reference CORAL.
- Joints (robot-local m): effector pivot `[.1905,.2476,-.0953]` (X-contact bearing), intake 48T deploy shaft `[-.3091,.3112,0]`, climber bushings `[.0254,.437,.3429]` (axis X). Two-stage cascade: stage 1 moves half the carriage travel (1.62 m max). Elevator + pivot IK puts the CORAL / ALGAE seats on the rules' placement point.
- The CAD pose has the intake deployed; it stows by folding up 1.9 rad and stays down through the conveyor handoff (the indexer carries floor CORAL forward to the fingers). The torsion-spring climber arm unfolds outward to +Z in the endgame.
- Estimates: CORAL seat against the finger-tip wheels, climber unfold angle, cycle and harvest times. References: binder and CAD release [CD 501347](https://www.chiefdelphi.com/t/501347), TBA match photos.

### 422 Mech Tech Dragons Wisp

- Mapping `yzx`. The elevator assembly is flat; parts are sorted into `elevator-stage` (2nd stage), `elevator-stage-2` (3rd stage) and `carriage` by name and by their nested side-tube spacing (|x| .197 / .165 / .133 / .10 m). `effector` = Manipulator Assembly (no wrist), `intake` = Ground Coral Mk2 arm (its side plates, motor and chain stay fixed), `climber` = L plates, hooks and reaction bar only.
- Omitted: bumpers, battery leads, cameras and mounts, radio case, energy chain and a retracted belt-run reference.
- Joints: ground arm shaft `[-.1956,.3023,0]` (deploys 2.0 rad over the back bumper, star wheels on the carpet, and flips CORAL up into the funnel during the fold handoff), climber bushings `[-.051,.4056,.337]` (axis X). Continuous elevator split 1/3, 2/3, 1 over 1.6 m.
- The linked technical binder ([CD 501340](https://www.chiefdelphi.com/t/501340)) was deleted, so behaviour comes from CAD, the reveal ([CD 497928](https://www.chiefdelphi.com/t/497928)) and TBA pit photos. Estimates: ALGAE seat, deploy and climber angles, all rates.

### 1706 Ratchet Rockers Singularity

- New `negative-x` mapping: source (-X, Z, Y) to robot (X, Y, Z), with `offsetX .3555` (the export origin is at a frame corner) and `offsetY .026` (wheel contact).
- Groups: `effector` (RS400 arm), `carriage` (RS-300), `elevator-stage` / `elevator-stage-2` (the flat RS-200 sorted by nested tube pairs at |y| .2032 / .1651; the fixed stage at .2413 stays in `frame`), `intake` (RS-500 front ALGAE roller on curved racks), `climber` (RS-600 harpoon).
- Omitted: bumpers, the reference ALGAE ball, battery, radio, signal light, loose wiring and an unnamed 1 m reference body (dropped with the new `drop` hook).
- Joints: arm shaft `[.0761,.3745,0]`, harpoon sprocket shaft `[-.3049,.4641,0]`, ALGAE rack pitch-circle centre `[.283,.69,0]` (888T at 20 DP = 0.564 m radius; the fixed pinion sits on this circle). The arm's narrow channel holds CORAL lengthwise (`coralAxis` along the channel) and the front stealth wheels hold ALGAE, so it carries one of each. Funnel-fed CORAL only. Floor ALGAE comes in at the front (`groundYaw 0`).
- Estimates: CORAL seat, rack retraction (0.7 rad), harpoon swing, three-stage cascade split and all rates. TBA has no 2025 photos; references are the teaser video frames ([CD 495400](https://www.chiefdelphi.com/t/495400)), the CAD/code release ([CD 510177](https://www.chiefdelphi.com/t/510177)) and the code README's subsystem list.

### 3005 RoboChargers Relay

- Mapping `negative-y` (source -Y forward; the chute is at +Y). Groups: `elevator-stage` (Stage 1), `elevator-stage-2` (Stage 2), `carriage` (Stage 3 + Laterator Base Stage), `effector` (laterator carriage + Coral Ejector), `algae` (Algae Gripper), `climber` (Climber Arm V2).
- Finishes: the CAD's pure-blue swatch (printed parts and plates) is recoloured near-black via the new `recolor` spec hook, matching the black robot in the TBA photo.
- Omitted: bumpers, the pink block-CAD wiring harnesses (`BLOCK CAD - ELECTRONICS`, `Wiring`) and the reference `Coral (Deployed)`, whose pose sets the CORAL seat and axis.
- Joints: ALGAE gripper sprocket `[.31,.406,0]` (stows up and back, swings 1.2 rad forward for ALGAE), climber sprocket `[.031,.459,.315]` (axis X, swings up and out over the right bumper). Three-stage chain elevator split 1/3, 2/3, 1 over 1.75 m.
- The laterator's sideways slide is not animated: the sim has no lateral-alignment state, so the ejector stays centred. Estimates: gripper and climber angles, ALGAE seat, all rates. References: reveal ([CD 493529](https://www.chiefdelphi.com/t/493529)), CAD release ([CD 504887](https://www.chiefdelphi.com/t/504887)), TBA match photo.

### 190 Gompei and the H.E.R.D. Redundancy (V2)

- Mapping `yzx`. Groups: `elevator-stage` (A-25B-2002), `carriage` (2003), `effector` ("Gustav", 4001), `algae` ("The Claw", 4002), `intake` (6000 roller assembly sliding out on its racks; only the camera mounts stay fixed), `climber` (5000 gas-spring arm and grappling hook above the gearbox).
- Omitted: origin cubes, battery, one-piece bumper.
- Joints: claw pivot shaft `[.133,.688,0]` (hangs at its floor pose, tilts 0.9 rad for REEF / NET ALGAE), climber shaft `[-.222,.133,0]` [EST], front roller slide 0.25 m [EST]. Two-stage elevator split 1/2, 1 over 1.5 m.
- The clapping funnel flaps are not animated. Estimates: CORAL seat in Gustav, claw ALGAE seat, roller travel and purpose (floor ALGAE, read from the CAD), climber pivot and swing, all rates. References: CAD release ([CD 503355](https://www.chiefdelphi.com/t/503355)), reveal ([CD 493653](https://www.chiefdelphi.com/t/493653)), TBA photos (V1 and V2).
