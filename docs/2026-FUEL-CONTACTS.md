# 2026 CAD FUEL contacts

Imported 2026 CAD robots and robots with CAD donor assemblies now use sphere contacts against their visible mesh triangles for stored FUEL and intake/feed transport. BVHs are built lazily and cached per geometry. Model transforms are sampled after articulation; whole-chassis motion cancels in the hopper frame. Sleeping piles continue to check for moving surfaces but skip contact solving and instance uploads until disturbed. Empty piles skip surface updates.

CAD hopper floors retain their fitted source height. Expanding/sliding CAD hoppers use one persistent pile with continuously changing bounds rather than swapping separate compact/expanded piles at the halfway point. Capacity and shooter-rate settings are unchanged.

Intake/feed transport uses velocity-based roller traction toward fitted transport lanes, gravity, and triangle contact reactions at 120 Hz substeps. Intake handoff uses the transported ball's actual position. Balls and CAD remain in the same robot frame on replicas as on the host.

## Remaining approximations

This is a hybrid contact simulation, not a fully physical mechanism simulation. Fitted hopper bounds still retain the load; transport lanes and durations still drive the rollers/feeder approximation. Capture still reserves a field piece immediately, shot timing and launch speed still come from gameplay configuration, and transport tokens have a bounded lifetime. The hopper handoff confines arrivals to the fitted bin. Balls do not apply reaction forces to the chassis, and intake/feed tokens do not collide with each other. These limits mean a blocked feed cannot yet cause a gameplay jam or alter shot timing. Procedural robots retain their existing solver: their approximate enclosures are not suitable as exact CAD contact surfaces.

Validation: `tests/fuel-cad-contact.test.ts` covers floor support, inclined normals, moving parts, chassis-transform invariance, persistent deployment, actual imported CAD through visual optimization, and blocked intake transport. Existing hopper-motion, spill, expansion, CAD and piece-flow tests cover shared behavior.
