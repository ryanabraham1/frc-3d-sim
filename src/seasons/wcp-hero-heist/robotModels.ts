import * as THREE from 'three';
import {
  approach, bar, box, climberHooks, deployableIntake, drivebase, elevator, hoodShell, intakeDeployTarget, mat, pivot, registerRobotModel,
  sidePlates, spin, tubeMat, wheelShaft, type ModelKit, type RobotModel,
} from '@engine/robot/models';
import { inch } from '@engine/units';

/**
 * Hero Heist archetype models (derived designs, no real robots exist; see docs/ROBOT-ARCHETYPES.md). One builder per
 * archetype, every part tied to the frame: a front panel lift whose cradle follows the season's placement pose
 * (`robot.placeAnim`, drawn by rules.ts), a back floor intake (intakes face away from the scoring side), a station funnel
 * for station-fed builds, a turret or fixed-hood bubble shooter, and climber hooks sized by the climb level.
 * Colours: COMMANDER gold, MYSTIC violet, GADGETEER teal accents on aluminium.
 */
const ACCENT = { commander: 0xd4a017, mystic: 0x7b4fd6, gadgeteer: 0x16a39a } as const;
type Hero = keyof typeof ACCENT;

interface Parts { lift?: boolean; magazine?: number; shooter?: 'turret' | 'fixed'; hopper?: number; floor: boolean; funnel?: boolean; sharedTool?: boolean }

function heroModel(k: ModelKit, hero: Hero, p: Parts): RobotModel {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop;
  const alu = tubeMat(0xc0c7cf), dark = mat(0x1d2025), accent = mat(ACCENT[hero], { rough: 0.45 }), poly = mat(0xd8e6f2, { opacity: 0.28, rough: 0.1 });
  const db = drivebase(k, { motorRing: ACCENT[hero] });
  box(k.visual, L * 0.5, 0.012, W * 0.55, dark, -L * 0.05, bt + 0.02, 0); // electronics deck

  // Front panel lift: two rails off the front frame tube, a telescoping stage when the cradle rises past the rails,
  // and a fork cradle that carries the STORY PANEL out over the bumper.
  let liftUpdate: ((h: number, f: number, dt: number) => void) | null = null;
  let held: THREE.Object3D | undefined;
  if (p.lift) {
    const x = L / 2 - 0.06, top = H - 0.02, span = 0.42;
    const lift = elevator(k.visual, { x, y0: bt - 0.01, height: top - bt, width: span, stages: H > inch(40) ? 3 : 2, m: alu });
    for (const sz of [-1, 1]) bar(k.visual, [x - 0.18, bt, (sz * span) / 2], [x, top * 0.7, (sz * span) / 2], 0.02, alu); // rail braces to the frame
    const carriage = pivot(k.visual, x, bt + 0.2);
    box(carriage, 0.03, 0.12, span - 0.06, accent, 0.015, 0, 0);
    const fork = new THREE.Group(); carriage.add(fork);
    for (const sz of [-1, 1]) box(fork, 1, 0.018, 0.025, alu, 0.5, -0.02, sz * 0.14);
    held = pivot(carriage, 0.2, 0);
    let y = bt + 0.2, reach = 0.2;
    liftUpdate = (h, f, dt) => {
      y = approach(y, Math.max(bt + 0.12, h), 6, dt);
      reach = approach(reach, Math.max(0.08, f - x), 6, dt);
      carriage.position.y = y;
      lift.set(Math.max(0, y - (top - 0.15)));
      fork.scale.x = reach; held!.position.x = reach;
    };
  }
  // Back floor intake: wide rollers for the 24 in panel and 7 in bubbles (teal/gold/violet rollers by class).
  let floor: ReturnType<typeof deployableIntake> | null = null;
  if (p.floor) floor = deployableIntake(k, { reach: c.intake.reach, rollers: hero === 'commander' ? 3 : 2, frame: alu, rollerMaterial: accent, width: Math.min(W - 0.04, hero === 'mystic' ? c.intake.width : 0.66) });
  // Station funnel: polycarbonate chute over the back bumper for the human player's slide and chute.
  if (p.funnel) {
    const fx = -L / 2;
    sidePlates(k.visual, [[fx, bt], [fx - 0.02, bt + 0.32], [fx + 0.22, bt + 0.32], [fx + 0.26, bt]], W / 2 - 0.04, poly);
    for (const sz of [-1, 1]) bar(k.visual, [fx + 0.24, bt, (sz * (W / 2 - 0.04))], [fx, bt + 0.32, (sz * (W / 2 - 0.04))], 0.02, alu);
  }
  // Panel magazine (COMMANDER): stacked panel shelves over the deck behind the lift.
  if (p.magazine) {
    const mx = -L * 0.08;
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) bar(k.visual, [mx + sx * 0.26, bt, sz * 0.26], [mx + sx * 0.26, bt + 0.08 + p.magazine * 0.06, sz * 0.26], 0.02, alu);
    for (let n = 0; n < p.magazine; n++) for (const sz of [-1, 1]) box(k.visual, 0.56, 0.01, 0.03, accent, mx, bt + 0.08 + n * 0.06, sz * 0.26);
  }
  // Bubble hopper: polycarbonate bin between the intake and the shooter.
  let fill: { set(f: number): void } | null = null;
  if (p.hopper) {
    const hl = L * 0.42, hw = W * 0.7, hh = Math.max(0.12, Math.min(H - bt - 0.12, 0.08 + p.hopper * 0.035));
    const hx = -L * 0.12;
    for (const sz of [-1, 1]) box(k.visual, hl, hh, 0.006, poly, hx, bt + 0.03 + hh / 2, (sz * hw) / 2);
    for (const sx of [-1, 1]) box(k.visual, 0.006, hh, hw, poly, hx + (sx * hl) / 2, bt + 0.03 + hh / 2, 0);
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) bar(k.visual, [hx + (sx * hl) / 2, bt, (sz * hw) / 2], [hx + (sx * hl) / 2, bt + 0.03 + hh, (sz * hw) / 2], 0.014, alu);
    // Held SPEECH BUBBLES drawn in the bin (visual only: a physics ball bay would jam a short hopper and cost step time).
    const r = 0.0889, ballMat = mat(k.alliance === 'red' ? 0xe83d4f : 0x337fe8, { rough: 0.7 }), geo = new THREE.SphereGeometry(r * 0.95, 12, 8);
    const balls = Array.from({ length: p.hopper }, (_, n) => {
      const m = new THREE.Mesh(geo, ballMat);
      const perRow = Math.max(1, Math.floor(hl / (2 * r))), row = Math.floor(n / perRow);
      m.position.set(hx - hl / 2 + r + (n % perRow) * 2 * r, bt + 0.03 + r + Math.floor(row / 2) * 1.7 * r, (row % 2 ? 1 : -1) * Math.min(hw / 2 - r, r * 1.05));
      m.visible = false; k.visual.add(m); return m;
    });
    fill = { set: f => balls.forEach((b, n) => (b.visible = n < Math.round(f * p.hopper!))) };
  }
  // Shooter in the turret group (yaws with a turret; fixed robots never turn it). Shots leave at the turret origin.
  let wheels: THREE.Group | null = null, hood: THREE.Group | null = null;
  if (p.shooter) {
    const t = k.turret;
    if (p.shooter === 'turret') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 8, 32), accent); ring.rotation.x = Math.PI / 2; ring.position.y = -0.1; t.add(ring);
      box(t, 0.32, 0.01, 0.26, dark, 0, -0.095, 0);
    }
    sidePlates(t, [[-0.12, -0.09], [0.1, -0.09], [0.08, 0.05], [-0.06, 0.07]], 0.12, dark, [[0, -0.02, 0.025]]);
    wheels = wheelShaft(t, 0.02, -0.02, { n: 3, r: 0.051, w: 0.04, span: 0.2, colors: [ACCENT[hero]] });
    hood = hoodShell(t, 0.07, 0.22, alu);
    hood.position.set(0.02, -0.02, 0);
    // Shooter tower from the frame up to the shooter base (the turret bearing for a turret), with the feed column inside.
    const ty = Math.max(c.launcher.height, H) - 0.02 - 0.1;
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) bar(k.visual, [L * 0.18 + sx * 0.1, bt, sz * 0.1], [L * 0.18 + sx * 0.1, ty, sz * 0.1], 0.022, alu);
    box(k.visual, 0.06, ty - bt, 0.12, poly, L * 0.18 - 0.1, (ty + bt) / 2, 0);
  }
  // Climber hooks: longer tubes for higher climbs (the truss underside is 66 in above the carpet).
  const climb = c.climber.maxLevel > 0 ? climberHooks(k.visual, { x: -L * 0.32, y0: bt, length: Math.max(0.3, H - bt - 0.05), spread: W * 0.6, m: alu, hook: accent }) : null;
  let deploy = 0;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel', 'launcher'],
    heldAnchor: held,
    lightAt: [-L * 0.3, Math.min(H, bt + 0.4), W / 2 - 0.05],
    update(s) {
      db.update(s);
      deploy = approach(deploy, intakeDeployTarget(s), 7, s.dt);
      floor?.update(s, deploy);
      if (liftUpdate) liftUpdate(s.place ? s.place.height : bt + 0.2, s.place ? s.place.forward : L / 2 + 0.1, s.dt);
      if (wheels) spin(wheels, s.aiming || s.firing > 0 ? 60 : s.enabled ? 12 : 0, s.dt);
      if (hood) hood.rotation.z = approach(hood.rotation.z, s.aiming ? Math.max(0, s.hood - 0.6) : 0, 4, s.dt);
      climb?.set(s.climb);
      fill?.set(s.fill);
    },
  };
}

const presets: Record<string, [Hero, Parts]> = {
  'hero-gadgeteer-hybrid': ['gadgeteer', { lift: true, shooter: 'fixed', hopper: 3, floor: true }],
  'hero-gadgeteer-flex': ['gadgeteer', { lift: true, shooter: 'fixed', hopper: 4, floor: true, sharedTool: true }],
  'hero-commander-roller': ['commander', { lift: true, magazine: 3, floor: true }],
  'hero-commander-simple': ['commander', { lift: true, floor: false, funnel: true }],
  'hero-mystic-turret': ['mystic', { shooter: 'turret', hopper: 6, floor: true }],
  'hero-mystic-fixed': ['mystic', { shooter: 'fixed', hopper: 4, floor: true }],
};
for (const [id, [hero, parts]] of Object.entries(presets)) {
  registerRobotModel(id, k => heroModel(k, hero, {
    ...parts,
    // The menu's options can change a preset: follow the config, not the preset's defaults.
    floor: k.config.intake.ground !== false,
    funnel: parts.funnel || k.config.intake.ground === false,
    lift: !!k.config.placement?.enabled,
    shooter: k.config.launcher.enabled ? (k.config.launcher.turret ? 'turret' : 'fixed') : undefined,
  }));
}
// A class picked from the menu's Hero class option (archetype = class) uses that class's default build.
for (const hero of ['commander', 'mystic', 'gadgeteer'] as const) {
  registerRobotModel(`hero-${hero}`, k => heroModel(k, hero, {
    floor: k.config.intake.ground !== false, funnel: k.config.intake.ground === false, lift: !!k.config.placement?.enabled,
    magazine: hero === 'commander' ? 3 : undefined, hopper: hero === 'commander' ? undefined : hero === 'mystic' ? 6 : 3,
    shooter: k.config.launcher.enabled ? (k.config.launcher.turret ? 'turret' : 'fixed') : undefined,
  }));
}
export const HERO_MODEL_IDS = [...Object.keys(presets), 'hero-commander', 'hero-mystic', 'hero-gadgeteer'];
