import type { Alliance } from '@engine/coords';
import type { MatchPeriod } from '@engine/match/clock';
import type { RobotOption } from '@engine/core/season';
import { cloneConfig, DEFAULT_ROBOT, sanitizeConfig, type RobotConfig } from '@engine/robot/config';
import { inch, lb } from '@engine/units';
import * as C from './constants';

export const TIMELINE: MatchPeriod[] = [
  { id: 'auto', label: 'AUTO', duration: 15, mode: 'auto', displayGroup: 'auto' },
  { id: 'auto-pause', label: 'AUTO SCORING', duration: 3, mode: 'disabled' },
  { id: 'teleop', label: 'TELEOP', duration: 115, mode: 'teleop', displayGroup: 'teleop' },
  { id: 'endgame', label: 'END GAME', duration: 20, mode: 'teleop', displayGroup: 'teleop' },
  { id: 'post', label: 'FINAL SCORING', duration: 3, mode: 'disabled' },
];

/**
 * Default: the most common competitive 2025 design — an elevator with a CORAL end effector fed by a funnel from
 * the CORAL STATION, reef auto-align, and a deep CAGE climber. See docs/ROBOT-ARCHETYPES.md.
 */
export function reefscapeRobotDefaults() {
  const c = cloneConfig(DEFAULT_ROBOT);
  c.height = inch(36);
  // A compact frame fits reef approaches and cage lanes; this is a simulator design choice.
  c.frameLength = c.frameWidth = inch(27);
  c.hopperCapacity = 2;
  c.preload = 1;
  c.intake.maxHeight = C.ALGAE_RADIUS * 2 + 0.1;
  c.intake.reach = 0.35;
  c.intake.primary = true;
  c.intake.secondary = false;
  c.intake.ground = false;
  c.intake.station = true;
  c.intake.groundSide = 'back';
  c.intake.stationSide = 'back';
  // ALGAE NET scoring: the elevator rises at the BARGE and the rollers outtake the ALGAE over the NET lip — almost no
  // 2025 team shot it, so it is a mechanism option rather than a launcher.
  c.options = { algaeGround: false, net: false };
  c.placement = { enabled: true, maxLevel: 4, liftSpeed: 1.3, reach: inch(18), cycleSeconds: 0.6, harvestSeconds: 0.45, scoreSide: 'front', handoffSeconds: 0.5 };
  c.processor = { enabled: false };
  c.launcher.enabled = false;
  c.launcher.turret = false; // pick-and-place game: no turret (it would make placement trivially easy)
  c.launcher.height = inch(38);
  c.launcher.minAngle = Math.PI / 6;
  c.launcher.maxAngle = Math.PI * 0.46;
  c.launcher.maxSpeed = 16;
  c.launcher.rate = 2;
  c.aimAssist = 'speed';
  c.autoAlign = true;
  c.climber.maxLevel = 2;
  c.climber.secondsToClimb = 3.6;
  return c;
}

/** Rule limits come from R104/R105/G409; timing ranges are simulator tuning bounds. */
export function normalizeReefscapeConfig(config: RobotConfig): RobotConfig {
  const c = sanitizeConfig(config, inch(42), inch(120)), d = reefscapeRobotDefaults();
  const bounded = (v: number | undefined, fallback: number, lo: number, hi: number) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v!)) : fallback;
  c.intake.primary ??= true; c.intake.secondary ??= true;
  c.intake.ground ??= true; c.intake.groundSide ??= 'back'; c.intake.station ??= false; c.intake.stationSide ??= 'back';
  // Older configs flagged NET scoring with the launcher; NET scoring is now the elevator outtake.
  c.options = { ...d.options, ...c.options, net: !!(c.options?.net ?? c.launcher.enabled) };
  c.launcher.enabled = false;
  c.placement = { ...d.placement!, ...c.placement };
  const p = c.placement;
  p.maxLevel = Math.round(bounded(p.maxLevel, 4, 1, 4));
  p.reach = bounded(p.reach, inch(18), 0, inch(18));
  p.liftSpeed = bounded(p.liftSpeed, 1.3, 0.25, 2.5);
  p.cycleSeconds = bounded(p.cycleSeconds, 0.6, 0.2, 3);
  p.harvestSeconds = bounded(p.harvestSeconds, 0.45, 0.2, 3);
  p.scoreSide = p.scoreSide === 'sides' || p.scoreSide === 'ends' ? p.scoreSide : 'front';
  p.handoffSeconds = bounded(p.handoffSeconds, 0.5, 0, 2);
  c.processor = { ...d.processor!, ...c.processor };
  // A CORAL intake needs a way in: floor or funnel.
  if (c.intake.primary && !c.intake.ground && !c.intake.station) c.intake.primary = false;
  // Named storage mechanisms follow the supplied CAD and user corrections.
  const buffered = c.options.coralBuffer === true || (c.options.coralBuffer === undefined && ['whisper-1690', 'subzero-1778', 'lightning-2056', 'zuma-581'].includes(c.model ?? ''));
  c.options.coralBuffer = buffered;
  if (['subzero-1778', 'zuma-581'].includes(c.model ?? '')) c.options.coralBufferLocation = 'intake';
  const dualStorage = buffered || (c.options.dualPieceStorage ?? (!c.model || ['firefly-118','sublime-1678'].includes(c.model)));
  c.options.dualPieceStorage = dualStorage === true;
  const types = Number(c.intake.primary) + Number(c.intake.secondary);
  c.hopperCapacity = c.options.dualPieceStorage ? types : Math.min(1, types);
  c.preload = c.intake.primary ? Math.min(1, c.preload) : 0;
  c.intake.enabled = c.hopperCapacity > 0;
  c.intake.reach = Math.min(d.intake.reach, Math.max(0, p.reach - c.bumperThickness));
  c.launcher.turret = false;
  if (c.aimAssist === 'full') c.aimAssist = 'speed';
  c.autoAlign ??= true;
  c.climber.maxLevel = Math.round(bounded(c.climber.maxLevel, 2, 0, 2));
  c.climber.secondsToClimb = bounded(c.climber.secondsToClimb, 3.6, 0.5, 12);
  c.launcher.rate = bounded(c.launcher.rate, 2, 0.25, 4);
  c.launcher.height = bounded(c.launcher.height, Math.min(inch(38), c.height), inch(8), c.height);
  return c;
}

type Build = { coral: 'none' | 'l1' | 'l3' | 'l4'; intake: 'funnel' | 'ground' | 'both' | 'none'; algae: 'none' | 'reef' | 'reefGround'; algaeScore: 'none' | 'processor' | 'net' | 'both'; climb: 0 | 1 | 2; align: boolean;
  /** Balance trade-offs: drive speed (m/s), weight (lb), seconds to place a CORAL. */
  speed?: number; weight?: number; cycle?: number };
export function build(b: Build): RobotConfig {
  const c = reefscapeRobotDefaults();
  c.placement!.enabled = b.coral !== 'none';
  c.placement!.maxLevel = { none: 4, l1: 1, l3: 3, l4: 4 }[b.coral];
  c.intake.primary = b.intake !== 'none' && b.coral !== 'none';
  c.intake.ground = b.intake === 'ground' || b.intake === 'both';
  c.intake.station = b.intake === 'funnel' || b.intake === 'both';
  c.intake.secondary = b.algae !== 'none';
  c.options = { ...c.options, algaeGround: b.algae === 'reefGround' };
  c.processor!.enabled = b.algaeScore === 'processor' || b.algaeScore === 'both';
  c.options = { ...c.options, net: b.algaeScore === 'net' || b.algaeScore === 'both' };
  c.climber.maxLevel = b.climb;
  c.autoAlign = b.align;
  if (b.coral === 'l1') { c.height = inch(24); c.placement!.reach = inch(10); }
  if (b.speed) c.maxSpeed = b.speed;
  if (b.weight) { c.mass = lb(b.weight); c.maxAccel *= Math.min(1, 125 / b.weight); }
  if (b.cycle) c.placement!.cycleSeconds = b.cycle;
  return normalizeReefscapeConfig(c);
}

/** Archetypes seen across 2025 events (docs/ROBOT-ARCHETYPES.md). */
export function reefscapeRobotPresets() {
  return [
    { id: 'funnel-l4', label: 'Funnel-fed L4 cycler', description: 'Elevator + CORAL end effector fed by a CORAL STATION funnel (no ground intake), reef auto-align, knocks ALGAE off with the elevator, deep climb. The most common competitive design.', config: build({ coral: 'l4', intake: 'funnel', algae: 'none', algaeScore: 'none', climb: 2, align: true, speed: 4.6, weight: 122 }) },
    { id: 'all-rounder', label: 'Ground-intake all-rounder', description: 'CORAL ground intake + funnel, L1–L4, reef and floor ALGAE into NET and PROCESSOR, auto-align, deep climb. The elite do-everything build: all those mechanisms make it the heaviest and slowest to drive and place.', config: build({ coral: 'l4', intake: 'both', algae: 'reefGround', algaeScore: 'both', climb: 2, align: true, speed: 4.1, weight: 135, cycle: 0.75 }) },
    { id: 'mid-elevator', label: 'L2–L3 elevator', description: 'Single-stage elevator: funnel-fed CORAL on L1–L3, reef ALGAE to the PROCESSOR, shallow climb. A common mid-tier build: the short elevator is light, quick and places fast.', config: build({ coral: 'l3', intake: 'funnel', algae: 'reef', algaeScore: 'processor', climb: 1, align: true, speed: 4.8, weight: 115, cycle: 0.5 }) },
    { id: 'trough', label: 'L1 trough bot', description: 'Low, simple robot: CORAL ground intake scoring only the L1 trough, floor ALGAE to the PROCESSOR, shallow climb, no auto-align (kit-bot style).', config: build({ coral: 'l1', intake: 'ground', algae: 'reefGround', algaeScore: 'processor', climb: 1, align: false, speed: 4.9, weight: 110 }) },
    { id: 'algae', label: 'ALGAE specialist', description: 'No CORAL scoring: removes reef ALGAE and collects it from the floor, outtakes into the NET from its raised elevator and feeds the PROCESSOR, deep climb.', config: build({ coral: 'none', intake: 'none', algae: 'reefGround', algaeScore: 'both', climb: 2, align: true, speed: 4.7, weight: 118 }) },
  ];
}

const opt = (id: string, label: string, choices: [string, string, string?][], get: (c: RobotConfig) => string, set: (c: RobotConfig, v: string) => void, hint?: string): RobotOption =>
  ({ id, label, hint, choices: choices.map(([cid, l, title]) => ({ id: cid, label: l, title })), get, set: (c, v) => { set(c, v); Object.assign(c, normalizeReefscapeConfig(c)); } });

export const reefscapeRobotOptions: RobotOption[] = [
  opt('coral', 'CORAL scoring', [['none', 'None'], ['l1', 'L1 trough'], ['l3', 'Up to L3'], ['l4', 'Up to L4']],
    (c) => !c.placement!.enabled ? 'none' : c.placement!.maxLevel === 1 ? 'l1' : c.placement!.maxLevel <= 3 ? 'l3' : 'l4',
    (c, v) => { c.placement!.enabled = v !== 'none'; c.placement!.maxLevel = v === 'l1' ? 1 : v === 'l3' ? 3 : 4; if (v !== 'none' && !c.intake.ground && !c.intake.station) c.intake.station = true; c.intake.primary = v !== 'none'; },
    'Elevator height limit. L1 is the trough (18 in); L2 31⅞ in, L3 47⅝ in, L4 72 in.'),
  opt('coralIntake', 'CORAL intake', [['funnel', 'Station funnel', 'Catches CORAL rolling out of the CORAL STATION CHUTE'], ['ground', 'Ground', 'Picks CORAL up off the carpet'], ['both', 'Both'], ['none', 'None']],
    (c) => !c.intake.primary ? 'none' : c.intake.ground && c.intake.station ? 'both' : c.intake.ground ? 'ground' : 'funnel',
    (c, v) => { c.intake.primary = v !== 'none'; c.intake.ground = v === 'ground' || v === 'both'; c.intake.station = v === 'funnel' || v === 'both'; },
    'Without a ground intake you depend on your human player dropping CORAL into your funnel.'),
  opt('algae', 'ALGAE handling', [['none', 'Knock off only', 'The elevator can still knock reef ALGAE onto the carpet'], ['reef', 'Grab from REEF'], ['reefGround', 'REEF + ground']],
    (c) => !c.intake.secondary ? 'none' : c.options?.algaeGround ? 'reefGround' : 'reef',
    (c, v) => { c.intake.secondary = v !== 'none'; c.options = { ...c.options, algaeGround: v === 'reefGround' }; }),
  opt('pieceStorage', 'Piece storage', [['buffered', 'CORAL buffer + gripper', 'Stages CORAL in the intake or indexer; score ALGAE before transferring CORAL'], ['shared', 'One shared gripper', 'Holds one CORAL or one ALGAE at a time'], ['separate', 'Separate storage', 'Holds one CORAL and one ALGAE in independent mechanisms']],
    (c) => c.options?.coralBuffer ? 'buffered' : c.options?.dualPieceStorage ? 'separate' : 'shared',
    (c, v) => { c.options = { ...c.options, dualPieceStorage: v !== 'shared', coralBuffer: v === 'buffered' }; }),
  opt('algaeScore', 'ALGAE scoring', [['none', 'None'], ['processor', 'PROCESSOR'], ['net', 'NET (elevator)', 'Raise the elevator at the BARGE and outtake the ALGAE over the NET lip'], ['both', 'Both']],
    (c) => (c.processor!.enabled && c.options?.net ? 'both' : c.processor!.enabled ? 'processor' : c.options?.net ? 'net' : 'none'),
    (c, v) => { c.processor!.enabled = v === 'processor' || v === 'both'; c.options = { ...c.options, net: v === 'net' || v === 'both' }; },
    'NET: line up at the BARGE, the elevator rises to full height and the rollers toss the ALGAE in (G).'),
  opt('scoreSide', 'Scorer faces', [['front', 'Front', 'Elevator end effector on the front: drive nose-in to the REEF'], ['sides', 'Both sides', 'An arm on the elevator swings out to either side (1778 SubZero): line up side-on to the REEF'], ['ends', 'Front and back', 'An arm on the elevator flips over the top (1690 WHISPER): drive in nose-first or tail-first']],
    (c) => c.placement!.scoreSide ?? 'front', (c, v) => { c.placement!.scoreSide = v === 'sides' || v === 'ends' ? v : 'front'; },
    'Side scoring keeps the robot parallel to the REEF face; front-and-back scoring never has to turn around.'),
  opt('assist', 'Driver assist', [['align', 'Reef auto-align', 'Holding Space drives to the nearest open BRANCH (vision pose alignment)'], ['manual', 'Manual alignment']],
    (c) => (c.autoAlign ? 'align' : 'manual'), (c, v) => { c.autoAlign = v === 'align'; },
    'CORAL only goes on when the end effector is lined up with the BRANCH (±1 in).'),
  opt('climb', 'CAGE climber', [['0', 'None'], ['1', 'Shallow'], ['2', 'Deep']],
    (c) => String(c.climber.maxLevel), (c, v) => { c.climber.maxLevel = Number(v); },
    'Park 2 · shallow 6 · deep 12. Sets your station’s cage depth; you may climb any matching alliance cage.'),
];

export function reefscapeSpecBars(config: RobotConfig) {
  const c = normalizeReefscapeConfig(config);
  const intake = !c.intake.primary ? 'no intake' : c.intake.ground && c.intake.station ? 'ground + funnel' : c.intake.ground ? 'ground' : 'funnel';
  return [
    { label: 'CORAL', value: c.placement!.enabled ? `L1–L${c.placement!.maxLevel} · ${intake}` : 'Off', frac: c.placement!.enabled ? c.placement!.maxLevel / 4 : 0 },
    { label: 'ALGAE', value: !c.intake.secondary ? 'Knock off' : [c.processor!.enabled ? 'PROCESSOR' : '', c.options?.net ? 'NET' : ''].filter(Boolean).join(' + ') || 'Pickup only', frac: Number(c.intake.secondary) * (Number(c.processor!.enabled) + Number(!!c.options?.net)) / 2 },
    { label: 'Mechanism reach', value: `${(c.placement!.reach / 0.0254).toFixed(1)} in`, frac: c.placement!.reach / inch(18) },
  ];
}

/** Headline stats on a robot's picker card. */
export function reefscapeCardBars(config: RobotConfig) {
  const c = normalizeReefscapeConfig(config);
  const lift = c.placement!.liftSpeed / 0.0254;
  return [
    { label: 'Lift', value: `${lift.toFixed(0)} in/s`, frac: lift / 98 },
    { label: 'Cycle', value: `${c.placement!.cycleSeconds.toFixed(2)} s`, frac: 1 - (c.placement!.cycleSeconds - 0.2) / 1.2 },
    { label: 'Climb', value: ['Park', 'Shallow', 'Deep'][c.climber.maxLevel], frac: c.climber.maxLevel / 2 },
  ];
}

export function reefscapeRobotSummary(config: RobotConfig): string {
  const c = normalizeReefscapeConfig(config);
  const intake = !c.intake.primary ? '' : c.intake.ground && c.intake.station ? ' (ground + funnel)' : c.intake.ground ? ' (ground)' : ' (funnel)';
  const coral = c.placement!.enabled && c.intake.primary ? `CORAL L1–L${c.placement!.maxLevel}${intake}` : 'CORAL off';
  const algae = c.intake.secondary ? [c.processor!.enabled ? 'PROCESSOR' : '', c.options?.net ? 'NET' : ''].filter(Boolean).join(' + ') || 'ALGAE pickup only' : 'ALGAE knock-off';
  return `${coral}${c.placement!.scoreSide === 'sides' ? ' (side scoring)' : c.placement!.scoreSide === 'ends' ? ' (front + back scoring)' : ''} · ${algae}${c.intake.primary && c.intake.secondary ? c.options?.coralBuffer ? ' · CORAL buffer; ALGAE first' : c.options?.dualPieceStorage ? ' · separate storage' : ' · one piece at a time' : ''} · ${['park only', 'shallow cage', 'deep cage'][c.climber.maxLevel]}${c.autoAlign ? ' · auto-align' : ''}`;
}

export function startPose(a: Alliance, station: number) {
  const p = C.side(a, C.START_LINE, [C.REEF_Y + 2.2, C.REEF_Y, C.REEF_Y - 2.2][station - 1]);
  return { ...p, yaw: C.sideYaw(a, Math.PI) };
}

export function driverEye(a: Alliance, station: number) {
  const p = C.side(a, -1.4, [C.REEF_Y + 2.2, C.REEF_Y, C.REEF_Y - 2.2][station - 1]);
  return { ...p, z: 1.95, yaw: C.sideYaw(a, 0) };
}
