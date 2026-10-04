import type { CameraMode } from '@engine/camera/cameras';
import type { GameSettings, SeasonDefinition } from '@engine/core/season';
import { DEFAULT_CONTROLS_HELP } from '@engine/input/input';
import { ACTIONS, codeLabel, keybinds, SLOTS, type ActionId } from '@engine/input/keybinds';
import { cloneConfig, DEFAULT_WHEEL_COF, footprint, RobotConfig } from '@engine/robot/config';
import { checkStartSpot, clampToArea, type StartSpot } from '@engine/startPose';
import { pushingForce } from '@engine/robot/drivetrain';
import { formatClock, inch, lb, toInch } from '@engine/units';
import { SEASONS, getSeason } from '@seasons/index';
import { aiRobotChoices } from '@engine/ai/robots';
import { icon } from './icons';
import { bindHeadingControls, bindPlacementMap, placementDragging, headingControls, placementMap, presetSpot, rotateSpot, syncHeadingControls, type MineState } from './placement';
import type { LobbyController } from './lobby';
import { bindMultiplayer, multiplayerPage } from './multiplayer';
import './menu.css';

/** Newtons per pound-force. */
const LBF = 4.4482216;
const STORAGE_KEY = 'frc-sim-settings-v1';
const FT = 0.3048;

type Page = 'play' | 'controls' | 'rules' | 'multiplayer';
type PlayTab = 'match' | 'ai' | 'robot';

function load(): Partial<GameSettings> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<GameSettings>) : null;
  } catch {
    return null;
  }
}

function save(s: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode) — fine */
  }
}

export function defaultSettings(season: SeasonDefinition): GameSettings {
  return {
    seasonId: season.id,
    alliance: 'blue',
    station: 2,
    robot: cloneConfig(season.robotDefaults),
    autoRoutine: season.autoRoutines[0]?.id ?? 'none',
    manualAuto: true,
    camera: 'driver',
    autoHumanPlayer: true,
    autoIntake: true,
    seed: Math.floor(Math.random() * 1e6),
    shadows: true,
    aiOpponents: true,
    aiDifficulty: 'normal',
  };
}

interface NumField {
  key: string;
  label: string;
  min: number;
  max?: number;
  step: number;
  get: (c: RobotConfig) => number;
  set: (c: RobotConfig, v: number) => void;
}

function numFields(season: SeasonDefinition): Record<string, NumField> {
  const list: NumField[] = [
    { key: 'team', label: 'Team #', min: 1, max: 99999, step: 1, get: (c) => c.teamNumber, set: (c, v) => (c.teamNumber = Math.round(v)) },
    { key: 'height', label: 'Height in', min: 8, max: toInch(season.maxRobotHeight), step: 0.25, get: (c) => +toInch(c.height).toFixed(2), set: (c, v) => (c.height = inch(v)) },
    { key: 'len', label: 'Length in', min: 18, max: 36, step: 0.5, get: (c) => +toInch(c.frameLength).toFixed(1), set: (c, v) => (c.frameLength = inch(v)) },
    { key: 'wid', label: 'Width in', min: 18, max: 36, step: 0.5, get: (c) => +toInch(c.frameWidth).toFixed(1), set: (c, v) => (c.frameWidth = inch(v)) },
    { key: 'speed', label: 'Speed ft/s', min: 6, max: 22, step: 0.5, get: (c) => +(c.maxSpeed / FT).toFixed(1), set: (c, v) => (c.maxSpeed = v * FT) },
    { key: 'accel', label: 'Accel ft/s²', min: 8, max: 45, step: 1, get: (c) => Math.round(c.maxAccel / FT), set: (c, v) => (c.maxAccel = v * FT) },
    // Defense: weight (with bumpers + battery) and tread grip set how hard the robot pushes and resists a push.
    { key: 'weight', label: 'Weight lb', min: 60, max: Math.floor((season.maxRobotWeight ?? lb(150)) / lb(1)), step: 1, get: (c) => Math.round(c.mass / lb(1)), set: (c, v) => (c.mass = lb(v)) },
    { key: 'tread', label: 'Tread grip μ', min: 0.6, max: 1.5, step: 0.05, get: (c) => c.wheelCOF ?? DEFAULT_WHEEL_COF, set: (c, v) => (c.wheelCOF = v) },
    { key: 'cap', label: 'Capacity', min: 1, max: season.robotLimits?.capacity ?? 120, step: 1, get: (c) => c.hopperCapacity, set: (c, v) => (c.hopperCapacity = Math.round(v)) },
    { key: 'pre', label: 'Preload', min: 0, max: season.robotLimits?.preload ?? 8, step: 1, get: (c) => c.preload, set: (c, v) => (c.preload = Math.round(v)) },
    { key: 'rate', label: 'Shots/s', min: 1, max: 35, step: 0.5, get: (c) => c.launcher.rate, set: (c, v) => (c.launcher.rate = v) },
    {
      key: 'acc',
      label: 'Accuracy %',
      min: 0,
      max: 100,
      step: 5,
      get: (c) => Math.max(0, Math.round(100 - ((c.launcher.spread - 0.002) / 0.06) * 100)),
      set: (c, v) => {
        c.launcher.spread = (0.06 * (100 - v)) / 100 + 0.002;
        c.launcher.speedError = (0.06 * (100 - v)) / 100 + 0.004;
      },
    },
    { key: 'cspd', label: 'Sec/level', min: 0.5, max: 6, step: 0.1, get: (c) => +c.climber.secondsPerLevel.toFixed(1), set: (c, v) => (c.climber.secondsPerLevel = v) },
  ];
  if (season.shotAccuracy) {
    const acc = list.find((f) => f.key === 'acc')!;
    acc.get = season.shotAccuracy.get;
    acc.set = season.shotAccuracy.set;
    acc.step = 1;
  }
  if (season.year === 2026) {
    for (const f of list) {
      if (['speed', 'accel', 'cap', 'rate', 'cspd'].includes(f.key)) delete f.max;
    }
  }
  if (season.maxScoringLevel) {
    const find = (key: string) => list.find((f) => f.key === key)!;
    find('height').label = 'Starting height in'; find('len').label = 'Frame length in'; find('wid').label = 'Frame width in';
    find('pre').label = 'CORAL preload'; find('rate').label = 'ALGAE shots/s'; find('rate').min = 0.25; find('rate').max = 4; find('rate').step = 0.25;
    find('acc').label = 'NET accuracy %'; find('acc').step = 1;
    Object.assign(find('cspd'), { label: 'Climb rise s', max: 12, get: (c: RobotConfig) => c.climber.secondsToClimb ?? 3.6, set: (c: RobotConfig, v: number) => (c.climber.secondsToClimb = v) });
    list.push(
      { key: 'reach', label: 'Mechanism reach in', min: 0, max: 18, step: 0.5, get: (c) => +toInch(c.placement!.reach).toFixed(1), set: (c, v) => (c.placement!.reach = inch(v)) },
      { key: 'lift', label: 'Elevator in/s', min: 10, max: 98, step: 0.1, get: (c) => +toInch(c.placement!.liftSpeed).toFixed(1), set: (c, v) => (c.placement!.liftSpeed = inch(v)) },
      { key: 'place', label: 'CORAL cycle s', min: 0.2, max: 3, step: 0.1, get: (c) => c.placement!.cycleSeconds, set: (c, v) => (c.placement!.cycleSeconds = v) },
      { key: 'harvest', label: 'ALGAE removal s', min: 0.2, max: 3, step: 0.05, get: (c) => c.placement!.harvestSeconds, set: (c, v) => (c.placement!.harvestSeconds = v) },
      { key: 'release', label: 'ALGAE release in', min: 8, max: toInch(season.maxRobotHeight), step: 0.5, get: (c) => +toInch(c.launcher.height).toFixed(1), set: (c, v) => (c.launcher.height = inch(v)) },
    );
  }
  return Object.fromEntries(list.map((f) => [f.key, f]));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function opt(attrs: string, label: string, on: boolean, extra = '', lead = ''): string {
  return `<button class="opt ${on ? 'on' : ''} ${extra}" ${attrs}>${lead}<span>${esc(label)}</span></button>`;
}

function group(label: string, body: string, hint = '', cls = ''): string {
  return `<div class="group ${cls}"><div class="label">${esc(label)}</div>${body}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
}

const CAMERAS: [CameraMode, string][] = [
  ['follow', '3rd person'],
  ['chase', 'Chase'],
  ['driver', 'Driver station'],
  ['overhead', 'Overhead'],
];

/**
 * Isometric robot. The shooter/scorer barrel points to the far (upper-right) edge, the orange intake roller sits on
 * the opposite near (lower-left) edge when the intake is on the back — and the other way round for a front intake.
 */
function robotArt(alliance: 'red' | 'blue', team: number, groundSide: 'front' | 'back' = 'back'): string {
  const c = alliance === 'red' ? '#ef4444' : '#4f8cff';
  const back = groundSide !== 'front';
  // Near edge (lower-left) and far edge (upper-right) of the base diamond, offset outward by the roller thickness.
  const near = '<line x1="33" y1="103" x2="101" y2="137" stroke="#ff7a1a" stroke-width="8" stroke-linecap="round"/><line x1="33" y1="101" x2="101" y2="135" stroke="#ffb066" stroke-width="2" stroke-linecap="round"/>';
  const far = '<line x1="109" y1="55" x2="177" y2="89" stroke="#ff7a1a" stroke-width="8" stroke-linecap="round"/><line x1="109" y1="53" x2="177" y2="87" stroke="#ffb066" stroke-width="2" stroke-linecap="round"/>';
  const label = (x: number, y: number, t: string, fill: string) =>
    `<text x="${x}" y="${y}" transform="rotate(27 ${x} ${y})" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="11" fill="${fill}" letter-spacing="1.5">${t}</text>`;
  return `<svg viewBox="0 0 210 150" aria-hidden="true">
    <ellipse cx="105" cy="112" rx="88" ry="26" fill="none" stroke="#2f2f3c" stroke-width="1.5"/>
    <polygon points="105,62 172,96 105,130 38,96" fill="${c}"/>
    <polygon points="105,74 156,98 105,122 54,98" fill="#0c0c10"/>
    <polygon points="38,96 105,130 105,138 38,104" fill="${c}" opacity=".6"/>
    <polygon points="172,96 105,130 105,138 172,104" fill="${c}" opacity=".4"/>
    <polygon points="105,30 130,42 130,84 105,96 80,84 80,42" fill="#8b6cf6"/>
    <polygon points="105,30 130,42 105,54 80,42" fill="#a48bff"/>
    <polygon points="105,54 130,42 130,84 105,96" fill="#6c4fd8"/>
    <polygon points="118,36 150,52 150,60 118,44" fill="#d9d9e8"/>
    <polygon points="150,52 156,55 156,63 150,60" fill="#8f8fa6"/>
    ${back ? near : far}
    ${label(back ? 60 : 150, back ? 140 : 62, 'INTAKE', '#ff9a3c')}
    ${label(back ? 160 : 60, back ? 82 : 140, 'SHOOTER', '#c9c9d8')}
    <text x="105" y="112" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="15" fill="#fff" letter-spacing="1">${team}</text>
  </svg>`;
}

export function showMenu(container: HTMLElement, onStart: (s: GameSettings) => void, opts: { lobby?: LobbyController; page?: Page } = {}): void {
  const stored = load();
  let season = getSeason(stored?.seasonId ?? SEASONS[0].id);
  let s: GameSettings = { ...defaultSettings(season), ...(stored ?? {}) };
  if (stored?.robot) {
    const d = season.robotDefaults;
    s.robot = {
      ...cloneConfig(d),
      ...stored.robot,
      launcher: { ...d.launcher, ...stored.robot.launcher },
      climber: { ...d.climber, ...stored.robot.climber },
      // Intake faces aren't editable: always the season's (a saved front-mounted intake predates the back-mounted default).
      intake: { ...d.intake, ...stored.robot.intake, groundSide: d.intake.groundSide, stationSide: d.intake.stationSide },
    };
  }
  let page: Page = opts.page ?? 'play';
  let playTab: PlayTab = 'match';
  const lobby = opts.lobby;

  const el = document.createElement('div');
  el.className = 'shell';
  container.appendChild(el);

  const matchLength = () => season.timeline.filter((p) => p.mode !== 'disabled').reduce((a, p) => a + p.duration, 0);
  const numInput = (f: NumField) =>
    `<label class="num"><span>${esc(f.label)}</span><input type="number" data-f="${f.key}" min="${f.min}"${f.max === undefined ? '' : ` max="${f.max}"`} step="${f.step}" value="${f.get(s.robot)}"/></label>`;

  const specBar = (label: string, value: string, frac: number) => {
    const n = Math.round(Math.min(1, Math.max(0, frac)) * 10);
    return `<div class="spec-bar"><div class="top"><span>${esc(label)}</span><b>${esc(value)}</b></div><div class="segs">${Array.from({ length: 10 }, (_, i) => `<i class="${i < n ? 'f' : ''}"></i>`).join('')}</div></div>`;
  };

  /** Where the robot starts: the custom spot, else the station preset (blue frame). */
  const curSpot = (): StartSpot => s.startSpot ?? presetSpot(season, s.alliance, s.station);
  const mapHtml = () => {
    const fp = footprint(s.robot);
    return placementMap(
      season,
      [{ alliance: s.alliance, spot: curSpot(), length: fp.length, width: fp.width, label: String(s.robot.teamNumber), mine: true, intakeFront: s.robot.intake.groundSide === 'front' }],
      { zones: [s.alliance], stations: [1, 2, 3].map((n) => ({ alliance: s.alliance, station: n, spot: presetSpot(season, s.alliance, n) })) },
    );
  };
  /** A saved spot can stop being legal (bigger robot, other season): nudge it back inside the zone or fall back to the preset. */
  const sanitizeSpot = () => {
    const area = season.startArea;
    if (!s.startSpot) return;
    if (!area) return void (s.startSpot = null);
    const fp = footprint(s.robot);
    if (checkStartSpot(area, s.startSpot, fp.length, fp.width).ok) return;
    const fit = clampToArea(area, s.startSpot, fp.length, fp.width);
    s.startSpot = checkStartSpot(area, fit, fp.length, fp.width).ok ? fit : null;
  };

  const SKILLS = ['easy', 'normal', 'hard', 'elite'] as const;
  const skillLabel = (d: string) => d[0].toUpperCase() + d.slice(1);
  const skillHint: Record<string, string> = {
    easy: 'Slower driving, looser aim, simple cycles without the alliance plan.',
    normal: 'Runs the alliance plan and strategy switching at a moderate pace.',
    hard: 'Competitive builds at full speed with tight aim, the full alliance plan and endgame climbs.',
    elite: 'Hard plus the fastest re-planning and the most accurate shots: plays the strongest plan the benchmarks found.',
  };
  /** Opponent difficulty, then your teammates: skill, alliance strategy, and a role per driver station (yours included). */
  const aiGroups = () => {
    const strategies = season.aiStrategies ?? [];
    const roles = season.aiRoles ?? [];
    const ally = (s.aiAlly ??= {});
    if (ally.strategy && !strategies.some((x) => x.id === ally.strategy)) ally.strategy = 'auto';
    for (const [k, v] of Object.entries(ally.roles ?? {})) if (v !== 'auto' && !roles.some((x) => x.id === v)) delete ally.roles![Number(k)];
    for (const [k, v] of Object.entries(ally.archetypes ?? {})) if (v !== 'auto' && !aiRobotChoices(season).some((p) => p.id === v)) delete ally.archetypes![Number(k)];
    const opp = (s.aiOpponent ??= {});
    for (const [k, v] of Object.entries(opp.archetypes ?? {})) if (v !== 'auto' && !aiRobotChoices(season).some((p) => p.id === v)) delete opp.archetypes![Number(k)];
    const strat = strategies.find((x) => x.id === (ally.strategy ?? 'auto'));
    // Opponent robots: pick a real team's robot or an archetype per opposing driver station (Auto = the difficulty's lineup).
    const oppRow = (station: number) => {
      const presets = aiRobotChoices(season);
      const arch = opp.archetypes?.[station] ?? 'auto';
      const archDesc = presets.find((p) => p.id === arch)?.description;
      const seg = `<div class="seg robot-seg">${opt(`data-opp-arch="${station}" data-choice="auto"`, 'Auto robot', arch === 'auto')}${presets.map((p) => opt(`data-opp-arch="${station}" data-choice="${p.id}" title="${esc(p.description)}"`, p.label, arch === p.id)).join('')}</div>`;
      return group(`Opponent · station ${station}`, seg, archDesc ? `Robot: ${archDesc}` : 'Auto: the robot this difficulty fields at this station.');
    };
    const roleRow = (station: number) => {
      const cur = ally.roles?.[station] ?? 'auto';
      const who = station === s.station ? `You · station ${station}` : `Teammate · station ${station}`;
      const desc = roles.find((x) => x.id === cur)?.description;
      const roleSeg = `<div class="seg">${opt(`data-ally-role="${station}" data-choice="auto"`, 'Auto', cur === 'auto')}${roles.map((x) => opt(`data-ally-role="${station}" data-choice="${x.id}" title="${esc(x.description)}"`, x.label, cur === x.id)).join('')}</div>`;
      if (station === s.station) return group(who, roleSeg, cur === 'auto' ? 'Tell your teammates what you will do so they cover the rest.' : `Teammates plan around you: ${desc}`);
      // Teammates also get a robot: a real team's robot, a generic archetype, or the lineup the difficulty would pick.
      const presets = aiRobotChoices(season);
      const arch = ally.archetypes?.[station] ?? 'auto';
      const archDesc = presets.find((p) => p.id === arch)?.description;
      const archSeg = presets.length ? `<div class="seg robot-seg">${opt(`data-ally-arch="${station}" data-choice="auto"`, 'Auto robot', arch === 'auto')}${presets.map((p) => opt(`data-ally-arch="${station}" data-choice="${p.id}" title="${esc(p.description)}"`, p.label, arch === p.id)).join('')}</div>` : '';
      return group(who, roleSeg + archSeg, [desc ?? 'The alliance assigns this robot a role from the plan.', archDesc ? `Robot: ${archDesc}` : ''].filter(Boolean).join(' '));
    };
    return `
      ${group('AI difficulty', `<div class="seg">${SKILLS.map((d) => opt(`data-difficulty="${d}"`, skillLabel(d), (s.aiDifficulty ?? 'normal') === d)).join('')}</div>`, `Opponents: ${skillHint[s.aiDifficulty ?? 'normal']}`)}
      ${group('Teammate skill', `<div class="seg">${SKILLS.map((d) => opt(`data-ally-skill="${d}"`, skillLabel(d), (ally.skill ?? 'normal') === d)).join('')}</div>`, `Your two AI teammates: ${skillHint[ally.skill ?? 'normal']}`)}
      ${group('AI radio', `<div class="seg">${(['all', 'team', 'off'] as const).map((v) => opt(`data-radio="${v}"`, v === 'all' ? 'Both alliances' : v === 'team' ? 'My alliance' : 'Off', (s.aiRadio ?? 'all') === v)).join('')}</div>`, 'Callouts the AI robots use to coordinate (AMPLIFY calls, rescues, plan switches).')}
      ${strategies.length ? group('Alliance strategy', `<div class="seg">${strategies.map((x) => opt(`data-ally-strategy="${x.id}" title="${esc(x.description)}"`, x.label, (ally.strategy ?? 'auto') === x.id)).join('')}</div>`, strat?.description ?? '', 'wide') : ''}
      ${roles.length ? [1, 2, 3].map(roleRow).join('') : ''}
      ${aiRobotChoices(season).length ? [1, 2, 3].map(oppRow).join('') : ''}`;
  };

  const playPage = () => {
    const F = numFields(season);
    const r = s.robot;
    const routine = season.autoRoutines.find((x) => x.id === s.autoRoutine);
    const acc = F.acc.get(r);
    const hasAi = s.aiOpponents !== false;
    const hpHint = season.humanPlayerHint
      ? s.autoHumanPlayer ? season.humanPlayerHint.auto : season.humanPlayerHint.manual
      : season.maxScoringLevel
        ? s.autoHumanPlayer ? 'Nearby CORAL stations supply you; human players throw received ALGAE in TELEOP.' : 'Press H to toggle CORAL stations and throw received ALGAE in TELEOP.'
        : s.autoHumanPlayer ? 'The chute feeds you automatically.' : 'Press H to open the chute door yourself.';
    const settings = `
      <section class="panel settings">
        <div class="panel-head"><span>Match setup</span><span class="dim">${season.year} ${esc(season.name)} · ${formatClock(matchLength())} match</span></div>
        <div class="settings-grid">
          ${group('Alliance', `<div class="seg">${opt('data-alliance="blue"', 'Blue', s.alliance === 'blue', 'solid blue', '<span class="dot"></span>')}${opt('data-alliance="red"', 'Red', s.alliance === 'red', 'solid red', '<span class="dot"></span>')}</div>`)}
          ${group('AI opponents', `<div class="seg">${opt('data-ai="1"', '3 vs 3', s.aiOpponents !== false)}${opt('data-ai="0"', 'Solo practice', s.aiOpponents === false)}</div>`, '3 vs 3 adds two AI teammates and three opponents who collect and score.')}
          ${group('Camera', `<div class="seg">${CAMERAS.map(([id, label]) => opt(`data-camera="${id}"`, label, s.camera === id)).join('')}</div>`, '', 'wide')}
          ${group('Human player', `<div class="seg">${opt('data-hp="1"', 'Auto', s.autoHumanPlayer)}${opt('data-hp="0"', 'Manual (H)', !s.autoHumanPlayer)}</div>`, hpHint, 'wide')}
          ${group('Practice options', `<div class="seg">${opt('data-toggle="manualAuto"', 'Drive in AUTO', s.manualAuto)}${opt('data-toggle="autoIntake"', 'Auto-intake', s.autoIntake)}${opt('data-toggle="shadows"', 'Shadows', s.shadows)}</div>`, 'None of these change scoring.', 'wide')}
          ${group('Autonomous', `<select class="pick" data-routine-sel aria-label="Autonomous routine">${season.autoRoutines.map((x) => `<option value="${x.id}" ${x.id === s.autoRoutine ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>`, routine?.description ?? '', 'wide')}
        </div>
      </section>`;
    const map = `
      <section class="panel map-panel">
        <div class="panel-head"><span>Starting spot</span><span class="dim">Station ${s.station}${s.startSpot ? ' · custom start' : ''}</span>${season.startArea ? `<button class="link" data-place="reset">${icon.reset(13)} Station preset</button>` : ''}</div>
        <div class="map-wrap">${mapHtml()}</div>
        ${season.startArea ? `<div class="place-wrap">${headingControls(curSpot().yaw)}</div>` : ''}
        <div class="map-legend"><span class="lg"><i class="sw"></i>Your robot</span><span class="lg"><i class="sw ring"></i>Station presets</span>${season.startArea ? '<span class="lg"><i class="sw zone"></i>Legal start zone</span>' : ''}<span class="sp">${season.startArea ? 'Drag your robot in the green zone, drag the knob on its nose to rotate (Shift = 15° steps), or click a ring for a station preset.' : 'Click a circle to move to that driver station.'}</span></div>
      </section>`;
    const matchTab = `<div class="play-grid"><div class="col">${settings}</div><div class="col">${map}</div></div>`;
    const aiTab = `
      <section class="panel">
        <div class="panel-head"><span>AI opponents &amp; teammates</span><span class="dim">${esc(season.name)}</span></div>
        <div class="settings-grid ai-grid">${aiGroups()}</div>
      </section>`;
    const robotCard = `
      <section class="panel robot-card ${s.alliance}">
        <div class="robot-top"><span>Your robot</span><span class="tag ${s.alliance}">${s.alliance === 'red' ? 'Red' : 'Blue'} alliance</span></div>
        <div class="robot-art">${robotArt(s.alliance, r.teamNumber, r.intake.groundSide)}</div>
        <div class="robot-id"><div class="robot-num">${r.teamNumber}</div><div class="robot-meta"><b>Station ${s.station}${s.startSpot ? ' · custom start' : ''}</b><span>${toInch(r.frameLength).toFixed(0)} × ${toInch(r.frameWidth).toFixed(0)} in · ${(r.maxSpeed / FT).toFixed(1)} ft/s</span></div></div>
      </section>`;
    const fields = season.robotFields ?? ['team', 'height', 'len', 'wid', 'speed', 'accel', 'cap', 'pre', 'rate', 'acc', 'cspd'];
    const same = (c: RobotConfig) => JSON.stringify({ ...r, teamNumber: 0 }) === JSON.stringify({ ...c, teamNumber: 0 });
    const presets = season.robotPresets ?? [];
    const current = presets.find((p) => same(p.config));
    const teams = season.teamRobots ?? [];
    const team = teams.find((t) => same(t.config));
    const teamPicker = teams.length
      ? `<div class="config-presets">${group('Play as a real robot', `<div class="seg">${teams.map((t) => opt(`data-team-robot="${t.id}" title="${esc(t.description)}"`, `${t.team} ${esc(t.name)}`, t === team)).join('')}</div>`, team ? `${team.description} Source: ${team.source}.` : `Top ${season.year} robots, simplified and animated — capabilities from their Chief Delphi reveals and tech binders.`)}</div>`
      : '';
    const profiles = presets.length
      ? `<div class="config-presets">${group('Robot archetype', `<div class="seg">${presets.map((p) => opt(`data-preset="${p.id}" title="${esc(p.description)}"`, p.label, p === current)).join('')}</div>`, current ? current.description : team ? `Playing as ${team.team} ${team.name} — changing a mechanism below turns it into a custom build.` : 'Custom build — pick an archetype to start from, then change mechanisms below.')}</div>`
      : '';
    const options = (season.robotOptions ?? [])
      .map((o) => group(o.label, `<div class="seg">${o.choices.map((ch) => opt(`data-opt="${o.id}" data-choice="${ch.id}"${ch.title ? ` title="${esc(ch.title)}"` : ''}`, ch.label, o.get(r) === ch.id)).join('')}</div>`, o.hint ?? ''))
      .join('');
    const bars = season.robotSpecBars?.(r) ?? [
      { label: `${season.gamePiece.name} capacity`, value: `${r.hopperCapacity}`, frac: r.hopperCapacity / 80 },
      { label: 'Fire rate', value: `${r.launcher.rate} /s`, frac: r.launcher.rate / 20 },
      { label: 'Accuracy', value: `${acc}%`, frac: acc / 100 },
    ];
    const spec = `
      <section class="panel spec-panel">
        <div class="panel-head"><span>Robot</span><button class="link" data-k="resetRobot">${icon.reset(13)} Reset to ${season.year} defaults</button></div>
        ${teamPicker}
        ${profiles}
        <div class="tune-opts">${options}</div>
        <div class="tune">${fields.filter((k) => F[k]).map((k) => numInput(F[k])).join('')}</div>
        ${season.robotHint ? `<div class="config-note">${esc(season.robotHint)}<br/>Speeds, cycle times and accuracy are simulator tuning; mechanism choices mirror real ${season.year} robot archetypes.</div>` : ''}
      </section>`;
    const summary = `
      <section class="panel">
        <div class="panel-head"><span>Build summary</span></div>
        <div class="spec-bars">
          ${specBar('Speed', `${F.speed.get(r)} ft/s`, F.speed.get(r) / 22)}
          ${specBar('Pushing', `${Math.round(pushingForce(r) / LBF)} lbf`, pushingForce(r) / LBF / 200)}
          ${bars.map((x) => specBar(x.label, x.value, x.frac)).join('')}
          ${specBar('Climb', season.climberLabels?.[r.climber.maxLevel] ?? (r.climber.maxLevel === 0 ? 'None' : `L${r.climber.maxLevel}`), r.climber.maxLevel / Math.max(1, season.maxClimbLevel))}
        </div>
      </section>`;
    const robotTab = `<div class="robot-grid"><div class="col">${robotCard}${summary}</div><div class="col">${spec}</div></div>`;
    return playTab === 'robot' ? robotTab : playTab === 'ai' && hasAi ? aiTab : matchTab;
  };

  /** The key slot waiting for a key press on the Controls page, and the last change made. */
  let capturing: { id: ActionId; slot: number } | null = null;
  let bindNote = '';
  const labelOf = (id: ActionId) => ACTIONS.find((a) => a.id === id)!.label;

  const controlsPage = () => {
    const groups = [...new Set(ACTIONS.map((a) => a.group))];
    const slotBtn = (id: ActionId, slot: number) => {
      const on = capturing?.id === id && capturing.slot === slot;
      const code = keybinds.slots(id)[slot];
      return `<button class="keycap ${on ? 'capturing' : ''} ${code ? '' : 'empty'}" data-bind="${id}" data-slot="${slot}" aria-label="${esc(labelOf(id))}, key ${slot + 1}: ${code ? esc(codeLabel(code)) : 'unbound'}. Click to change." title="${code ? 'Click, then press a new key · Backspace clears' : 'Click, then press a key'}">${on ? 'Press a key…' : esc(codeLabel(code))}</button>`;
    };
    const rows = (group: string) =>
      ACTIONS.filter((a) => a.group === group)
        .map((a) => `<div class="row"><div class="row-text"><div class="row-title">${esc(a.label)}</div></div><div class="keycaps">${Array.from({ length: SLOTS }, (_, i) => slotBtn(a.id, i)).join('')}</div></div>`)
        .join('');
    return `
    <section class="panel">
      <div class="panel-head"><span>Key bindings</span><span class="dim" role="status">${esc(capturing ? `Press a key for “${labelOf(capturing.id)}” · Esc cancels · Backspace clears` : bindNote || 'Click a key to change it')}</span><button class="link" data-k="resetKeys" ${keybinds.isCustomized() ? '' : 'disabled'}>${icon.reset(13)} Reset to defaults</button></div>
      <div class="keybinds">${groups.map((g) => `<div class="keygroup">${esc(g)}</div><div class="list">${rows(g)}</div>`).join('')}</div>
    </section>
    <div class="section-label">Reference</div>
    ${keybinds.isCustomized() ? '<div class="config-note">The descriptions below list the default keys; your bindings above take effect in the match.</div>' : ''}
    <section class="panel list">
      ${(season.controlsHelp ?? DEFAULT_CONTROLS_HELP)
        .map(([k, v]) => `<div class="row"><div class="row-text"><div class="row-title">${esc(v)}</div></div><kbd>${esc(k)}</kbd></div>`)
        .join('')}
    </section>`;
  };

  const rulesPage = () => `
    <section class="panel list">
      ${season.timeline
        .map((p) => `<div class="row"><div class="row-text"><div class="row-title">${esc(p.label)}</div><div class="row-sub">${p.mode === 'disabled' ? 'Robots disabled' : p.mode.toUpperCase()}</div></div><span class="pill">${p.duration}s</span></div>`)
        .join('')}
    </section>
    ${
      season.rulesSummary?.length
        ? `<div class="section-label">Key rules</div><section class="panel list">${season.rulesSummary
            .map((x) => `<div class="row"><div class="row-text"><div class="row-title">${esc(x.title)}</div><div class="row-sub">${esc(x.detail)}</div></div>${x.value ? `<span class="pill">${esc(x.value)}</span>` : ''}</div>`)
            .join('')}</section>`
        : ''
    }`;

  let onKey: (e: KeyboardEvent) => void;
  const start = () => {
    save(s);
    document.removeEventListener('keydown', onKey);
    el.remove();
    onStart(s);
  };

  const render = () => {
    if (lobby?.lobby && lobby.lobby.seasonId !== s.seasonId) {
      season = getSeason(lobby.lobby.seasonId);
      const teamNumber = s.robot.teamNumber;
      s = { ...defaultSettings(season), alliance: s.alliance, station: s.station, camera: s.camera, aiOpponents: s.aiOpponents, aiDifficulty: s.aiDifficulty, aiAlly: { skill: s.aiAlly?.skill }, aiRadio: s.aiRadio };
      s.robot.teamNumber = teamNumber;
    }
    if (season.normalizeRobotConfig) s.robot = season.normalizeRobotConfig(s.robot);
    sanitizeSpot();
    if (lobby) lobby.settings = s;
    // A relay wake/status update can arrive while the user is typing. Keep the form draft and focus.
    const draft = page === 'multiplayer' ? {
      name: el.querySelector<HTMLInputElement>('[data-mp="name"]')?.value,
      code: el.querySelector<HTMLInputElement>('[data-mp="code"]')?.value,
      url: el.querySelector<HTMLInputElement>('[data-mp="url"]')?.value,
      focused: (document.activeElement as HTMLElement | null)?.dataset.mp,
    } : null;
    const titles: Record<Page, { h1: string; sub: string }> = {
      play: { h1: 'Single player', sub: '' },
      controls: { h1: 'Controls', sub: 'Driving is field-oriented from your driver station. Press V in a match to switch cameras.' },
      rules: { h1: `${season.name} rules`, sub: season.summary },
      multiplayer: { h1: 'Multiplayer', sub: '' },
    };
    // Multiplayer page content lives in multiplayer.ts; the lobby re-renders it on every lobby change.
    const mp =
      page === 'multiplayer' && lobby
        ? (save(s), multiplayerPage(lobby, { s, season, rerender: render, goto: (p) => ((page = p), render()) }))
        : null;
    const t = titles[page];
    // innerHTML below rebuilds the scroll container; keep the user's place when changing a setting on the same page.
    if (playTab === 'ai' && s.aiOpponents === false) playTab = 'match';
    const pageKey = page === 'play' ? `play:${playTab}` : page;
    const prevPage = el.dataset.page;
    const scrollTop = el.querySelector<HTMLElement>('.main')?.scrollTop ?? 0;
    const playTabs = `<div class="subtabs" role="tablist">${([['match', 'Match'], ...(s.aiOpponents !== false ? [['ai', 'AI']] : []), ['robot', 'Robot']] as [PlayTab, string][]).map(([id, label]) => `<button class="subtab ${playTab === id ? 'on' : ''}" role="tab" aria-selected="${playTab === id}" data-ptab="${id}">${label}</button>`).join('')}</div>`;
    const tab = (p: Page, label: string) => `<button class="bbtn ${page === p ? 'on' : ''}" data-page="${p}">${label}</button>`;
    el.innerHTML = `
      <header class="topbar">
        <span class="brand">FRC Sim</span><span class="brand-sep"></span>
        <label class="season-pick"><select data-k="season" aria-label="Game season" ${lobby?.lobby && (!lobby.isHost || lobby.lobby.inMatch) ? 'disabled' : ''}>${SEASONS.map((x) => `<option value="${x.id}" ${x.id === season.id ? 'selected' : ''}>${x.year} ${esc(x.name)}</option>`).join('')}</select></label>
        <div class="team-chip"><i>${esc(String(s.robot.teamNumber).slice(0, 1))}</i>Team ${s.robot.teamNumber}</div>
      </header>
      <main class="main">
        <div class="titlebar"><h1 class="title">${esc(t.h1)}${t.sub ? `<small>${esc(t.sub)}</small>` : ''}</h1>${page === 'play' ? playTabs : ''}</div>
        ${mp ? mp.body : page === 'play' ? playPage() : page === 'controls' ? controlsPage() : rulesPage()}
      </main>
      <footer class="bar-bottom">
        ${
          mp
            ? mp.footer
            : `${page === 'play' ? tab('controls', 'Controls') + tab('rules', 'Rules') + (lobby ? tab('multiplayer', 'Multiplayer') : '') : `<button class="bbtn" data-page="play"><kbd>Esc</kbd>Back</button>`}
        <span class="spacer"></span>
        ${page === 'play' ? `<button class="bbtn primary" data-k="start"><kbd>Enter</kbd>Start match</button>` : ''}`
        }
      </footer>`;
    el.dataset.page = pageKey;
    if (prevPage === pageKey) {
      const main = el.querySelector<HTMLElement>('.main');
      if (main) main.scrollTop = scrollTop;
    }
    bind();
    if (draft && page === 'multiplayer') {
      for (const key of ['name', 'code', 'url'] as const) {
        const input = el.querySelector<HTMLInputElement>(`[data-mp="${key}"]`);
        if (input && draft[key] !== undefined) input.value = draft[key];
        if (input && draft.focused === key) input.focus();
      }
    }
  };

  onKey = (e: KeyboardEvent) => {
    if (!el.isConnected) return document.removeEventListener('keydown', onKey);
    if (capturing) {
      // Capture the next physical key for the slot being rebound; nothing else may react to it.
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      const { id, slot } = capturing;
      if (e.code === 'Escape') bindNote = '';
      else if (e.code === 'Backspace' || e.code === 'Delete') (keybinds.set(id, slot, ''), (bindNote = `Cleared ${labelOf(id)}`));
      else {
        const taken = keybinds.set(id, slot, e.code);
        bindNote = `${labelOf(id)} → ${codeLabel(e.code)}${taken ? ` (was ${labelOf(taken)}, now unbound)` : ''}`;
      }
      capturing = null;
      return render();
    }
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (e.key === 'Escape' && page !== 'play') {
      page = 'play';
      render();
    } else if (e.key === 'Enter' && page === 'play' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'BUTTON') start();
  };
  document.addEventListener('keydown', onKey);

  const bind = () => {
    const all = <T extends Element>(sel: string) => Array.from(el.querySelectorAll<T & HTMLElement>(sel));
    all<HTMLButtonElement>('[data-bind]').forEach((b) => (b.onclick = () => {
      capturing = { id: b.dataset.bind as ActionId, slot: Number(b.dataset.slot) };
      render();
      el.querySelector<HTMLElement>('.keycap.capturing')?.focus();
    }));
    all('[data-k="resetKeys"]').forEach((b) => (b.onclick = () => (keybinds.resetAll(), (bindNote = 'Restored default keys'), (capturing = null), render())));
    all('[data-ptab]').forEach((b) => (b.onclick = () => ((playTab = b.dataset.ptab as PlayTab), render())));
    all('[data-page]').forEach((b) => (b.onclick = () => ((page = b.dataset.page as Page), (capturing = null), render())));
    const seasonSel = el.querySelector<HTMLSelectElement>('[data-k="season"]')!;
    seasonSel.onchange = () => {
      season = getSeason(seasonSel.value);
      const teamNumber = s.robot.teamNumber;
      s = { ...defaultSettings(season), alliance: s.alliance, station: s.station, camera: s.camera, aiOpponents: s.aiOpponents, aiDifficulty: s.aiDifficulty, aiAlly: { skill: s.aiAlly?.skill }, aiRadio: s.aiRadio };
      s.robot.teamNumber = teamNumber;
      if (lobby) { lobby.settings = s; lobby.setSeason(season.id); }
      render();
    };
    all('[data-alliance]').forEach((b) => (b.onclick = () => ((s.alliance = b.dataset.alliance as 'red' | 'blue'), render())));
    all('[data-camera]').forEach((b) => (b.onclick = () => ((s.camera = b.dataset.camera as CameraMode), render())));
    const routineSel = el.querySelector<HTMLSelectElement>('[data-routine-sel]');
    if (routineSel) routineSel.onchange = () => ((s.autoRoutine = routineSel.value), render());
    all('[data-preset]').forEach((b) => (b.onclick = () => {
      const preset = season.robotPresets?.find((p) => p.id === b.dataset.preset);
      if (!preset) return;
      const team = s.robot.teamNumber; s.robot = cloneConfig(preset.config); s.robot.teamNumber = team;
      render();
    }));
    all('[data-team-robot]').forEach((b) => (b.onclick = () => {
      const t = season.teamRobots?.find((x) => x.id === b.dataset.teamRobot);
      if (!t) return;
      s.robot = cloneConfig(t.config);
      render();
    }));
    all('[data-opt]').forEach((b) => (b.onclick = () => {
      // A real team's robot is a fixed build: changing a mechanism makes it a custom robot with the generic model.
      delete s.robot.model;
      season.robotOptions?.find((o) => o.id === b.dataset.opt)?.set(s.robot, b.dataset.choice!);
      render();
    }));
    all('[data-difficulty]').forEach((b) => (b.onclick = () => ((s.aiDifficulty = b.dataset.difficulty as GameSettings['aiDifficulty']), render())));
    all('[data-ally-skill]').forEach((b) => (b.onclick = () => (((s.aiAlly ??= {}).skill = b.dataset.allySkill as GameSettings['aiDifficulty']), render())));
    all('[data-ally-strategy]').forEach((b) => (b.onclick = () => (((s.aiAlly ??= {}).strategy = b.dataset.allyStrategy), render())));
    all('[data-ally-role]').forEach((b) => (b.onclick = () => {
      const ally = (s.aiAlly ??= {});
      (ally.roles ??= {})[Number(b.dataset.allyRole)] = b.dataset.choice!;
      render();
    }));
    all('[data-ally-arch]').forEach((b) => (b.onclick = () => {
      const ally = (s.aiAlly ??= {});
      (ally.archetypes ??= {})[Number(b.dataset.allyArch)] = b.dataset.choice!;
      render();
    }));
    all('[data-opp-arch]').forEach((b) => (b.onclick = () => {
      const opp = (s.aiOpponent ??= {});
      (opp.archetypes ??= {})[Number(b.dataset.oppArch)] = b.dataset.choice!;
      render();
    }));
    all('[data-radio]').forEach((b) => (b.onclick = () => ((s.aiRadio = b.dataset.radio as GameSettings['aiRadio']), render())));
    all('[data-ai]').forEach((b) => (b.onclick = () => ((s.aiOpponents = b.dataset.ai === '1'), render())));
    all('[data-hp]').forEach((b) => (b.onclick = () => ((s.autoHumanPlayer = b.dataset.hp === '1'), render())));
    all('[data-toggle]').forEach(
      (b) =>
        (b.onclick = () => {
          const k = b.dataset.toggle as 'manualAuto' | 'autoIntake' | 'shadows';
          s[k] = !s[k];
          render();
        }),
    );
    all('[data-k="resetRobot"]').forEach(
      (b) =>
        (b.onclick = () => {
          s.robot = cloneConfig(season.robotDefaults);
          render();
        }),
    );
    const F = numFields(season);
    all<HTMLInputElement>('[data-f]').forEach((input) => {
      const f = F[input.dataset.f!];
      input.onchange = () => {
        const v = Math.min(f.max ?? Infinity, Math.max(f.min, Number(input.value)));
        if (Number.isFinite(v)) f.set(s.robot, v);
        render();
      };
    });
    const wrap = el.querySelector<HTMLElement>('.map-wrap');
    if (wrap && page === 'play' && playTab === 'match') {
      const fp = footprint(s.robot);
      const mine = (): MineState => ({ alliance: s.alliance, spot: curSpot(), length: fp.length, width: fp.width, blockers: [] });
      const redraw = () => {
        wrap.innerHTML = mapHtml();
        syncHeadingControls(el, curSpot().yaw);
      };
      bindPlacementMap(wrap, season, {
        mine,
        set: (spot) => ((s.startSpot = spot), redraw()),
        station: (n) => ((s.station = n), (s.startSpot = null), render()),
      });
      bindHeadingControls(el, (yaw) => ((s.startSpot = rotateSpot(season, mine(), yaw)), render()));
      el.querySelector<HTMLElement>('[data-place="reset"]')?.addEventListener('click', () => ((s.startSpot = null), render()));
    }
    const startBtn = el.querySelector<HTMLButtonElement>('[data-k="start"]');
    if (startBtn) startBtn.onclick = start;
    if (page === 'multiplayer' && lobby) bindMultiplayer(el, lobby, { s, season, rerender: render, goto: (p) => ((page = p), render()) });
  };

  if (lobby)
    lobby.onChange = () => {
      // Don't rebuild the page under a robot being dragged on the placement map.
      if (el.isConnected && !placementDragging()) render();
    };

  render();
}
