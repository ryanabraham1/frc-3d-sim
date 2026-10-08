# 6731 Multiclass — playable Hero Heist CAD

Select **WCP CADathon: Hero Heist → team 6731 · Multiclass** (Mailbox, row 49 of the [submission sheet](https://docs.google.com/spreadsheets/d/1puhGmcSgHVSIsmb2TWnyxC6fqbZaQrJXKUxNsb7Mt-s/edit?gid=0)).

Source: the Onshape assembly "main cadathon assembly" of [the team's document](https://cad.onshape.com/documents/44d79a4408847ce19d00f4f8/w/76e03ec9a527d1f1ec8b04f3/e/2c036c551c14893708853833) (the robot alone; the "robot on field" tab with the field is not used). The technical binder (`Mailbox 2025 WCP Cadathon Tech Binder 6731.pdf`) was not reachable, so everything below is read from the CAD or marked **[EST]**.

Read from the CAD: 25.5 in swerve frame; a rear over-bumper compliant-wheel floor intake with two stub feed rollers on an arm hinged on the 26.125 in hex shaft (pivot measured); a fixed front shooter, two 4 in flywheels in a hood assembly that pivots on the 3DP hood gear shaft, and three-inch feeder wheels (no turret, so the chassis aims); six SPEECH BUBBLEs modelled in the hopper; a STORY PANEL plate on the intake; no climber (sheet: Park).

Runtime: the six CAD bubbles are the held-piece display (`fill` shows 0–6, tinted to the alliance); the compliant roller is orange to mark the intake; the arm deploys when enabled (the exported pose is deployed; stow raises it over the frame, **[EST]** travel), rollers spin while intaking, the hood follows launch elevation, flywheel and feeder spin while shooting. Asset: `hero-multiclass-6731.glb`, 8.3 MB / 650k triangles, 290 omitted occurrences (bumper, origin cubes, hardware). Reproduce with `node tools/prepare-robot-cad.mjs <dir with hero-multiclass-6731-source.gltf> hero-multiclass-6731` after exporting the assembly as glTF (medium resolution) from Onshape.

Estimates: playing mass 105 lb, 4.5 m/s, 3 bubbles/s, 25°–70° hood range, muzzle at the flywheel exit (0.30 m ahead, 0.42 m high), intake travel. Simulation gap: the sheet lists 6 bubbles and 1 panel, which no class in the manual allows (Mystic 6 / 0, Gadgeteer 4 / 2); it is simulated as a Mystic, so the panel plate is visual only. Intake is floor-only (no station funnel).
