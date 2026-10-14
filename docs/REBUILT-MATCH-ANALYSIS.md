# REBUILT match-log analysis

209 archive entries: 208 logs with a playable robot schema and one empty diagnostic log. 111 runs lasted at least 155 seconds; this is a long-run filter, not proof that every match ended normally. Personal assessment uses the local player slot, excluding unidentified hosted drivers.

## Your play

In 18 long local games with both alliances explicitly logged as Einstein, your visible hopper increases averaged 608 fuel during the 140-second driving period, versus 266 per bot. This is about 2.28 times the collection flow. You traveled about 292 m versus 251 m per bot, so the advantage is more than simply driving farther.

You consistently keep fuel circulating: collect, feed back into your zone, then score. That is the clearest measurable strength. Your six latest long solo games averaged 597 fuel points, ranging from 521 to 710 across different robots. These are solo fuel totals; multiplayer alliance scores cannot be assigned to you individually.

| Local start (Oct 13, PDT) | Robot | Fuel points | Classified shots | Classified feeds | Uncertain launches | Fuel left |
|---|---:|---:|---:|---:|---:|---:|
| 17:38 | 4414 | 527 | 772 | 180 | 14 | 60 |
| 17:41 | 4414 | 623 | 852 | 241 | 14 | 0 |
| 18:18 | 254 | 539 | 716 | 260 | 2 | 17 |
| 18:22 | 2910 | 521 | 809 | 184 | 3 | 0 |
| 18:25 | 604 | 660 | 777 | 370 | 16 | 27 |
| 18:32 | 4414 | 710 | 1075 | 562 | 14 | 0 |

The 710-point 4414 run had 1,651 launches, approximately 1,075 shots + 562 feeds + 14 near command transitions. The launch count was not a shooting count. 710/1,075 is a score-per-classified-shot ratio (~66%), not pure accuracy: these logs cannot distinguish inactive-window losses, late balls, obstruction, and aiming misses.

Your main opportunities:

- Reduce avoidable rule losses: the six recent solo games contain 4 G403 center-line calls, 6 G407 out-of-zone scoring calls, and 3 G408 catch calls. Together they awarded 175 points to the other side; that is separate from fuel scoring.
- Unload earlier at the end: one recent run finished holding 60 fuel. The logs establish unused inventory, not that all 60 would have scored.
- Leave the narrow bump/trench approaches clear when holding a scoring stance. The pathing fix also makes bots choose another available crossing instead of pushing through you.

Assessment: your collection and field-supply decisions substantially outperform the recorded Einstein bots. The remaining gap is cleaner zone discipline and converting that supply before time expires. A numeric skill rating or exact shooting accuracy would require more detailed telemetry and controlled, equal-build trials.

## Bot findings and changes

- Einstein defaults to scoring and staging instead of opportunistic cross-field raids; hunting starts only after collecting a useful load.
- Larger collection loads amortize crossings, with a deadline to return and unload before a scoring window closes.
- Near-hub shooting stances and a smaller catch guard preserve collection throughput.
- Chassis-aimed scorers can creep through nearby fuel only while aligned, level, and moving slowly.
- AUTO uses dynamic loaded height, reserves travel/alignment/unload time, recovers when it stops making progress, and returns immediately when its time budget is exhausted.
- Crossing selection recognizes stationary robots occupying single-file lanes, chooses an alternate crossing, backs out before changing lanes if already blocked on a bump, and waits clear if every compatible crossing is occupied.
- Teammates route around the driver and do not send rescue shoves to a human who is intentionally shooting/feeding.

Initial matched production-simulator comparison, seeds 1–3, identical 4414/1323/2910 builds on both alliances, all robots controlled by AI, normal moving-shot actuator lag:

| Measure | Before | After | Change |
|---|---:|---:|---:|
| Red fuel total across 3 games | 1,203 | 1,726 | +43.5% |
| Both alliances fuel across 3 games | 2,544 | 3,469 | +36.4% |
| Both alliances AUTO fuel | 292 | 672 | +130.1% |

This is a small deterministic benchmark in the working checkout, not a guarantee of a 43.5% gain against your driving. Final isolated-checkout validation is recorded separately in the engineering notes.

## Limits

- A long run is >=155 seconds, not proof of a normally finished match.
- Human shots/feeds are classified from sampled commands; transitions remain uncertain.
- Bot commands were not logged, so bot launches cannot be split into shots and feeds.
- Score events identify the alliance, not the robot. Solo totals are attributable to the only robot.
- Pickup increases miss simultaneous collection and launch, and include transfers; they are a lower bound on flow.
- Different builds, manual AUTO, old code versions, and possible practice boosts prevent a controlled skill rating.
- The same physical fuel can be recycled repeatedly. Launch and pickup counts are actions, not distinct balls.
- Stopped time includes useful shooting; it cannot be treated as wasted time without command context.
- No logs were uploaded to another service for this analysis.

Reproduce: `python3 tools/analyze_rebuilt_archive.py /Users/ryanabraham/Downloads/2026-rebuilt.zip -o /tmp/rebuilt-analysis/archive-summary.json`.


## Final validation and publication

Published to main in two isolated commits: the friendly rescue/pathing fix and the Einstein scoring/traffic upgrade.
No unrelated working-checkout changes were included.

Final isolated production benchmark: blue/red FUEL 593/589, 652/546, 595/597 for seeds 1–3. Combined FUEL 3,572;
combined AUTO FUEL 689. Every robot scored between 123 and 301 points. These final figures are separate from the
initial working-checkout before/after comparison above.

The build and 12 new regression cases passed across the focused runs. The full intermediate suite completed with
1,456 passing and eight failing tests. Five bot-related failures were corrected and their affected checks passed on
rerun. The remaining three shooter exit/cadence checks also failed on unchanged main; they were not rewritten to
hide those failures. Browser runtime error inspection returned no errors.


Post-push check on `3ef713c`, including the concurrent increase of 4414 to 105 FUEL: all 12 new regressions and the
production build passed. Per-seed blue/red FUEL: 580/572, 532/642, 650/586; combined 3,562 FUEL and 694 AUTO FUEL.
These measurements are not attributed entirely to AI changes, since this version also includes the capacity update.
