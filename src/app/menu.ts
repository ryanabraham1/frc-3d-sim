import type { CameraMode } from '@engine/camera/cameras';
import { detectTier, qualityPref, setQualityPref, type QualityPref } from '@engine/core/quality';
import { normalizeSkill, seasonLabel, type GameSettings, type SeasonDefinition } from '@engine/core/season';
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

type Page = 'home' | 'solo' | 'garage' | 'controls' | 'rules' | 'multiplayer' | 'ranked';
type PlayTab = 'match' | 'ai';
/** Pages that are reached from another page and return to it (Garage from the lobby goes back to the lobby). */
const SIDE_PAGES: Page[] = ['garage', 'controls', 'rules'];
const PAGE_LABEL: Record<Page, string> = { home: 'home', solo: 'solo setup', garage: 'the garage', controls: 'controls', rules: 'rules', multiplayer: 'the lobby', ranked: 'ranked' };

function load(): Partial<GameSettings> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<GameSettings>;
    // Easy and Elite no longer exist: Easy plays as Normal, Elite as Hard.
    if (saved.aiDifficulty) saved.aiDifficulty = normalizeSkill(saved.aiDifficulty);
    if (saved.aiAlly?.skill) saved.aiAlly.skill = normalizeSkill(saved.aiAlly.skill);
    if (saved.aiOpponent?.skill) saved.aiOpponent.skill = normalizeSkill(saved.aiOpponent.skill);
    return saved;
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
  if (season.id === '2026-rebuilt') {
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

/** Saved settings from before the auto planner was removed may still point at its "My planned auto" routine. */
function dropPlanner(s: GameSettings & { autoPlan?: unknown }, season: SeasonDefinition): void {
  delete s.autoPlan;
  if (s.autoRoutine === 'custom' || !season.autoRoutines.some((x) => x.id === s.autoRoutine)) s.autoRoutine = season.autoRoutines[0]?.id ?? 'none';
}

export function showMenu(container: HTMLElement, onStart: (s: GameSettings) => void, opts: { lobby?: LobbyController; page?: Page } = {}): void {
  const stored = load();
  let season = getSeason(stored?.seasonId ?? SEASONS[0].id);
  let s: GameSettings = { ...defaultSettings(season), ...(stored ?? {}) };
  dropPlanner(s, season);
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
  let page: Page = opts.page ?? 'home';
  /** Where Garage / Controls / Rules return to. */
  let backTo: Page = 'home';
  /** Asking before a solo match drops the room the player is in. */
  let leavePrompt = false;
  let playTab: PlayTab = 'match';
  /** Robot preview images already rendered (seasonId|robot id|alliance → data URL), so re-renders don't flash. */
  const thumbUrls = new Map<string, string>();
  let live: import('./robotPreview').LivePreview | null = null;
  let liveKey = '';
  let thumbObserver: IntersectionObserver | null = null;
  /** Fill the picker thumbnails and the live 3D preview of the selected robot (lazy: loads three/Rapier on first use). */
  const mountPreviews = () => {
    const host = el.querySelector<HTMLElement>('[data-live]');
    const imgs = Array.from(el.querySelectorAll<HTMLImageElement>('img[data-thumb]'));
    if (!host && !imgs.length) return;
    void import('./robotPreview').then((m) => {
      if (!el.isConnected) return;
      if (host) {
        const key = `${season.id}|${s.alliance}|${JSON.stringify(s.robot)}`;
        if (!live || !liveKey.startsWith(season.id + '|')) { live?.dispose(); live = m.createLivePreview(season, s.robot, s.alliance); liveKey = ''; }
        if (key !== liveKey) { live.set(s.robot, s.alliance); liveKey = key; }
        live.attach(host);
      }
      // Only fetch/render the cards that are on (or near) the screen, in the order they scroll into view: the CAD
      // files are several MB each, so loading every robot up front made the whole picker crawl.
      thumbObserver?.disconnect();
      const load = (img: HTMLImageElement) => {
        const t = season.teamRobots?.find((x) => x.id === img.dataset.thumb);
        if (!t || img.getAttribute('src')) return;
        const k = `${season.id}|${t.id}|${s.alliance}`;
        void m.robotThumb(season, t.config, s.alliance).then((url) => { thumbUrls.set(k, url); if (img.isConnected) img.src = url; });
      };
      if (typeof IntersectionObserver === 'undefined') return void imgs.forEach(load);
      const obs = (thumbObserver = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          obs.unobserve(e.target);
          load(e.target as HTMLImageElement);
        }
      }, { rootMargin: '150px' }));
      for (const img of imgs) if (!img.getAttribute('src')) obs.observe(img);
    });
  };
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

  const SKILLS = ['normal', 'hard', 'einstein'] as const;
  const skillLabel = (d: string) => d[0].toUpperCase() + d.slice(1);
  const skillHint: Record<string, string> = {
    normal: 'Runs the alliance plan and strategy switching at a moderate pace.',
    hard: 'Competitive real-team robots driven at full speed with the full alliance plan, fast re-planning and endgame climbs.',
    einstein: 'Championship level: Hard play, and the nearest opponent hunts you down whenever you are loaded and about to score.',
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

  const sameRobot = (a: RobotConfig, b: RobotConfig) => JSON.stringify({ ...a, teamNumber: 0 }) === JSON.stringify({ ...b, teamNumber: 0 });
  const teamRobotNow = () => season.teamRobots?.find((x) => sameRobot(s.robot, x.config));
  const presetNow = () => (season.robotPresets ?? []).find((x) => sameRobot(s.robot, x.config));
  const robotName = () => { const x = teamRobotNow(); return x ? `${x.team} ${x.name}` : presetNow()?.label ?? 'Custom build'; };
  /** The room (or ranked search) the player is in right now, if any: it survives moving between menu pages. */
  const activity = (): { page: Page; label: string; detail: string } | null => {
    if (!lobby) return null;
    if (lobby.status === 'lobby' && lobby.lobby) {
      const L = lobby.lobby;
      if (L.ranked) return { page: 'ranked', label: 'Ranked match', detail: 'a ranked match' };
      return { page: 'multiplayer', label: `Room ${L.room}`, detail: `room ${L.room}` };
    }
    if (lobby.status === 'lobby' && lobby.client.room) return { page: 'ranked', label: 'Match found', detail: 'a ranked match' };
    if (lobby.ranked.searching) return { page: 'ranked', label: 'Searching ranked…', detail: 'your ranked search' };
    return null;
  };
  /** Time-critical online steps (ranked draft, starting positions) keep the player on their page. */
  const forcedPage = (): Page | null => {
    if (!lobby || lobby.status !== 'lobby') return null;
    const L = lobby.lobby;
    if (L) return L.ranked ? 'ranked' : L.placing ? 'multiplayer' : null;
    return lobby.client.room ? 'ranked' : null;
  };

  /** The robot as a thumbnail (a real team's robot) or the isometric sketch (an archetype / custom build). */
  const robotThumb = () => {
    const x = teamRobotNow();
    if (x) {
      const url = thumbUrls.get(`${season.id}|${x.id}|${s.alliance}`);
      return `<span class="rs-thumb"><img alt="" data-thumb="${x.id}" ${url ? `src="${url}"` : ''}/></span>`;
    }
    return `<span class="rs-thumb art">${robotArt(s.alliance, s.robot.teamNumber, s.robot.intake.groundSide)}</span>`;
  };
  /** "Your robot" card with a way to change it: Home (big) and Solo setup (compact). */
  const robotStrip = (big: boolean) => {
    const r = s.robot;
    const chips = [`${toInch(r.frameLength).toFixed(0)} × ${toInch(r.frameWidth).toFixed(0)} in`, `${(r.maxSpeed / FT).toFixed(1)} ft/s`, season.robotSummary?.(r)].filter(Boolean) as string[];
    return `<section class="panel robot-strip ${big ? 'big' : ''}">
      ${robotThumb()}
      <div class="rs-info">
        <div class="rs-kicker">Your robot</div>
        <div class="rs-name">Team ${r.teamNumber} · ${esc(robotName())}</div>
        <div class="rs-chips">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
        ${big ? '<div class="rs-hint">Used in Solo and Online matches. Ranked robots are drafted in the match.</div>' : ''}
      </div>
      <button class="bbtn" data-page="garage">${icon.sliders(18)} Change robot</button>
    </section>`;
  };

  const homePage = () => {
    const act = activity();
    const resume = act && act.page !== 'home'
      ? `<div class="resume"><span class="mp-dot on"></span><div><b>You're in ${esc(act.detail)}</b><span>Your spot is saved while you look around.</span></div><button class="bbtn primary" data-page="${act.page}">Return</button></div>`
      : '';
    const mode = (cls: string, ic: string, title: string, desc: string, tags: string[], cta: string, target: Page, extra = '') =>
      `<article class="mode-card ${cls}">
        <div class="mode-ic">${ic}</div>
        <h2>${title}</h2>
        <p>${desc}</p>
        <div class="mode-tags">${tags.map((x) => `<span>${x}</span>`).join('')}</div>
        <div class="mode-actions"><button class="bbtn primary" data-page="${target}">${cta}</button>${extra}</div>
      </article>`;
    const help = (season.controlsHelp ?? DEFAULT_CONTROLS_HELP).slice(0, 5);
    return `
      <div class="home">
        ${resume}
        <div class="home-lead"><h1>Choose how you want to play</h1><p>${esc(seasonLabel(season))} · ${formatClock(matchLength())} match. New here? Start with <b>Solo</b>: it works instantly, no account or friends needed.</p></div>
        <div class="mode-grid">
          ${mode('solo', icon.gamepad(26), 'Solo', 'Drive a full match against AI. Play 3 v 3 with AI teammates, or practice alone with the field to yourself.', ['3 v 3 with AI', 'Solo practice', 'Choose your AUTO'], 'Set up &amp; play', 'solo', `<button class="link" data-k="quick" title="Start with your last settings">Quick start ▸</button>`)}
          ${mode('online', icon.users(26), 'Online', 'Play with friends or strangers. Quick play, browse public lobbies, or share a 4-letter code. Bots fill empty stations.', ['Up to 6 drivers', 'Public &amp; private rooms', 'Chat'], 'Play online', 'multiplayer')}
          ${mode('ranked', icon.flag(26), 'Ranked', 'Rated matches with a ban/pick robot draft, a rank ladder and a yearly leaderboard.', ['1v1 · 2v2 · 3v3', 'Robot draft', 'Leaderboard'], 'Play ranked', 'ranked')}
        </div>
        ${robotStrip(true)}
        <div class="learn-grid">
          <section class="panel learn">
            <div class="panel-head"><span>Basic controls</span><button class="link" data-page="controls">All controls &amp; rebinding</button></div>
            <div class="learn-keys">${help.map(([k, v]) => `<div><kbd>${esc(k)}</kbd><span>${esc(v)}</span></div>`).join('')}</div>
          </section>
          <section class="panel learn">
            <div class="panel-head"><span>${esc(season.name)} rules</span><button class="link" data-page="rules">Match timeline &amp; key rules</button></div>
            <p class="learn-sum">${esc(season.summary)}</p>
          </section>
        </div>
      </div>`;
  };

  const soloPage = () => {
    const routine = season.autoRoutines.find((x) => x.id === s.autoRoutine);
    const hasAi = s.aiOpponents !== false;
    const hpHint = season.humanPlayerHint
      ? s.autoHumanPlayer ? season.humanPlayerHint.auto : season.humanPlayerHint.manual
      : season.maxScoringLevel
        ? s.autoHumanPlayer ? 'Nearby CORAL stations supply you; human players throw received ALGAE in TELEOP.' : 'Press H to toggle CORAL stations and throw received ALGAE in TELEOP.'
        : s.autoHumanPlayer ? 'The chute feeds you automatically.' : 'Press H to open the chute door yourself.';
    const settings = `
      <section class="panel settings">
        <div class="panel-head"><span>Match setup</span><span class="dim">${esc(seasonLabel(season))} · ${formatClock(matchLength())} match</span></div>
        <div class="settings-grid">
          ${group('Alliance', `<div class="seg">${opt('data-alliance="blue"', 'Blue', s.alliance === 'blue', 'solid blue', '<span class="dot"></span>')}${opt('data-alliance="red"', 'Red', s.alliance === 'red', 'solid red', '<span class="dot"></span>')}</div>`)}
          ${group('AI opponents', `<div class="seg">${opt('data-ai="1"', '3 vs 3', s.aiOpponents !== false)}${opt('data-ai="0"', 'Solo practice', s.aiOpponents === false)}</div>`, '3 vs 3 adds two AI teammates and three opponents who collect and score.')}
          ${group('Camera', `<div class="seg">${CAMERAS.map(([id, label]) => opt(`data-camera="${id}"`, label, s.camera === id)).join('')}</div>`, '', 'wide')}
          ${group('Human player', `<div class="seg">${opt('data-hp="1"', 'Auto', s.autoHumanPlayer)}${opt('data-hp="0"', 'Manual (H)', !s.autoHumanPlayer)}</div>`, hpHint, 'wide')}
          ${group('Practice options', `<div class="seg">${opt('data-toggle="manualAuto"', 'Drive in AUTO', s.manualAuto)}${opt('data-toggle="autoIntake"', 'Auto-intake', s.autoIntake)}${opt('data-toggle="shadows"', 'Shadows', s.shadows)}</div>`, 'None of these change scoring.', 'wide')}
          ${group('Graphics quality', `<div class="seg">${(['auto', 'low', 'medium', 'high'] as const).map((q) => opt(`data-quality="${q}"`, q[0].toUpperCase() + q.slice(1), qualityPref() === q)).join('')}</div>`, `Auto picked ${detectTier()} for this device. Lower settings simulate less (hoppers) and draw less; applies to the next match.`, 'wide')}
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
    const matchTab = `${robotStrip(false)}<div class="play-grid"><div class="col">${settings}</div><div class="col">${map}</div></div>`;
    const aiTab = `
      <section class="panel">
        <div class="panel-head"><span>AI opponents &amp; teammates</span><span class="dim">${esc(season.name)}</span></div>
        <div class="settings-grid ai-grid">${aiGroups()}</div>
      </section>`;
    return playTab === 'ai' && hasAi ? aiTab : matchTab;
  };

  /** Says what the robot being edited is for and where "Done" returns. */
  const garageBanner = () => {
    const where = backTo === 'multiplayer' && activity()?.page === 'multiplayer' ? 'your lobby' : backTo === 'solo' ? 'your solo match' : backTo === 'ranked' ? 'Ranked' : '';
    const note = backTo === 'ranked'
      ? 'Ranked matches use robots drafted in the match, so this robot applies to Solo and Online play.'
      : where ? `Changes apply to ${where} straight away. Press <b>Done</b> to go back.` : 'This robot is used in Solo and Online matches. Changes save automatically.';
    return `<div class="garage-note">${icon.sliders(16)}<span>${note}</span></div>`;
  };

  const garagePage = () => {
    const F = numFields(season);
    const r = s.robot;
    const acc = F.acc.get(r);
    const robotCard = `
      <section class="panel robot-card ${s.alliance}">
        <div class="robot-top"><span>Your robot</span><span class="tag ${s.alliance}">${s.alliance === 'red' ? 'Red' : 'Blue'} alliance</span></div>
        <div class="robot-art ${r.model ? 'live' : ''}" ${r.model ? 'data-live' : ''}>${r.model ? '' : robotArt(s.alliance, r.teamNumber, r.intake.groundSide)}</div>
        <div class="robot-id"><div class="robot-num">${r.teamNumber}</div><div class="robot-meta"><b>${esc(robotName())}</b><span>${toInch(r.frameLength).toFixed(0)} × ${toInch(r.frameWidth).toFixed(0)} in · ${(r.maxSpeed / FT).toFixed(1)} ft/s</span></div></div>
      </section>`;
    const fields = season.robotFields ?? ['team', 'height', 'len', 'wid', 'speed', 'accel', 'cap', 'pre', 'rate', 'acc', 'cspd'];
    const same = (c: RobotConfig) => JSON.stringify({ ...r, teamNumber: 0 }) === JSON.stringify({ ...c, teamNumber: 0 });
    const presets = season.robotPresets ?? [];
    const current = presets.find((p) => same(p.config));
    const teams = season.teamRobots ?? [];
    const team = teams.find((t) => same(t.config));
    const speedBar = (cfg: RobotConfig) => ({ label: 'Speed', value: `${(cfg.maxSpeed / FT).toFixed(1)} ft/s`, frac: cfg.maxSpeed / FT / 22 });
    const cardBars = (cfg: RobotConfig) => [speedBar(cfg), ...(season.robotCardBars?.(cfg) ?? season.robotSpecBars?.(cfg)?.slice(0, 3) ?? [])];
    const miniBar = (b: { label: string; value: string; frac: number }) =>
      `<div class="mini-bar"><span>${esc(b.label)}</span><i><u style="width:${Math.round(Math.min(1, Math.max(0, b.frac)) * 100)}%"></u></i><b>${esc(b.value)}</b></div>`;
    const teamCard = (t: (typeof teams)[number]) =>
      `<button class="team-card ${t === team ? 'on' : ''}" data-team-robot="${t.id}" title="${esc(t.description)}">
        <span class="team-thumb"><img alt="" data-thumb="${t.id}" ${thumbUrls.get(`${season.id}|${t.id}|${s.alliance}`) ? `src="${thumbUrls.get(`${season.id}|${t.id}|${s.alliance}`)}"` : ''} /></span>
        <span class="team-name"><b>${t.team}</b> ${esc(t.name)}</span>
        <span class="mini-bars">${cardBars(t.config).map(miniBar).join('')}</span>
      </button>`;
    const teamPicker = teams.length
      ? `<div class="config-presets"><div class="group"><div class="label">Play as a real robot</div><div class="team-grid">${teams.map(teamCard).join('')}</div><div class="hint">${esc(team ? `${team.description} Source: ${team.source}.` : `Top ${season.year} robots, simplified and animated. Capabilities come from their Chief Delphi reveals and tech binders; stats not published by the team are estimates.`)}</div></div></div>`
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
        <div class="panel-head"><span>Robot</span><button class="link" data-k="resetRobot">${icon.reset(13)} Reset to ${esc(season.label ?? String(season.year))} defaults</button></div>
        ${teamPicker}
        ${profiles}
        <div class="tune-opts">${options}</div>
        <div class="tune">${fields.filter((k) => F[k]).map((k) => numInput(F[k])).join('')}</div>
        ${season.robotHint ? `<div class="config-note">${esc(season.robotHint)}<br/>Speeds, cycle times and accuracy are simulator tuning; mechanism choices mirror ${season.label ? 'archetypes derived from past FRC robots' : `real ${season.year} robot archetypes`}.</div>` : ''}
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
    const robotTab = `${garageBanner()}<div class="robot-grid"><div class="col">${robotCard}${summary}</div><div class="col">${spec}</div></div>`;
    return robotTab;
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
  /** Move between menu pages; Garage / Controls / Rules remember where they were opened from. */
  const go = (p: Page) => {
    if (forcedPage() && p !== forcedPage()) return;
    if (SIDE_PAGES.includes(p) && !SIDE_PAGES.includes(page)) backTo = page;
    capturing = null;
    leavePrompt = false;
    page = p;
    render();
  };
  const launch = () => {
    save(s);
    document.removeEventListener('keydown', onKey);
    live?.dispose();
    el.remove();
    onStart(s);
  };
  /** Start a solo match, asking first if that would drop the room the player is in. */
  const start = () => {
    if (activity() && !leavePrompt) {
      leavePrompt = true;
      return render();
    }
    launch();
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
    const online = page === 'multiplayer' || page === 'ranked';
    const draft = online ? {
      name: el.querySelector<HTMLInputElement>('[data-mp="name"]')?.value,
      code: el.querySelector<HTMLInputElement>('[data-mp="code"]')?.value,
      url: el.querySelector<HTMLInputElement>('[data-mp="url"]')?.value,
      title: el.querySelector<HTMLInputElement>('[data-mp="title"]')?.value,
      'room-title': el.querySelector<HTMLInputElement>('[data-mp="room-title"]')?.value,
      chat: el.querySelector<HTMLInputElement>('[data-mp="chat"]')?.value,
      focused: (document.activeElement as HTMLElement | null)?.dataset.mp,
    } : null;
    const forced = forcedPage();
    if (forced && page !== forced) page = forced;
    const act = activity();
    // The robot or AUTO choices can change on any page (Garage, Solo setup); a room needs to hear about it.
    if (lobby && lobby.status === 'lobby' && lobby.lobby && !lobby.lobby.ranked && page !== 'multiplayer') lobby.syncMine();
    const titles: Record<Page, { h1: string; sub: string }> = {
      home: { h1: '', sub: '' },
      solo: { h1: 'Solo match', sub: 'Set up your match, then press Start.' },
      garage: { h1: 'Garage', sub: 'Build the robot you drive.' },
      controls: { h1: 'Controls', sub: 'Driving is field-oriented from your driver station. Press V in a match to switch cameras.' },
      rules: { h1: `${season.name} rules`, sub: season.summary },
      multiplayer: { h1: 'Online', sub: lobby?.lobby ? '' : 'Join a lobby, host your own, or watch a live match.' },
      ranked: { h1: 'Online', sub: lobby?.lobby ? '' : 'Rated matches with a robot draft.' },
    };
    // Multiplayer page content lives in multiplayer.ts; the lobby re-renders it on every lobby change.
    const mp =
      online && lobby
        ? (save(s), multiplayerPage(lobby, { s, season, page: page as 'multiplayer' | 'ranked', robotName: robotName(), rerender: render, goto: (p) => go(p) }))
        : null;
    const t = titles[page];
    // innerHTML below rebuilds the scroll container; keep the user's place when changing a setting on the same page.
    const pageKey = page === 'solo' ? `solo:${playTab}` : page;
    const prevPage = el.dataset.page;
    const scrollTop = el.querySelector<HTMLElement>('.main')?.scrollTop ?? 0;
    const playTabs = `<div class="subtabs" role="tablist">${([['match', 'Match'], ...(s.aiOpponents !== false ? [['ai', 'AI']] : [])] as [PlayTab, string][]).map(([id, label]) => `<button class="subtab ${playTab === id ? 'on' : ''}" role="tab" aria-selected="${playTab === id}" data-ptab="${id}">${label}</button>`).join('')}</div>`;
    const locked = !!forced;
    const nav = (p: Page, label: string, extra = '') => `<button class="nav-btn ${page === p ? 'on' : ''}" data-page="${p}" ${locked && page !== p ? 'disabled' : ''} ${page === p ? 'aria-current="page"' : ''}>${label}${extra}</button>`;
    // Lobbies, spectating and Ranked are one area: Online. The two pages are tabs inside it.
    const inOnline = page === 'multiplayer' || page === 'ranked';
    const navOnline = `<button class="nav-btn ${inOnline ? 'on' : ''}" data-page="${inOnline ? page : (act?.page ?? 'multiplayer')}" ${locked && !inOnline ? 'disabled' : ''} ${inOnline ? 'aria-current="page"' : ''}>Online${act ? '<i class="nav-live" title="You are in a match or room"></i>' : ''}</button>`;
    const onlineTabs = inOnline && lobby && !(lobby.status === 'lobby' && lobby.lobby) && !(lobby.status === 'lobby' && lobby.client.room)
      ? `<div class="subtabs" role="tablist">${([['multiplayer', 'Lobbies'], ['ranked', 'Ranked']] as [Page, string][]).map(([id, label]) => `<button class="subtab ${page === id ? 'on' : ''}" role="tab" aria-selected="${page === id}" data-page="${id}">${label}</button>`).join('')}</div>`
      : '';
    const modeNav = nav('home', 'Home') + nav('solo', 'Solo') + (lobby ? navOnline : '') + nav('garage', 'Garage');
    const backLabel = `Back to ${page === 'garage' || page === 'controls' || page === 'rules' ? PAGE_LABEL[backTo === 'multiplayer' && act?.page !== 'multiplayer' ? 'home' : backTo] : 'home'}`;
    const footer = mp
      ? mp.footer
      : page === 'home'
        ? ''
        : page === 'solo'
          ? `<button class="bbtn" data-page="home"><kbd>Esc</kbd>Back</button><span class="spacer"></span><button class="bbtn primary" data-k="start"><kbd>Enter</kbd>Start solo match</button>`
          : page === 'garage'
            ? `<span class="spacer"></span><button class="bbtn primary" data-page="${backTo}"><kbd>Esc</kbd>Done · ${esc(backLabel)}</button>`
            : `<button class="bbtn" data-page="${backTo}"><kbd>Esc</kbd>${esc(backLabel)}</button><span class="spacer"></span>`;
    el.innerHTML = `
      <header class="topbar">
        <button class="brand" data-page="home" ${locked ? 'disabled' : ''} aria-label="FRC Sim home">FRC Sim</button><span class="brand-sep"></span>
        <label class="season-pick"><select data-k="season" aria-label="Game season" ${lobby?.lobby && (!lobby.isHost || lobby.lobby.inMatch || lobby.lobby.ranked) ? 'disabled' : ''}>${SEASONS.map((x) => `<option value="${x.id}" ${x.id === season.id ? 'selected' : ''}>${esc(seasonLabel(x))}</option>`).join('')}</select></label>
        <nav class="nav" aria-label="Main">${modeNav}<span class="nav-sep"></span>${nav('controls', 'Controls')}${nav('rules', 'Rules')}</nav>
        ${act && act.page !== page ? `<button class="live-chip" data-page="${act.page}"><span class="mp-dot on"></span>${esc(act.label)}</button>` : ''}
        <button class="team-chip" data-page="garage" ${locked ? 'disabled' : ''} title="Change your robot in the Garage"><i>${esc(String(s.robot.teamNumber).slice(0, 1))}</i><span>Team ${s.robot.teamNumber}<small>${esc(robotName())}</small></span></button>
      </header>
      <main class="main ${page === 'home' ? 'is-home' : ''}">
        ${page === 'home' ? '' : `<div class="titlebar"><h1 class="title">${esc(t.h1)}${t.sub ? `<small>${esc(t.sub)}</small>` : ''}</h1>${page === 'solo' ? (s.aiOpponents !== false ? playTabs : '') : onlineTabs}</div>`}
        ${mp ? mp.body : page === 'home' ? homePage() : page === 'solo' ? soloPage() : page === 'garage' ? garagePage() : page === 'controls' ? controlsPage() : rulesPage()}
      </main>
      ${footer ? `<footer class="bar-bottom">${footer}</footer>` : ''}
      ${leavePrompt && act ? `<div class="modal-back" data-modal="cancel"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-h"><h3 id="modal-h">Leave ${esc(act.detail)}?</h3><p>Starting a solo match takes you out of ${esc(act.detail)}. To keep playing online, go back to it instead.</p><div class="modal-actions"><button class="bbtn" data-modal="cancel">Stay</button><button class="bbtn primary" data-modal="confirm">Leave &amp; start solo</button></div></div></div>` : ''}`;
    el.dataset.page = pageKey;
    if (prevPage === pageKey) {
      const main = el.querySelector<HTMLElement>('.main');
      if (main) main.scrollTop = scrollTop;
    }
    bind();
    mountPreviews();
    if (draft && online) {
      for (const key of ['name', 'code', 'url', 'title', 'room-title', 'chat'] as const) {
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
    if (leavePrompt) {
      if (e.key === 'Escape') ((leavePrompt = false), render());
      return;
    }
    if (e.key === 'Escape') {
      if (tag === 'INPUT' || tag === 'SELECT') return void (e.target as HTMLElement).blur();
      if (forcedPage() || page === 'home') return;
      go(SIDE_PAGES.includes(page) ? backTo : 'home');
    } else if (e.key === 'Enter' && page === 'solo' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'BUTTON') start();
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
    all('[data-page]').forEach((b) => (b.onclick = () => go(b.dataset.page as Page)));
    all('[data-k="quick"]').forEach((b) => (b.onclick = start));
    all('[data-modal="cancel"]').forEach((b) => (b.onclick = (e) => { if (e.target === b) ((leavePrompt = false), render()); }));
    all('[data-modal="confirm"]').forEach((b) => (b.onclick = launch));
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
    if (routineSel) routineSel.onchange = () => ((s.autoRoutine = routineSel.value), (s.manualAuto = false), render());
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
    all('[data-quality]').forEach((b) => (b.onclick = () => (setQualityPref(b.dataset.quality as QualityPref), render())));
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
    if (wrap && page === 'solo' && playTab === 'match') {
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
    if ((page === 'multiplayer' || page === 'ranked') && lobby) bindMultiplayer(el, lobby, { s, season, page: page as 'multiplayer' | 'ranked', robotName: robotName(), rerender: render, goto: (p) => go(p) });
  };

  if (lobby)
    lobby.onChange = () => {
      // Don't rebuild the page under a robot being dragged on the placement map.
      if (el.isConnected && !placementDragging()) render();
    };

  render();
}
