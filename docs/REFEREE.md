# The referee

`src/engine/match/referee.ts` makes the calls a head referee would make from what the robots physically did.
Every season builds one (`rules.ref`), gives it its rule numbers, calls `ref.update(dt)` each step, and adds its own
season-specific protection rules on top, using `ref.touching(a, b)` (contact **directly or through a SCORING ELEMENT
both robots are touching**, which is how the manuals word every "protection" rule) and `ref.call(...)`.

`call` writes the foul (and card) to the scoreboard, shows the toast, and sidelines a red-carded robot
(`Robot.sidelined`). A second yellow card to the same robot is a red card.

## Calls shared by every season

| Call | 2024 | 2025 | 2026 | What the sim sees |
| --- | --- | --- | --- | --- |
| This isn't combat robotics | G418 | G423 | — | closing speed ≥ 3.2 m/s into an opponent pressed against a wall / FIELD element, or the same robot hitting the same opponent 3× at ≥ 2.6 m/s within 10 s → MAJOR + YELLOW |
| Don't tip or entangle | G419 | G424 | G417 | driving into a robot that has started to tip, or tipping the same robot twice → MAJOR + YELLOW; driving into a robot lying on its side for 2 s (CONTINUOUS) → MAJOR + RED |
| Don't collude | G421 | G426 | G419 | 2+ partners walling an opposing climber off the TOWER / CAGES / STAGE: MAJOR after 3 s, again every 3 s |
| Use pieces as directed | G406 | G406 | — | a piece launched well off the direction the robot was aiming that hits an opponent: MAJOR |
| Keep pieces in bounds | G407 | G407 | — | a robot's launched piece leaves the FIELD: the first is let go (intent), then MINOR, then MAJOR |
| Pinning | G420 | G425 | G418 | `PinTracker` (see `pinning.ts`) |

2026 leaves G416, G404 and G405 uncalled: ramming, launching at robots and ejecting FUEL are too hard to judge from the sim (a season omits a rule number in `RefereeRules` to turn a call off).

A single bumper-to-bumper hit, even a hard one in open field, is never called (the manuals say so explicitly).

## 2026 REBUILT specifics

* **G420 TOWER protection** (last 30 s): any contact, direct or through a FUEL, with an opponent robot that is touching
  its own TOWER, whoever starts it: MAJOR. If that robot is off the ground it is awarded LEVEL 3 at the final scoring.
* **G403**: crossing the CENTER LINE in AUTO is a MAJOR, plus another MAJOR for every contact with an opponent after.
* **G408**: FUEL the HUB releases may not be caught before it touches anything else. One catch is a MINOR; 3 or more in a
  run ("sitting under the HUB") is a MAJOR with a verbal warning, then MAJOR + YELLOW for a repeat.
* G407 (score from your ALLIANCE ZONE) and G418 (3-count on pins) were already called.

## Not called, and why

The sim has no damage model, no bumper-zone model, no human hands and no expansion measurement, so the rules that
need them are not called: G406/G409/G411 (damage), G410 (bumpers lifted), G412 (grabbing the FIELD), G413 (expansion,
checked when a robot is built), G414 (robots supporting robots: the wheels cannot drive onto a robot), G415 (components
inside the perimeter), G401/G402/G421-G427 (drive team and human player conduct). Intent is a judgement call, so ejecting
and launching are judged on what happened (see the table).
