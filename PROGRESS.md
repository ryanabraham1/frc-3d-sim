# REBUILT realism push: progress tracker

Updated as work lands. `[x]` = done and pushed to main, `[~]` = in progress, `[ ]` = not started.
Last updated: 2026-10-14. COST CUT: the hood and pile agents finish their current item and stop; only the mechanism agent continues, on a narrowed list. AI tests are skipped for all of this work (your call).

---

## 1. Raised hood visibly blocks the TRENCH (agent a98fa75)

When shooting, the hood rises enough that you can see it hit the TRENCH arm. The robot is stopped exactly where the
drawn hood touches it, never by an invisible box.

- [x] Hood collider is fitted to the drawn hood every time it moves (`9de6957`)
- [x] Hoods open visibly while shooting, and park flat when not shooting (`9de6957`)
- [x] Hood collider only active at the TRENCH arm, so it does not snag elsewhere (`d56516b`)
- [x] Fast suite green after the hood changes (1285 tests)
- [x] Hood "skirt" stops the robot exactly at the TRENCH arm face, no tipping (`1bbb6c3`). In the browser, 1678, 4414 and a generic dumper stop with the drawn hood touching the arm face (0 cm gap)
- [x] Robots no longer spin when the hood hits the arm: the stop acts on the robot's centreline; 971, 1690, 2910 and 4414 stop square (under 5° of yaw) (`75bf98c`)
- [ ] Shots leave through the hood mouth along the real path (indexer, flywheel, hood) and never pass through shooter parts (your report: balls clip out of the shooter)
- [x] ~~4414/1690 flat top when parked~~: cancelled (you changed the 4414 model yourself)

## 2. Hopper pile containment (agent a98038f)

Balls held in the hopper (the visual pile) don't jitter, leak or sit inside mechanisms.

- [x] Over-constrained piles freeze instead of jittering forever; roof clamp uses the final position (`3c0bc51`). Jitter is now 0 on all 24 REBUILT robots (4414 used to jump 10 cm)
- [x] 2910's pile follows its sloped clear roof (no balls through the front slope); 3256's open bin stops churning (`b941ba1`)
- [x] No FUEL leaving the hopper and no jitter at rest while driving and turning, full and part-full, on 1678, 1690, 971, 2910
- [x] 1690's pile bin matches its drawn walls (balls overlapping by more than 1 cm: 25 → 14 of 39) (`042f7f3`)
- [x] Visual pile packs foam FUEL at 0.9 × radius (shared `FUEL_PACK_RADIUS`), balls drawn full size; still 0 jitter on all 24 robots (`ca4e406`)
- [~] Remaining overlaps (balls sunk more than 1 cm into drawn parts, full load): 971 18/35, 1678 27/70, 1690 14/38, 2910 6/50. Now adding per-robot keepouts using the room the packing freed
- [~] No FUEL inside the 2910 shooter, feeder rollers or intake (still overlapping)
- [~] 4414 rotor containment written (`f5797f9`, not on main). Handed to agent a091c2e: once kept out of the mechanisms, only about 72 FUEL fit, which clashes with the 85/105 target
- [ ] Keepouts on EVERY hopper robot (24), not just four: 0 balls sunk more than 1 cm into any mechanism. Then piles rise and stretch their nets naturally (your report: balls clip into mechanisms, so nets look emptier than they should)
- [ ] ~~Intaken balls enter from the intake side~~: dropped (cost cut); real-body hoppers replace the drawn pile
- [ ] Checked full and part-full in the browser (worker mode)

## 3. Balls physically move through the mechanism (agent a091c2e)

FUEL is only taken in by real mechanism contact (no suction), travels intake → indexer or dye rotor → shooter, and the
intake retracts near empty to push the last balls in.

- [x] Physical mechanism hopper (`MechHopper`) for 2910 and 4414, behind `?hopper=all` (`42aad27`)
- [x] 4414 mechanism hooks: dye-rotor screw drive, reworked throat into the turret, launched at the flywheel (`42aad27`)
- [ ] 4414 feed rate: only about 1–2 FUEL/s through the rotor today, far below the real robot (known gap)
- [x] Intake only grabs balls it actually touches (`42aad27`, with `?hopper=all`)
- [ ] Intake folds in near empty to squeeze the last FUEL into the indexer or rotor (2910, 4414)
- [ ] Balls going into the 4414 hopper land, roll and pile up on the load (no popping into place)
- [ ] Real-body hoppers ON BY DEFAULT for every robot, built the way rebuilt.firstroboticsim does it (read from their code). Balls slosh, and spill over an open rim on a hard hit (e.g. a full 3256); netted hoppers keep them. Budget: worker step under about 4 ms in a 3v3 with full hoppers
  - each ball stays one Rapier body: in a hopper it switches to a "carried" group at 0.9 × radius; balls in the indexer lanes are disabled and moved by the feed; a ball leaving the hopper goes back to normal (spills)
  - thick (8 cm) hopper walls, plus a per-step correction that keeps carried balls on the deck and pushes them with moving walls: no jitter, no leaks
- [ ] All tests green; browser check in worker mode

### 3b. 4414 capacity: about 85 under the TRENCH, 105+ stretched (same agent)

Modelled on rebuilt.firstroboticsim.com's 4414 (115 FUEL): foam FUEL packs at 0.9 × radius, and the net is a big dome
whose AVERAGE lift is the full 29.5 in stretch, with the middle peaking near the 30 in limit. It covers the box plus
the slide-out drawer, with holes over the turret and rotor.

- [~] FUEL packs at 0.9 × radius (squished foam): shared `FUEL_PACK_RADIUS` in config.ts, used by MechHopper (`1ac47e7`; 2910 uses 0.95); visual pile next

- [~] TRENCH clearance comes from the measured pile top under the net, not from a count formula (groundwork in `1ac47e7`)
- [ ] Net collider and drawn net follow that measured height; an over-full net visibly hits the TRENCH arm
- [ ] Intake under the TRENCH stops when the pile would reach the arm (no fixed cutoff count)
- [ ] 105 FUEL physically fit (net area covers the box and the extended tray), with nothing in the turret or rotor keepouts
- [ ] Tests: about 85 passes under the TRENCH, about 100 is blocked (the cutoff is a range, emerging from the pile)

### 3c. All hopper nets realistic like rebuilt.firstroboticsim (same agent)

Shared net code, applied to every netted robot (254, 581, 6800, 9470, 1323, 4414, 1678, 2910, 604).

- [x] Shared dome net shape (big round dome, tied at the rim), also used as the pile ceiling (`1ac47e7`)
- [ ] Covers/holes over turret, rotor and wheel stacks; chamfer and drawer support
- [~] Drawn net drapes over the real ball tops with sag between, tied at the rim (`1ac47e7`); diamond mesh look still to check
- [ ] All netted robots converted (1678 keeps its telescoping roof)
- [ ] Browser check slack and full on 4414, 254, 1678, 1323, 581, 2910

## 0. Lag and flashing (me)

- [x] Field and HUBs re-simplified: 2.1M → 0.38M triangles per frame, render time 43 ms → 3.9 ms in a 3v3 match (`f73bb72`). Downloads: field 5.9 → 1.3 MB, HUB 1.5 → 0.36 MB
- [x] (other session) Lighter match versions of every robot CAD (`8813287`)
- [~] Flashing: most likely the quality governor dropping shadows under the old 43 ms frames, which recompiles every material at once. It shouldn't trigger now; still needs a check with the browser pane visible

## 4. Field CAD + hub (me)

- [x] HUB drawn from the official field CAD; scored FUEL travels through it as the same ball (`41e5c8c`)
- [x] Hopper nets mirrored from the simulation worker to the screen (1678 telescoping net, stretching and CAD-hopper nets) (`bdc48b6`)
- [x] Whole field drawn from the official field CAD (`7f2087a`)
- [x] REBUILT banner removed from the hub side (`c050366`)
- [x] Slow AI benchmark: dropped (skipped per your call). For the record, 10-seed runs showed Normal AI improved with the CAD hub (637 vs 585 per match) and Hard stayed level
- [x] Removed the temporary `pre-hub` comparison worktree

## Other sessions (not tracked here)

- [x] Field CAD camera lag, fading and alliance paint fixes (`03dcf15`, `d8d6cf6`, `7296b93`)

## Done earlier

- [x] Simulation runs in a Web Worker (no lag on the page)
- [x] Motion-profiled hood and turret; hood parks unless shooting
- [x] 4414 and 1690 models rebuilt from match photos and the AI reference GLBs
- [x] Robot picker no longer draws a spinning robot over a standing one
