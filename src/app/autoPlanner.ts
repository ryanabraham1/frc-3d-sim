import { footprint } from '@engine/robot/config';
import type { GameSettings, SeasonDefinition } from '@engine/core/season';
import type { StartSpot } from '@engine/startPose';
import type { Alliance } from '@engine/coords';
import { cleanAutoPlan, planPoint, type AutoPlan, type AutoStep } from '@engine/ai/autoPlan';
import { placementMap, presetSpot } from './placement';
import * as Reef from '../seasons/2025-reefscape/constants';
import * as Notes from '../seasons/2024-crescendo/constants';
import './autoPlanner.css';

let drawing = false;
export const autoPlannerDragging = () => drawing;
const tools = new WeakMap<GameSettings, { action: string; level: string; duration: string }>();
export function loadAutoPlan(season: SeasonDefinition): AutoPlan | undefined {
  try { return cleanAutoPlan(JSON.parse(localStorage.getItem(`frc-auto-plan-${season.id}`) ?? 'null'), season); } catch { return undefined; }
}
const actions = (year: number): AutoStep['action'][] => year === 2025 ? ['reef', 'station', 'drive', 'wait'] : year === 2024 ? ['shoot', 'note', 'drive', 'wait'] : ['drive', 'intake', 'shoot', 'wait'];
const labels: Record<AutoStep['action'], string> = { drive: 'Drive here', intake: 'Intake here', shoot: 'Shoot here', reef: 'Place coral', station: 'Station intake', note: 'Pick up note', wait: 'Wait here' };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function stepLabel(s: AutoStep): string {
  if (s.action === 'reef') return `Branch ${String.fromCharCode(65 + s.target!)} · L${s.level}`;
  if (s.action === 'station') return `${s.target === 0 ? 'Lower' : 'Upper'} station · intake`;
  if (s.action === 'note') return `${s.target! < 3 ? `Wing ${s.target! + 1}` : `Center ${s.target! - 2}`} · pick up`;
  return `${labels[s.action]}${s.action === 'wait' ? ` · ${s.duration}s` : ''}`;
}
export function targetStep(_season: SeasonDefinition, action: AutoStep['action'], target: number, level = 4): AutoStep {
  let p = { x: 0, y: 0 };
  if (action === 'reef') p = Reef.branchPoint('blue', Math.floor(target / 2), target % 2, level);
  if (action === 'station') p = Reef.stations('blue')[target];
  if (action === 'note') p = target < 3 ? Notes.wingSpikes('blue')[target] : Notes.centerSpikes()[target - 3];
  return { action, ...p, duration: action === 'station' ? 3 : 2, target, ...(action === 'reef' ? { level } : {}) };
}
export interface PlannerOptions { startSpot?: StartSpot | null; alliance?: Alliance; station?: number; teammates?: { name: string; plan: AutoPlan; station: number }[]; disabled?: boolean; changed?: () => void }
export function autoPlanner(season: SeasonDefinition, s: GameSettings, opts: PlannerOptions = {}): string {
  const tool = tools.get(s);
  const alliance = opts.alliance ?? s.alliance;
  const plan = cleanAutoPlan(s.autoPlan, season) ?? { seasonId: season.id, steps: [] };
  const start = (opts.startSpot !== undefined ? opts.startSpot : s.startSpot) ?? presetSpot(season, alliance, opts.station ?? s.station);
  let svg = placementMap(season, [{ alliance, spot: start, length: footprint(s.robot).length, width: footprint(s.robot).width, label: 'Start', mine: true }], { zones: [] });
  const route = (p: AutoPlan, color: string, station?: number) => {
    const origin = station ? presetSpot(season, alliance, station) : start;
    const points = [planPoint(season, alliance, origin), ...p.steps.map(step => planPoint(season, alliance, step))];
    return `<polyline points="${points.map(q => `${q.x},${season.fieldWidth - q.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  };
  let overlay = (opts.teammates ?? []).map(t => route(t.plan, '#71b3a0', t.station)).join('') + route(plan, '#b19aff');
  const targets = season.year === 2025 ? [...Array.from({ length: 12 }, (_, i) => targetStep(season, 'reef', i)), ...[0, 1].map(i => targetStep(season, 'station', i))] : season.year === 2024 ? Array.from({ length: 8 }, (_, i) => targetStep(season, 'note', i)) : [];
  overlay += targets.map(t => {
    // Separate branch hit targets radially from the reef for legible labels.
    let p = { x: t.x, y: t.y };
    if (t.action === 'reef') { const c = Reef.reefCenter('blue'); p = { x: c.x + (t.x - c.x) * 1.65, y: c.y + (t.y - c.y) * 1.65 }; }
    const q = planPoint(season, alliance, p);
    const label = t.action === 'reef' ? String.fromCharCode(65 + t.target!) : t.action === 'station' ? `S${t.target! + 1}` : t.target! < 3 ? `W${t.target! + 1}` : `C${t.target! - 2}`;
    return `<g data-auto-target="${t.target}" data-auto-kind="${t.action}" role="button" tabindex="0" aria-label="${esc(stepLabel(t))}"><circle cx="${q.x}" cy="${season.fieldWidth - q.y}" r=".24" fill="#263747" stroke="#a6cbe7" stroke-width="1.5" vector-effect="non-scaling-stroke"/><text x="${q.x}" y="${season.fieldWidth - q.y + .07}" text-anchor="middle" font-size=".19" fill="white">${label}</text></g>`;
  }).join('');
  overlay += plan.steps.map((t, i) => { const p = planPoint(season, alliance, t); return `<g pointer-events="none"><circle cx="${p.x}" cy="${season.fieldWidth - p.y}" r=".17" fill="#b19aff"/><text x="${p.x}" y="${season.fieldWidth - p.y + .06}" text-anchor="middle" font-size=".17" fill="#17131f">${i + 1}</text></g>`; }).join('');
  svg = svg.replace('</svg>', `${overlay}</svg>`);
  const seconds = season.timeline.filter(p => p.mode === 'auto').reduce((sum, p) => sum + p.duration, 0);
  return `<section class="panel auto-planner" ${opts.disabled ? 'data-auto-disabled' : ''}>
    <div class="panel-head"><span>Plan your auto</span><span class="dim">${seconds}s AUTO</span></div>
    <div class="auto-pad"><div class="seg"><button class="opt ${s.autoRoutine === 'custom' && !s.manualAuto ? 'on' : ''}" data-auto-use>Run this plan</button><button class="opt" data-auto-undo ${plan.steps.length ? '' : 'disabled'}>Undo last</button><button class="opt" data-auto-clear ${plan.steps.length ? '' : 'disabled'}>Clear</button></div>
    <p class="hint">${season.year === 2025 ? 'Click a reef branch or coral station in order. Choose the level before adding a branch.' : season.year === 2024 ? 'Click a note to collect it. Choose Shoot here, then click a shooting spot in your wing.' : 'Click to add waypoints, or drag on the field to draw a route. Add intake and shooting stops along the way.'} Drag routes use Drive here.</p>
    <div class="auto-tools"><label>Action <select class="pick" data-auto-action>${actions(season.year).map(a => `<option value="${a}" ${tool?.action === a ? 'selected' : ''}>${labels[a]}</option>`).join('')}</select></label>${season.year === 2025 ? `<label>Level <select class="pick" data-auto-level>${[4, 3, 2, 1].map(l => `<option ${tool?.level === String(l) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}<label>Stop time <input data-auto-duration type="number" min="0.1" max="10" step="0.1" value="${tool?.duration ?? '2'}" aria-label="Action timeout in seconds"/> s</label></div>
    ${targets.length ? `<div class="auto-tools"><label>Target <select class="pick" data-auto-target-pick>${targets.map(t => `<option value="${t.action}:${t.target}">${esc(stepLabel(t).replace(' · L4', ''))}</option>`).join('')}</select></label><button class="opt" data-auto-add-target>Add target</button></div>` : ''}
    <div class="auto-map">${svg}</div>
    <p class="hint">${s.autoRoutine === 'custom' && !s.manualAuto ? 'This plan will run during AUTO.' : 'Choose Run this plan to use these actions during AUTO.'} Stops finish early when the shot or intake completes. Routes may take longer than AUTO; test in Solo practice.</p>
    <ol class="auto-steps">${plan.steps.map((t, i) => `<li><b>${esc(stepLabel(t))}</b><span class="dim">${t.duration}s max stop</span><button class="opt" data-auto-up="${i}" aria-label="Move action ${i + 1} up" ${i ? '' : 'disabled'}>↑</button><button class="opt" data-auto-down="${i}" aria-label="Move action ${i + 1} down" ${i === plan.steps.length - 1 ? 'disabled' : ''}>↓</button><button class="opt" data-auto-remove="${i}" aria-label="Remove action ${i + 1}">×</button></li>`).join('')}</ol>
    ${plan.steps.length ? '' : '<div class="hint">Add your first target on the map. Your robot starts at the position chosen above.</div>'}
    ${(opts.teammates ?? []).map(t => `<div class="hint">${esc(t.name)}: ${t.plan.steps.map(stepLabel).map(esc).join(' → ') || 'No actions yet'}</div>`).join('')}
    ${opts.disabled ? '<p class="hint">Unlock your position and auto to edit.</p>' : ''}</div></section>`;
}
export function bindAutoPlanner(el: HTMLElement, season: SeasonDefinition, s: GameSettings, render: () => void, opts: PlannerOptions = {}): void {
  const root = el.querySelector<HTMLElement>('.auto-planner');
  if (!root || opts.disabled) return;
  const plan = () => s.autoPlan = cleanAutoPlan(s.autoPlan, season) ?? { seasonId: season.id, steps: [] };
  const changed = () => { tools.set(s, { action: root.querySelector<HTMLSelectElement>('[data-auto-action]')!.value, level: root.querySelector<HTMLSelectElement>('[data-auto-level]')?.value ?? '4', duration: root.querySelector<HTMLInputElement>('[data-auto-duration]')!.value }); try { localStorage.setItem(`frc-auto-plan-${season.id}`, JSON.stringify(plan())); } catch { /* storage unavailable */ } opts.changed?.(); render(); };
  const add = (step: AutoStep) => { if (plan().steps.length >= 80) return; plan().steps.push(step); s.autoRoutine = 'custom'; s.manualAuto = false; changed(); };
  root.querySelector<HTMLElement>('[data-auto-use]')!.onclick = () => { plan(); s.autoRoutine = 'custom'; s.manualAuto = false; changed(); };
  root.querySelector<HTMLElement>('[data-auto-undo]')!.onclick = () => { plan().steps.pop(); changed(); };
  root.querySelector<HTMLElement>('[data-auto-clear]')!.onclick = () => { plan().steps = []; changed(); };
  for (const kind of ['up', 'down', 'remove']) root.querySelectorAll<HTMLElement>(`[data-auto-${kind}]`).forEach(b => b.onclick = () => {
    const i = Number(b.getAttribute(`data-auto-${kind}`)), steps = plan().steps;
    if (kind === 'remove') steps.splice(i, 1);
    else { const j = i + (kind === 'up' ? -1 : 1); if (j >= 0 && j < steps.length) [steps[i], steps[j]] = [steps[j], steps[i]]; }
    changed();
  });
  root.querySelector<HTMLElement>('[data-auto-add-target]')?.addEventListener('click', () => { const [action, index] = root.querySelector<HTMLSelectElement>('[data-auto-target-pick]')!.value.split(':'); const step = targetStep(season, action as AutoStep['action'], Number(index), Number(root.querySelector<HTMLSelectElement>('[data-auto-level]')?.value ?? 4)); step.duration = duration(); add(step); });
  const svg = root.querySelector<SVGSVGElement>('svg')!;
  const action = () => root.querySelector<HTMLSelectElement>('[data-auto-action]')!.value as AutoStep['action'];
  const duration = () => Math.max(.1, Math.min(10, Number(root.querySelector<HTMLInputElement>('[data-auto-duration]')!.value) || 2));
  const target = (g: Element) => { const t = targetStep(season, g.getAttribute('data-auto-kind') as AutoStep['action'], Number(g.getAttribute('data-auto-target')), Number(root.querySelector<HTMLSelectElement>('[data-auto-level]')?.value ?? 4)); t.duration = duration(); add(t); };
  root.querySelectorAll<SVGElement>('[data-auto-target]').forEach(g => g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); target(g); } });
  const point = (e: PointerEvent) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const m = svg.getScreenCTM(); if (!m) return null; const q = p.matrixTransform(m.inverse()); const field = { x: q.x, y: season.fieldWidth - q.y }; return planPoint(season, opts.alliance ?? s.alliance, field); };
  let drawn: { x: number; y: number }[] = [];
  let down = false;
  svg.onpointerdown = e => { if (e.button !== 0) return; const g = (e.target as Element).closest('[data-auto-target]'); if (g) { target(g); return; } const p = point(e); if (!p) return; down = drawing = true; drawn = [p]; svg.setPointerCapture(e.pointerId); };
  svg.onpointermove = e => { if (!down || season.year !== 2026) return; const p = point(e), last = drawn.at(-1)!; if (p && Math.hypot(p.x - last.x, p.y - last.y) > .4) { drawn.push(p); let line = svg.querySelector('polyline.auto-draft'); if (!line) { line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); line.setAttribute('class', 'auto-draft'); svg.append(line); } line.setAttribute('points', drawn.map(q => { const f = planPoint(season, opts.alliance ?? s.alliance, q); return `${f.x},${season.fieldWidth - f.y}`; }).join(' ')); } };
  svg.onpointercancel = () => { down = drawing = false; drawn = []; svg.querySelector('.auto-draft')?.remove(); };
  svg.onpointerup = () => {
    if (!down) return; down = drawing = false;
    const valid = drawn.filter(p => p.x >= 0 && p.y >= 0 && p.x <= season.fieldLength && p.y <= season.fieldWidth && (season.year !== 2026 || p.x < season.fieldLength / 2 - Math.max(footprint(s.robot).length, footprint(s.robot).width) / 2 - .15));
    if (!valid.length) return;
    if (drawn.length > 1) { for (const p of valid.slice(0, 80 - plan().steps.length)) plan().steps.push({ action: 'drive', ...p, duration: 2 }); s.autoRoutine = 'custom'; s.manualAuto = false; changed(); }
    else if (!['reef', 'station', 'note'].includes(action())) add({ action: action(), ...valid[0], duration: duration() });
  };
}
