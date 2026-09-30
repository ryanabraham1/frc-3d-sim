import type { CameraMode } from '@engine/camera/cameras';
import type { GameSettings, MapShape, SeasonDefinition } from '@engine/core/season';
import { DEFAULT_CONTROLS_HELP } from '@engine/input/input';
import { AimAssist, cloneConfig, RobotConfig } from '@engine/robot/config';
import { formatClock, inch, toInch } from '@engine/units';
import { SEASONS, getSeason } from '@seasons/index';
import { icon } from './icons';
import type { LobbyController } from './lobby';
import { bindMultiplayer, multiplayerPage } from './multiplayer';
import './menu.css';

const STORAGE_KEY = 'frc-sim-settings-v1';
const FT = 0.3048;

type Page = 'play' | 'controls' | 'rules' | 'multiplayer';

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
    { key: 'cap', label: 'Capacity', min: 1, max: season.robotLimits?.capacity ?? 120, step: 1, get: (c) => c.hopperCapacity, set: (c, v) => (c.hopperCapacity = Math.round(v)) },
    { key: 'pre', label: 'Preload', min: 0, max: season.robotLimits?.preload ?? 8, step: 1, get: (c) => c.preload, set: (c, v) => (c.preload = Math.round(v)) },
    { key: 'rate', label: 'Shots/s', min: 1, max: 20, step: 0.5, get: (c) => c.launcher.rate, set: (c, v) => (c.launcher.rate = v) },
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
  if (season.year === 2026) {
    for (const f of list) {
      if (['speed', 'accel', 'cap', 'rate', 'cspd'].includes(f.key)) delete f.max;
    }
  }
  if (season.robotPresets) {
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

function group(label: string, body: string, hint = ''): string {
  return `<div class="group"><div class="label">${esc(label)}</div>${body}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
}

const CAMERAS: [CameraMode, string][] = [
  ['follow', 'Third person'],
  ['driver', 'Driver station'],
  ['chase', 'Chase'],
  ['overhead', 'Overhead'],
];

function robotArt(alliance: 'red' | 'blue', team: number): string {
  const c = alliance === 'red' ? '#ef4444' : '#4f8cff';
  return `<svg viewBox="0 0 210 150" aria-hidden="true">
    <ellipse cx="105" cy="112" rx="88" ry="26" fill="none" stroke="#2f2f3c" stroke-width="1.5"/>
    <polygon points="105,62 172,96 105,130 38,96" fill="${c}"/>
    <polygon points="105,74 156,98 105,122 54,98" fill="#0c0c10"/>
    <polygon points="38,96 105,130 105,138 38,104" fill="${c}" opacity=".6"/>
    <polygon points="172,96 105,130 105,138 172,104" fill="${c}" opacity=".4"/>
    <polygon points="105,30 130,42 130,84 105,96 80,84 80,42" fill="#8b6cf6"/>
    <polygon points="105,30 130,42 105,54 80,42" fill="#a48bff"/>
    <polygon points="105,54 130,42 130,84 105,96" fill="#6c4fd8"/>
    <text x="105" y="112" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="15" fill="#fff" letter-spacing="1">${team}</text>
  </svg>`;
}

const SHAPE_OPACITY: Record<MapShape['kind'], number> = { zone: 0.07, hub: 0.28, bump: 0.16, trench: 0.12, tower: 0.1, depot: 0.08, outpost: 0.1 };

/** Top-down field with the player's start position; other driver stations are clickable. */
function fieldMap(season: SeasonDefinition, s: GameSettings): string {
  const L = season.fieldLength;
  const W = season.fieldWidth;
  const pad = 0.5;
  const fy = (y: number) => W - y; // +y is up on screen
  const mirror = season.mapSymmetry === 'mirror';
  const poly = (m: MapShape, red: boolean) =>
    m.points.map(([x, y]) => `${(red ? L - x : x).toFixed(3)},${fy(red && !mirror ? W - y : y).toFixed(3)}`).join(' ');
  const shapes = season.mapShapes ?? [];
  let out = '';
  for (const red of [false, true]) {
    const col = red ? '#ef4444' : '#4f8cff';
    for (const m of shapes) {
      const neutral = m.kind === 'tower' || m.kind === 'depot' || m.kind === 'outpost';
      out += `<polygon points="${poly(m, red)}" fill="${neutral ? '#ffffff' : col}" fill-opacity="${SHAPE_OPACITY[m.kind]}" stroke="${m.kind === 'zone' ? 'none' : col}" stroke-opacity="${m.kind === 'hub' ? 0.9 : 0.4}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
    }
  }
  const zone = shapes.find((m) => m.kind === 'zone');
  const zx = zone ? Math.max(...zone.points.map((p) => p[0])) : season.startPose('blue', 1).x;
  out += `<line x1="${zx}" y1="0" x2="${zx}" y2="${W}" stroke="#4f8cff" stroke-opacity=".7" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
  out += `<line x1="${L - zx}" y1="0" x2="${L - zx}" y2="${W}" stroke="#ef4444" stroke-opacity=".7" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
  out += `<line x1="${L / 2}" y1="0" x2="${L / 2}" y2="${W}" stroke="#fff" stroke-opacity=".25" stroke-width="1.5" stroke-dasharray="5 5" vector-effect="non-scaling-stroke"/>`;

  const fl = s.robot.frameLength + 2 * s.robot.bumperThickness;
  const fw = s.robot.frameWidth + 2 * s.robot.bumperThickness;
  for (const n of [1, 2, 3]) {
    const p = season.startPose(s.alliance, n);
    if (n === s.station) {
      const deg = (-p.yaw * 180) / Math.PI;
      out += `<g transform="translate(${p.x} ${fy(p.y)}) rotate(${deg})">
        <rect x="${-fl / 2}" y="${-fw / 2}" width="${fl}" height="${fw}" rx="0.06" fill="#8b6cf6" fill-opacity=".35" stroke="#a48bff" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
        <polygon points="${fl / 2 + 0.3},0 ${fl / 2 + 0.04},-0.16 ${fl / 2 + 0.04},0.16" fill="#a48bff"/>
      </g>
      <text x="${p.x}" y="${fy(p.y)}" text-anchor="middle" dominant-baseline="central" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="0.42" fill="#fff">${s.robot.teamNumber}</text>`;
    } else {
      out += `<circle class="st-hit" data-station="${n}" cx="${p.x}" cy="${fy(p.y)}" r="0.5"/><circle class="st-dot" cx="${p.x}" cy="${fy(p.y)}" r="0.24" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
    }
  }
  return `<svg viewBox="${-pad} ${-pad} ${L + 2 * pad} ${W + 2 * pad}" preserveAspectRatio="xMidYMid meet">
    <rect x="0" y="0" width="${L}" height="${W}" fill="#0f0f15" stroke="#e7e7ee" stroke-opacity=".8" stroke-width="1.5" vector-effect="non-scaling-stroke"/>${out}</svg>`;
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
      intake: { ...d.intake, ...stored.robot.intake },
    };
  }
  let page: Page = opts.page ?? 'play';
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

  const playPage = () => {
    const F = numFields(season);
    const r = s.robot;
    const routine = season.autoRoutines.find((x) => x.id === s.autoRoutine);
    const acc = F.acc.get(r);
    const left = `
      <section class="panel robot-card ${s.alliance}">
        <div class="robot-top"><span>Your robot</span><span class="tag ${s.alliance}">${s.alliance === 'red' ? 'Red' : 'Blue'} alliance</span></div>
        <div class="robot-art">${robotArt(s.alliance, r.teamNumber)}</div>
        <div class="robot-id"><div class="robot-num">${r.teamNumber}</div><div class="robot-meta"><b>Station ${s.station}</b><span>${toInch(r.frameLength).toFixed(0)} × ${toInch(r.frameWidth).toFixed(0)} in · ${(r.maxSpeed / FT).toFixed(1)} ft/s</span></div></div>
        <button class="wide-btn" data-k="resetRobot"><span>Reset robot</span>${icon.reset(18)}</button>
      </section>
      ${group('Alliance', `<div class="seg">${opt('data-alliance="blue"', 'Blue', s.alliance === 'blue', 'solid blue', '<span class="dot"></span>')}${opt('data-alliance="red"', 'Red', s.alliance === 'red', 'solid red', '<span class="dot"></span>')}</div>`)}
      ${group('Camera', `<div class="seg">${CAMERAS.map(([id, label]) => opt(`data-camera="${id}"`, label, s.camera === id)).join('')}</div>`)}
      ${group('Autonomous', `<div class="seg">${season.autoRoutines.map((x) => opt(`data-routine="${x.id}"`, x.label, x.id === s.autoRoutine)).join('')}</div>`, routine?.description ?? '')}
      ${group('Human player', `<div class="seg">${opt('data-hp="1"', 'Auto', s.autoHumanPlayer)}${opt('data-hp="0"', 'Manual (H)', !s.autoHumanPlayer)}</div>`, season.humanPlayerHint ? (s.autoHumanPlayer ? season.humanPlayerHint.auto : season.humanPlayerHint.manual) : season.maxScoringLevel ? (s.autoHumanPlayer ? 'Nearby CORAL stations supply you; human players throw received ALGAE in TELEOP.' : 'Press H to toggle CORAL stations and throw received ALGAE in TELEOP.') : (s.autoHumanPlayer ? 'The chute feeds you automatically.' : 'Press H to open the chute door yourself.'))}
      ${group('Practice options', `<div class="seg">${opt('data-toggle="manualAuto"', 'Drive in AUTO', s.manualAuto)}${opt('data-toggle="autoIntake"', 'Auto-intake', s.autoIntake)}${opt('data-toggle="shadows"', 'Shadows', s.shadows)}</div>`, 'None of these change scoring.')}`;
    const right = `
      <section class="panel map-panel">
        <div class="panel-head"><span>Starting spot</span><span class="dim" style="margin-left:auto">${season.year} ${esc(season.name)} · ${formatClock(matchLength())} match</span></div>
        <div class="map-wrap">${fieldMap(season, s)}</div>
        <div class="map-legend"><span class="lg"><i class="sw"></i>Your robot</span><span class="lg"><i class="sw ring"></i>Other stations</span><span class="sp">Click a circle to move to that driver station.</span></div>
      </section>`;
    const placement = !!season.robotPresets;
    const fields = placement ? ['team', 'height', 'len', 'wid', 'speed', 'accel', 'pre', 'reach', 'lift', 'place', 'harvest', 'release', 'rate', 'acc', 'cspd'] : ['team', 'height', 'len', 'wid', 'speed', 'accel', 'cap', 'pre', 'rate', 'acc', 'cspd'];
    const mechanismToggle = (key: string, label: string, enabled: boolean, hint = '') => group(label, `<div class="seg">${opt(`data-mechanism="${key}" data-enabled="1"`, 'Enabled', enabled)}${opt(`data-mechanism="${key}" data-enabled="0"`, 'Disabled', !enabled)}</div>`, hint);
    const profiles = placement ? `<div class="config-presets">${group('2025 robot profiles', `<div class="seg">${season.robotPresets!.map((p) => opt(`data-preset="${p.id}" title="${esc(p.description)}"`, p.label, JSON.stringify({ ...r, teamNumber: 0 }) === JSON.stringify({ ...p.config, teamNumber: 0 }))).join('')}</div>`, 'All-rounder scores both pieces; specialists focus on CORAL or ALGAE and a cage.')}</div>` : '';
    const seasonalOptions = placement ? `
      ${mechanismToggle('coral-pickup', 'CORAL intake', !!r.intake.primary, 'One CORAL at a time; preload is 0 or 1 CORAL.')}
      ${mechanismToggle('algae-pickup', 'ALGAE intake + removal', !!r.intake.secondary, 'One ALGAE at a time; reef removal needs the contacted L2/L3 height.')}
      ${mechanismToggle('coral', 'CORAL scorer', r.placement!.enabled)}
      ${group('Highest elevator level', `<div class="seg">${[1, 2, 3, 4].map((n) => opt(`data-reef-level="${n}"`, `L${n}`, r.placement!.maxLevel === n)).join('')}</div>`, 'L1 trough · L2 31⅞ in · L3 47⅝ in · L4 72 in. Also limits reef ALGAE removal.')}
      ${mechanismToggle('processor', 'ALGAE PROCESSOR feeder', r.processor!.enabled, 'Independent of the NET shooter.')}
      ${mechanismToggle('net', 'ALGAE NET shooter', r.launcher.enabled)}
    ` : '';
    const spec = `
      <section class="panel" style="margin-top:22px">
        <div class="panel-head"><span>Spec</span><button class="link" data-k="resetRobot">${icon.reset(13)} Reset to ${season.year} defaults</button></div>
        ${profiles}
        <div class="spec-bars">
          ${specBar('Speed', `${F.speed.get(r)} ft/s`, F.speed.get(r) / 22)}
          ${placement ? specBar('CORAL reach', r.placement!.enabled ? `L1–L${r.placement!.maxLevel}` : 'Off', r.placement!.enabled ? r.placement!.maxLevel / 4 : 0) : specBar(`${season.gamePiece.name} capacity`, `${r.hopperCapacity}`, r.hopperCapacity / 80)}
          ${placement ? specBar('ALGAE', !r.intake.secondary ? 'Off' : [r.processor!.enabled ? 'PROCESSOR' : '', r.launcher.enabled ? 'NET' : ''].filter(Boolean).join(' + ') || 'Pickup only', Number(r.intake.secondary) * (Number(r.processor!.enabled) + Number(r.launcher.enabled)) / 2) : specBar('Fire rate', `${r.launcher.rate} /s`, r.launcher.rate / 20)}
          ${placement ? specBar('Mechanism reach', `${F.reach.get(r)} in`, F.reach.get(r) / 18) : specBar('Accuracy', `${acc}%`, acc / 100)}
          ${specBar('Climb', season.climberLabels?.[r.climber.maxLevel] ?? (r.climber.maxLevel === 0 ? 'None' : `L${r.climber.maxLevel}`), r.climber.maxLevel / Math.max(1, season.maxClimbLevel))}
        </div>
        <div class="tune">${fields.map((k) => numInput(F[k])).join('')}</div>
        <div class="tune-opts">
          ${seasonalOptions}
          ${group('Aim assist', `<div class="seg">${(['full', 'speed', 'off'] as AimAssist[]).map((a) => opt(`data-aim="${a}"`, { full: 'Full', speed: 'Speed', off: 'Off' }[a], r.aimAssist === a)).join('')}</div>`, 'Full: turret aim + speed · Speed: aim with chassis · Off: manual')}
          ${group(placement ? 'Scoring wrist / NET yaw' : 'Turret', `<div class="seg">${opt('data-turret="1"', placement ? 'Pivoting' : 'Turret', r.launcher.turret)}${opt('data-turret="0"', 'Fixed', !r.launcher.turret)}</div>`)}
          ${group(placement ? 'CAGE choice' : 'Climber', `<div class="seg">${Array.from({ length: season.maxClimbLevel + 1 }, (_, n) => opt(`data-level="${n}"`, season.climberLabels?.[n] ?? (n === 0 ? 'None' : `L${n}`), r.climber.maxLevel === n)).join('')}</div>`, placement ? 'No climber: park 2 · shallow: 6 · deep: 12. Sets your station’s cage depth; you may climb any matching alliance cage.' : season.robotHint ?? `Max height ${toInch(season.maxRobotHeight).toFixed(0)} in · under 22.25 in fits the TRENCH`)}
        </div>
        ${placement ? `<div class="config-note">${esc(season.robotHint ?? '')}<br/>Inventory is fixed at one of each enabled piece type. Elevator speed, cycle times, drive performance and NET settings are simulator tuning, not manual requirements.</div>` : ''}
      </section>`;
    return `<div class="play-grid"><div class="col">${left}</div><div class="col">${right}</div></div>${spec}`;
  };

  const controlsPage = () => `
    <section class="panel list">
      ${(season.controlsHelp ?? DEFAULT_CONTROLS_HELP)
        .map(([k, v]) => `<div class="row"><div class="row-text"><div class="row-title">${esc(v)}</div></div><kbd>${esc(k)}</kbd></div>`)
        .join('')}
    </section>`;

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
      s = { ...defaultSettings(season), alliance: s.alliance, station: s.station, camera: s.camera };
      s.robot.teamNumber = teamNumber;
    }
    if (season.normalizeRobotConfig) s.robot = season.normalizeRobotConfig(s.robot);
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
    const tab = (p: Page, label: string) => `<button class="bbtn ${page === p ? 'on' : ''}" data-page="${p}">${label}</button>`;
    el.innerHTML = `
      <header class="topbar">
        <span class="brand">FRC Sim</span><span class="brand-sep"></span>
        <label class="season-pick"><select data-k="season" aria-label="Game season" ${lobby?.lobby && (!lobby.isHost || lobby.lobby.inMatch) ? 'disabled' : ''}>${SEASONS.map((x) => `<option value="${x.id}" ${x.id === season.id ? 'selected' : ''}>${x.year} ${esc(x.name)}</option>`).join('')}</select></label>
        <div class="team-chip"><i>${esc(String(s.robot.teamNumber).slice(0, 1))}</i>Team ${s.robot.teamNumber}</div>
      </header>
      <main class="main">
        <h1 class="title">${esc(t.h1)}${t.sub ? `<small>${esc(t.sub)}</small>` : ''}</h1>
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
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (e.key === 'Escape' && page !== 'play') {
      page = 'play';
      render();
    } else if (e.key === 'Enter' && page === 'play' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'BUTTON') start();
  };
  document.addEventListener('keydown', onKey);

  const bind = () => {
    const all = <T extends Element>(sel: string) => Array.from(el.querySelectorAll<T & HTMLElement>(sel));
    all('[data-page]').forEach((b) => (b.onclick = () => ((page = b.dataset.page as Page), render())));
    const seasonSel = el.querySelector<HTMLSelectElement>('[data-k="season"]')!;
    seasonSel.onchange = () => {
      season = getSeason(seasonSel.value);
      const teamNumber = s.robot.teamNumber;
      s = { ...defaultSettings(season), alliance: s.alliance, station: s.station, camera: s.camera };
      s.robot.teamNumber = teamNumber;
      if (lobby) { lobby.settings = s; lobby.setSeason(season.id); }
      render();
    };
    all('[data-alliance]').forEach((b) => (b.onclick = () => ((s.alliance = b.dataset.alliance as 'red' | 'blue'), render())));
    all('[data-station]').forEach((b) => (b.onclick = () => ((s.station = Number(b.dataset.station)), render())));
    all('[data-camera]').forEach((b) => (b.onclick = () => ((s.camera = b.dataset.camera as CameraMode), render())));
    all('[data-routine]').forEach((b) => (b.onclick = () => ((s.autoRoutine = b.dataset.routine!), render())));
    all('[data-aim]').forEach((b) => (b.onclick = () => ((s.robot.aimAssist = b.dataset.aim as AimAssist), render())));
    all('[data-level]').forEach((b) => (b.onclick = () => ((s.robot.climber.maxLevel = Number(b.dataset.level)), render())));
    all('[data-preset]').forEach((b) => (b.onclick = () => {
      const preset = season.robotPresets?.find((p) => p.id === b.dataset.preset);
      if (!preset) return;
      const team = s.robot.teamNumber; s.robot = cloneConfig(preset.config); s.robot.teamNumber = team;
      s.autoRoutine = s.robot.placement?.enabled ? season.autoRoutines[0]?.id ?? 'none' : 'leave';
      render();
    }));
    all('[data-reef-level]').forEach((b) => (b.onclick = () => ((s.robot.placement!.maxLevel = Number(b.dataset.reefLevel)), render())));
    all('[data-mechanism]').forEach((b) => (b.onclick = () => {
      const on = b.dataset.enabled === '1';
      switch (b.dataset.mechanism) {
        case 'coral-pickup': s.robot.intake.primary = on; break;
        case 'algae-pickup': s.robot.intake.secondary = on; break;
        case 'coral': s.robot.placement!.enabled = on; break;
        case 'processor': s.robot.processor!.enabled = on; break;
        case 'net': s.robot.launcher.enabled = on; break;
      }
      render();
    }));
    all('[data-hp]').forEach((b) => (b.onclick = () => ((s.autoHumanPlayer = b.dataset.hp === '1'), render())));
    all('[data-turret]').forEach((b) => (b.onclick = () => ((s.robot.launcher.turret = b.dataset.turret === '1'), render())));
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
    const startBtn = el.querySelector<HTMLButtonElement>('[data-k="start"]');
    if (startBtn) startBtn.onclick = start;
    if (page === 'multiplayer' && lobby) bindMultiplayer(el, lobby, { s, season, rerender: render, goto: (p) => ((page = p), render()) });
  };

  if (lobby)
    lobby.onChange = () => {
      if (el.isConnected) render();
    };

  render();
}
