# Robot archetypes and driver-assist features

The simulator is meant for **kickoff strategy**: which robot archetype scores the most in a given game, and
whether a given mechanism (for example a ground intake) is worth building. That only works if the robots you can
configure are ones teams actually build, with the same trade-offs. This page records what we found about how
competitive robots were built from 2022 to 2026, and how each season's presets and options map to it.

Research method: web search over Chief Delphi threads, team technical write-ups and robot code (2020–2026).
Direct page fetches were blocked in the build environment, so the findings come from search-result summaries.
Treat them as a guide to common archetypes, not measured statistics.

## Cross-season patterns

| Feature | What real robots do | Simulator model |
|---|---|---|
| **Ground intake** | Usually the defining trade-off of a season. Full-width "touch it, own it" intakes (often under the bumper) on most competitive robots; simpler robots skip it and depend on the human-player station. | `intake.ground` (engine). Without it, a piece on the carpet can't be picked up. |
| **Station / human-player intake** | Funnels, hopper openings or shooter-intakes that catch pieces as they leave the human-player chute. | `intake.station` + `stationSide`: `Robot.stationContains` catches pieces **in the air** in front of or above that side of the robot. |
| **Human-player feeding** | Human players physically drop or roll pieces down a chute, aimed at the robot. | The season models the real chute geometry and drops a free rigid body down it (H button, or automatic human player). |
| **Turret vs chassis aim** | Turrets were common in 2022 (shoot on the move with vision). In 2024 and 2026 most shooters were fixed to the chassis, and the robot rotated to aim (vision "auto-align" / heading lock). Pick-and-place games (2023, 2025) have no turret. | `launcher.turret` or `autoAlign` (heading servo with a fire gate, `Robot.autoAlign`) or driver aim. Pick-and-place seasons force `turret = false`. |
| **Scoring auto-align** | 2025 robots used vision / pose-estimate alignment to a chosen reef branch (left/right buttons), and 2024 robots auto-aligned to the AMP/TRAP. | Season `adjustCommand` hook drives the robot to the scoring pose, with sensor noise. Without it, the driver lines up and physics decides whether the piece goes on. |
| **Shooter type** | Fixed-angle shooters (e.g. kitbots) only score from one spot. Pivot/hood shooters score from a range. | `launcher.minAngle == maxAngle` + a speed cap for fixed shooters; the ballistic solver decides the rest. |
| **Capacity / hopper** | Fixed by the rules in some games (1 NOTE, 1 CORAL + 1 ALGAE); a key design variable in others (2022 cargo, 2026 FUEL hopper). | `hopperCapacity`, clamped by the season's `normalizeRobotConfig`. |
| **Size vs field obstacles** | Height set by field features (2024 STAGE 27⅞ in, 2026 TRENCH 22¼ in). | Real colliders; the robot's height really blocks it. |

## 2025 REEFSCAPE

- **Funnel-fed L4 elevator cycler**: the most common competitive design. An elevator with a CORAL end effector,
  fed by a funnel at the CORAL STATION instead of a ground intake. Many used vision alignment to the reef branch,
  with driver buttons to pick left or right.
- **Ground-intake all-rounder**: elite robots added a CORAL ground intake (for pieces knocked off or dropped) and
  ALGAE handling for the NET and PROCESSOR.
- **Mid-tier**: single-stage elevators (L2–L3) and L1 trough robots. ALGAE specialists existed on strong
  alliances.
- **Climb**: the deep CAGE was the high-value endgame.
- **No turrets.** A turret doesn't help a pick-and-place game, and in the simulator it made placement unrealistically
  easy.

Presets: *Funnel-fed L4 cycler* (default), *Ground-intake all-rounder*, *L2–L3 elevator*, *L1 trough bot*,
*ALGAE specialist*. See [REEFSCAPE.md](REEFSCAPE.md#robot-archetypes).

## 2024 CRESCENDO

- **Under-bumper intake + pivot shooter** was dominant. The robot rotates to aim at the SPEAKER, often with
  vision "auto-aim". The AMP is scored with the shooter or a small amp bar.
- **Turrets** were rare (heavy and complex) but let top teams shoot while moving.
- **SOURCE-fed robots** took NOTES from the human player through the shooter intake. The KitBot was a SOURCE-fed
  fixed shooter that scored from against the SUBWOOFER and in the AMP.
- **Amp/TRAP robots** skipped the SPEAKER shooter. Most competitive robots climbed; fewer scored the TRAP.

Presets: *Under-bumper pivot shooter* (default), *Turret shooter*, *SOURCE-fed shooter*, *KitBot (SUBWOOFER
shooter)*, *AMP + TRAP specialist*. See [CRESCENDO.md](CRESCENDO.md#robot-archetypes).

## 2026 REBUILT

- **Hopper size and fire rate** decide cycle time: "how much FUEL can you carry, and how fast can you empty it".
- **Turret vs fixed shooter**: turrets allow shooting on the move. Fixed double-wide shooters with chassis
  auto-align were more common and simpler.
- **Trench-capable (≤ 22¼ in)** robots take the short path under the TRENCH. Taller robots with bigger hoppers
  must cross the BUMPs.
- **OUTPOST-fed** robots (no ground intake) depend on the human player's CHUTE.
- Climbers ranged from TOWER LEVEL 1 to LEVEL 3.

Presets: *Turret trench bot* (default), *Fixed shooter + auto-align*, *Big-hopper BUMP bot*, *OUTPOST-fed
shooter*.

## Earlier seasons (patterns only, not yet in the simulator)

- **2022 RAPID REACT**: turret + Limelight auto-aim shooters that shoot on the move; ground intakes universal;
  traversal climbers.
- **2023 CHARGED UP**: the ground-intake vs substation-only trade-off; elevator or arm placers; auto-balance on the
  CHARGE STATION.

## Sources

- [Chief Delphi: Share your REEFSCAPE controller layout](https://www.chiefdelphi.com/t/share-your-reefscape-controller-layout/504821): reef auto-align and left/right branch buttons.
- [Chief Delphi: Generating reef alignment poses](https://www.chiefdelphi.com/t/generating-reef-alignment-poses-an-example-showcase/491876): pose-based reef alignment.
- [Team 2910 2025 recap](https://frcteam2910.org/2025/05/07/2025-recap-post/): an elite 2025 design.
- Team 254 robot write-ups: [1](https://www.team254.com/?p=18644), [2](https://www.team254.com/?p=18432).
- [Chief Delphi: Stop overcomplicating REBUILT](https://www.chiefdelphi.com/t/stop-overcomplicating-rebuilt/513157): 2026 archetypes, hopper-first design.
- [DeLaSalle Robotics 2024 repository](https://github.com/DeLaSalle-Robotics/DLS-Robot-2024): a 2024 team repository (also the mirror of the 2024 manual PDF).
