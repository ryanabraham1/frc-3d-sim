# WCP CADathon: Hero Heist

Standalone game (id `wcp-hero-heist`, module `src/seasons/wcp-hero-heist/`). It is **not** an FRC season: menus and
lobbies show `WCP CADathon: Hero Heist` (`SeasonDefinition.label`); the `year` field (2025) is only the manual's date.
Build status, measurements and the work log live in [HERO-HEIST-IMPLEMENTATION-PLAN.md](HERO-HEIST-IMPLEMENTATION-PLAN.md).

## Sources

| Source | Use |
| --- | --- |
| `WCP Hero Heist 2025 Game Manual.pdf` (23 pp., no revision id, sha256 `92a36ed6…`) | Rules, scoring, classes, zones |
| `Copy of WCP Hero Heist Score Calculator.xlsx` | Aggregate score oracle (`calculatorScore`, 186-point fixture) |
| `Hero_Heist_Field.glb` (Onshape, sha256 `0dc5c215…`) | Visual field and every position/opening measurement |
| `game_pieces.glb` (sha256 `76d6ee1e…`) | STORY PANEL / SPEECH BUBBLE shapes |

`node tools/prepare-hero-heist-cad.mjs [dir]` rebuilds `public/assets/hero-heist/{field,bubble,panel}.glb` and
`cad-manifest.json` from the originals (removes the 40 staged piece copies, batches 10,045 primitives into 190, keeps
the 80 LED indicators and 8 FOOTHILL baskets addressable, and gives the polycarbonate a clear material).
`tools/hero-heist-cad.html` is a CAD inspector (`cad.look(eye, target)` in the console).

## Manual page map

| Pages | Content | Code |
| --- | --- | --- |
| 2-3 | Match periods: 15 AUTO + 100 TELEOP + 20 ENDGAME, then G03 settling | `config.ts` `TIMELINE`, `endgameSeconds: 20` |
| 4-5 | Score table, OWNERSHIP effects, tower points | `ownership.ts`, `scoring.ts` |
| 6-8 | FIELD, zones (TOWER, COLLECTOR, LAUNCH, HOME) | `geometry.ts` (CAD tape) |
| 9-10 | Pieces, staging, preloads | `pieces.ts`, `geometry.ts` `STAGED_*`, `rules.ts` `stage()` |
| 11-15 | DISTRICTS, MAILBOXES, CITY BLOCKS, TOWERS, DISTRIBUTION CENTERS | `geometry.ts`, `field.ts`, `rules.ts` |
| 16-17 | OWNERSHIP and the worked example | `ownership.ts`, test "worked example" |
| 18 | Hero classes | `constants.ts` `CLASS_LIMITS`, `legalPossession` |
| 19-22 | G01-G21, R01-R06 | `rules.ts` `enforce()` |
| 23 | Ranking points | `scoring.ts` `heroHeistResults` |

## Field (measured from the CAD)

Field coordinates are WPILib-style: `fx = cadX + 8.2296`, `fy = cadY + 4.1148`. BLUE plays from `x = 0`; the field is
**mirror** symmetric (`x → L − x`, same `y`). Blue's HOME ZONE is at the red end, next to the red-end FOOTHILL.

- **UPTOWN** (6, purple, far side): CITY BLOCK = a 20 in window in a 45° slope (z 1.52 → 1.92), diagonal MAILBOX slit
  in a 45° chamfer at z ≈ 0.87.
- **DOWNTOWN** (6, green, near side): CITY BLOCK = a horizontal 20 in hole in the top (z 1.07), horizontal MAILBOX
  slit at z 0.65.
- **FOOTHILLS** (4 + 4, orange WEST at the blue end, yellow EAST at the red end): a diagonal wall with two columns of
  square funnel holes (CITY BLOCKS, z 0.92-1.42 and 2.37-2.87) above top-fed baskets (MAILBOXES, rims 0.78 and 2.23 m).
- **TOWERS**: truss with 66 in underside at `fx` 4.115 / 12.345, three CLIMB PADS at `fy` 2.59 / 4.11 / 5.64.
- **DISTRIBUTION CENTER**: bubble chute slot in the SQUAD WALL (z 0.77-0.98) and a panel slide with three exit slots
  (z 0.65) behind the side guardrail beside the COLLECTOR ZONE.

Physics uses procedural boxes/prisms from these measurements (fast and robust; the CAD is the visual layer). Every
CITY BLOCK opening is physically open; misses bounce off the real walls.

## What is simulated vs assisted

| Interaction | How |
| --- | --- |
| SPEECH BUBBLE flight | Physical spheres from the robot's launcher; the exit sensor sits just behind each window (`inCityBlock`). Automatic targeting: chassis robots aim at the CITY BLOCK nearest their heading, turrets at the most valuable one in range; the target locks while the trigger is held. Drivers can also pick any CITY BLOCK by hand (`RobotCommand.aimTarget`); a turret then tracks it from anywhere, and impossible shots simply miss. |
| STORY PANEL delivery | **Assisted mechanism, physical judgement.** Hold G at a MAILBOX: the lift raises/extends for `placement.cycleSeconds`, then the panel is judged where the robot actually is. Within the slit tolerance (CAD slit 0.65 m vs 24 in panel → ≈1.4 in lateral, 4° yaw, leading edge 8 in into the slot within 18 in of the frame) the powered rollers take it; otherwise it hits the wall and drops to the carpet as a free body. A vision auto-align option squares the robot up with ≈0.45 in noise. |
| FOOTHILL baskets | Same mechanism, top-fed; the CAD basket visibly tips back after a delivery. |
| Returns / sorting | Scored pieces keep their identity and go to their color's DISTRIBUTION CENTER stock (the manual's "imaginary" sorter). |
| Human players | Physical: H rolls a bubble out of the chute slot, B slides a panel out of the slot nearest your robot; auto mode feeds robots waiting there with their intake on. |
| Climbing | Kinematic lift under a free CLIMB PAD to 4 / 35 / 45 in bottom clearance; points are judged from the actual elevation. |

## Rule interpretations (provisional, see plan §4)

- **D1** Panels may be delivered in AUTO (the table has no ban; panels never earn direct FAME).
- **D2** A panel into an opponent-supported strength-1 district neutralizes it with no overflow.
- **D3** Scoring follows the **piece color**; a robot is credited only for its own squad's color.
- **D4** AUTO FULL bonus: once per district per squad.
- **D5** FULL ownership also counts toward the "8 partial" RP history.
- **D6** G03: the sim always waits the 5 s settling period (no early "everything stopped" finalization). Pieces that
  pass a sensor after AUTO are priced as TELEOP.
- **D7** PARK = bumpers at least partly in your TOWER ZONE. Climb level is measured at the wheels (robot bottom).
  A climb is limited to the level that keeps the whole robot under 78 in (G18), so tall robots only reach LOW.
  G14 forced HIGH CLIMB and G18/G20 forfeits do not stack: a forfeit wins.
- **D8** G11 pins: 3-count, TECHNICAL FOUL every time (no first-minor escalation), recognized by the shared
  `PinTracker`.
- **D9** Illegal launches (G21) are fouls only; the bubble still counts if it scores.

Enforced automatically: G04 (AUTO contact across the CENTER LINE, off-sides robot), G11, G14 (all three zones, HIGH
CLIMB award), G18 (78 in in a TOWER ZONE), G20 (truss contact in the last 20 s), G21. Constrained by design: G01
(start area), G08 (18 in reach), G15 (intake refuses illegal possession), G16 (pieces only enter through the
DISTRIBUTION CENTERS), G21 panels (never launched). Not enforced (intent/judgement): G02, G05, G06, G07, G09, G10, G12,
G13, G17, R01-R06 beyond the class size limits.

## Simulation approximations

- Moving field elements: the FOOTHILL baskets tip back as an animation tied to delivery (not a physical hinge),
  the only element the manual describes as moving.
- STORY PANEL collider is a thin flat disc (the knob is visual); MAILBOX slits are closed colliders and panel entry is
  the assisted mechanism above.
- The weight limit maps to the simulator's playing mass with an `[EST]` +28 lb for bumpers and battery.
- Performance values (speeds, shooter rates, cycle times) are estimates, not manual facts.

## Robot archetypes (derived, not observed)

Six presets in `config.ts`, two per class: `gadgeteer-hybrid` (default; panel cradle + 3-ball feeder),
`gadgeteer-flex` (shared tool, 2 panels OR 4 bubbles), `commander-roller` (3-panel magazine, reaches every MAILBOX,
LOW climb only), `commander-simple` (station-fed single panel, slits only, HIGH climb), `mystic-turret` (6 balls,
turret) and `mystic-fixed` (4 balls, chassis aim, HIGH climb). MAILBOX reach comes from the CAD rim heights: slits ≤
1.2 m, low baskets need 55 in (GADGETEER and up), high baskets need 113 in (COMMANDER only).

## Controls

Default keys plus: Space launches a bubble, **,** / **.** pick the CITY BLOCK to shoot at by hand (any of the 20; **Z** = back to automatic, gamepad R3 = next), hold **G** to deliver a panel, **H** / **B** for the human player
(bubble / panel), **C** to climb under a CLIMB PAD, **X** to descend.

## Known limitations

- Robots use the generic robot model; archetype-specific 3D models are not built yet.
- The auto-planner (custom AUTO paths) offers only generic drive/intake/shoot steps for this game.
- Ranked play stays on REBUILT; Hero Heist is available for solo and casual multiplayer.
