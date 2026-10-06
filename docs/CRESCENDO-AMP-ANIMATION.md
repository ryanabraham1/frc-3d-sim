# 2024 AMP mechanism animation

AMP deployment is separate from passing. CRESCENDO rules request it when the
AMP/pass control is held at the robot's own AMP, with AMP capability enabled.
The NOTE stays loaded for the first 0.3 seconds to allow deployment, then the
assisted deposit scores it. Deployment persists for 0.6 seconds after the last
request/deposit, retracts for a speaker-shot command or climbing, and is sent
in multiplayer snapshots as mechanism bit 16. These times are simulator tuning,
not measured actuator times.

## Mechanism references

- [254's technical binder, page 15](https://media.team254.com/2024/10/8f2607a0-2024-Tech-Binder.pdf):
  the amplifier uses an elevator roller carriage with 17 inches of travel;
  it redirects NOTES downward into AMP/TRAP. The procedural model now translates
  the carriage along fixed uprights instead of flipping an arm.
- [118's CAD/code release](https://www.chiefdelphi.com/t/2024-robonauts-cad-and-code-release/478131):
  the turret feeds the shooter and diverter for AMP/TRAP. The imported diverter
  stays attached to the turret. Source CAD 05_9001/05_9002 deploy shafts locate
  the hinge at robot coordinates (-0.118821, 0.455295, 0) meters.
- [Orbit's team explanations](https://www.chiefdelphi.com/t/orbit-1690-presents-2024-robot-reveal-doppler/455350?page=6):
  the last intake rollers feed the pitching shooter arm at its pivot. The CAD
  shooter retains its rear-shaft pitch; the separately exported AMP assembly now
  deploys too. Its rear support center (-0.2644, 0.16944, 0) and 1.25 radian sweep
  are a visual fit to the supplied assembly, not a measured servo linkage model.
- [2056's technical binder, pages 9–13 and 18–19](https://2056.ca/wp-content/uploads/2024/05/OPR24-2056-Technical-Binder.pdf):
  shoulder/shooter rotates on a fixed tower dead axle and has a separate AMP
  position. AMP and passing are separate controller actions.
- [Team RUSH 2024](https://www.teamrush27.net/history/2024-crescendo):
  imported AMP motion uses the paired CAD hinge standoffs
  (0.2667, 0.6477, 0), replacing the previous offset pivot. The drive shaft at
  (0.1973005, 0.6393434, 0) is not the arm hinge; brackets and gearbox remain fixed. Travel angles
  remain a simulation fit.

CAD units are meters; +X is the scoring side, +Y is up, Z is transverse.
Other teams' AMP angles and lift distances are fitted poses, not exact reproductions
of their control software. Existing assisted AMP scoring remains in use.

Validation: deployment lifecycle and pass separation in crescendo.test.ts;
CAD deploy/retract sweeps at three turret headings in crescendo-amp-poses.test.ts;
mechanism bit round-trip in net.test.ts; model gallery front/reverse views.
