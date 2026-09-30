import type { GameSettings, SeasonDefinition } from '@engine/core/season';
import type { CameraMode } from '@engine/camera/cameras';
import { DEFAULT_CONTROLS_HELP } from '@engine/input/input';
import { AimAssist, cloneConfig, RobotConfig } from '@engine/robot/config';
import { formatClock, inch, toInch } from '@engine/units';
import { SEASONS, getSeason } from '@seasons/index';
import { icon } from './icons';

const STORAGE_KEY = 'frc-sim-settings-v1';
const FT = 0.3048;

type Page = 'play' | 'controls' | 'rules';

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
  max: number;
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
    { key: 'cap', label: 'Capacity', min: 1, max: 120, step: 1, get: (c) => c.hopperCapacity, set: (c, v) => (c.hopperCapacity = Math.round(v)) },
    { key: 'pre', label: 'Preload', min: 0, max: 8, step: 1, get: (c) => c.preload, set: (c, v) => (c.preload = Math.round(v)) },
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
  return Object.fromEntries(list.map((f) => [f.key, f]));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const initials = (s: string) =>
  s
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

function row(title: string, sub: string, controls: string, badge = initials(title)): string {
  return `<div class="row">
    <div class="badge">${esc(badge)}</div>
    <div class="row-text"><div class="row-title">${esc(title)}</div><div class="row-sub">${sub}</div></div>
    <div class="row-ctl">${controls}</div>
  </div>`;
}

function opt(attrs: string, label: string, on: boolean, ico = '', extra = ''): string {
  return `<button class="opt ${on ? 'on' : ''} ${extra}" ${attrs}>${ico}<span>${esc(label)}</span></button>`;
}

export function showMenu(container: HTMLElement, onStart: (s: GameSettings) => void): void {
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
  let page: Page = 'play';

  const el = document.createElement('div');
  el.className = 'shell';
  container.appendChild(el);

  const matchLength = () => season.timeline.filter((p) => p.mode !== 'disabled').reduce((a, p) => a + p.duration, 0);

  const numInput = (f: NumField) =>
    `<label class="num"><span>${esc(f.label)}</span><input type="number" data-f="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${f.get(s.robot)}"/></label>`;

  const playPage = () => {
    const F = numFields(season);
    const r = s.robot;
    const routine = season.autoRoutines.find((x) => x.id === s.autoRoutine);
    const allianceCode = `${s.alliance === 'red' ? 'R' : 'B'}${s.station}`;
    return `
      <section class="card">
        <div class="card-head">
          <div class="ch-left">
            <span class="big-num ${s.alliance}">${allianceCode}</span>
            <div><div class="ch-title">${s.alliance === 'red' ? 'Red' : 'Blue'} ${s.station}</div><div class="mono dim">team ${r.teamNumber} · driver station</div></div>
          </div>
          <button class="start" data-k="start">${icon.play(16)}<span>Start match</span></button>
          <div class="mono amber">${s.manualAuto ? 'You drive AUTO' : 'AUTO runs your routine'} after a 3s countdown</div>
        </div>
        ${row('Alliance', 'Which side of the field you drive for', opt('data-alliance="red"', 'Red', s.alliance === 'red', icon.flag(15), 'red') + opt('data-alliance="blue"', 'Blue', s.alliance === 'blue', icon.flag(15), 'blue'), 'AL')}
        ${row('Driver station', 'Sets your starting spot and driver view', [1, 2, 3].map((n) => opt(`data-station="${n}"`, `Station ${n}`, s.station === n, icon.user(15))).join(''), 'DS')}
        ${row(
          'Autonomous',
          s.manualAuto
            ? 'You drive during the 20 s AUTO period. Remember G403 — don’t fully cross the CENTER LINE.'
            : esc(routine?.description ?? ''),
          opt('data-routine="__manual"', 'Drive it yourself', s.manualAuto, icon.gamepad(15)) +
            season.autoRoutines.map((x) => opt(`data-routine="${x.id}"`, x.label, !s.manualAuto && x.id === s.autoRoutine, icon.route(15))).join(''),
          'AU',
        )}
        ${row(
          'Camera',
          'Starting view — press V in a match to cycle. Follow: drag to orbit, scroll to zoom.',
          (
            [
              ['driver', 'Driver station'],
              ['follow', 'Follow (3rd person)'],
              ['chase', 'Chase'],
              ['overhead', 'Overhead'],
            ] as [CameraMode, string][]
          )
            .map(([m, label]) => opt(`data-camera="${m}"`, label, s.camera === m, icon.target(15)))
            .join(''),
          'CM',
        )}
        ${row(
          'Match options',
          'Practice helpers — none of these change scoring',
          opt('data-toggle="autoHumanPlayer"', 'Auto human player', s.autoHumanPlayer, icon.users(15)) +
            opt('data-toggle="autoIntake"', 'Auto-intake', s.autoIntake, icon.check(15)) +
            opt('data-toggle="shadows"', 'Shadows', s.shadows, icon.sliders(15)),
          'OP',
        )}
      </section>

      <div class="section-label">${icon.logo(14)}<span>Your robot</span><button class="link" data-k="resetRobot">${icon.reset(13)} Reset to ${season.year} defaults</button></div>
      <section class="card">
        ${row('Identity', 'Shown on your bumpers', numInput(F.team), 'ID')}
        ${row('Size', `Max height ${toInch(season.maxRobotHeight).toFixed(0)}in · under 22.25in fits the TRENCH`, numInput(F.height) + numInput(F.len) + numInput(F.wid), 'SZ')}
        ${row('Drivetrain', 'Swerve · field-oriented', numInput(F.speed) + numInput(F.accel), 'DT')}
        ${row('Hopper', 'Preload max 8 FUEL', numInput(F.cap) + numInput(F.pre), 'HP')}
        ${row(
          'Launcher',
          'Rate and grouping',
          numInput(F.rate) + numInput(F.acc) + opt('data-toggle="turret"', 'Turret', r.launcher.turret, icon.target(15)),
          'LN',
        )}
        ${row(
          'Aim assist',
          'Full = turret aim + speed · Speed = aim with your chassis · Off = manual',
          (['full', 'speed', 'off'] as AimAssist[]).map((a) => opt(`data-aim="${a}"`, { full: 'Full', speed: 'Speed only', off: 'Off' }[a], r.aimAssist === a, icon.target(15))).join(''),
          'AA',
        )}
        ${row(
          'Climber',
          'Highest TOWER level your robot can reach',
          Array.from({ length: season.maxClimbLevel + 1 }, (_, n) => opt(`data-level="${n}"`, n === 0 ? 'None' : `L${n}`, r.climber.maxLevel === n, n === 0 ? '' : icon.arrowUp(15))).join('') + numInput(F.cspd),
          'CL',
        )}
      </section>`;
  };

  const controlsPage = () => `
    <section class="card">
      ${(season.controlsHelp ?? DEFAULT_CONTROLS_HELP)
        .map(([k, v]) => `<div class="row"><div class="badge">${icon.gamepad(15)}</div><div class="row-text"><div class="row-title">${esc(v)}</div></div><div class="row-ctl"><kbd>${esc(k)}</kbd></div></div>`)
        .join('')}
    </section>`;

  const rulesPage = () => `
    <section class="card">
      ${season.timeline
        .map((p) =>
          row(p.label, `${p.mode === 'disabled' ? 'Robots disabled' : p.mode.toUpperCase()}${p.displayGroup ? ` · field timer group “${p.displayGroup}”` : ''}`, `<span class="pill mono">${p.duration}s</span>`, p.id.slice(0, 2)),
        )
        .join('')}
    </section>
    ${
      season.rulesSummary?.length
        ? `<div class="section-label">${icon.book(14)}<span>Key rules</span></div><section class="card">${season.rulesSummary
            .map((x) => row(x.title, esc(x.detail), x.value ? `<span class="pill mono">${esc(x.value)}</span>` : '', x.tag ?? initials(x.title)))
            .join('')}</section>`
        : ''
    }`;

  const render = () => {
    const titles: Record<Page, { eyebrow: string; h1: string; lede: string }> = {
      play: { eyebrow: `${season.year} · ${season.name}`, h1: 'Ready to drive?', lede: `Set up your robot and press <b>Start match</b>. Drive AUTO yourself or pick a routine, then TELEOP is all yours.` },
      controls: { eyebrow: 'Keyboard & gamepad', h1: 'Controls', lede: 'Driving is field-oriented from your driver station. Press <b>V</b> in a match to switch cameras.' },
      rules: { eyebrow: `${season.manualVersion}`, h1: `${season.name} at a glance`, lede: esc(season.summary) },
    };
    const t = titles[page];
    const nav = (p: Page, label: string, ico: string) => `<button class="nav ${page === p ? 'on' : ''}" data-page="${p}">${ico}<span>${label}</span></button>`;
    el.innerHTML = `
      <aside class="side">
        <div class="logo">
          <div class="logo-tile">${icon.logo(22)}</div>
          <div><div class="logo-title">FRC 3D SIM</div><div class="logo-sub">SEASON ${season.year}</div></div>
        </div>
        <nav>
          ${nav('play', 'Play', icon.play(18))}
          ${nav('controls', 'Controls', icon.gamepad(18))}
          ${nav('rules', 'Game rules', icon.book(18))}
        </nav>
        <div class="side-foot">
          <label class="season-pick mono"><span>Season</span>
            <select data-k="season">${SEASONS.map((x) => `<option value="${x.id}" ${x.id === season.id ? 'selected' : ''}>${x.year} ${esc(x.name)}</option>`).join('')}</select>
          </label>
          <div class="status mono"><span class="dot"></span>Singleplayer</div>
          <div class="mono dim small">Multiplayer · coming later</div>
        </div>
      </aside>
      <main class="main">
        <div class="head">
          <div>
            <div class="eyebrow">${icon.calendar(15)}<span>${esc(t.eyebrow)}</span></div>
            <h1>${t.h1}</h1>
            <p class="lede">${t.lede}</p>
          </div>
          <div class="stat">
            <div class="stat-num">${season.gamePiece.count}</div>
            <div><div class="stat-top">${esc(season.gamePiece.name)}</div><div class="stat-sub mono">on field · ${formatClock(matchLength())} match</div></div>
          </div>
        </div>
        ${page === 'play' ? playPage() : page === 'controls' ? controlsPage() : rulesPage()}
      </main>`;
    bind();
  };

  const bind = () => {
    const all = <T extends HTMLElement>(sel: string) => Array.from(el.querySelectorAll<T>(sel));
    all<HTMLButtonElement>('[data-page]').forEach((b) => (b.onclick = () => ((page = b.dataset.page as Page), render())));
    const seasonSel = el.querySelector<HTMLSelectElement>('[data-k="season"]')!;
    seasonSel.onchange = () => {
      season = getSeason(seasonSel.value);
      s = { ...defaultSettings(season), alliance: s.alliance, station: s.station };
      render();
    };
    all<HTMLButtonElement>('[data-alliance]').forEach((b) => (b.onclick = () => ((s.alliance = b.dataset.alliance as 'red' | 'blue'), render())));
    all<HTMLButtonElement>('[data-station]').forEach((b) => (b.onclick = () => ((s.station = Number(b.dataset.station)), render())));
    all<HTMLButtonElement>('[data-routine]').forEach(
      (b) =>
        (b.onclick = () => {
          const id = b.dataset.routine!;
          s.manualAuto = id === '__manual';
          if (!s.manualAuto) s.autoRoutine = id;
          render();
        }),
    );
    all<HTMLButtonElement>('[data-camera]').forEach((b) => (b.onclick = () => ((s.camera = b.dataset.camera as CameraMode), render())));
    all<HTMLButtonElement>('[data-aim]').forEach((b) => (b.onclick = () => ((s.robot.aimAssist = b.dataset.aim as AimAssist), render())));
    all<HTMLButtonElement>('[data-level]').forEach((b) => (b.onclick = () => ((s.robot.climber.maxLevel = Number(b.dataset.level)), render())));
    all<HTMLButtonElement>('[data-toggle]').forEach(
      (b) =>
        (b.onclick = () => {
          const k = b.dataset.toggle!;
          if (k === 'turret') s.robot.launcher.turret = !s.robot.launcher.turret;
          else if (k === 'autoHumanPlayer' || k === 'autoIntake' || k === 'shadows') s[k] = !s[k];
          render();
        }),
    );
    const reset = el.querySelector<HTMLButtonElement>('[data-k="resetRobot"]');
    if (reset)
      reset.onclick = () => {
        s.robot = cloneConfig(season.robotDefaults);
        render();
      };
    const F = numFields(season);
    all<HTMLInputElement>('[data-f]').forEach((input) => {
      const f = F[input.dataset.f!];
      input.onchange = () => {
        const v = Math.min(f.max, Math.max(f.min, Number(input.value)));
        if (Number.isFinite(v)) f.set(s.robot, v);
        input.value = String(f.get(s.robot));
        if (f.key === 'team') render();
      };
    });
    const start = el.querySelector<HTMLButtonElement>('[data-k="start"]');
    if (start)
      start.onclick = () => {
        save(s);
        el.remove();
        onStart(s);
      };
  };

  render();
}
