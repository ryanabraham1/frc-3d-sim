# INSTRUCTIONS — adding an FRC game to this simulator from its Game Manual

**Read this before starting.** It is the retrospective from building 2024 CRESCENDO using nothing but
its game manual, written for the next agent (or human) who gets "here's a manual, add the game."
Companion docs: [docs/FRAMEWORK.md](docs/FRAMEWORK.md) (engine reuse map + season contract),
[PLAN.md](PLAN.md) (architecture/log), and the per-season docs (`docs/CRESCENDO.md`, `docs/REEFSCAPE.md`).

---

## 0. The short version

1. Get the PDF into the repo root as `<year>GameManual.pdf`. Record its version (kickoff V0 vs a Team Update).
2. Extract text + figures (PyMuPDF). Read **Game Overview, ARENA, Game Details, Game Rules, Glossary**, and the
   robot-size rules (R1xx). Skip the rest.
3. Write `constants.ts` first — every number with a provenance tag `[M §]` / `[FIG n]` / `[EST]`.
4. Decide, per scoring action, **physical vs assisted** (see §3) *before* writing rules.
5. Build: `constants → config → scoring (pure) → field → rules → autopilot → hud → index`, register in
   `src/seasons/index.ts`.
6. `npm run typecheck`, `npm test` (the physics suite automatically tests every registered season),
   browser smoke test (`tools/browser-smoke.mjs`), multiplayer smoke test.
7. Write `docs/<GAME>.md` (manual page map + approximations), update README/PLAN, commit.

Budget that worked: ~15 % reading/measuring, ~45 % building, **~40 % testing and fixing**. The test/fix
loop is where the real bugs were — don't skimp on it.

---

## 1. Getting the manual

- FIRST hosts manuals at `firstfrc.blob.core.windows.net/frc<year>/Manual/<year>GameManual.pdf`. In the cloud
  sandbox that host was **blocked by the network policy** (HTTP 403 on CONNECT). Don't retry a policy
  denial; check `curl -sS "$HTTPS_PROXY/__agentproxy/status"` for the reason, then look for a mirror.
- What worked: `WebSearch` for `"<year>GameManual.pdf" github`, then fetch the raw file from
  `raw.githubusercontent.com/<team>/<repo>/main/<year>GameManual.pdf` (GitHub is reachable). Verify it's a real
  PDF (`file x.pdf`) and check the page count/creation date so you know which version you have.
- A mirror is usually the **kickoff (V0)** manual. Say so in the docs; later Team Updates changed rules
  (e.g. 2024 AMPLIFICATION later ended after 4 NOTES — not in V0, so not modeled). If the user wants "just the
  manual", don't pull in knowledge from Team Updates, CAD, or WPILib layouts — even if you remember them.

## 2. Extracting facts from the PDF

```bash
pip install pymupdf pillow           # no poppler in the sandbox
```

```python
import pymupdf
d = pymupdf.open("2024GameManual.pdf")
print(d.get_toc())                                  # section → page map; read only what you need
open("m.txt","w").write("".join(f"\n=== PAGE {i+1} ===\n"+p.get_text() for i,p in enumerate(d)))
# Figures: extract the embedded images at full resolution (much sharper than page renders)
for p in [22, 24, 45]:
    for k, img in enumerate(d[p-1].get_images(full=True)):
        if img[2] >= 400: pymupdf.Pixmap(d, img[0]).save(f"fig_p{p}_{k}.png")
```

Then `Read` the PNGs (and crop/zoom with Pillow) to *look* at them.

**The manual gives sizes, not positions.** Most element *locations* (where the SPEAKER sits along the wall,
stage leg positions, zone polygons) are only drawn. Measure them from the top-view field figures:
- Find the field boundary in pixels, compute px/in from the known field length (≈1.2 px/in at full res),
  cross-check with the known width. Use figure dimension call-outs (e.g. spike-mark spacing) as anchors.
- Expect ±2 in. Tag the value `[FIG n]` so the next person knows it's measured, not specified.
- Look for alignments the figure implies (2024: the SPEAKER center lines up with the middle WING spike
  mark; the STAGE ZONE's far edge is the WING line; the lowest wing note is on the field's center line).

Things to extract deliberately (they drive the code):
- **Symmetry**: rotational (red = L−x, W−y) or **mirror** (red = L−x, y). 2024 is mirror, 2025/2026 rotational.
  Get this wrong and half the field is wrong. The helper `side(a, x, y)` in `constants.ts` encodes it.
- **Ownership of elements**: which alliance uses which element. 2024 trap: *your SOURCE is at the
  opponent's end* and belongs to you; a SOURCE ZONE is bounded by the *opponent's* wall. Protected-zone
  fouls (G423) are about the *opponent's* zones. Write these down explicitly.
- **Timeline** (periods, delays, "counts for N s after 0:00", when endgame starts), **point table**,
  **RP thresholds**, **penalty values**, **staging counts** (sum them — the manual's total must match).
- **Robot limits** (height, perimeter, extension, piece-control limit).
- Glossary definitions — they are often more precise than the section text (e.g. "ONSTAGE", "CONTROL").

## 3. Physical vs assisted — decide up front

The engine simulates rigid bodies well but not everything. For each scoring action ask: *can the game
piece physically do this with the colliders we have?*

| Physically simulated in 2024 | Assisted (animation + rule check) in 2024 |
|---|---|
| SPEAKER shots through the real hood geometry | AMP deposit (a flat ring can't enter a 3⅞ in-deep slot as a disc collider) |
| Passing, SOURCE drops, HIGH NOTE throws onto a pipe | Chain climb (kinematic), TRAP placement |

Rules of thumb:
- If the goal's opening is bigger than the piece's collider in every direction it needs to pass, simulate it.
- If scoring needs deformation, orientation control, or a mechanism we don't model (hooks, grippers),
  make it assisted with a proximity + state check, and **say so** in the rules page and docs.
- Keep **detection** (a piece entered the goal volume → reserve it) separate from **scoring** (points depend
  on the period). Detection must work even when the match clock isn't running (see §5, the harness).

## 4. Engine features you may need (added for 2024, all generic)

- `GamePieceSpec.shape: 'ring'` — flat torus visual + rounded flat-disc collider; `stripes` for taped variants;
  `pool.restHeight(i)` (use it instead of `radius` for "resting on the floor"). Launcher clearance uses
  `robot.projectile.halfHeight` for flat pieces (set it in `configureRobot`).
- `AimTarget.ceilings` (pass UNDER a lip), `allowRising` + `minEntryAngle` (goals entered level/rising, e.g. under
  a hood), besides `clearances` (pass OVER obstacles). If your goal is open-topped, the default (descending
  entry) is right.
- `engine/zones.ts` — `convexOverlap(robot.corners(), zonePolygon)` for "any part of the BUMPERS in X";
  `!convexOverlap` for "completely outside X".
- `SeasonDefinition.humanPlayerButtons` (H, B, N), `humanPlayerHint`, `mapSymmetry: 'mirror'`, `climberLabels`
  (also used by the in-match info panel).
- `SeasonTesting.canScoreFrom(alliance, x, y)` — the shot harness only fires where a goal is physically possible.

Before adding a *season-specific* branch to engine/app code, grep for existing ones
(`grep -rn "year ===\|maxScoringLevel\|placement" src/app src/engine`) and prefer a generic, optional hook.

## 5. Problems hit while building 2024 (and the fixes)

| Symptom | Root cause | Fix / lesson |
|---|---|---|
| Every test shot "missed" (0/8) | Goal sensor code returned early because the match clock wasn't started; the test harness never starts it | Sensors always run; only points depend on the period |
| Oblique shots clipped the goal | Aimed through the wall-plane center, but the opening is 18 in deep with side cheeks | Aim the flight line through the **middle of a deep opening** |
| Chassis-aimed robots missed | `testing.goalCenter` pointed at the wall, not where a driver should point | `goalCenter` = the point a turret-less robot should face |
| Shoot-on-the-move < 85 % | 48 in robot drifted to 60–77° off the goal axis — geometrically impossible shots | User: impossible shots may miss. Added `canScoreFrom` so the harness fires only where it's possible. **Don't tune physics to pass a test; fix the test's assumption honestly.** |
| "Prefer a level entry arc" tweak | Slow arcs collided mid-air at 20 shots/s and led moving shots worse | Measure with a sweep before keeping a tuning change; reverted |
| Robots stuck on loose pieces | Bumper bottom (1.5 in) below a 2 in flat piece's top — robot rode up and lost traction | Season default bumpers 0.75–5.75 in (inside the bumper zone) so flat pieces are pushed |
| "Robot too tall is blocked" realism test failed | Test lane skirted the structure instead of going under it | Design lanes that go straight *under/through* the constraint, between obstacles (2024: 30° through the stage legs) |
| HIGH NOTE throws never scored | Thrown from behind the wall; the out-of-field cleanup removed it on the first step | Spawn human-player throws inside the out-of-field tolerance (or exempt them) |
| Empty alliance's auto human player acted | Auto HP ran for an alliance with no robots (single player) | Gate automatic human-player actions on "this alliance has robots" |
| Existing physics test timed out | Vitest default 5 s timeout vs. a heavy physics test on a slow container | `testTimeout: 120_000` in `vite.config.ts` |
| `npm install` rewrote package-lock.json | Incidental npm version churn | `git checkout package-lock.json` unless you changed dependencies |

## 6. Testing — what "done" means

1. `npm run typecheck` clean, `npm run build` ok.
2. `npm test` — all seasons. The physics suite (`tests/physics.test.ts`) runs automatically for your season via
   `testing` (scoring spots, goal count, traversals, piece scatter). Make scoring spots *legal and realistic*
   (a grid in front of the goal), traversals that test real clearances (with `maxRobotHeight`).
3. A season test file (`tests/<game>.test.ts`) covering: the manual's timing/penalties/limits, the point table
   and RP thresholds (pure functions), staging counts per alliance, each scoring action through the real
   mechanism loop for **both alliances**, every enforced foul, the scripted AUTO routines actually scoring,
   end-of-match assessment, and `netState` → JSON → `applyNetState`. Use the helpers at the top of
   `tests/crescendo.test.ts` (`run()` advances the clock AND physics; `jump()` jumps the clock).
4. When something fails, write a throwaway trace test (`tests/_debug.test.ts`, run with
   `npx vitest run tests/_debug.test.ts --reporter=verbose` to see `console.log`) that fires one shot and prints
   the piece's position every few steps. Delete it afterwards.
5. **Browser**: `tools/browser-smoke.mjs` (setup in its header; Chromium is at `/opt/pw-browsers/...` in the
   cloud sandbox, use the swiftshader flags). Look at the screenshots yourself — geometry mistakes (a part
   floating, mirrored the wrong way) are obvious visually and invisible to tests. For close-ups, override the
   camera: `g.camera.setMode('orbit'); g.camera.update = () => {}; cam.position.copy(...); cam.lookAt(...)`.
   `window.game.step(game.physics.dt, idleInput)` fast-forwards deterministically.
6. **Multiplayer**: two browser contexts — host picks the season, creates a room (`.mp-room-code`), guest joins
   (`[data-mp="code"]`, `[data-mp="join"]`), takes a slot (`.mp-slot.red.open`), host starts; check both
   `window.game.season.id` and that the guest has no page errors.

## 7. What I'd do differently next time

- **Write the pure scoring module and its tests straight from the point table on day one**, before any
  geometry. They're the cheapest tests and catch misreadings early.
- **Screenshot the field after the first `field.ts` pass**, from overhead + each element close-up, before
  writing rules. Visual review is fast and catches mirrored/misplaced elements.
- **Run the physics suite as soon as the goal exists** (with a stub rules file that only reserves pieces in the
  goal). Aim/geometry problems dominated the debugging time.
- Think about the **piece's shape vs the goal's opening** first — it decides the collider, the solver
  constraints, and what must be assisted.
- For every rule, decide: *automatic foul*, *assisted constraint* (e.g. capacity 1 makes a control-limit rule
  impossible to break), or *not enforced (judgement/intent)* — and list the last group in the docs.
- Keep engine changes generic, optional, and documented in FRAMEWORK.md; run the **whole** suite after each
  engine change (other seasons depend on it).
- Keep a running list of `[EST]` values and reasons; it becomes the docs' "approximations" section for free.

## 8. File checklist for a new season

```
<year>GameManual.pdf                       repo root
src/seasons/<year>-<name>/constants.ts     manual facts + helpers (side(), zones, element positions)
                          config.ts        TIMELINE, robot defaults/normalize (limits), startPose, driverEye
                          scoring.ts       PURE point/RP functions + results table
                          field.ts         FieldBuilder geometry, lights/visual refs, AprilTags
                          rules.ts         SeasonRules: stage, sensors, scoring, fouls, human players, climb, netState
                          autopilot.ts     scripted AUTO routines
                          hud.ts           alliance/center/player HUD widgets
                          index.ts         SeasonDefinition (+ controlsHelp, rulesSummary, mapShapes, testing)
src/seasons/index.ts                       register (newest first)
tests/<name>.test.ts                       season tests
docs/<NAME>.md                             manual page map, what's simulated vs assisted, approximations
README.md, PLAN.md (log), docs/FRAMEWORK.md (if the engine changed)
```
