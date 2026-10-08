# 6800 Mantis — playable Hero Heist CAD

Select **WCP CADathon: Hero Heist → team 6800 · Mantis**. This is Valor’s CADathon Mystic, separate from its 2026 Downpour robot.

Source: [Onshape assembly](https://cad.onshape.com/documents/e4397ae1ed0ebe3445466e8a/w/dc22b6503a48cdc0a163c772/e/579f1fa8cfef57db8f7205ca), [Valor technical binder](https://drive.google.com/file/d/13vtXk3quJwtnLouwWYrYYzpjj4qm8j8W/view), and yellow row 51 of the [submission sheet](https://docs.google.com/spreadsheets/d/1puhGmcSgHVSIsmb2TWnyxC6fqbZaQrJXKUxNsb7Mt-s/edit?gid=0).

The actual CAD retains fifteen groups: frame, both intakes, spindexer, telescope base/three stages/suction pad, shooter base, turret, roller hood, flywheel, magazine mount and magazine. Runtime animation deploys the two side intakes, follows turret yaw and launch elevation, spins the flywheel, folds the magazine/shooter and extends the telescope. The procedural fallback approximates the same layout. Generic bumpers and colliders remain in use.

The exported shooter exits toward −x (flywheel and hood roller pinch the ball up and back, away from the turret-axis feed), so the runtime adds a half turn to the commanded turret yaw and raises the hood by turning it the opposite way about the flywheel. The ~52° rest elevation is read from the CAD roller centres [EST].

Both physical side mouths collect bubbles in gameplay. Storage is six bubbles and no panels. Launcher mount follows the measured turret center; three bubbles/second comes from the binder’s six-bubble/two-second design claim. Speed, acceleration, playing mass and travel are simulator estimates. Four-bar motion is fitted from one CAD pose rather than a full mate solver. The climb is conservatively capped at medium pending verification of the complete folded envelope; the source claims high.

Source file: `hero-mantis-6800-source.glb`, 112,421,496 bytes / 5,488,024 triangles. Prepared asset: 7,367,364 bytes / 523,960 triangles, 831 omitted occurrences. Coordinate mapping: `(-Y,Z,-X)` in meters. Source colors and lossless occurrence positions are retained with Meshopt compression.

Reproduce with `npm run cad:prepare -- /Users/ryanabraham/Downloads hero-mantis-6800`. Gallery: `/tools/robot-gallery.html?season=wcp-hero-heist&cad`.

Validation: actual runtime decoder, finite joint sweeps and stationary frame, legal normalized roster configuration, collection from both sides on both alliances, Hero Heist rule tests, full build, and browser gallery intake/aim/climb poses.
