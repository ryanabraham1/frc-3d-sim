# 1540 Fireweed — playable Hero Heist CAD

Select **WCP CADathon: Hero Heist → team 1540 · Fireweed**. Gadgeteer class, per the [submission sheet](https://docs.google.com/spreadsheets/d/1puhGmcSgHVSIsmb2TWnyxC6fqbZaQrJXKUxNsb7Mt-s/edit?gid=0): four SPEECH BUBBLES, one STORY PANEL, HIGH climb.

Source: [Onshape MAIN ROBOT ASSEMBLY](https://cad.onshape.com/documents/13077706b3602fcaaebf812d/w/7f881b0a224dbb2d9b86c00c/e/2d469ff1cdaa4b77b0d18772) (exported through the Onshape API as glTF, Z up). Mechanisms follow the team's [tech binder](https://drive.google.com/file/d/1bBfcYraRpfNVjnXHx2lBZHuhb2iTAGC_/view) (29.5 in swerve, one-stage elevator with two hard stops about 10 in apart, double-jointed intake arm, four-bubble indexer, no turret, boat-hook vacuum climb for all levels in under two seconds) and the CAD. Drive speed, mass, feed rate and joint travel are simulator estimates [EST].

## What the CAD shows

| Mechanism | CAD evidence | Sim behaviour |
| --- | --- | --- |
| Floor intake (back, `-x`) | Double-jointed arm: joint 1 (bubble intake, Kraken X44, 7.5:1) pivots on the elevator carriage, joint 2 is the panel end effector with a split roller | Both joints fold over the frame when stowed and swing to the floor, 0.17 m past the bumper, while intaking. Orange roller bars mark both mouths |
| Elevator | One fixed stage and a pass-through carriage that carries the intake pivot; two hard-stop positions, just under 10 in | Carriage jumps between down and up (0.254 m) while a panel is being placed; a fork from the carriage carries the held STORY PANEL |
| Indexer | Single-file ramp between two plates 0.185 m apart (one bubble wide), sushi-roller bed, J-path to the shooter | Four bubbles drawn single file in the indexer, alliance colored, one per held piece. Plates are clear so they show from both sides |
| Shooter (front, `+x`) | 2 in and 3 in Stealth wheels (two Kraken X44), rack-and-pinion hood, servo arm that ejects opposite-alliance bubbles, no turret | Fixed shooter aimed by turning the chassis; wheels spin, hood tilts with the requested elevation |
| Climber | Bi-stable reeled composite tube ("boat hook") with a vacuum cup, plus a pneumatic vacuum arm | Tube lengthens and the cup rises 0.62 m [EST] to the TOWER; the cup is the climb contact point |

Coordinate mapping: source `(Y,Z,X)` → robot `(x,y,z)`; the CAD's shooter side is `+x`, the intake `-x`. The CAD frame is 27.5 in tube; the bumpers in the CAD measure 0.884 m outside, which, with the binder's 29.5 in, sets the 0.749 m frame.

## Simulation approximations

- The binder scores panels with the second arm joint, but the season's placement is front-only: the elevator carriage jumps up and the cradle follows the season's `placeAnim`; the arm itself stays folded then.
- The shooter is 0.10 m off the robot centerline in the CAD; shots leave from the centerline.
- Feed rate (3/s), top speed (4.5 m/s) and playing mass (110 lb) are estimates.
- Four-bar/pivot travel is fitted to the exported pose; the deployed (floor) pose is the CAD export pose.

Prepared asset: `public/models/robots/wcp-hero-heist/hero-fireweed-1540.glb` from `npm run cad:prepare -- <dir containing hero-1540-source.gltf> hero-fireweed-1540`. Gallery: `/tools/robot-gallery.html?season=wcp-hero-heist&cad`.

Validation: `tests/hero-fireweed.test.ts` (config, joint rig and held-bubble display, back-intake collection on both alliances).
