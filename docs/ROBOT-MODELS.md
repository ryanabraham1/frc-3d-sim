# Building a real team's robot model

How the 2024 Twister / TIDEPOD / MadTown and 2025 WHISPER / LIGHTNING / Firefly models were rebuilt. Their earlier
versions came from one shared template per season with a `style` switch. They didn't look like the real robots
and could not have been built: shooters floating over a bare bellypan, braces ending in mid-air, elevator stages
that left their rails, mechanisms on the wrong end of the robot. The fix wasn't better 3D skill. It was research
first, and treating every part as something that must bolt onto something else.

Engine side: `src/engine/robot/models.ts` (kit helpers, `RobotModel` contract) and `mechanicalDetail.ts`. Models
are visual only. Capabilities still come from the config (see the header of `models.ts`).

## 1. Research before you write any geometry

Teams publish a lot. Expect a technical binder, CAD, a reveal video and dozens of photos for any top team. Spend
real time here; it is most of what makes a model right.

| Source | What you get | How |
| --- | --- | --- |
| Team technical binder (PDF) | Frame size, which way things face, mechanism specs and CAD renders labelled per subsystem | `tools/robot-refs.py binder file.pdf`; read `text.txt`, then zoom pages with `pdftoppm -r 80 -f N -l N` |
| Chief Delphi reveal / "CAD and code release" topics | Reveal video, binder attachment, team Q&A that explains how mechanisms work | `tools/robot-refs.py search "1690 2025 robot"`, then `topic <id>` |
| The Blue Alliance team/year page | Match and pit photos from several angles | `tools/robot-refs.py tba 118 2024` |
| Team website (often Wix) | More photos per season page | grep the page for `static.wixstatic.com/media/...` and fetch `.../v1/fit/w_700,h_700/a.jpg` |

Every command writes a `sheet.jpg` contact sheet under `refs/` (git-ignored). Open it with the Read tool. Look at
**at least three angles**, and prefer a pit photo or CAD render over a reveal thumbnail: reveal art is often
edited (4414's TIDEPOD reveal thumbnail is a joke photoshop).

Then **write the feature list before coding**, as the comment block above `registerRobotModel`. Put these in it:

- frame size (from the binder; set `frameLength`/`frameWidth` in the config if it isn't the season default);
- where each mechanism sits: center or offset, which end, which side, how tall, how big relative to the frame;
- what holds each mechanism up: towers, pods, knee braces, A-frames, gussets;
- which end the intake is on and which end(s) it scores from. Get this right. The user caught WHISPER scoring only
  off the front when the real arm rotates over the top to score off both ends;
- how each mechanism moves: elevator stages, pivot axes, what folds where when stowed;
- colors and finishes (gold anodized, teal, raw aluminum, black powder coat, white printed parts) and visible logos;
- your sources, cited with what each one showed.

If two sources disagree, trust the binder or CAD over a single photo. If you can't tell something, say so in the
comment and choose the most buildable option.

## 2. The structural rule: every part needs a load path

Before you place a mesh, ask what it is bolted to. On a real robot, everything traces back to the frame rails
through plates, tubes, bearings or gussets. The quickest check is the gallery: if it would fall when the robot
is flipped upside down, it's floating.

- **Supports first, mechanism second.** Twister's turret sits on a gold deck plate carried by the two electronics
  pods, which stand on the frame rails. TIDEPOD's elevator is braced to the front corners by truss A-frames.
  MadTown's arm hinges on blue towers on the frame rails. Build these before the moving parts.
- **Braces end on structure at both ends.** Compute brace endpoints from the same constants as the parts they join,
  for example a point on a tilted elevator through its lean angle. Don't eyeball them. TIDEPOD's first version had
  its brace math sign-flipped and the braces ended in space.
- **Moving links re-pin every frame.** Gas struts, leadscrews and linkages between a fixed and a moving part use
  `link(parent, r, m)` plus `pointIn(parent, movingChild, x, y, z)` in `update()`, so both ends stay attached
  (MadTown's gas struts, Twister's pitch leadscrew).
- **Elevator stages overlap.** A two-stage elevator moves stage 1 by `ext / 2` and stage 2 by `ext`, and the
  carriage rides the last stage. A single stage that reaches too high visibly separates from its rails. If the
  binder says single stage (Firefly), cap the travel and lengthen the arm instead.
- **Stowed means inside the frame perimeter.** Check every mechanism's stowed pose against `L/2`, `W/2` and
  `height`. Twister's first diverter stowed sticking out the back of the robot.
- **One part, one job.** Don't add a second look-alike: WHISPER's climber at the far end read as a second ground
  intake, so it moved to the long side, where Orbit's photos show it. A real robot has one floor intake unless the
  team built two (Twister really is dual-sided; its unused mouth has no orange so it doesn't read as active).

## 3. Write one builder per robot, never a shared style switch

A `for ([id, color, style] of [...]) registerRobotModel(...)` template is what produced the floating robots:
geometry tuned for one style ends up in mid-air on the others. Give every robot its own builder, with its own
constants named after real parts (`podX`, `ringR`, `towerX`, `lean`). Share small kit helpers
(`starWheels`, `reachWith`) and no layout.

Useful kit pieces: `drivebase`, `underBumperIntake`, `deployableIntake`, `sidePlates`/`plate` (with pocket
holes), `lattice` (truss beams and panels: give it an origin, a direction along the beam and a depth),
`wheelShaft`, `roller`, `hoodShell`, `hook`, `link`/`pointIn`, `decal`, `tubeMat` (perforated tube look).

## 4. Drive mechanisms from the rules' pose, with real kinematics

- Shooting games: aim with `s.hood`, AMP/pass with `s.passing`, climb with `s.climb` (1 = reach up, 0.25 = pulled
  in). Animate the part that really moves (Twister's chain arms swing up; TIDEPOD's whole elevator rises).
- Placement games: the rules give `s.place` = `{ height, forward, level, side, handoff }`. `forward` is a
  **distance along the scoring direction**, not a signed x. `side` is quarter turns: 0 front, ±1 left/right
  (`scoreSide: 'sides'`), 2 back (`scoreSide: 'ends'`). For elevator + arm robots, solve with
  `reachWith(p, dir, hubX, armLength, yMin, yMax)` in `2025-reefscape/additionalTeamRobots.ts`. Size the arm so
  the held piece actually reaches the target: the team-robots test checks it within 0.2 m.
- Hoods: `s.aiming` is true while the driver holds shoot / pass, and `s.hood` then tracks the solved launch angle
  live (re-solved ~7x a second from where the robot is). Stow the hood flat when not aiming and swing it to
  `hoodFor(s.hood)` when aiming, so it visibly re-adjusts with range. Turret robots should use
  `turretShooter()` (`engine/robot/turretShooter.ts`, after 4414's CAD) rather than a box with a wheel.
- 2026 indexers: build dye rotors with `dyeRotor()` (`models.ts`): pocketed spinning plate, fenced tub, spiral guide
  wall with feed rollers, open tower to the turret, external Krakens. Spin `floor` and `rollers` from `update`.
- Piece flow: return `flow: { intake, stow, feed }` (robot-frame points, read when a piece starts moving) so captured
  pieces visibly ride through **this** robot's mechanism: under / over the real rollers, onto the pile
  (`hopperStow`), along the floor or up the tower into the shooter (`overBumperIntake`, `columnFeed`, a dye rotor's
  `feed`). Paths must stay inside the robot's parts, never through a wall. Anything omitted uses a generic path.
- If the real robot can do something the rules don't support (WHISPER scoring off both ends), add it to the rules
  as a config option with a test (`placement.scoreSide = 'ends'`). Don't fake it in the model.

## 5. Check in the gallery, every pose, every angle

`npm run dev`, then open `/tools/robot-gallery.html`. Click a robot to focus it. Drag to orbit and scroll to zoom,
or from the browser tools call `view(orbit, tilt, zoom)`, e.g. `view(0.6, 0.4, 0.5)`. Go through **Stowed,
Intaking, Scoring/extended, Climbing and Piece flow** (loops intake → hopper → shooter so you can watch the paths), and look from both ends and from low down. Compare side by side with the
contact sheet. Look for these specifically:

- gaps between parts that should touch (stage to rail, brace to frame, arm to hub);
- parts poking through each other or out of the frame perimeter when stowed;
- the silhouette: proportions, the tallest part, where the mass sits. If you squint, it should read as that team's
  robot;
- the intake on the config's `groundSide`, and the scoring mechanism facing the way the rules score.

## 6. Tests

`npm test` covers every team robot (`tests/team-robots.test.ts`): a registered model, legal config, something
animates, and in 2025 the held piece reaches the L4 target on every side the robot scores from. Add a rules test
when you add a capability (`tests/reefscape-mechanisms.test.ts`, "front-and-back scoring"). Also run
`npm run typecheck` and `npm run build`.
