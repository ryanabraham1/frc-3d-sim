# REBUILT realism push: progress tracker

Updated as work lands. `[x]` = done and pushed to main, `[~]` = in progress, `[ ]` = not started.
Last updated: 2026-10-14 (night). Real-ball hoppers are the default (section 3); latest `7df7826`; fast suite fully green. AI tests are skipped for all of this work (your call).

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
- [~] Keepouts on EVERY hopper robot (24): moving parts get their own clearance field, drawn floors are stood on, the load is re-poured around the mechanisms (`a157bd5`). Sunk balls at full load 388 → 94. The drawn pile is now only the fallback (replicas, shed hoppers)
- [ ] ~~Intaken balls enter from the intake side~~: dropped (cost cut); real-body hoppers replace the drawn pile
- [ ] Checked full and part-full in the browser (worker mode)

## 3. Balls physically move through the mechanism (agent a091c2e)

FUEL is only taken in by real mechanism contact (no suction), travels intake → indexer or dye rotor → shooter, and the
intake retracts near empty to push the last balls in.

- [x] Physical mechanism hopper (`MechHopper`) for 2910 and 4414, behind `?hopper=all` (`42aad27`)
- [x] 4414 mechanism hooks: dye-rotor screw drive, reworked throat into the turret, launched at the flywheel (`42aad27`)
- [x] 4414 feed rate: steady 15.0–15.9 FUEL/s at 60/85/105 loads (dye rotor 6 m/s rim, fin funnels near the throat) (`4aa365d`)
- [x] Intake only grabs balls it actually touches (`42aad27`, with `?hopper=all`)
- [x] Intake folds in near empty to squeeze the last FUEL into the indexer or rotor (2910, 4414): with real balls the moving walls push them; 2910 empties 50/50, 4414 103/105
- [ ] Balls going into the 4414 hopper land, roll and pile up on the load (no popping into place)
- [x] Real-body hoppers ON BY DEFAULT for every robot (StowBay; `?hopper=mech` for the old separate world). Same Rapier body in and out of the hopper, no swap on a spill. 3v3 with six full hoppers: 0.8 ms/step, 1.1 ms (p95 2.2) all feeding; browser worker step 2.2 ms (`aa800e6`)
- [x] Indexer only takes a ball at its entry; driven floor (feed rollers / dye rotor / whole floor) carries floor balls to it while firing; nothing sucked out of the heap (`aa800e6`)
- [x] 2910 and 4414 capture by roller contact; rollers drive a ball only while touching; a dropped ball is a field ball again (no timed drop-in) (`aa800e6`)
- [x] Dumpers launch each ball where it reaches the rollers across their width, no fixed streams (`9867347`)
- [x] Contact capture for every robot: models without roller hooks get a capture bar across their intake mouth; the intake lane carries a ball only while it stays on it (`56822b8`)
- [x] Intake fold policy: chassis-aimed shooters (dumpers, 2910's drum) fold 0.5 s into the shot; turrets pulse when their feed floor has ≤ 2 balls or below 20%; auto-intake rests while shooting (`88f94a0`, `970478c`, `4aa365d`, `7d5e611`)
- [x] Firm hopper faces after every step (4 mm skin, 8 cm slabs), slosh kept; no world-frame damping on held balls; pile wakes on hits/turns (`4aa365d`, `7d5e611`)
- [x] Hoods only pivot (HOOD_LIFT slide removed; HOOD_SEAT fixed offset); stopped at the TRENCH only if the pivoted hood reaches the arm (`970478c`)
- [x] Intakes stay deployed between AUTO and TELEOP (`970478c`)
- [x] ~~Intake fold / pulse / sweep~~: removed at your request; the indexer takes a ball at its entry, else draws the nearest held ball, so nothing is stranded (`eebc8ce`)
- [x] 4414 holds 85 under the TRENCH (binder): idle rotor agitates the load, foam packing 0.9 r (`4c8409a`)
- [x] 1778 floor at its spindexer level (12 of 47 left behind its tower legs, was 27) (`50b943e`)
- [x] 1678 slide-out section has clear side panels (`35545f4`); 604's floor steps up to its tray over the intake (`eebc8ce`); nets tie round the live hopper and held balls stay under the net dome (`f414eab`, `f7522cb`)
- [ ] Generic drawn-shell boundary for every robot (voxel push tried; it blocks feed mechanisms, reverted)
- [x] Every REBUILT robot empties fully at (or near) its rated speed in tests, with shoot-while-tracking as in matches (971 16.7/s, 5940 15.6/s, 6329/7769/9496 ~19/s after their feed rollers stopped holding the shot `2698fa9`)
- [ ] Hard spins (3 rad/s) can still show 8–11 cm single-frame jumps on 4414/3256 (keepout exits)
  - each ball stays one Rapier body: in a hopper it switches to a "carried" group at 0.9 × radius; balls in the indexer lanes are disabled and moved by the feed; a ball leaving the hopper goes back to normal (spills)
  - thick (8 cm) hopper walls, plus a per-step correction that keeps carried balls on the deck and pushes them with moving walls: no jitter, no leaks
- [x] Fast suite fully green (`7df7826`); browser check in worker mode (6 real hoppers, 2910)

### 3b. 4414 capacity: about 85 under the TRENCH, 105+ stretched (same agent)

Modelled on rebuilt.firstroboticsim.com's 4414 (115 FUEL): foam FUEL packs at 0.9 × radius, and the net is a big dome
whose AVERAGE lift is the full 29.5 in stretch, with the middle peaking near the 30 in limit. It covers the box plus
the slide-out drawer, with holes over the turret and rotor.

- [~] FUEL packs at 0.9 × radius (squished foam): shared `FUEL_PACK_RADIUS` in config.ts, used by MechHopper (`1ac47e7`; 2910 uses 0.95); visual pile next

- [~] TRENCH clearance comes from the measured pile top under the net, not from a count formula (groundwork in `1ac47e7`)
- [ ] Net collider and drawn net follow that measured height; an over-full net visibly hits the TRENCH arm
- [ ] Intake under the TRENCH stops when the pile would reach the arm (no fixed cutoff count)
- [ ] 105 FUEL physically fit (net area covers the box and the extended tray, tray reaching the intake), with nothing in the turret or rotor keepouts. Check dims against the HighTide binder (85 should pass under the TRENCH; at ~70 balls poke above it today). Your report: at full load balls overlap and ride above the net
- [ ] Tests: about 85 passes under the TRENCH, about 100 is blocked (the cutoff is a range, emerging from the pile)

### 3c. All hopper nets realistic like rebuilt.firstroboticsim (same agent)

Shared net code, applied to every netted robot (254, 581, 6800, 9470, 1323, 4414, 1678, 2910, 604).

- [ ] Net attachment points: 581 and other netted robots tie their nets in the wrong place (your report)

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

## Multiplayer (latency first)

- [x] Host simulates no real-ball hoppers; every drawn pile runs light; no intake fold logic online (`ae68aea`, `eebc8ce`)
- [x] Smart auto-intake removed; auto-intake just runs
