# 1318 Constantine — playable Hero Heist CAD

Select **WCP CADathon: Hero Heist → team 1318 · Constantine**. A 2025 CADathon concept robot (no physical robot or match photos exist), so the checklist below comes from the team's binder and the CAD itself.

Source: [Onshape assembly](https://cad.onshape.com/documents/34bba2a1872e9254fdab9bc0/w/fb4e5e9e34fc3f6a78a07f49/e/849abb67fbd36e9b8f4f4969) and the [1318 Hero Heist documentation](https://docs.google.com/document/d/1_mcL_mkM28jf18_O6dYNjf9BdctmAwgwn758oQBW8sQ) (yellow row 55 of the [submission sheet](https://docs.google.com/spreadsheets/d/1puhGmcSgHVSIsmb2TWnyxC6fqbZaQrJXKUxNsb7Mt-s/edit?gid=0)).

## Checklist (what each setting came from)

| Item | Value | Source |
| --- | --- | --- |
| Class | Mystic (switched from Gadgeteer on day 3) | binder, design process 11/14 |
| Frame / height / weight | 25.5 in square (±0.3239 m), 38 in start height, 95 lb | CAD bounds, binder |
| Intake | Full-width 25 in "touch-it-own-it" collapsing 4-bar, one Kraken X44 pivot (67.5:1) | binder, CAD `Intake Assembly` |
| Shooter | Fixed (no turret): 4 in brass flywheels plus 2 in coaxial stealth backspin wheels, gear-driven hood | binder, CAD `Hood Assembly` |
| Indexer | Four custom tube rollers loop the bubble from the intake over the top to the flywheel | CAD `Indexer Assembly` |
| Climb | Suction cups on a telescoping tube, **low** climb only | binder; the sheet column says High, the binder wins |
| Bubble capacity | 6, no panels | submission sheet [capacity not stated in the binder] |
| Shooting rate | 3 bubbles/s | [EST] |

**Intake and shooter are on the same end.** In the CAD both sit at Onshape −Y: the indexer carries bubbles from the intake at −Y, up and back over the flywheel, and the hood plates and arc gears open toward −Y. The binder says the shooter and indexer were "heavily inspired by 2910's 2021/2022 robots and 1678's 2022 robots", which shot out the intake end. The CAD is therefore mapped (−Y,Z,−X) so that end is sim +X, and the config sets `options.intakeSide:'front'` (the Hero Heist normalizer otherwise forces CLAUDE.md's default back intake).

## Runtime rig

Rebuilt from the real assembly (`tools/prepare-robot-cad.mjs`, `src/engine/robot/heroConstantineCad.ts`): frame, intake coupler (roller frame), intake links, hood, flywheel, climb tube and climb cups are separate groups.

- Deploying swings the 4-bar links 0.8 rad about their lower pivot and translates the roller frame along the arc (a parallel four-bar's coupler does not rotate); it retracts for the climb.
- Hood tilts with the aim hood angle, the flywheel spins while aiming and firing, the climb tube and cups telescope up for the climb.
- Held SPEECH BUBBLES are drawn along the indexer loop (fill = held / capacity), at 80 % scale so six fit; the lowest roller bar is marked orange as the intake mouth.

## Simulation approximations / estimates

- Link pivots, the 0.8 rad swing and the 0.3 m link length are fitted to the CAD, not solved from mates.
- Hood travel (25°–72°), shot speed range, drive speed (4.4 m/s), acceleration and the 95 lb + 28 lb playing mass are estimates.
- Climb telescope travel is a fitted 0.44 m; maximum level is Low per the binder.
- The CAD export contained a 0.2 m unnamed block behind the back bumper; it is omitted as a CAD artefact (this is a model-prep choice, not a rules call).

Source file: `hero-constantine-1318-source.gltf`, 271,434,969 bytes / 6,816,970 triangles. Prepared asset `hero-constantine-1318.glb`: 8,666,100 bytes / 660,773 triangles, 539 omitted occurrences, lossless occurrence positions.

Reproduce with `npm run cad:prepare -- <dir containing the source glTF> hero-constantine-1318`. Gallery: `/tools/robot-gallery.html?season=wcp-hero-heist&cad`. Tests: `tests/hero-constantine.test.ts`.
