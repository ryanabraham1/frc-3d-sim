import { footprint } from '@engine/robot/config';
import type { GameSettings, SeasonDefinition } from '@engine/core/season';
import type { StartSpot } from '@engine/startPose';
import type { Alliance } from '@engine/coords';
import { cleanAutoPlan, planPoint, simplifyPath, type AutoPlan, type AutoStep } from '@engine/ai/autoPlan';
import { placementMap, presetSpot } from './placement';
import * as Reef from '../seasons/2025-reefscape/constants';
import * as Notes from '../seasons/2024-crescendo/constants';
import './autoPlanner.css';

let drawing = false;
export const autoPlannerDragging = () => drawing;
interface ToolState { action: AutoStep['action']; level: number; duration: number; selected: number }
const tools = new WeakMap<GameSettings, ToolState>();
const toolFor = (s: GameSettings): ToolState => {
  let t = tools.get(s);
  if (!t) { t = { action: 'drive', level: 4, duration: 3, selected: -1 }; tools.set(s, t); }
  return t;
};
export function loadAutoPlan(season: SeasonDefinition): AutoPlan | undefined {
  try { return cleanAutoPlan(JSON.parse(localStorage.getItem(`frc-auto-plan-${season.id}`) ?? 'null'), season); } catch { return undefined; }
}
const labels: Record<AutoStep['action'], string> = { drive: 'Drive path', intake: 'Collect here', shoot: 'Shoot here', reef: 'Place coral', station: 'Station intake', note: 'Pick up note', wait: 'Wait here' };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const deg = (r: number) => Math.round(((r * 180 / Math.PI) % 360 + 360) % 360);
export function stepLabel(s: AutoStep): string {
  if (s.action === 'reef') return `Branch ${String.fromCharCode(65 + s.target!)} · L${s.level}`;
  if (s.action === 'station') return `${s.target === 0 ? 'Lower' : 'Upper'} station · intake`;
  if (s.action === 'note') return `${s.target! < 3 ? `Wing ${s.target! + 1}` : `Center ${s.target! - 2}`} · pick up`;
  if (s.action === 'intake' && s.duration === 0) return 'Collect while driving';
  return `${labels[s.action]}${s.action === 'wait' ? ` · ${s.duration}s` : ''}`;
}
export function targetStep(_season: SeasonDefinition, action: AutoStep['action'], target: number, level = 4): AutoStep {
  let p = { x: 0, y: 0 };
  if (action === 'reef') p = Reef.branchPoint('blue', Math.floor(target / 2), target % 2, level);
  if (action === 'station') p = Reef.stations('blue')[target];
  if (action === 'note') p = target < 3 ? Notes.wingSpikes('blue')[target] : Notes.centerSpikes()[target - 3];
  return { action, x: p.x, y: p.y, duration: action === 'station' ? 3 : 2, target, ...(action === 'reef' ? { level } : {}) };
}
export interface PlannerOptions {
  startSpot?: StartSpot | null;
  alliance?: Alliance;
  station?: number;
  teammates?: { name: string; plan: AutoPlan; station: number }[];
  disabled?: boolean;
  changed?: () => void;
  setStartYaw?: (yaw: number) => void;
}
function startFor(season: SeasonDefinition, s: GameSettings, opts: PlannerOptions): StartSpot {
  return (opts.startSpot !== undefined ? opts.startSpot : s.startSpot) ?? presetSpot(season, opts.alliance ?? s.alliance, opts.station ?? s.station);
}
export function autoPlanner(season: SeasonDefinition, s: GameSettings, opts: PlannerOptions = {}): string {
  const tool = toolFor(s), alliance = opts.alliance ?? s.alliance;
  const plan = cleanAutoPlan(s.autoPlan, season) ?? { seasonId: season.id, steps: [] };
  const start = startFor(season, s, opts), fp = footprint(s.robot);
  const disabled = opts.disabled ? 'disabled' : '';
  let svg = placementMap(season, [{ alliance, spot: start, length: fp.length, width: fp.width, label: 'Start', mine: true }], { zones: [] });
  const route = (p: AutoPlan, color: string, station?: number) => {
    const origin = station ? presetSpot(season, alliance, station) : start;
    const points = [planPoint(season, alliance, origin), ...p.steps.flatMap(step => [...(step.path ?? []), step].map(q => planPoint(season, alliance, q)))];
    return `<polyline points="${points.map(q => `${q.x},${season.fieldWidth - q.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  };
  let overlay = (opts.teammates ?? []).map(t => route(t.plan, '#71b3a0', t.station)).join('') + route(plan, '#b19aff');
  const targets = season.year === 2025 ? [...Array.from({ length: 12 }, (_, i) => targetStep(season, 'reef', i, tool.level)), ...[0, 1].map(i => targetStep(season, 'station', i))] : season.year === 2024 ? Array.from({ length: 8 }, (_, i) => targetStep(season, 'note', i)) : [];
  overlay += targets.map(t => {
    let p = { x: t.x, y: t.y };
    if (t.action === 'reef') { const c = Reef.reefCenter('blue'); p = { x: c.x + (t.x - c.x) * 1.65, y: c.y + (t.y - c.y) * 1.65 }; }
    const q = planPoint(season, alliance, p);
    const label = t.action === 'reef' ? String.fromCharCode(65 + t.target!) : t.action === 'station' ? `S${t.target! + 1}` : t.target! < 3 ? `W${t.target! + 1}` : `C${t.target! - 2}`;
    return `<g data-auto-target="${t.target}" data-auto-kind="${t.action}" role="button" tabindex="${opts.disabled ? -1 : 0}" aria-label="${esc(stepLabel(t))}"><circle cx="${q.x}" cy="${season.fieldWidth - q.y}" r=".24" fill="#263747" stroke="#a6cbe7" stroke-width="1.5" vector-effect="non-scaling-stroke"/><text x="${q.x}" y="${season.fieldWidth - q.y + .07}" text-anchor="middle" font-size=".19" fill="white">${label}</text></g>`;
  }).join('');
  overlay += plan.steps.map((t, i) => {
    const p = planPoint(season, alliance, t), shoot = t.action === 'shoot', color = shoot ? '#f1c879' : '#b19aff';
    const angle = p.yaw;
    const arrow = t.yaw === undefined ? '' : `<line x1="${p.x}" y1="${season.fieldWidth - p.y}" x2="${p.x + Math.cos(angle) * .6}" y2="${season.fieldWidth - p.y - Math.sin(angle) * .6}" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke"/><circle cx="${p.x + Math.cos(angle) * .6}" cy="${season.fieldWidth - p.y - Math.sin(angle) * .6}" r=".08" fill="${color}"/>`;
    return `<g data-auto-step="${i}" role="button" tabindex="${opts.disabled ? -1 : 0}" aria-label="Edit action ${i + 1}: ${esc(stepLabel(t))}">${arrow}<circle cx="${p.x}" cy="${season.fieldWidth - p.y}" r="${shoot ? .28 : .2}" fill="${color}" stroke="${tool.selected === i ? '#fff' : color}" stroke-width="2" vector-effect="non-scaling-stroke"/><text x="${p.x}" y="${season.fieldWidth - p.y + .07}" text-anchor="middle" font-size=".2" fill="#17131f">${i + 1}</text>${shoot ? `<rect x="${p.x - .58}" y="${season.fieldWidth - p.y - .67}" width="1.16" height=".3" rx=".08" fill="#f1c879"/><text x="${p.x}" y="${season.fieldWidth - p.y - .45}" text-anchor="middle" font-size=".21" fill="#17131f">SHOOT</text>` : ''}</g>`;
  }).join('');
  svg = svg.replace('</svg>', `${overlay}</svg>`);
  const seconds = season.timeline.filter(p => p.mode === 'auto').reduce((sum, p) => sum + p.duration, 0);
  const selected = plan.steps[tool.selected];
  const headings = (yaw: number, attr: string) => `<input type="number" min="0" max="359" step="5" value="${deg(yaw)}" ${attr} ${disabled}/><span>°</span>`;
  const modeHint = tool.action === 'shoot' ? `Click where your robot should STOP and shoot, ${season.year === 2024 ? 'inside your wing' : 'inside your alliance zone'}. A gold SHOOT marker shows the spot.` : tool.action === 'wait' ? 'Click the field to add a wait.' : season.year === 2025 ? 'Click a branch or station. You can also draw a drive path between them.' : 'Drag to draw a path. Each drag adds ONE path to your auto. The intake runs automatically as you drive.';
  return `<section class="panel auto-planner" ${opts.disabled ? 'data-auto-disabled' : ''}>
    <div class="panel-head"><span>Plan your auto</span><span class="dim">${seconds}s AUTO · intake automatic</span></div>
    <div class="auto-pad"><div class="seg"><button class="opt ${s.autoRoutine === 'custom' && !s.manualAuto ? 'on' : ''}" data-auto-use ${disabled}>Run this plan</button><button class="opt" data-auto-undo ${!plan.steps.length || opts.disabled ? 'disabled' : ''}>Undo last</button><button class="opt" data-auto-clear ${!plan.steps.length || opts.disabled ? 'disabled' : ''}>Clear</button></div>
    <div class="auto-modes"><button class="opt ${tool.action === 'drive' ? 'on' : ''}" data-auto-mode="drive" ${disabled}>Draw path</button>${season.year !== 2025 ? `<button class="opt auto-shoot-button ${tool.action === 'shoot' ? 'on' : ''}" data-auto-mode="shoot" ${disabled}>Place shooting spot</button><button class="opt auto-shoot-button" data-auto-shoot-end ${disabled}>Shoot ${plan.steps.length ? 'at path end' : 'at start'}</button>` : ''}</div>
    <p class="auto-instruction" role="status">${modeHint}</p>
    <div class="auto-tools"><label>Start direction ${headings(start.yaw, 'data-auto-start-yaw aria-label="Starting robot direction in degrees"')}</label><span class="hint">0° → &nbsp; 90° ↑ &nbsp; 180° ← &nbsp; 270° ↓${alliance === 'red' ? ' · directions shown before alliance mirroring' : ''}</span>${season.year === 2025 ? `<label>Level <select class="pick" data-auto-level ${disabled}>${[4, 3, 2, 1].map(l => `<option ${tool.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}</div>
    ${targets.length ? `<div class="auto-tools"><label>Target <select class="pick" data-auto-target-pick ${disabled}>${targets.map(t => `<option value="${t.action}:${t.target}">${esc(stepLabel(t))}</option>`).join('')}</select></label><button class="opt" data-auto-add-target ${disabled}>Add target</button></div>` : ''}
    <div class="auto-map ${tool.action === 'shoot' ? 'placing-shot' : ''}">${svg}</div>
    <div class="auto-legend"><span><i class="auto-line"></i>Drive path · intake on</span>${season.year !== 2025 ? '<span><i class="auto-shot-dot"></i>Stop &amp; shoot</span>' : ''}</div>
    <ol class="auto-steps">${plan.steps.map((t, i) => `<li class="${tool.selected === i ? 'selected' : ''} ${t.action === 'shoot' ? 'shoot-step' : ''}"><button class="auto-step-label" data-auto-edit="${i}" ${disabled}>${esc(stepLabel(t))}</button><span class="dim">${t.yaw === undefined ? 'Direction: automatic' : `Direction: ${deg(t.yaw)}°`}</span><button class="opt" data-auto-up="${i}" aria-label="Move action ${i + 1} up" ${!i || opts.disabled ? 'disabled' : ''}>↑</button><button class="opt" data-auto-down="${i}" aria-label="Move action ${i + 1} down" ${i === plan.steps.length - 1 || opts.disabled ? 'disabled' : ''}>↓</button><button class="opt" data-auto-remove="${i}" aria-label="Remove action ${i + 1}" ${disabled}>×</button></li>`).join('')}</ol>
    ${selected ? `<div class="auto-step-editor"><b>Action ${tool.selected + 1}: ${esc(stepLabel(selected))}</b>${!['reef', 'station', 'note'].includes(selected.action) ? `<div class="auto-tools"><label>Robot direction <select class="pick" data-auto-facing ${disabled}><option value="auto" ${selected.yaw === undefined ? 'selected' : ''}>Automatic${selected.action === 'shoot' ? ' · face goal' : ' · intake faces path'}</option><option value="custom" ${selected.yaw !== undefined ? 'selected' : ''}>Choose angle</option></select></label>${selected.yaw !== undefined ? `<label>Angle ${headings(selected.yaw, 'data-auto-yaw aria-label="Action robot direction in degrees"')}</label>` : ''}</div>` : '<p class="hint">The robot automatically faces this target.</p>'}${selected.action !== 'drive' ? `<label class="auto-stop-time">${selected.action === 'shoot' ? 'Shoot for up to' : selected.action === 'intake' ? 'Stop time (0 = keep moving)' : 'Wait up to'} <input data-auto-stop-time type="number" min="0" max="10" step="0.5" value="${selected.duration}" ${disabled}/> seconds</label>` : ''}</div>` : ''}
    ${!plan.steps.length ? '<p class="hint">Start by drawing a path, or choose Shoot at start to score your preload.</p>' : ''}
    <details class="auto-options"><summary>More options</summary><button class="opt" data-auto-mode="wait" ${disabled}>Add wait</button><label>Default stop time <input data-auto-duration type="number" min="0" max="10" step="0.5" value="${tool.duration}" ${disabled}/> seconds</label></details>
    <p class="hint">${s.autoRoutine === 'custom' && !s.manualAuto ? 'This auto is selected.' : 'Choose Run this plan to use it.'} Collecting never needs a stop. Click an action to change its direction. Test in Solo practice; the match stops your auto when time runs out.</p>
    ${(opts.teammates ?? []).map(t => `<div class="hint">${esc(t.name)}: ${t.plan.steps.map(stepLabel).map(esc).join(' → ') || 'No actions yet'}</div>`).join('')}
    ${opts.disabled ? '<p class="hint">Unlock your position and auto to edit.</p>' : ''}</div></section>`;
}

export function bindAutoPlanner(el: HTMLElement, season: SeasonDefinition, s: GameSettings, render: () => void, opts: PlannerOptions = {}): void {
  const root = el.querySelector<HTMLElement>('.auto-planner');
  if (!root || opts.disabled) return;
  const tool = toolFor(s);
  const plan = () => s.autoPlan = cleanAutoPlan(s.autoPlan, season) ?? { seasonId: season.id, steps: [] };
  const changed = () => {
    try { localStorage.setItem(`frc-auto-plan-${season.id}`, JSON.stringify(plan())); } catch { /* storage unavailable */ }
    opts.changed?.(); render();
  };
  const add = (step: AutoStep) => {
    if (plan().steps.length >= 80) return;
    plan().steps.push(step); tool.selected = plan().steps.length - 1;
    s.autoRoutine = 'custom'; s.manualAuto = false; changed();
  };
  root.querySelector<HTMLElement>('[data-auto-use]')!.onclick = () => { plan(); s.autoRoutine = 'custom'; s.manualAuto = false; changed(); };
  root.querySelector<HTMLElement>('[data-auto-undo]')!.onclick = () => { plan().steps.pop(); tool.selected = -1; changed(); };
  root.querySelector<HTMLElement>('[data-auto-clear]')!.onclick = () => { plan().steps = []; tool.selected = -1; changed(); };
  root.querySelectorAll<HTMLElement>('[data-auto-mode]').forEach(b => b.onclick = () => { tool.action = b.dataset.autoMode as AutoStep['action']; render(); });
  root.querySelector<HTMLInputElement>('[data-auto-start-yaw]')!.onchange = e => {
    const value = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(value)) opts.setStartYaw?.(value * Math.PI / 180);
  };
  const level = root.querySelector<HTMLSelectElement>('[data-auto-level]');
  if (level) level.onchange = () => { tool.level = Number(level.value); render(); };
  const stop = root.querySelector<HTMLInputElement>('[data-auto-duration]')!;
  stop.onchange = () => { tool.duration = Math.max(0, Math.min(10, Number(stop.value))); };
  const select = (i: number) => { tool.selected = i; render(); };
  root.querySelectorAll<HTMLElement>('[data-auto-edit]').forEach(b => b.onclick = () => select(Number(b.dataset.autoEdit)));
  const facing = root.querySelector<HTMLSelectElement>('[data-auto-facing]');
  if (facing) facing.onchange = () => { const step = plan().steps[tool.selected]; if (!step) return; if (facing.value === 'auto') delete step.yaw; else step.yaw ??= startFor(season, s, opts).yaw; changed(); };
  const yaw = root.querySelector<HTMLInputElement>('[data-auto-yaw]');
  if (yaw) yaw.onchange = () => { if (Number.isFinite(Number(yaw.value))) { plan().steps[tool.selected].yaw = Number(yaw.value) * Math.PI / 180; changed(); } };
  const time = root.querySelector<HTMLInputElement>('[data-auto-stop-time]');
  if (time) time.onchange = () => { plan().steps[tool.selected].duration = Math.max(0, Math.min(10, Number(time.value))); changed(); };
  for (const kind of ['up', 'down', 'remove']) root.querySelectorAll<HTMLElement>(`[data-auto-${kind}]`).forEach(b => b.onclick = () => {
    const i = Number(b.getAttribute(`data-auto-${kind}`)), steps = plan().steps;
    if (kind === 'remove') { steps.splice(i, 1); tool.selected = -1; }
    else { const j = i + (kind === 'up' ? -1 : 1); if (j >= 0 && j < steps.length) { [steps[i], steps[j]] = [steps[j], steps[i]]; tool.selected = j; } }
    changed();
  });
  root.querySelector<HTMLElement>('[data-auto-shoot-end]')?.addEventListener('click', () => {
    const end = plan().steps.at(-1) ?? startFor(season, s, opts);
    add({ action: 'shoot', x: end.x, y: end.y, duration: tool.duration });
  });
  root.querySelector<HTMLElement>('[data-auto-add-target]')?.addEventListener('click', () => {
    const [action, index] = root.querySelector<HTMLSelectElement>('[data-auto-target-pick]')!.value.split(':');
    const step = targetStep(season, action as AutoStep['action'], Number(index), tool.level);
    step.duration = tool.duration; add(step);
  });
  const svg = root.querySelector<SVGSVGElement>('svg')!;
  const target = (g: Element) => { const t = targetStep(season, g.getAttribute('data-auto-kind') as AutoStep['action'], Number(g.getAttribute('data-auto-target')), tool.level); t.duration = tool.duration; add(t); };
  root.querySelectorAll<SVGElement>('[data-auto-target]').forEach(g => g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); target(g); } });
  root.querySelectorAll<SVGElement>('[data-auto-step]').forEach(g => g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(Number(g.dataset.autoStep)); } });
  const point = (e: PointerEvent) => {
    const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const m = svg.getScreenCTM(); if (!m) return null;
    const q = p.matrixTransform(m.inverse());
    return planPoint(season, opts.alliance ?? s.alliance, { x: q.x, y: season.fieldWidth - q.y });
  };
  const valid = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x <= season.fieldLength && p.y <= season.fieldWidth && (season.year !== 2026 || p.x < season.fieldLength / 2 - Math.max(footprint(s.robot).length, footprint(s.robot).width) / 2 - .15);
  let drawn: { x: number; y: number }[] = [];
  let down = false;
  let pendingMarker = -1;
  svg.onpointerdown = e => {
    if (e.button !== 0) return;
    const marker = (e.target as Element).closest('[data-auto-step]');
    pendingMarker = marker && tool.action === 'drive' ? Number(marker.getAttribute('data-auto-step')) : -1;
    const g = (e.target as Element).closest('[data-auto-target]');
    if (g && tool.action !== 'shoot') { target(g); return; }
    const p = point(e); if (!p || !valid(p)) return;
    down = drawing = true; drawn = [p]; svg.setPointerCapture(e.pointerId);
  };
  svg.onpointermove = e => {
    if (!down || tool.action !== 'drive') return;
    const p = point(e), last = drawn.at(-1)!;
    if (!p || !valid(p) || drawn.length >= 80 || Math.hypot(p.x - last.x, p.y - last.y) < .12) return;
    drawn.push(p);
    let line = svg.querySelector('polyline.auto-draft');
    if (!line) { line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); line.setAttribute('class', 'auto-draft'); svg.append(line); }
    line.setAttribute('points', drawn.map(q => { const f = planPoint(season, opts.alliance ?? s.alliance, q); return `${f.x},${season.fieldWidth - f.y}`; }).join(' '));
  };
  const cancel = () => { down = drawing = false; drawn = []; svg.querySelector('.auto-draft')?.remove(); };
  svg.onpointercancel = cancel;
  svg.onpointerup = e => {
    if (!down) return;
    down = drawing = false;
    const end = point(e);
    if (end && valid(end) && tool.action === 'drive' && drawn.length > 1) drawn.push(end);
    svg.querySelector('.auto-draft')?.remove();
    if (!drawn.length) return;
    if (pendingMarker >= 0 && drawn.length === 1) { select(pendingMarker); return; }
    const simplified = simplifyPath(drawn), last = simplified.at(-1)!;
    if (tool.action === 'drive') add({ action: 'drive', x: last.x, y: last.y, duration: 2, path: simplified.slice(0, -1) });
    else add({ action: tool.action, x: drawn[0].x, y: drawn[0].y, duration: tool.duration });
  };
}
