# 1923 Sentinel — playable Hero Heist CAD

Select **WCP CADathon: Hero Heist → team 1923 · Sentinel** (MidKnight Inventors' Gadgeteer; row 40 of the [submission sheet](https://docs.google.com/spreadsheets/d/1puhGmcSgHVSIsmb2TWnyxC6fqbZaQrJXKUxNsb7Mt-s/edit?gid=0): 3 bubbles, 1 panel, park only).

Source: [Onshape assembly "Full Robot Assy."](https://cad.onshape.com/documents/264bc1a68a1b98bb7580a604/w/71c614ca220467a6a0209fa9/e/67d0ee0989ec87adab4475b9), exported through the Onshape API as glTF (robot only; the field is a separate element and was not exported). Mechanism roles follow the team's [CADathon binder](https://docs.google.com/document/d/135EM1IFAZO8HmWg07CkjN1Mtu_gsU-PTukQik1T0J14/edit) (MK5N R3 Kraken swerve at 19.2 ft/s free speed; Pink Arm = 1-stage elevator on a dead MAXSpline pivot with a fixed-angle claw on two NEO 550s; FRC2910-2022-style mecanum slapdown intake; ball tunnel with a NEO Vortex flywheel and a Kraken-driven adjustable hood on a zombie axle). The binder gives no travel limits, angles or speeds.

## Mechanisms (CAD pose = intake deployed, panel arm folded back)

| Group | What the CAD shows | Simulator animation |
| --- | --- | --- |
| frame | 29 in square tube frame, four SDS MK5n swerve modules, electronics; battery, PDH, RSL and the molded 1923 bumper shell omitted (the sim draws alliance bumpers) | fixed |
| intake-arm | Slapdown roller arm at the back: four rows of 3 in compliant / 2 in flex wheels (orange here), mecanum wheels on the floor roller, 66T belts and a 32T plate sprocket on a hinge shaft driven by a Kraken + 88T belt | hinge at source (y .318, z .314); upright when stowed, laid to the carpet while intaking (stow angle is [EST]) |
| arm / arm-slide | "Pink Arm": 2x2 tube sliding in four elevator bearing blocks on a pivoting 2x1 carriage, chain/belt driven, claw with two 2.5 in compliant intake wheels and NEO 550s; pivots on the 32T sprocket / 35 mm bearing pair at the front tower | hinge at source (y -.286, z .320); claw follows the mailbox pose, the slide extends up to 0.20 m [EST], the held panel rides the claw |
| tunnel / flywheel / hood | Curved ball-tunnel bowl, three rows of 3 in flex feed rollers, a stack of four 4 in Stealth wheels (flywheel) at the front end, "Hood" plate above | flywheel spins about its CAD axis; the 80T-geared hood pivots on the same axle with the shot elevation |

Held SPEECH BUBBLES are drawn inside the tunnel from `RobotAnimState.fill` (three seats, shooter end first). The intake face is marked with orange rollers.

## Gameplay configuration

Gadgeteer, 29 in frame, 3 bubbles + 1 panel (sheet), preload 1 panel + 3 bubbles, ground intake on the back (`groundSide: 'back'`), no station funnel, forward shooter with adjustable hood, park only.

**Estimates** (not in the CAD): 5.0 m/s top speed (binder free speed 19.2 ft/s = 5.9 m/s, derated), 118 lb playing mass, 3 bubbles/s, 55 degree default launch angle (30-70 range), 0.30 m exit height, 0.70 m stowed height (intake upright), panel arm limited to the DOWNTOWN / UPTOWN slits (placement tier 1: the claw reaches about 0.8 m from its hinge, not enough for the low FOOTHILL baskets). Stow angle, arm extension and joint speeds are fitted to one CAD pose.

Reproduce with `node --max-old-space-size=14000 tools/prepare-robot-cad.mjs <dir containing hero-sentinel-1923-source.gltf> hero-sentinel-1923` (the 344 MB export needs a large heap). Gallery: `/tools/robot-gallery.html?season=wcp-hero-heist&cad`.

Output: 7.9 MB / 578,198 triangles (source 6.5 M), 506 omitted occurrences. Coordinate mapping `(-Y,Z,-X)` in meters.

Validation: `tests/hero-sentinel.test.ts` (legal Gadgeteer config, actual CAD decode with the frame fixed and finite joint sweeps, held-bubble and intake markers, back-only collection on both alliances in the Rapier loop, the real shooter scoring, panel placement into a DOWNTOWN slit), full test suite, typecheck and production build.
