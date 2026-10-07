# 2026 CAD FUEL contacts

Imported 2026 CAD robots and robots with CAD donor assemblies now use sphere contacts against their visible mesh triangles for stored FUEL and intake/feed transport. BVHs are built lazily and cached per geometry. Model transforms are sampled after articulation; whole-chassis motion cancels in the hopper frame. Sleeping piles continue to check for moving surfaces but skip contact solving and instance uploads until disturbed. Empty piles skip surface updates.

CAD hopper floors retain their fitted source height. Expanding/sliding CAD hoppers use one persistent pile with continuously changing bounds rather than swapping separate compact/expanded piles at the halfway point. Capacity and shooter-rate settings are unchanged.

Intake/feed transport uses velocity-based roller traction toward fitted transport lanes, gravity, and triangle contact reactions at 120 Hz substeps. Intake handoff uses the transported ball's actual position. Balls and CAD remain in the same robot frame on replicas as on the host.

## Remaining approximations

This is a hybrid contact simulation, not a fully physical mechanism simulation. Fitted hopper bounds still retain the load; transport lanes and durations still drive the rollers/feeder approximation. Capture still reserves a field piece immediately, shot timing and launch speed still come from gameplay configuration, and transport tokens have a bounded lifetime. The hopper handoff confines arrivals to the fitted bin. Balls do not apply reaction forces to the chassis, and intake/feed tokens do not collide with each other. These limits mean a blocked feed cannot yet cause a gameplay jam or alter shot timing. Procedural robots retain their existing solver: their approximate enclosures are not suitable as exact CAD contact surfaces.

Validation: `tests/fuel-cad-contact.test.ts` covers floor support, inclined normals, moving parts, chassis-transform invariance, persistent deployment, actual imported CAD through visual optimization, and blocked intake transport. Existing hopper-motion, spill, expansion, CAD and piece-flow tests cover shared behavior.

## Held FUEL are real Rapier bodies (`src/engine/robot/stowBay.ts`)

On the host and in single player, a held FUEL is the same pool body that rolls on the field, drawn by the pool's own
mesh, not an entry in a separate particle pile (that pile and its fitted-slot solver remain only for multiplayer
replicas and the robot gallery, which have no pool).

- **Walls:** a floor, four sides and, for covered/netted hoppers, a roof, attached to the chassis body in the `STOW_WALL`
  group that only held pieces (`STOWED`) touch. They follow the live bounds of the active bins (`Robot.fuelCavity()`), so
  deployed extensions and a lifted roof change the cavity. Chassis acceleration, tilt and impacts move the pile through
  ordinary contacts.
- **Model geometry:** every visible mesh of the model that reaches the hopper region (CAD rails, plates, feeders, shooter,
  the recreated models' panels) becomes a static trimesh collider in the same group, re-posed when its node moves
  (120k triangle budget, nearest first). Held balls collide with exactly what is drawn.
- **Intake:** a captured ball is not hidden. It keeps its position and is pulled along the model's own intake lane
  (`Robot.intakePath`) at roller speed (`feeding` group: passes walls, still bumps held balls) until it is inside the
  cavity, then it is just a ball in a box. The count and the drawn ball update the instant of capture.
- **Overflow:** an uncovered hopper has no roof and takes `OVERFLOW_ROOM` more balls than rated; extras that clear a wall's
  top edge are released with `GamePiecePool.releaseToField` as the same body with the same velocity. Nothing is spawned.
- **Shooting:** the ball nearest the launcher is the one that leaves.
- Held balls use a collider 7 % smaller than field balls (`STOWED_SCALE`, foam/net compression) so rated loads fit.

Not yet physical: field balls still collide with the chassis box (not the CAD) outside the intake lane; the feed-to-shooter
hop is still a teleport to the launcher exit with a decorative token; a netted hopper's roof is a rigid slab at the net's
full height rather than fabric that stretches; the cavity is one box around the active bins (no turret pillars).
