# AI strategy analysis

How the AI alliances decide what to do, and the measurements behind it. Every number here comes from full
six-robot matches run headless through the real physics and rules (`src/engine/testing/match.ts`), with both
alliances on the same Hard robot build so the plan is the only difference.

```bash
# One alliance's strategy against another's, 4 seeds, results as RESULT {json} lines:
AI_BENCH=1 AI_SEASON=2026-rebuilt AI_BLUE=press AI_RED=shift AI_SEEDS=4 \
  npx vitest run tests/ai-bench.test.ts --silent=false --reporter=verbose
# AI_PLAYER_ROLE=defender makes blue's "player" station play a role (simulating how a human plays).
```

**Reading the tables.** *Δ* is blue minus red, averaged over seeds (± one standard error). The same plan on both
sides is not exactly 0 — the fields and starting stations aren't perfectly symmetric — so each table has a
*mirror* row (both alliances on the baseline) and the column that matters is **gain** = Δ − mirror Δ: points per
match the plan is worth against the baseline.

## How the AI chooses

Each alliance has one `TeamBrain` (`src/engine/ai/team.ts`). Every 2 s its season **adapter** picks the alliance
strategy (when the strategy is *Adaptive*), then a **role planner** turns it into one role per robot, fitted to each
robot's build (a SOURCE-only robot feeds, an AMP/TRAP robot without a shooter AMPs...). The adapter reads the
**scout**: score margin, the clock, each side's recent scoring rate, which opponents spend their time defending us,
and which opponent has scored most — usually the human driver, who then gets the pressure. Switches are announced on
the radio ("New plan: PRESS — …").

## 2026 REBUILT

Strategy, blue vs red on Shift control (4 seeds):

| Blue plan | Blue | Red | Δ | Gain |
|---|---:|---:|---:|---:|
| Shift control (mirror) | 1164 | 1294 | −130 ± 22 | 0 |
| **Press** | 1210 | 1124 | +86 ± 36 | **+216** |
| Lockdown (dedicated defender) | 1174 | 1266 | −92 ± 64 | +38 |
| Stockpile (dedicated feeder) | 1001 | 1166 | −166 ± 49 | −36 |

Robots that are already full during their own inactive shift have nothing to do but wait; sending them to contest
the opponents' shooters (and coming home in time for their own shift) is worth about 200 points a match, far more
than a full-time defender or feeder. A conveyor-feeding variant ("pass while full") also lost to simply waiting.
**Adaptive** therefore always runs Press, and aims the pressure at the opponents' top scorer. Press stops itself
in the last 30 s so every robot dumps and climbs.

(These strategy runs predate the archetype rebalance below, when every Hard bot had an 80-ball hopper firing
16/s; absolute scores are now lower, the ranking of plans is what matters.)

## 2024 CRESCENDO

Strategy, blue vs red on Amplify cycles (6 seeds):

| Blue plan | Blue | Red | Δ | Gain |
|---|---:|---:|---:|---:|
| Amplify cycles (mirror) | 191 | 173 | +18 ± 8 | 0 |
| Amplify + defense | 129 | 140 | −12 ± 15 | −30 |
| Feed & shoot | 143 | 185 | −42 ± 5 | −60 |
| Speaker cycles | 101 | 143 | −42 ± 11 | −60 |

Counter-play: blue's player station plays **defender** against red (6 seeds) — what should the AI do?

| Red plan | Blue | Red | Red margin |
|---|---:|---:|---:|
| **Amplify cycles** | 153 | 192 | **+39** |
| Amplify + defense | 160 | 146 | −14 |
| Speaker cycles | 128 | 130 | +2 |
| Feed & shoot | 177 | 136 | −41 |

AMPLIFIED volleys (5 points a NOTE for 10 s) dominate, and a defender doesn't change that — the plan that answers
defense best is still Amplify cycles. Without a feeder every robot crosses the field to the SOURCE through traffic,
which is why Speaker cycles is so far behind. **Adaptive** runs Amplify cycles, and in the last ~28 s with nothing
banked (no time for another AMPLIFICATION) switches every robot to shooting.

## 2025 REEFSCAPE

| Red plan (blue on Reef race) | Blue | Red | Red margin | Gain |
|---|---:|---:|---:|---:|
| **Reef race** (mirror) | 234 | 244 | +10 ± 9 | 0 |
| Reef race → press | 264 | 249 | −15 ± 15 | −25 |

Pressing the opponents' cyclers once our L2–L4 BRANCHES are full (CORAL is then only worth 2 points in the trough)
looked promising but lost about 25 points: the presser gives up its own trough and ALGAE points and contact is
limited around the protected REEF ZONE. All coral and Coral + algae were within noise of Reef race. **Adaptive** runs
Reef race (which adds an ALGAE robot when the alliance has three bots); Press remains selectable.

## Archetypes (2026)

Before this pass every Hard bot used a maxed-out build (80-ball hopper, 16/s turret, LEVEL 3) plus +20 % speed and
5× accuracy. Now AI robots play the season's real archetypes in a lineup per difficulty (Normal and up: Dumper, Turret,
Big-hopper), skill mostly changes how well they drive (pace, re-planning, ≤ 8 % speed, ≤ 35 % tighter aim), and the
presets trade off against each other: the turret adds weight and fires a single 8/s stream, the big hopper is heavy,
slower and less accurate and can't use the TRENCH, the dumper is light and fast but must turn the chassis to aim.

Alliances of three identical archetypes against the Hard lineup (Turret, Dumper, Big-hopper), 3 seeds, adaptive plan
on both sides — before → after the trade-offs:

| 2026 alliance | First pass | Final |
|---|---:|---:|
| 3 × Turret trench bot | 832 | 730 |
| 3 × Dumper + auto-align | 622 | 665 |
| 3 × Big-hopper BUMP bot | 711 | 634 |
| 3 × OUTPOST-fed shooter | 118 | — |

The three ground-intake builds now land within about ±7 % of each other (seed-to-seed noise is ±50). Three
OUTPOST-only robots share one CHUTE and starve, so that build stays out of AI lineups above Easy — it is the
simple, human-player-dependent option, not a peer.

## Archetypes (2024)

Same method against Turret + Pivot + Pivot (4 seeds; mirror Δ −25):

| 2024 alliance | Blue | Red | Gain vs mirror |
|---|---:|---:|---:|
| 3 × Turret shooter | 204 | 177 | +52 |
| 3 × Under-bumper pivot | 134 | 141 | +18 |

Shooting on the move keeps the turret ahead even after making it the heaviest, slowest build (4.0 m/s vs 4.6) and
equalizing SPEAKER range; it remains the rare "elite" option. The SOURCE-only shooter is clearly weaker in an AI
lineup (it can't pick up passed or loose NOTES), so it is only used on Easy. 2025 archetypes got the same kind of
trade-offs (the all-rounder is heaviest and slowest to drive and place; the short elevator and trough bot are light
and quick) without a separate benchmark.

AI lineups (station 1, 2, 3) per opponent difficulty:

| Season | Easy | Normal | Hard | Elite |
|---|---|---|---|---|
| 2026 | Outpost, Dumper, Turret | Dumper, Turret, Big-hopper | same as Normal | same as Normal |
| 2024 | KitBot, SOURCE-fed, Pivot | Pivot, Pivot, Turret | Pivot, Turret, Turret | Turret, Turret, Turret |
| 2025 | Trough, L2–L3, Funnel L4 | Funnel L4, L2–L3, All-rounder | Funnel L4, All-rounder, Funnel L4 | same as Hard |

A role you order for a teammate picks a fitting build (e.g. 2024 *Amp* → AMP + TRAP specialist), and the menu lets you
choose each teammate's robot directly.
