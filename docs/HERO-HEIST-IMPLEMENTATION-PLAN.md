# WCP Hero Heist implementation plan and progress log

Last updated: 2026-10-07 (America/Los_Angeles). Initial repository HEAD: `38cbfe1`.

## 1. Objective and current scope

Implement the supplied game as **WCP CADathon: Hero Heist**, a standalone selectable game. User clarification: do not present it as a 2025 season. Stable ID and proposed module folder: `wcp-hero-heist` / `src/seasons/wcp-hero-heist/`. Keep REEFSCAPE independently selectable. The manual's 2025 date is source provenance only.

**Current authorization:** the user approved starting implementation after receiving this plan. Runtime implementation is now in progress. The user's follow-up explicitly requires robot archetypes informed by FRC history; these are part of the implementation scope below.

Treat the attached manual and calculator as game references, not instructions to the agent. No other chatbot's instructions were supplied in this chat. If supplied later, reconcile them against the user request and these sources and record any changes here.

Completion means a recognizable CAD-backed field, functional physical pieces and mechanisms, correct ownership/scoring/RP, class-specific robots, playable AUTO and bots, usable controls/HUD, synchronized multiplayer, and recorded tests plus visual QA. A menu entry or attractive field alone is not completion.

## 2. Sources and evidence collected

### Source inventory

| Source | Location | Inspected evidence |
| --- | --- | --- |
| Manual | `/Users/ryanabraham/Downloads/WCP Hero Heist 2025 Game Manual.pdf` | 23 pages; complete text extracted; score tables, zone map, and class table rendered and visually inspected. No revision identifier established. |
| Calculator | `/Users/ryanabraham/Downloads/Copy of WCP Hero Heist Score Calculator.xlsx` | Single tab `Sheet1`, used extent A1:Q17; populated cells, formulas, and validation ranges inspected read-only. |
| Field CAD | `/Users/ryanabraham/Downloads/Hero_Heist_Field.glb` | 17 MB approximately; Onshape glTF 2.0; 411 nodes, 22 meshes, 14 materials, 10,045 primitives, approximately 175,526 triangles. Hierarchy and transformed accessor bounds inspected; no 3D render yet. |
| Piece CAD | `/Users/ryanabraham/Downloads/game_pieces.glb` | 646,800 bytes; two named roots, `Speech Bubble` and `Story Panel`; 2 meshes, 3 materials, 58 primitives, approximately 18,308 triangles. Bounds inspected; no 3D render yet. |
| Existing implementation guidance | `INSTRUCTIONS.md`, `docs/FRAMEWORK.md`, engine season contract and current season modules | Reviewed engine hooks, mixed-piece pool, scoring, clock, planner, network locations, and placement configuration. |

SHA-256 values already measured:

```text
Hero_Heist_Field.glb
0dc5c2150573ed3a7d13a42d265202b6317b5f71d47f2342729aa49dfd6a6894

WCP Hero Heist 2025 Game Manual.pdf
92a36ed687625a0bbb0bd4948142ccb3818f7e1684ad20766809ef0d02865327

game_pieces.glb
76d6ee1ea3ad58ab5814a20821d55cf4f55bb41d65ec2a96c5aac5989b9cdc0d

Copy of WCP Hero Heist Score Calculator.xlsx
96ead27d17a7d28f8c815e6b5bbc45393f07447f0feea078b94d162eb2025ded
```

Verify these checksums when copying sources in M0. Preserve originals. Source copying, runtime asset preparation, and any redistribution/license review remain future work.

### Manual page map (physical PDF page numbers)

| Pages | Content | Implementation use |
| --- | --- | --- |
| 1 | Cover and reference links | Source identity; optional later CAD reference |
| 2-3 | Summary and match periods | 3 vs 3; 135-second enabled match; AUTO/endgame timing |
| 4-5 | Score breakdown | Event points, ownership changes, AUTO bonus, tower values |
| 6-8 | Arena and zone diagram/definitions | Carpet size, exact CAD-measured zone polygons, protection |
| 9-10 | Pieces and staging | Dimensions, masses, counts, reserves, preloads |
| 11-13 | Districts and return system | 20 targets, mailbox geometry, city blocks, recycling |
| 14-15 | Towers and distribution centers | Climb pads, clearance, physical feeding slots |
| 16-17 | Ownership and worked example | Clamp behavior, score-before-transition, reversible score |
| 18 | Hero classes | Class constraints and conditional possession limits |
| 19-22 | G01-G21 and R01-R06 | Fouls, protected contact, legal launch and climb conditions |
| 23 | Tournament | RP and seeding statistics |

### Repository state at planning start

Existing unrelated edits were present: `.claude/launch.json`, `.gitignore`, `server/index.ts`, `server/vitePlugin.ts`, `src/engine/core/game.ts`, `src/engine/robot/robot.ts`, `src/engine/testing/headless.ts`, and `tests/scoring-readiness.test.ts`. Untracked work included `docs/MATCH-LOGS.md`, `server/matchLogs.ts`, `src/engine/telemetry/`, `supabase/match_logs.sql`, match logger tests, and training tools. Recheck status before implementation. Do not reset, absorb, or commit these changes as Hero Heist work.

No applicable `AGENTS.md` was found in this repository during initial inspection. Recheck if the checkout changes. Tests/build have **not** been run for this planning-only task; no current baseline success or failure is claimed.

## 3. Verified game model

### Field, periods, pieces

- Playable field: 54 ft long by 27 ft wide = **16.4592 x 8.2296 m**. Full CAD assembly bounds include external structures and must not define carpet dimensions.
- Enabled match: **135 seconds**: 15 AUTO, 100 ordinary TELEOP, 20 ENDGAME. The latter two share one 120-second teleop countdown. Add up to 5 seconds disabled settling under G03; scoring closes earlier if everything relevant comes to rest.
- Districts: **20**, comprising 6 Uptown, 6 Downtown, 4 West Foothills, 4 East Foothills. Every district has a mailbox, a nominal 20-inch square city-block opening, and four ownership indicators.
- Speech Bubbles: **60 total**, 30 per color; 7-inch diameter (radius 0.0889 m), approximately 5 oz (0.14175 kg). Initially 15 per color on the carpet in a 3 x 5 grid. Up to 3 per eligible robot can be preloaded, drawn from that color's remaining reserve.
- Story Panels: **24 total**, 12 per color; nominal 24-inch diameter, 0.5-inch panel thickness, 2.75 lb (1.24738 kg), plus a knob. Initially 5 per color alongside squad walls. Eligible robot preloads draw from remaining reserve.
- Speech Bubbles enter city blocks. Story Panels enter mailboxes; they are never launched. Uptown slots are diagonal, Downtown slots horizontal, Foothill slots top-fed and tilt to return panels. Powered rollers capture an inserted panel after approximately 8 inches of insertion.
- Scored pieces return through the imaginary color sorting/return system to human players. Simulate identity-preserving reserve transfers rather than rendering off-field sorting machinery or generating replacements.
- Towers: truss underside at 66 inches; three 24-inch-long climb pads per tower. Pads cover the bottom and two sides and leave the top open. Robots may contact only the three permitted external pad faces.
- The top-view diagram places Blue's HOME ZONE at the opposite end from its tower. Do not assume all blue protected zones are near the blue wall. Verify both colors from CAD and page 7.

### Ownership state and event order

Represent each district as `{support: red | blue | null, strength: 0..4}`. Canonicalize zero strength to null. Strength 1 has a supporting color but is still **neutral**; 2-3 is partially owned; 4 is fully owned. Never allow simultaneous red and blue ownership.

For every accepted piece, classify the district **before** processing the event, award its event points, then apply the ownership transition. Update the live ownership category from all current districts after the transition. Ownership is a current-state value, not accumulated points or points per second.

| Piece / pre-event target state relative to piece color | AUTO FAME | TELEOP/ENDGAME FAME | Ownership transition |
| --- | --- | --- | --- |
| Bubble into own partial/full district | 6 | 3 | No change |
| Bubble into neutral strength 0 or own strength 1 | 2 | 1 | Add 1 toward piece color |
| Bubble into opponent-supported neutral strength 1 | 2 | 1 | Remove that 1; reach neutral 0 without overflow |
| Bubble into opponent partial/full district | 0 | 0 | Reduce opponent strength by 1 |
| Panel into neutral or own partial district | 0 direct | 0 direct | Add 2 toward piece color, capped at 4; opponent-supported neutral case needs an explicit resolution below |
| Panel into opponent partial/full district | 0 direct | 0 direct | Reduce opponent strength by 4, clamped at 0; never transfer leftover strength |

Current partial districts are worth 10 each; current full districts are worth 25 each, replacing the partial value. First full ownership during AUTO earns a persistent 10-point bonus per district per squad, once only; loss/reacquisition must not farm this bonus. Confirm per-squad versus global first-acquisition interpretation before finalizing fixtures.

Manual example to encode as a fixture: blue strength 3 + red panels -> neutral 0 -> red 2 -> red 4. Live ownership score changes from blue 10 to zero, then red 10, then red 25. Repeated pieces cannot repeatedly score one sensor crossing.

### Calculator reconciliation

The supplied workbook is an **aggregate score calculator**, not a complete rules engine:

```text
Sheet1!E14 = F8*6 + F9*2 + F10*10
Sheet1!J14 = K8*3 + K9*1 + K11*10 + K12*25
Sheet1!O14 = P8*5 + P9*20 + P10*35 + P11*50
Sheet1!J2  = E14 + J14 + O14
```

F8/F9 are AUTO own-owned/neutral bubble counts; F10 is AUTO fully-owned district count. K8/K9 are teleop own-owned/neutral bubble counts; K11/K12 are final partial/full district counts. P8:P11 are park/low/medium/high counts. Translate “OWNED” as owned by the scored piece's squad, consistent with the manual, not any owned target.

Use these formulas as an independent aggregate oracle. They omit fouls, RP, possession, event timing, transitions, and special climb awards. Do not copy workbook validation as game rules: its decimal inputs and irregular validation ranges do not enforce legal counts.

Representative aggregate fixture: F8=3, F9=2, F10=1 -> AUTO 32; K8=5, K9=4, K11=2, K12=1 -> TELEOP 64; P8=1, P9=0, P10=1, P11=1 -> ENDGAME 90; base total **186**. Additional opposing minor/technical fouls contribute 25/50 separately.

### Class limits

| Limit | Commander | Mystic | Gadgeteer |
| --- | --- | --- | --- |
| Frame perimeter | 120 in | 104 in | 120 in |
| Robot weight limit | 125 lb | 100 lb | 100 lb |
| Starting height | 60 in | 42 in | 30 in |
| Normal deployed height | 120 in | 42 in | 60 in |
| Panel possession | 3 | 0 | 1 mixed; 2 if holding only panels |
| Bubble possession | 0 | 6 | 3 mixed; 4 if holding only bubbles |
| Maximum preload | 1 panel | 3 bubbles | 1 panel AND 3 bubbles |

Enforce Gadgeteer legality with a predicate over `(panels, bubbles)`, not one summed hopper capacity. Legal examples: (1,3), (2,0), (0,4). Illegal examples: (2,1), (1,4). Class cannot change during a match. Account for the simulator's “playing mass including bumpers/battery” convention before mapping the manual's weight limit; record any ambiguity rather than assuming they are equivalent.

Horizontal extension is limited to 18 inches beyond the frame. Tower-zone height is capped at 78 inches. In the final 20 seconds, every class may extend to 78 inches in its tower zone, subject to the pad/contact rules. Commander normal 120-inch reach must retract under the truss and cannot override tower-zone limits.

### Tower points and RP

- Park / low / medium / high: **5 / 20 / 35 / 50** per robot, mutually exclusive. Medium/high use 35/45-inch clearance from the floor, with only climb-pad contact. Define the exact robot reference point during geometry validation.
- Win / tie / loss: **3 / 1 / 0 RP**.
- All squad robots exit their tower zone during AUTO: +1 RP. Track complete-footprint exit per participant; do not grant this vacuously in an empty squad.
- Historical district bonus: +1 RP for partial ownership of 8 distinct districts OR full ownership of 5 distinct districts during the match. Use distinct-ID history, not final ownership or repeated recaptures; clarify whether a direct jump to full also satisfies “partial” history.
- At least 60 collective tower points: +1 RP. Normal maximum total is 6 RP per winning squad.
- Record tournament seeding statistics where meaningful: RP, full ownerships, endgame points, partial ownerships. WCP sticker count is not modeled; no tournament system is required just to play matches.

## 4. Decisions and ambiguities to resolve before dependent code

Record resolution, evidence, and affected tests here. Keep unaffected milestones moving. These are targeted rule questions, not a reason to stop asset inspection or pure scoring work.

| ID | Issue | Proposed approach / resolution gate |
| --- | --- | --- |
| D1 | Panels are omitted from the AUTO task list, but the ownership table is not period-restricted | Do not silently ban AUTO panels. Re-read source context; if still unspecified, document a provisional allowance with no direct FAME and ask the user only if required to settle intended behavior. |
| D2 | Panel into neutral strength 1 supporting the opposite squad | The bubble row describes this case explicitly; the panel row does not. Resolve before implementing that transition. Do not use a signed value that silently overflows opponent ownership into own ownership. |
| D3 | Handling opponent-colored pieces and credit | Separate physical piece color from carrying/launching robot's alliance. Define pickup permissions from explicit rules; do not invent a prohibition. Default scoring belongs to the piece color; account for cross-alliance player credit without breaking totals. |
| D4 | AUTO full bonus: once globally per district or once per squad per district | Proposed per-squad distinct set; label the interpretation and test reacquisition by both squads. |
| D5 | RP partial/full distinct history | Proposed at-least-partial set includes full ownership; exact-level events are separately recorded. Confirm source interpretation and expose counters. |
| D6 | G03 settle timing and event phase | Preserve AUTO/TELEOP value at a documented scoring boundary; never price late AUTO pieces as AUTO merely because launched then. Define disabled-period scoring behavior, robot freeze time, “at rest” tolerance, and final tower assessment; test both timeout and early-settle paths. |
| D7 | Climb height, park inclusion, pad allocation, G14 award interaction | Use CAD-measured pads and footprint-based zones. Clarify clearance reference; ensure G14 forced high award does not stack with actual climb or bypass G18/G20 disqualification without a recorded policy. |
| D8 | Pin reset, repeat penalties, and intent-based DQ | G11 specifies 3 seconds and TECHNICAL FOUL. Reuse pin recognition, but do not inherit the other seasons' first-minor/escalation or unmentioned 6-ft reset as manual fact. Document any reset approximation. DQ based on intent stays referee/manual territory; preserve the existing preference against robot gameplay lockout. |
| D9 | Illegal launch and illegal contact scoring consequences | Issue stated fouls; do not add an unstated score cancellation. Define sensor processing independently from legality, except where the manual explicitly removes tower points. |

## 5. Implementation architecture

### Season-local modules

| Proposed file | Responsibility |
| --- | --- |
| `constants.ts` | Sourced dimensions, class limits, periods, scoring values, district IDs and measured poses, polygons; `[MANUAL pN]`, `[CAD]`, `[EST]` provenance |
| `config.ts` | Declared class, defaults, presets/options, class-aware normalization, preload schema, starting spots, camera poses |
| `ownership.ts` | Pure district transitions, historical sets, AUTO bonus and event-order rules |
| `scoring.ts` | Pure score/RP/tower calculations, calculator fixtures, results categories |
| `field.ts` / `fieldCad.ts` | Optimized CAD visual loading and measured simple colliders; target sensors; ownership LED references |
| `pieces.ts` / `staging.ts` | Stable piece metadata/index ranges, CAD visuals, conservation, preloads and reserve queues |
| `mechanisms.ts` / `robotModels.ts` | Bubble firing, panel transfer/orientation, visible class-specific mechanisms and climb motion |
| `rules.ts` | SeasonRules orchestration, contacts/zones, scoring sensors, climb legality, human players, net state |
| `autopilot.ts` / `bots.ts` | Real commands for AUTO and class-aware match strategies, routes and target selection |
| `hud.ts` | Ownership overview, class and inventory, legal target/launch feedback, RP and tower status |
| `index.ts` | SeasonDefinition registration metadata, testing hooks, controls and menu rules |

### Reuse and narrow engine adaptations

- Existing `SeasonDefinition` / `SeasonRules` hooks support season-owned intake and mechanisms. Use `handlesIntake` + `handleMechanisms` rather than forcing panels through the generic shooter.
- `GamePieceSpec.variants` supports stable ranges in one synchronized pool. Proposed ranges: red bubbles 0-29, blue bubbles 30-59, red panels 60-71, blue panels 72-83. Metadata must be explicit and immutable; color/type cannot depend on the current carrier or inferred mesh color.
- The pool supports spheres, tubes, and rings, **not the supplied three-spoke panel with a knob or arbitrary imported render geometry**. Add an optional compound-panel/custom visual facility, or a season adapter using existing pool bodies. Preserve pose interpolation, instance hiding, replica mode, collision groups, disposal, and stable indices. Do not substitute a bare NOTE torus for its spokes and knob.
- CAD visual inspection corrected the initial solid-disc assumption: the supplied Story Panel is an open ring with three radial spokes and a central knob. Use the supplied visuals and preferably compound rim/spoke/knob colliders. A thin solid-disc collision approximation, if needed for stable handling, must be explicitly documented and tested against the actual slots. Center its pose on the panel thickness, not the knob-inclusive bounds.
- Typed inventory and typed preloads need season-level data and validation. Generic `hopperCapacity`/`preload` alone cannot represent Gadgeteer's conditional limits or simultaneous panel+bubble preload. Reuse options/hooks only where serialization remains clear and reliable.
- `Scoreboard.set` can overwrite live ownership values. Persist bubble event scores and AUTO bonuses separately. Keep contested ownership alliance-level/uncredited unless a reversible attribution policy is explicitly designed; never permanently credit disappearing ownership to a robot.
- Existing `MatchClock` accepts configurable disabled periods, but `Game.step` calls results immediately at clock completion. Implement G03 using a settle period and a narrowly scoped optional early-finalization hook if needed; inspect final-step ordering before freezing results.
- `src/engine/core/game.ts` currently sets `climbReady` with `driveRemaining <= 30`. Introduce an optional season endgame/climb-ready threshold defaulting to existing behavior; Hero Heist uses 20. Audit input, HUD, headless, and bot gating too.
- `src/engine/ai/autoPlan.ts` and `src/app/autoPlanner.ts` branch on `season.year === 2025` for reef targets, actions, obstacles, and cleanup. **Hero Heist must not take these paths.** Introduce explicit optional planner capabilities/target hooks, with existing season fallback; include standalone-game regression tests.
- The season contract currently requires numeric `year`. Add optional standalone-game display/category metadata and adapt labels/sorting as needed, or a narrowly scoped game identity abstraction. Keep any internal provenance year separate from user-facing identity and capability selection. Do not invent a competition year or use a fake year merely to evade planner branches. Audit all `season.year` consumers before choosing the smallest compatible implementation.
- Reuse `src/engine/match/pinning.ts` and `referee.ts` only after separating Hero Heist's technical-first pin penalty and its manual-specific policy from existing FRC defaults.
- Use `src/engine/net/protocol.ts`, `hostSync.ts`, and `clientSync.ts` as the synchronization boundary. Host applies rules; replicas apply serialized state and render. Do not run ownership mutations on clients.
- Audit season lists and IDs in lobby, saved settings, match logs, ranked pool, and any server validation. Casual multiplayer is required; competitive ranked inclusion is a separate decision, not implied by a registry entry.
- Keep engine changes optional and default-preserving; document them in `docs/FRAMEWORK.md`. Recheck current source before each edit because this is a shared, dirty checkout.

## 6. CAD preparation and physical interaction strategy

### Important findings from the supplied assets

- Field bounds are approximately `[-11.3284,-7.2136,-0.03175]` to `[11.3284,7.2136,3.0480]` in exported coordinates, including outside-field structures. Z is the candidate vertical axis; verify visually and against the carpet/truss before applying a transform. glTF conventions alone are insufficient for this Onshape export.
- Piece CAD's bubble is offset: bounds X approximately 0.4191..0.5969 m, centered near **0.508 m**, not origin. Split and recenter roots; otherwise held pieces and launch exits will be visibly wrong.
- Panel bounds are approximately +/-0.304765 m in X/Y and 0..0.0635 m in Z. Its **2.5-inch overall height includes the knob**, while the manual's 0.5-inch value describes panel thickness. Do not use 2.5 inches as uniform disc thickness.
- Field nodes already include **30 staged bubbles and 10 staged panels**, matching floor counts. Remove these visual copies and instantiate the actual conserved pool at measured poses. Otherwise pieces appear twice and static CAD copies cannot be collected.
- The field contains **80 ownership-light nodes** and **16 generic April tag nodes**. Preserve useful visual anchors. Tags are identical “APRIL” placeholders according to the manual, not an official WPILib pose/ID map; do not import the official 2025 REEFSCAPE tag layout.
- Ten thousand primitives are a draw-call risk even though many meshes repeat. Batch material-compatible static geometry, instance repeated structures, and keep LED components independently addressable. Capture actual post-load draw calls and timings before deciding further simplification.

### Preparation sequence

1. Create `tools/prepare-hero-heist-cad.mjs` and a reproducible metadata manifest. Reuse existing glTF-transform dependencies. Keep raw supplied files unchanged and record checksums, transform, units, bounds, and outputs.
2. Render raw field overhead, from both driver ends, and close to every district family, station, and tower. Match page 7 zone positions and manual dimensions. Separate carpet frame from whole-assembly bounds.
3. Apply one explicit CAD-to-field/world mapping. Measure the carpet rectangle, tower lines, all target opening centers/normals/depths, station exits, start poses, and taped polygons. Assign stable district IDs by region plus ordered index; never use traversal order as gameplay ID.
4. Preserve silhouettes, wall openings, slot slopes, tower/pad geometry, tape colors, and field colors. Remove invisible fasteners or excessive subdivision only after before/after renders. Separate staged piece copies, indicators, and moving Foothill mailbox parts from static batching.
5. Export optimized visuals under `public/assets/hero-heist/` with a manifest. Confirm repo asset conventions before choosing raw-source storage; do not introduce large duplicates casually.
6. Build simplified fixed colliders around goal openings, rails, supports, and stations. Use compound convex shapes for moving mailbox parts. Avoid a single concave full-field mesh collider that seals slots or catches wheels.
7. Match every sensor to the actual passage **exit**, with swept crossing/direction checks, per-piece latch, and reset after return. Nearness or entering a front bounding box alone must not score.
8. Check robot travel lanes through each tower at legal loaded heights; verify panel clearance in all three mailbox families and real bubble flight into all 20 city blocks.

### Physical versus assisted decisions

| Interaction | Intended implementation | Acceptance condition |
| --- | --- | --- |
| Bubble flight | Physical sphere from actual shooter exit with real robot velocity, aim and collisions | Legal shots traverse openings; walls block misses; no target-distance point grants |
| Panel pickup/transport | Visible gripper/roller transfer with typed inventory and optional holding constraints | Piece travels through attached mechanism; class limits and pickup capability apply |
| Panel placement | Physical oriented release at slot; modeled roller capture after valid insertion | Wrong angle/height/reach can miss; no remote teleport scoring |
| Roller pulling/return | Assisted powered feed after measured slot insertion, followed by reserve transfer | Assistance activates only at verified slot engagement; same piece ID returns |
| Foothill tilt | Hinged/dynamic or constrained animated capture mechanism coupled to sensor state | Panel visibly falls through the return passage, without double scoring |
| Tower climb | Assisted pad-constrained climb unless actual hook dynamics prove stable | Visible attachment, legal clearance/contact, realistic elapsed climb time, descent and failures |
| Off-field color sorting | Abstract reserve queue, as the manual explicitly imagines sorting | Stock conserved by type/color and feed appears at real slots |

Any necessary approximation must be recorded in `docs/HERO-HEIST.md` and summarized clearly in the game's rules UI. It must not silently change points, capacity, zone legality, or ownership.

## 7. FRC-history-informed robot archetypes

These are **derived designs for this CADathon**, not claimed real team robots. Historical mechanisms are design analogies, not proof of Hero Heist cycle times or competitive balance. Build all three declared classes, with two contrasting presets per class. Keep mechanisms recognizable and animate complete moving assemblies.

| Proposed preset | Class | FRC mechanism inspiration | Game mechanism and legal capacity | Trade-off / intended role |
| --- | --- | --- | --- | --- |
| `commander-roller` | Commander | 2019 hatch-panel acquisition; 2025 compact placement elevators | Floor/station panel roller pickup, vertical magazine of 3 panels, elevator/wrist to orient into three mailbox families; 1 panel preload; no bubbles | Reliable ownership acquisition/stripping; large magazine and reach cost space and cycle time. Medium climb option. |
| `commander-simple` | Commander | Simple hatch-panel and fixed-height placement builds | Station-fed single-panel gripper, short lift and wrist; only reachable mailboxes; 1 panel preload; no bubbles | Lower complexity and fast local delivery; lacks broad target reach and ground pickup. Park/low climb option. |
| `mystic-turret` | Mystic | 2020/2022 ball hopper, turret, hood and flywheel systems | Ground/station bubble intake, indexed 6-ball hopper, turret and adjustable hood; 3 bubble preload; no panels | Strong repeatable own-district FAME; aim-on-move potential with measured error. Shooter/hopper/climber must fit 42-inch height and 104-inch perimeter. |
| `mystic-fixed` | Mystic | Simple 2020/2022 flywheel shooters with chassis aiming | Compact ground bubble intake, 4-ball hopper (design choice below max 6), fixed or limited hood, optional chassis auto-align; up to 3 preload | Easier build, fewer effective shooting poses, must stop/turn; compact packaging may support a better climber. |
| `gadgeteer-hybrid` | Gadgeteer | 2019 hatch/cargo dual handling; 2025 independently buffered piece mechanisms | Separate panel cradle and 3-ball path, folding lift/wrist plus compact shooter; mixed (1,3), panel-only (2,0) or bubble-only (0,4) if storage hardware supports them; mixed preload | Can acquire a district then farm bubbles, but slower transfers, 100-lb constraint and 30-inch stowed start height limit complexity. |
| `gadgeteer-flex` | Gadgeteer | Shared-end-effector designs and configurable mechanism trade-offs | Shared intake/end effector with explicit mode switching, panel-only up to 2 or bubble-only up to 4; mixed mode only if modeled storage supports it | Adaptable specialist, lower simultaneous throughput; visible reconfiguration/handoff delay. Prohibit incompatible preloads rather than claiming every build supports the class maximum. |

Preset names are provisional. Choose a legal mixed-capable Gadgeteer as a teaching default, while offering class-first selection. A preset may have less capacity than its class maximum; never invent capacity from a visual hopper or magazine change.

Expose meaningful options: declared class; floor versus station intake per type; magazine/hopper size; panel reach/orientation mechanism; turret versus chassis/manual aim; fixed versus variable hood; supported mailbox families; low/medium/high/no climber; assists. Normalize class-dependent choices immediately and show actual supported inventory/preloads. Reject or clamp invalid saved configs safely.

Treat drivetrain speed/acceleration, shooter rate/accuracy, lift speed, transfer delay, and climb duration as **estimated simulator parameters**. Keep them separate from manual constants and do not assume one preset is universally best. Derive packaging first, then measure cycles and multi-robot traffic. Never add a real team number/name without actual references.

Archetype validation matrix must include every preset:

- Cannot collect an unsupported type or from an absent ground/station intake.
- Correct capacity in all empty/mixed/single-type transitions; no illegal `(2,1)` or `(1,4)` Gadgeteer pickup or feed.
- Legal preload drawn from existing reserves; class lock survives saved settings and multiplayer.
- Full mechanism sweep stays attached to chassis and clears its own frame; transfer and release come from real exits.
- Eligible target success and ineligible target/misalignment failure for both colors.
- Height and extension limits in normal play, under tower, and final 20 seconds.
- Fixed shooter versus turret performance tested with appropriate scoring poses, not identical impossible grids.
- Visible differentiation and all climb states inspected in `tools/robot-gallery.html` after adding Hero Heist support.

## 8. Milestones and mini-goals

Each milestone is complete only after its exit checks and evidence are recorded below. Split work into these checkpoints; do not mark future tasks complete based on this plan.

### M0 - Reproducible source and baseline audit

- [x] Read all supplied manual text, calculator formulas, CAD structure, and key rendered manual figures.
- [x] Review current engine season hooks and identify integration hazards.
- [x] Define historical archetype candidates and trade-offs.
- [ ] Copy/archive sources according to repo asset conventions and record all checksums and manual version status.
- [x] Capture fresh git status, typecheck/build, and relevant existing season tests before runtime edits.
- [x] Establish standalone-game metadata/display support and confirm the menu label `WCP CADathon: Hero Heist` with stable ID `wcp-hero-heist`.
- [x] Resolve D1-D9 or record provisional interpretations and user-dependent decisions precisely.

Exit: source manifest, manual page map, cleanly separated baseline failures, explicit rule interpretations. Dependencies: none. **Current state: initial audit complete; baseline/source archive and rule decisions pending.**

### M1 - Pure ownership, score and ranking logic

- [x] Implement sourced constants and pure ownership transitions before geometry-dependent rules.
- [x] Encode table-driven tests for both colors and every strength 0..4; score-before-transition and no overflow.
- [x] Track AUTO full bonus and historical distinct district sets.
- [x] Calculate reversible ownership, tower/foul totals, RP thresholds, winner and results categories.
- [x] Reconcile aggregate outputs with workbook formulas and the 186-point fixture.

Exit: exhaustive pure fixtures pass; ambiguous cases clearly flagged/resolved; no rendering dependency. Depends on relevant M0 rule decisions.

### M2 - CAD-backed playable field and measurement manifest

- [x] Render raw CAD and verify orientation, scale, symmetry, regions, zones, stations, and tower/pads.
- [x] Split/recenter pieces; remove staged CAD copies; batch/instance static field primitives; preserve dynamic pieces and indicators.
- [x] Produce optimized outputs and measured manifest for 20 district openings/slots plus zone polygons.
- [x] Build physical boundaries/colliders and inspect overhead, both ends, each target family and station.
- [x] Drive representative legal robots through all lanes and under towers without phantom collisions.

Exit: recognizable field matches source geometry, simple colliders leave openings usable, source/optimized visuals compared, draw calls/load timings recorded. Depends on M0 source manifest; can proceed independently of M1.

### M3 - Conserved piece pool, class configs and robot models

- [x] Implement four type/color ranges in an 84-piece conserved pool and imported piece visuals.
- [x] Stage 30 bubbles and 10 panels on the floor; allocate legal preloads and remaining reserves without replacements.
- [x] Implement class-aware typed possession and preloads, class lock, normalized configurations and all six presets.
- [x] Build visible intake/storage/lift/wrist/shooter/climber mechanisms with real transfer and exit positions.
- [ ] Validate every inventory combination, source reserve exhaustion, retries/restarts and mixed Gadgeteer transitions.

Exit: identity/color/count conserved through floor/held/reserve state; all archetypes legal and visually differentiated. Depends on M0 and relevant M2 piece measurements.

### M4 - Real collection, scoring and human-player cycles

- [x] Bubble flights and crossing sensors work for all 20 targets at legal poses; misses hit field geometry.
- [x] Panels physically enter diagonal/horizontal/top-fed mailboxes and trigger capture at correct insertion depth.
- [x] Returned IDs enter correct color reserve; queued station feeding exits real openings without jams.
- [x] Tie scoring/ownership/LED changes to accepted sensor events, with color-aware attribution and event order.
- [x] Add selectable targets, auto/manual aiming, panel alignment feedback, and legal launch-zone checks.

Exit: complete collect -> score -> reserve -> feed -> recollect loop for both colors/types and each mailbox family; no double scoring or missing/duplicated pieces. Depends on M1-M3.

### M5 - Periods, climb and enforceable rules

- [ ] Implement 15/100/20 enabled timeline, 20-second climb readiness, and G03 settle/finalization.
- [x] Validate full-footprint launch/start legality and partial-footprint protection zones.
- [x] Implement three pad climbs, parking and mutually exclusive tower assessment; height/contact disqualification.
- [x] Protected collector/home contact applies all match; tower contact protection and forced high award apply only final 20 seconds.
- [x] AUTO centerline contact, 3-second technical-first pinning, capacity, bounds/extension and illegal launches have documented enforcement and debouncing.
- [x] Document rules constrained by design versus automatically enforced versus intent/human-judgement omissions.

Exit: both-color rule fixtures pass at timing/geometry boundaries; scored tower awards and settle results correct. Depends on M1-M4.

### M6 - AUTO, AI and strategy comparison

- [x] Replace unsafe year-based planner assumptions with explicit season capabilities; Hero Heist never receives reef targets/routes.
- [ ] Add drive/intake/wait, district bubble target, mailbox delivery and station actions where legal, with heading and target choice.
- [x] Provide leave-zone AUTO, bubble acquisition/farm AUTO, and panel ownership AUTO only after D1 resolution.
- [x] Add class-aware bots for claim/strip/farm/feed/climb using actual mechanisms and conserved pieces.
- [x] Coordinate teammates, legal launch locations, narrow routes, opposing HOME protection, and pad reservations.
- [ ] Measure complete seeded matches for multiple class mixes; tune estimated parameters without changing manual limits to balance a desired result.

Exit: bots/AUTO complete real cycles, avoid permanent stalls, and earn plausible points/RP; presets expose meaningful trade-offs. Depends on M4-M5.

### M7 - Menu, HUD, touch/gamepad and multiplayer

- [x] Register independent game, source/version label, class/preset picker, options, typed preloads, legal start placement and accurate rules summary.
- [x] HUD displays 20 districts with region/ownership, selected target, inventory, class, legal-action feedback, tower/bonus RP progress.
- [ ] Define separate bubble fire and panel-place actions, target selection, feed buttons and climb choices consistently on keyboard, gamepad and touch.
- [x] Synchronize district state/history as needed, panel transfers, robot class/storage, pad occupancy, returns, LED state and final results.
- [ ] Test host/guest, both squads, spectators, late join/reconnect and serialized state round-trip. Retain private alliance AUTO plans.
- [ ] Inspect desktop, tablet and phone layout and exercise real controls via current in-app browser/computer-use tools.

Exit: two-client match agrees on pieces, ownership, score, tower awards and results; responsive UI functions; no console/page errors. Depends on M3-M6; scaffolding may start earlier.

### M8 - Regression, performance, documentation and delivery

- [ ] Run focused Hero Heist suites, then typecheck, production build and all supported-game tests after shared engine changes.
- [ ] Verify official seasons and standalone `WCP CADathon: Hero Heist` coexist in planner, saved settings, lobby and robot gallery without year-based behavior leakage.
- [x] Record real browser screenshots and action checks, full match and multiplayer evidence separately from headless tests.
- [ ] Benchmark cold/repeated asset load, draw calls, fixed-step time, six-robot match behavior and host/guest performance on a recorded device/viewport.
- [ ] Write `docs/HERO-HEIST.md` with provenance, rule decisions, approximations, controls and current limitations; update `FRAMEWORK.md`, `ROBOT-ARCHETYPES.md`, README and main PLAN where relevant.
- [ ] Run `git diff --check`, review only authorized changes, and provide runnable local instructions plus concise completion evidence.

Exit: all required gameplay and evidence complete, known limitations explicit. Commit/push/deployment only when requested or already authorized in the implementation session. Depends on M1-M7.

## 9. Test plan and verification gates

Proposed focused files (create tests during implementation, not just tests of this plan):

| Test file | Coverage |
| --- | --- |
| `tests/hero-heist-scoring.test.ts` | Transition matrix, calculator parity, reversible ownership, AUTO bonus, distinct RP histories and boundary values |
| `tests/hero-heist-config.test.ts` | Three classes, every Gadgeteer inventory case, limits, typed preloads, saved configs and class lock |
| `tests/hero-heist-cad.test.ts` | Transform/scale, recentered piece bounds, 20 targets, staged-copy removal, manifest and source identity |
| `tests/hero-heist-pieces.test.ts` | 84-ID conservation, reserve exhaustion, return/re-feed, last scorer/color metadata, round-trip state |
| `tests/hero-heist-mechanisms.test.ts` | Every preset pickup/feed/transfer/release; all mailbox families; bubble trajectory and blocked/misaligned cases |
| `tests/hero-heist-rules.test.ts` | AUTO/endgame/settle edges, starting/launch/protected-zone footprint, technical-first pin, G14/G18/G20, no extra penalty stacking |
| `tests/hero-heist-bots.test.ts` | Real AUTO, seeded class mixes, target switching, recycle loops, pad reservation and no fabricated scores |
| `tests/hero-heist-network.test.ts` | JSON state parity, host-only transitions, colored pieces, mechanism animation, late join and finalization |

Also extend existing relevant clock/start-pose/physics/scoring-readiness/player-results/auto-planner/multiplayer/robot-mechanism suites. Inspect their assumptions before registering this mixed projectile/placement game: `SeasonTesting.mechanism` currently chooses one category, so do not mark “placement” and silently skip all bubble physics, or “projectile” and skip panels. Add explicit dedicated coverage or a generic optional mixed-mode hook.

Minimum scoring regressions: own strength 1->2 receives neutral bubble value; own strength 3->4 via panel increases live score by 15; opponent strength 2->1 removes 10 live points but grants no bubble FAME; opponent strength 4->0 via panel grants no overflow; repeated AUTO recapture gives no repeated bonus; final partial/full counts remain mutually exclusive.

Minimum boundary regressions: 14.999/15-second AUTO transition; 114.999/115-second endgame transition; 134.999/135-second disable; at-rest finalization and 140-second deadline; exact 60 tower points; 7/8 distinct partial and 4/5 distinct full; straddling a launch-zone edge cannot launch legally; merely touching one's protected zone is protected under G14.

Browser acceptance requires actual interactions, not only screenshots: collect each type, pick targets, fire/deposit/miss, feed repeatedly, change class before a match, run AUTO, climb/descend, restart, and complete a match. Use the current in-app browser/controller, not retired browser automation tooling. Record host and guest evidence separately.

Suggested commands once tests exist:

```bash
npx vitest run tests/hero-heist-*.test.ts
npm run typecheck
npm run build
npm test
git diff --check
npm run dev -- --host 127.0.0.1
```

No performance target is claimed from source inspection. Measure a baseline and then agree on practical acceptance based on the existing game's supported hardware; correct physics, smooth motion, and resource use all matter.

## 10. Progress logging and handoff protocol

This file is the durable source of implementation status. Update it **after each milestone/sub-goal, after a meaningful test/decision, before switching work areas, and before stopping**. During long implementation stretches, checkpoint at least every approximately 30 minutes. This is a work-session habit, not a scheduled automation.

For each entry, record:

```text
Date/time (America/Los_Angeles), agent/session if available:
Milestone and status: not started / in progress / blocked / complete
Changes: exact paths and behavior, commit if one exists
Evidence: command + result, test counts, browser/viewport and observed interaction
Decisions: resolved D-number, source pages/CAD measurements, new estimates
Failures/blockers: exact symptom, reproducer, what is still unverified
Next action: one concrete step and the files it will touch
Resume notes: active server/port, output asset locations, dirty files to preserve
```

Do not rewrite failed runs as successes, mark implementation complete after partial tests, or repeat an unchanged log entry. Replace the “Current handoff” fields as work advances, while keeping dated log entries intact.

### Current handoff

- **Status:** playable and registered (`WCP CADathon: Hero Heist`, id `wcp-hero-heist`). Field, pieces, typed inventory, bubble sensors, panel delivery, human players, climbing, fouls, RP, bots/AUTO, HUD, net state and six archetype models are implemented and tested; see the 20:35 and later log entries. Open: G03 early finalization, auto-planner district/mailbox actions, touch/gamepad and phone-layout checks, spectators/late join, performance benchmark, README/PLAN updates, source archival.
- **Next concrete action:** run `npm run build` and the full suite after the latest model/bot edits; then the remaining M6/M7/M8 boxes (planner actions in `src/app/autoPlanner.ts` + `src/engine/ai/autoPlan.ts` behind a season hook; touch labels; benchmark).
- **Files changed for this request:** this plan; `docs/HERO-HEIST.md`; `docs/ROBOT-ARCHETYPES.md`; `docs/FRAMEWORK.md`; `src/seasons/wcp-hero-heist/*` (constants, config, geometry, field, pieces, ownership, scoring, rules, bots, hud, robotModels, index); `src/seasons/index.ts`; engine: `core/season.ts` (label, seasonLabel, endgameSeconds), `core/game.ts` + `testing/headless.ts` (id-based shootWhileTracking, endgame threshold), `match/pinning.ts` (PinRule.kind), `ai/autoPlan.ts`; app: `autoPlanner.ts`, `menu.ts`, `lobby.ts`, `multiplayer.ts`; `tools/{prepare-hero-heist-cad.mjs,hero-heist-cad.ts,robot-gallery.ts}`; regenerated `public/assets/hero-heist/*.glb` and `cad-manifest.json`; tests: new `tests/hero-heist-rules.test.ts`, updated `hero-heist-config`, and shared `bots`, `physics`, `start-pose`, `match-logger`, `reefscape`, `team-robots` plus year→id checks in several suites. Nothing committed.
- **Existing dirty work:** telemetry/match-log/server/robot edits listed in section 2; preserve and inspect before touching shared files.
- **Temporary evidence:** manual text `/tmp/hero-heist-manual.txt`; rendered figures `/tmp/hero-score-04.png`, `/tmp/hero-score-05.png`, `/tmp/hero-top-07.png`, `/tmp/hero-class-18.png`. Temporary files are disposable and may not exist in the next session; recreate from source.
- **Runtime:** Vite at `http://127.0.0.1:5173/` (started by another session; reused). Robot gallery: `/tools/robot-gallery.html?season=wcp-hero-heist`. CAD inspector at `/tools/hero-heist-cad.html`; prepared assets under `public/assets/hero-heist/`. No deployment performed.
- **Source dependencies:** all four originals remain in Downloads. If unavailable later, retrieve the exact originals from the user; do not substitute a different game/version.
- **Priority hazards:** year-based REEFSCAPE planner branches; mixed typed possession/preload; CAD piece offsets and embedded staging; pre-event ownership scoring; dynamic versus persistent score; 20-second endgame and G03 settling.

### Dated progress log

#### 2026-10-07 - Initial planning checkpoint

- Completed read-only inspection of all 23 manual pages' text, visually verified the scoring/class tables and top-down zone figure, extracted all populated workbook cells/formulas/validation rules, and measured GLB structure/accessor bounds.
- Verified the workbook contains aggregate score only; ownership changes and RP must be implemented from the manual. Recorded formulas and a hand-calculated 186-point fixture for future automated reconciliation.
- Inspected current registry, season contract, piece pool, clock/scoreboard, planner branches and shared climb-ready logic. Found three existing official games and identified year-based game behavior that must not leak into a standalone CADathon game.
- Incorporated the user's explicit archetype follow-up: six derived presets across Commander/Mystic/Gadgeteer, based on historic FRC ball, panel, and mixed-piece mechanisms, with class limits and behavioral tests.
- Wrote the milestone plan, rule decision register, physical/assisted strategy, verification gates, and resumable checklist. No gameplay code or input asset changed.
- Read-only tooling note: bundled Python lacked `pymupdf`; successfully used `pypdf` for page mapping and system Poppler for rendering. `openpyxl` was used only to read the supplied workbook; future workbook authoring would use the spreadsheet skill's authoring workflow.
- Remaining: all runtime implementation milestones, CAD visual review, source archival/checksums, fresh baseline tests, and D1-D9 interpretation resolutions.

#### 2026-10-07 - Standalone game clarification and plan completion

- Applied the user's clarification: display `WCP CADathon: Hero Heist`, ID `wcp-hero-heist`, module `src/seasons/wcp-hero-heist/`. Do not label or group it as a 2025 season; retain 2025 only for supplied-source provenance.
- Added the standalone identity/metadata audit to architecture and M0; updated coexistence tests and handoff instructions.
- Measured and recorded field/manual checksums, completing all four input checksums. Source copying and verification after copying remain pending.
- Planning deliverable is complete. Runtime implementation remains unstarted; future agents must use the milestone checks and append evidence here as they work.

#### 2026-10-07 18:55 PDT - Implementation foundation checkpoint

- User authorized implementation. Preserved unrelated existing modifications.
- Baseline: `npm run typecheck` passed; clock/start-pose/auto-planner suites passed 55 tests. A build attempted after adding scoring exposed a test-only TypeScript inference error; corrected with explicit Ownership types. Full build still to rerun.
- Added `constants.ts`, `ownership.ts`, `scoring.ts` and 11 passing source-scoring tests. Covers every strength/color bubble case, clamp/no overflow, pre-event pricing, once-per-squad AUTO full bonuses, historical ownership, aggregate 186-point spreadsheet fixture, tower/RP boundaries, and conditional possession.
- Provisional interpretations in code: D1 allows panels in AUTO (table has no explicit ban); D2 opposing strength-1 neutral panel neutralizes without overflow; D4 AUTO bonuses once per squad per district; D5 full counts toward at-least-partial history. These remain documented approximations, not newly discovered manual text.
- Added `config.ts` with typed preloads/storage and six FRC-inspired presets. Performance values are estimates; class limits remain separate manual constants.
- Added reproducible `tools/prepare-hero-heist-cad.mjs`, `cad-manifest.json` and prepared field/bubble/panel GLBs. Verified 40 staged copies removed and correct 15-bubble/5-panel per-color distribution in metadata. Preserved 80 light nodes and 8 top-feed mailbox assemblies.
- Lossless visual batching: field 4,299,116 bytes, 190 primitives/draw calls versus 10,045 source primitives. CAD inspector rendered actual geometry in in-app browser: overview, Uptown, Downtown inspected; orientation and recognizable structures correct. Initial field load in inspector was 87 ms (one local observation, not a gameplay benchmark).
- Building separate simplified fixed boundary/scoring colliders from CAD so real cutouts/slopes remain open. No scoring by mere proximity planned.
- Next: verify prepared colliders, complete CAD target measurements, physical pool/mechanisms, and gameplay loop before registering the game.

#### 2026-10-07 19:45 PDT - CAD target measurement checkpoint (M2)

- Milestone: M2 in progress. Baseline rechecked: `npx vitest run tests/hero-heist-*.test.ts` 18/18 passed; `npm run typecheck` clean. Git status unchanged apart from this work; unrelated dirty files preserved.
- Measured from `cad-colliders.json` (ray/slice scripts in `tools/_tmp/`, throwaway) and inspected visually in `/tools/hero-heist-cad.html` (added a `cad.look()` camera hook). Field frame: `fx = sx + 8.2296`, `fy = sy + 4.1148`; blue end is `fx < 8.23`; symmetry is **mirror** (red = L - x, same y).
- Uptown (fy 7.85-8.53): lower face fy 7.849 to z 0.80; 45° chamfer to z 0.95 holding the diagonal mailbox slit (slot runs down/back at 45°, knob notch at district center); upper face fy 8.045 to z 1.52; **city block = 20 in window in a 45° slope** from (fy 8.065, z 1.52) to (fy 8.45, z 1.92), x half-width 0.27, ramp inside descends to z 1.05; backboard at fy 8.58. District x centers ±0.610, ±1.829, ±3.048 from field center.
- Downtown (fy -0.31-0.46): front face fy 0.457; horizontal mailbox slit z 0.63-0.67 (0.65 m wide, notch 0.55-0.72); chamfer to flat top z 1.07; **city block = horizontal 20 in hole** fy -0.27..0.21 at z 1.07, floor inside 0.78-0.86; back wall top 1.37 and LED backboard to 2.27.
- Foothills: thin diagonal wall at 40° through (fx 0.384, fy 7.231) for blue end, ends (0, 6.909)-(1.574, 8.23); two columns 1.067 m apart; square funnel holes (city blocks) 0.55 m at z 0.92-1.42 and 2.37-2.87; top-fed baskets (mailboxes) in front of the wall, tops z 0.78 and 2.23.
- Distribution center: bubble chute slot in squad wall z 0.77-0.98 spanning fy 0.11-1.32 (curved trough outside); panel slide box behind guardrail with three horizontal exit slots z 0.63-0.67 centered fx 5.05/5.95/6.85 from the red wall side (mirror for blue).
- Tape (CAD carpet primitives): tower zone fx 3.607-4.623, fy 1.321-8.23; collector zone fx 0-4.553, fy 0-1.372; home zone polygon between the squad-colored diagonal tape and the opposite-end foothill; launch zone = center rectangle between the inner white lines (fx 4.572-11.888) from the Downtown face to the Uptown face plus the end regions above the purple diagonal (0, 4.82)-(4.572, 2.90). Truss underside 66 in, pads at fy 4.115 and ±1.524.
- Decision: runtime physics uses procedural box/convex colliders built from these measurements (repo convention; CAD trimesh proxies were previously reverted for speed). The CAD GLB is the visual layer.
- Next action: write `field.ts` (colliders, sensors, measured target table), `rules.ts`, `index.ts` and register the game.

#### 2026-10-07 20:35 PDT - Playable game registered (M2-M7 first pass)

- Milestones: M2 complete for gameplay geometry; M3-M5 implemented with tests; M6 bots/AUTO playing full matches; M7 HUD/controls/net state in place (two-client multiplayer check still pending). Status: in progress.
- Engine (default-preserving): `SeasonDefinition.label` + `seasonLabel()` used by menu/lobby/multiplayer; `endgameSeconds` drives `climbReady` (Hero Heist 20 s); `PinRule.kind` (G11 TECHNICAL FOUL every count); every `season.year === 20xx` branch in `autoPlan.ts`, `autoPlanner.ts`, `menu.ts`, `game.ts`, `headless.ts` and the tests now keys off the season id, so the 2025-dated CADathon never takes REEFSCAPE paths.
- New season files: `geometry.ts` (20 districts with measured CITY BLOCK windows, MAILBOX slits/baskets, LED index map, zones, staging), `field.ts` (procedural colliders from the measurements; CAD GLB as the visual layer with the 80 LEDs driven per district and the 8 baskets tipping on delivery), `pieces.ts` (84-piece typed pool, CAD-shaped panel geometry), `rules.ts`, `bots.ts`, `hud.ts`, `index.ts`; registered last in `src/seasons/index.ts`. `config.ts` reworked: intakes on the back, MAILBOX reach tiers from CAD rim heights, G18-derived climb limit, placement vision-assist option, start poses/driver eyes, playing-mass allowance [EST +28 lb].
- CAD prep: `tools/prepare-hero-heist-cad.mjs` now gives `*_glass` parts a clear polycarbonate material (the driver-station view was a solid grey wall). Regenerated `public/assets/hero-heist/*.glb` (field 4,299,324 bytes, still 190 primitives).
- Evidence: `npx vitest run tests/hero-heist-*.test.ts` → 45/45 (new `tests/hero-heist-rules.test.ts` 27: staging/conservation, all 20 windows sensed once, wall misses, real launcher into DOWNTOWN/FOOTHILL low+high, panel delivery into every MAILBOX family, 2 in misalignment miss, assist from a sloppy approach, GADGETEER low-basket only, manual worked example blue 3 → 0 → red 2 → red 4, class possession, HP chute/slide both squads, LOW/MEDIUM/HIGH by clearance, park, G21, G14 incl. HIGH CLIMB award, AUTO exit, JSON net state). `npx vitest run tests/physics.test.ts -t "HERO HEIST"` 14/14 (static shots from every spot for 7 robot variants, moving shots, lanes under both trusses, beached/tipped recovery). `tests/bots.test.ts -t "HERO HEIST"`: full matches 327-436 points (Normal) with ownership, AUTO bubbles/bonus and climbs; all-AI match blue 376 / red 284, no fouls.
- Browser (in-app, 1280×800, Vite on 5173): menu shows `WCP CADathon: Hero Heist · 2:15 match`; match runs at 60 fps with the CAD field; AUTO ended 92-99 with UPTOWN 6 fully owned by red (AUTO bonus); LEDs and HUD strip follow ownership; no console errors.
- Decisions: tests and physics use `canScoreFrom` (1.4-5.5 m in front of the UPTOWN window) — a driver doesn't shoot from against the wall under the window; launcher top speed 9.5 m/s so the generic chassis lead estimate matches these lob shots; bubble target locks while the trigger is held; basket choice in a FOOTHILL column = where a panel helps most (high on a tie); climbs go to the best legal level ≤ the selected one.
- Docs: new `docs/HERO-HEIST.md`; Hero Heist section in `docs/ROBOT-ARCHETYPES.md`; standalone-game note in `docs/FRAMEWORK.md`.
- Next action: full `npm test` result, then two-client multiplayer check and archetype-specific robot models.

#### 2026-10-07 21:10 PDT - Archetype models, AI strategies, multiplayer check, Mystic shooting fix

- Added `src/seasons/wcp-hero-heist/robotModels.ts`: one model per archetype (front panel lift whose cradle follows the placement pose, back floor intake, station funnel for station-only builds, panel magazine, turret or fixed hood shooter on a support tower, hopper with visual held bubbles, climber hooks; class accent colours). Rules hand `robot.placeAnim` to the model and ride held panels on its cradle. Gallery: `tools/robot-gallery.ts` now lists a standalone game's presets; all six checked in the in-app browser, plus a live COMMANDER delivery into UPTOWN.
- Bots: alliance strategies `auto`/`claim`/`strip`/`press`, roles claimer/farmer/defender with a role planner and adapter (strip when 40+ behind in the last minute); defender shadows the top scorer only outside its protected zones; shooters settle before firing. Hard 1186 vs Normal 1154 over seeds 5-7; all-AI blue 360 / red 374, no fouls.
- **Bug reported by the user (fixed):** playing as a MYSTIC, Space never fired. Cause: the new models make `Robot.launch` wait for `scoringMechanismReady`, but the engine only advances model mechanisms for seasons without `handleMechanisms`. Fix: `HeroHeistRules.handleMechanisms` advances them. A second issue found while testing: the hopper fill helper `fillBlock` turned on the physical ball bay, which jammed the last bubble in short robots; replaced with visual-only bubbles. Regression test: every shooter preset fires 3/3 with its model attached.
- Multiplayer (two in-app tabs, relay on the Vite server): room meta shows the label; host and guest agreed on season, clock (28.3/28.2 s), score 92-140 and all 20 district states; guest had no console errors and its LEDs followed the host.
- Shared tests adapted for a standalone game (no team robots; 40 in start zone only fits square-on robots): start-pose, match-logger, reefscape registry, team-robots, bots.
- Evidence: `npm run typecheck` clean; `npm run build` OK; Hero Heist suites 49/49; physics (Hero Heist) 14/14; bots (Hero Heist) 7/7. Full `npx vitest run` before the fix: 938 passed, 5 failed — all REBUILT (physics shots ×2, OUTPOST re-catch, dumper, REBUILT all-AI). Verified unrelated: they pass at clean HEAD, 3 pass again with `shootWhileTracking` forced off, and the dumper fails with only the other session's `robot.ts` diff applied to HEAD. Left for that session.
- Next action: rerun the full suite after these edits; then auto-planner district/mailbox steps, touch/phone layout check, performance benchmark, README/PLAN.

#### 2026-10-07 21:40 PDT - Manual shot-target selection (user request)

- User asked to pick the CITY BLOCK by hand (UPTOWN, DOWNTOWN, FOOTHILLS), especially with a turret. Implemented as a generic engine feature: rebindable actions `targetPrev` (`,`), `targetNext` (`.`), `targetAuto` (`Z`), gamepad R3 = next; `DriverInput.targetStep/targetAuto`; `SeasonDefinition.aimTargets`; `RobotCommand.aimTarget` (-1 = automatic), packed as an optional 7th element in multiplayer commands (old 5/6-element packets still parse). Game toasts the pick.
- Hero Heist: `aimTargets` = the 20 districts; `targetFor` honours the pick ahead of automatic selection (turret tracks it anywhere; chassis auto-align turns to it); HUD shows manual/auto and warns "out of range / wrong side".
- Evidence: new tests (manual picks into UPTOWN 4, DOWNTOWN 4, WEST FOOTHILL low and UPTOWN 6 score only there; pack/unpack round trip); Hero Heist suites + net/netsync/keybinds/touch/prediction/multiplayer-bots 111/111; Hero Heist physics 14/14; build OK. In-app browser: cycling 0 → 1 → 0 → 19 → 18 wraps, the player's command carries the pick, Z returns to automatic (driven through `handleUiInput` because the hidden pane paused rAF).
- Not done: an on-screen touch button for target cycling.
