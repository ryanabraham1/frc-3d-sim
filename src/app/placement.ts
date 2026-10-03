import type { Alliance } from '@engine/coords';
import type { MapShape, SeasonDefinition } from '@engine/core/season';
import { slotAlliance, slotStation, type LobbyPlayer } from '@engine/net/protocol';
import {
  checkStartSpot,
  fieldToSpot,
  fitStartSpot,
  footprintPoly,
  mirrorPose,
  spotToField,
  wrapAngle,
  type FieldDims,
  type Poly,
  type StartSpot,
} from '@engine/startPose';

/**
 * Starting-position map shared by the single-player menu and the multiplayer placement phase: the field with the
 * legal starting zone shaded, robots drawn at their chosen spots, and pointer handling to drag a robot around
 * (anywhere in the zone) and rotate it with the knob on its nose.
 */

const SHAPE_OPACITY: Record<MapShape['kind'], number> = { zone: 0.07, hub: 0.28, bump: 0.16, trench: 0.12, tower: 0.1, depot: 0.08, outpost: 0.1 };
const COLOR = { red: '#ef4444', blue: '#4f8cff' } as const;
const ACCENT = '#a48bff';
/** Default footprint when a driver's robot size isn't known yet. */
const FALLBACK = { length: 0.9, width: 0.9 };

export const fieldDims = (season: SeasonDefinition): FieldDims => ({ length: season.fieldLength, width: season.fieldWidth, symmetry: season.mapSymmetry });

/** The driver-station preset as a blue-frame spot. */
export const presetSpot = (season: SeasonDefinition, alliance: Alliance, station: number): StartSpot =>
  fieldToSpot(fieldDims(season), alliance, season.startPose(alliance, station));

export interface PlacedRobot {
  alliance: Alliance;
  /** Blue frame. */
  spot: StartSpot;
  length: number;
  width: number;
  label: string;
  title?: string;
  mine?: boolean;
  ready?: boolean;
  invalid?: boolean;
  /** Draw the floor-intake marker on the front (true) or back (false) bumper; undefined = no marker. */
  intakeFront?: boolean;
}

export interface MapOptions {
  /** Alliances whose starting zone is shaded. */
  zones: Alliance[];
  /** Station presets to show as clickable rings (single player). */
  stations?: { alliance: Alliance; station: number; spot: StartSpot }[];
}

// ───────────────────────────── multiplayer helpers (pure) ─────────────────────────────

type PlacingPlayer = Pick<LobbyPlayer, 'peerId' | 'slot' | 'spot' | 'dims'>;

/** A seated player's effective spot: their pick, else the preset for their driver station. */
export function playerSpot(season: SeasonDefinition, p: PlacingPlayer): StartSpot | null {
  if (!p.slot) return null;
  return p.spot ?? presetSpot(season, slotAlliance(p.slot), slotStation(p.slot));
}

/** Why each seated player's start isn't legal (outside the zone, on a field element, on a teammate). */
export function placementProblems(season: SeasonDefinition, players: PlacingPlayer[]): Map<string, string> {
  const out = new Map<string, string>();
  const area = season.startArea;
  if (!area) return out;
  const seated = players.filter((p) => p.slot);
  for (const p of seated) {
    const spot = playerSpot(season, p)!;
    const d = p.dims ?? FALLBACK;
    const mates = seated
      .filter((o) => o !== p && slotAlliance(o.slot!) === slotAlliance(p.slot!))
      .map((o) => footprintPoly(playerSpot(season, o)!, (o.dims ?? FALLBACK).length, (o.dims ?? FALLBACK).width));
    const c = checkStartSpot(area, spot, d.length, d.width, mates);
    if (!c.ok) out.set(p.peerId, c.reason);
  }
  return out;
}

// ───────────────────────────── drawing ─────────────────────────────

const pointIn = (poly: Poly, x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

function baseShapes(season: SeasonDefinition): string {
  const L = season.fieldLength;
  const W = season.fieldWidth;
  const fy = (y: number) => W - y; // +y is up on screen
  const mirror = season.mapSymmetry === 'mirror';
  const poly = (m: MapShape, red: boolean) => m.points.map(([x, y]) => `${(red ? L - x : x).toFixed(3)},${fy(red && !mirror ? W - y : y).toFixed(3)}`).join(' ');
  const shapes = season.mapShapes ?? [];
  let out = '';
  for (const red of [false, true]) {
    const col = red ? COLOR.red : COLOR.blue;
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
  return out;
}

/** The legal starting zone (green) and the field elements inside it a robot can't start on (dark). */
function areaShapes(season: SeasonDefinition, alliance: Alliance): string {
  const area = season.startArea;
  if (!area) return '';
  const f = fieldDims(season);
  const pt = ([x, y]: [number, number]) => {
    const p = mirrorPose(f, alliance, { x, y, yaw: 0 });
    return `${p.x.toFixed(3)},${(f.width - p.y).toFixed(3)}`;
  };
  const r = area.rect;
  // With a starting line, the zone is the strip along it (drawn as the line plus the side robots start on).
  const x1 = area.line ?? r.x1;
  let out = `<polygon points="${[[r.x0, r.y0], [x1, r.y0], [x1, r.y1], [r.x0, r.y1]].map((p) => pt(p as [number, number])).join(' ')}" class="place-zone" fill="#34d399" fill-opacity=".1" stroke="#34d399" stroke-opacity=".75" stroke-width="1.5" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>`;
  if (area.line !== undefined) out += `<line x1="${pt([area.line, r.y0]).split(',')[0]}" y1="0" x2="${pt([area.line, r.y0]).split(',')[0]}" y2="${f.width}" stroke="#34d399" stroke-width="3.5" vector-effect="non-scaling-stroke"/>`;
  for (const k of area.keepOut ?? []) out += `<polygon points="${k.map((p) => pt(p)).join(' ')}" fill="#0c0c10" fill-opacity=".7" stroke="#ff6b6b" stroke-opacity=".55" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  return out;
}

function robotSvg(season: SeasonDefinition, r: PlacedRobot): string {
  const f = fieldDims(season);
  const p = spotToField(f, r.alliance, r.spot);
  const cy = f.width - p.y;
  const deg = (-p.yaw * 180) / Math.PI;
  const col = COLOR[r.alliance];
  const stroke = r.invalid ? '#ff4d4d' : r.mine ? ACCENT : col;
  const fl = r.length;
  const fw = r.width;
  const intake = r.intakeFront === undefined ? '' : `<rect x="${r.intakeFront ? fl / 2 - 0.02 : -fl / 2 - 0.1}" y="${-fw * 0.4}" width="0.12" height="${fw * 0.8}" rx="0.04" fill="#ff7a1a"/>`;
  const knob = r.mine
    ? `<line x1="${fl / 2}" y1="0" x2="${fl / 2 + 0.5}" y2="0" stroke="${ACCENT}" stroke-width="2" vector-effect="non-scaling-stroke"/>
       <circle cx="${fl / 2 + 0.5}" cy="0" r="0.17" fill="${ACCENT}" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
       <circle class="place-knob" data-rot="1" cx="${fl / 2 + 0.5}" cy="0" r="0.42" fill="transparent"/>`
    : '';
  const fillOp = r.invalid ? 0.5 : r.mine ? 0.35 : 0.3;
  const label = `<text x="${p.x}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="0.42" fill="#fff" style="pointer-events:none">${r.label}</text>`;
  const tick = r.ready ? `<text x="${p.x}" y="${cy - Math.max(fl, fw) / 2 - 0.18}" text-anchor="middle" font-size="0.5" fill="#34d399" style="pointer-events:none">✓</text>` : '';
  return `<g class="${r.mine ? 'place-me' : ''}" ${r.mine ? 'data-robot="1"' : ''}><g transform="translate(${p.x} ${cy}) rotate(${deg})">
      <rect x="${-fl / 2}" y="${-fw / 2}" width="${fl}" height="${fw}" rx="0.06" fill="${r.invalid ? '#ff4d4d' : r.mine ? '#8b6cf6' : col}" fill-opacity="${fillOp}" stroke="${stroke}" stroke-width="2.5" vector-effect="non-scaling-stroke">${r.title ? `<title>${r.title}</title>` : ''}</rect>
      <polygon points="${fl / 2 + 0.3},0 ${fl / 2 + 0.04},-0.16 ${fl / 2 + 0.04},0.16" fill="${stroke}"/>${intake}${knob}
    </g>${label}${tick}</g>`;
}

export function placementMap(season: SeasonDefinition, robots: PlacedRobot[], opts: MapOptions): string {
  const L = season.fieldLength;
  const W = season.fieldWidth;
  const pad = 0.5;
  const f = fieldDims(season);
  let out = baseShapes(season);
  for (const a of opts.zones) out += areaShapes(season, a);
  for (const st of opts.stations ?? []) {
    const p = spotToField(f, st.alliance, st.spot);
    out += `<circle class="st-hit" data-station="${st.station}" cx="${p.x}" cy="${W - p.y}" r="0.5"/><circle class="st-dot" cx="${p.x}" cy="${W - p.y}" r="0.24" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
  }
  // Mine last so its knob stays on top and grabbable when robots overlap.
  for (const r of [...robots].sort((a, b) => Number(!!a.mine) - Number(!!b.mine))) out += robotSvg(season, r);
  return `<svg viewBox="${-pad} ${-pad} ${L + 2 * pad} ${W + 2 * pad}" preserveAspectRatio="xMidYMid meet">
    <rect x="0" y="0" width="${L}" height="${W}" fill="#0f0f15" stroke="#e7e7ee" stroke-opacity=".8" stroke-width="1.5" vector-effect="non-scaling-stroke"/>${out}</svg>`;
}

// ───────────────────────────── interaction ─────────────────────────────

let dragging = false;
/** True while a robot is being dragged: the menu skips lobby-driven re-renders so the gesture isn't interrupted. */
export const placementDragging = (): boolean => dragging;

export interface MineState {
  alliance: Alliance;
  spot: StartSpot;
  length: number;
  width: number;
  /** Teammates' footprints (blue frame) the robot must not overlap. */
  blockers: Poly[];
}

export interface PlacementCtrl {
  mine(): MineState | null;
  /** Called on every drag step with a legal spot (the caller redraws the map). */
  set(spot: StartSpot): void;
  /** Pointer released. */
  commit?(spot: StartSpot): void;
  /** A station ring was clicked (single player). */
  station?(n: number): void;
}

/** Nearest multiple of 45° when within 4° (or 15° steps while holding Shift). */
function snapYaw(yaw: number, shift: boolean): number {
  const deg = (yaw * 180) / Math.PI;
  const step = shift ? 15 : 45;
  const near = Math.round(deg / step) * step;
  return wrapAngle(((shift || Math.abs(deg - near) < 4 ? near : deg) * Math.PI) / 180);
}

/** Rotate in place (clamped / blocked like a drag). */
export function rotateSpot(season: SeasonDefinition, m: MineState, yaw: number): StartSpot {
  const area = season.startArea;
  const want = { ...m.spot, yaw: wrapAngle(yaw) };
  return area ? fitStartSpot(area, m.spot, want, m.length, m.width, m.blockers) : want;
}

export function bindPlacementMap(wrap: HTMLElement, season: SeasonDefinition, ctrl: PlacementCtrl): void {
  const f = fieldDims(season);
  const area = season.startArea;
  /** Pointer position in the blue frame of `alliance` (so every calculation is alliance-independent). */
  const toBlue = (e: PointerEvent, alliance: Alliance) => {
    const svg = wrap.querySelector('svg');
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(m.inverse());
    const p = mirrorPose(f, alliance, { x: q.x, y: f.width - q.y, yaw: 0 });
    return { x: p.x, y: p.y };
  };

  wrap.onpointerdown = (e) => {
    const t = e.target as Element;
    const st = t.closest<SVGElement>('[data-station]');
    if (st && ctrl.station) {
      ctrl.station(Number(st.dataset.station));
      return;
    }
    const m = ctrl.mine();
    if (!m || !area) return;
    const down = toBlue(e, m.alliance);
    if (!down) return;
    let mode: 'rot' | 'move' | null = null;
    let grab = { x: 0, y: 0 };
    if (t.closest('[data-rot]')) mode = 'rot';
    else if (pointIn(footprintPoly(m.spot, m.length, m.width), down.x, down.y)) {
      mode = 'move';
      grab = { x: m.spot.x - down.x, y: m.spot.y - down.y };
    } else if (down.x >= area.rect.x0 && down.x <= area.rect.x1 && down.y >= area.rect.y0 && down.y <= area.rect.y1) mode = 'move';
    if (!mode) return;
    e.preventDefault();
    wrap.setPointerCapture(e.pointerId);
    dragging = true;
    let cur = m.spot;
    const step = (ev: PointerEvent) => {
      const mm = ctrl.mine();
      const q = mm && toBlue(ev, mm.alliance);
      if (!mm || !q) return;
      const want = mode === 'rot' ? { ...cur, yaw: snapYaw(Math.atan2(q.y - cur.y, q.x - cur.x), ev.shiftKey) } : { x: q.x + grab.x, y: q.y + grab.y, yaw: cur.yaw };
      cur = fitStartSpot(area, cur, want, mm.length, mm.width, mm.blockers);
      ctrl.set(cur);
    };
    const end = () => {
      wrap.removeEventListener('pointermove', step);
      wrap.removeEventListener('pointerup', end);
      wrap.removeEventListener('pointercancel', end);
      dragging = false;
      ctrl.commit?.(cur);
    };
    wrap.addEventListener('pointermove', step);
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
    step(e);
  };
}

// ───────────────────────────── heading controls ─────────────────────────────

const deg = (yaw: number) => Math.round((((yaw * 180) / Math.PI) % 360 + 360) % 360);

/** Heading input + quick-turn buttons (0° faces the field, 90° turns toward your left). `extra` is appended (e.g. a reset button). */
export function headingControls(yaw: number, extra = ''): string {
  const d = deg(yaw);
  const snaps = [0, 90, 180, 270].map((a) => `<button class="opt ${d === a ? 'on' : ''}" data-heading="${a}"><span>${a}°</span></button>`).join('');
  return `<div class="place-ctl">
    <label class="num"><span>Heading °</span><input type="number" data-place="heading" min="0" max="359" step="5" value="${d}"/></label>
    <div class="seg">${snaps}</div>${extra}
  </div>`;
}

/** Wire the controls from `headingControls`; `apply` gets the requested yaw (rad). */
export function bindHeadingControls(root: HTMLElement, apply: (yaw: number) => void): void {
  const input = root.querySelector<HTMLInputElement>('[data-place="heading"]');
  if (input)
    input.onchange = () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) apply((v * Math.PI) / 180);
    };
  root.querySelectorAll<HTMLElement>('[data-heading]').forEach((b) => (b.onclick = () => apply((Number(b.dataset.heading) * Math.PI) / 180)));
}

/** Keep the heading widgets in step with a drag without rebuilding the page. */
export function syncHeadingControls(root: HTMLElement, yaw: number): void {
  const d = deg(yaw);
  const input = root.querySelector<HTMLInputElement>('[data-place="heading"]');
  if (input && document.activeElement !== input) input.value = String(d);
  root.querySelectorAll<HTMLElement>('[data-heading]').forEach((b) => b.classList.toggle('on', Number(b.dataset.heading) === d));
}
