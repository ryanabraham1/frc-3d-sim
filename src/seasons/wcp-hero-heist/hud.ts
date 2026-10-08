import { ALLIANCES } from '@engine/coords';
import type { HudSlots, SeasonContext, SeasonHud } from '@engine/core/season';
import { heroClass, storage } from './config';
import { DISTRICTS } from './geometry';
import { levelOf } from './ownership';
import { HeroHeistRules, mailboxTier } from './rules';

const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const CLASS = { commander: 'COMMANDER', mystic: 'MYSTIC', gadgeteer: 'GADGETEER' } as const;

/**
 * Hero Heist HUD: per squad the live OWNERSHIP (partial/full districts and their points), RP progress (8 partial / 5
 * full districts ever, 60 TOWER points, AUTO exit), a 20-district ownership strip in the center, and for the driver:
 * class, typed inventory, bubble target, panel alignment feedback and TOWER status.
 */
export class HeroHud implements SeasonHud {
  constructor(private readonly ctx: SeasonContext, private readonly rules: HeroHeistRules, private readonly slots: HudSlots) {}

  update(): void {
    const { rules, ctx } = this;
    const own = rules.ownership;
    for (const a of ALLIANCES) {
      const team = ctx.robots.filter(r => r.alliance === a);
      const tower = team.reduce((s, r) => s + rules.robotTowerPoints(r), 0);
      ctx.hud.setHtml(this.slots[a],
        `<div class="mini">OWNED ${own.count(a, 'partial')} partial · ${own.count(a, 'full')} full · <b>${own.points(a)}</b></div>`
        + `<div class="mini dim">DISTRICT RP ${own.partialHistory[a].size}/8 partial or ${own.fullHistory[a].size}/5 full</div>`
        + (rules.chuteOpen[a] ? '<div class="mini ok">BUBBLE CHUTE OPEN (H)</div>' : '')
        + `<div class="mini dim">${ctx.clock.current.id === 'auto' || !ctx.clock.started ? `AUTO EXIT ${team.filter(r => rules.exited.has(r.id)).length}/${team.length}` : `TOWER ${tower}/60`}</div>`);
    }
    // 20 districts as small squares: squad color, filled by OWNERSHIP strength, outlined when FULLY owned.
    const p0 = ctx.playerRobot, aimed = p0 && p0.config.launcher.enabled && (p0.held.length > 0 || rules.manualTarget(p0)) ? rules.targets.get(p0.id) : undefined;
    const cell = (id: number) => {
      const s = own.districts[id], lvl = levelOf(s);
      const ring = id === aimed ? 'box-shadow:0 0 0 2px #ffd21f,0 0 6px 2px rgba(255,210,31,.75);' : lvl === 'full' ? 'outline:1px solid #fff;' : '';
      const rgb = s.support === 'red' ? '232,61,79' : s.support === 'blue' ? '51,127,232' : '138,143,153';
      const alpha = s.support ? 0.25 + 0.75 * (s.strength / 4) : 0.25;
      return `<i title="${esc(DISTRICTS[id].label)} · ${lvl.toUpperCase()}" style="display:inline-block;width:9px;height:9px;margin:1px;border-radius:2px;background:rgba(${rgb},${alpha});${ring}"></i>`;
    };
    const row = (label: string, ids: number[]) => `<div class="mini" style="white-space:nowrap"><span class="dim" style="display:inline-block;width:22px">${label}</span>${ids.map(cell).join('')}</div>`;
    ctx.hud.setHtml(this.slots.center, row('UP', [0, 1, 2, 3, 4, 5]) + row('DN', [6, 7, 8, 9, 10, 11]) + row('W·E', [12, 13, 14, 15, 16, 17, 18, 19]));

    const p = ctx.playerRobot;
    if (!p) return;
    const cap = storage(p.config), hero = heroClass(p.config);
    const lines: string[] = [`<div><b>${CLASS[hero]}</b> · panels ${rules.panelCount(p)}/${cap.panels} · bubbles ${p.held.length}/${cap.bubbles}${p.config.options?.sharedTool ? ' <span class="dim">(one type at a time)</span>' : ''}</div>`];
    const target = p.held.length ? rules.targetFor(p) : null;
    if (target) {
      const manual = rules.manualTarget(p), reachable = rules.shotPossible(p, target);
      lines.push(`<div>Target: <b>${esc(target.label)}</b> <span class="dim">${manual ? '(manual · Z auto)' : '(auto · , . to pick)'}</span> ${!reachable ? '<span class="bad">out of range / wrong side</span>' : rules.fullyInLaunchZone(p) ? '<span class="ok">IN LAUNCH ZONE — Space</span>' : '<span class="bad">outside LAUNCH ZONE (G21)</span>'}</div>`);
    }
    else if (p.held.length) lines.push('<div class="dim">No CITY BLOCK in range from here</div>');
    if (rules.panelCount(p)) {
      const st = rules.place.get(p.id)!;
      const d = rules.placementTarget(p, 1.6);
      if (st.phase === 'extend') lines.push(`<div class="ok">Delivering to ${esc(DISTRICTS[st.district].label)}…</div>`);
      else if (!d) lines.push('<div class="dim">Drive to a MAILBOX, hold <b>G</b> to deliver the panel</div>');
      else if (mailboxTier(d.mailbox) > (p.config.placement?.maxLevel ?? 0)) lines.push(`<div class="bad">${esc(d.label)}: too high for this lift</div>`);
      else {
        const e = rules.mailboxError(p, d.mailbox), tol = HeroHeistRules.tolerance(d.mailbox);
        const lat = e.lateral / 0.0254, yaw = (e.yaw * 180) / Math.PI;
        const ok = Math.abs(e.lateral) <= tol.lateral && Math.abs(e.yaw) <= tol.yaw && e.gap <= rules.maxGap(p, d.mailbox);
        lines.push(`<div class="${ok ? 'ok' : ''}">${esc(d.label)} · ${ok ? 'LINED UP — G' : `${Math.abs(lat).toFixed(1)} in ${lat > 0 ? 'right' : 'left'} · ${Math.abs(yaw).toFixed(0)}° · gap ${(Math.max(0, e.gap) / 0.0254).toFixed(0)} in`}${p.config.options?.placeAlign === false ? '' : ' <span class="dim">(assist)</span>'}</div>`);
      }
    }
    if (p.climbPhase === 'hanging') lines.push(`<div class="ok">Hanging · ${['', 'LOW', 'MEDIUM', 'HIGH'][rules.towerLevel(p)]} (X to descend)</div>`);
    else if (p.isClimbing) lines.push(`<div>Climbing… ${Math.round(p.climbProgress * 100)}%</div>`);
    else if (p.config.climber.maxLevel > 0 && rules.padUnder(p) !== null && ctx.clock.mode === 'teleop' && ctx.clock.driveRemaining <= 30) lines.push('<div class="ok">Under a CLIMB PAD — hold C to climb</div>');
    if (rules.noEndgame.has(p.id)) lines.push('<div class="bad">No ENDGAME points (G18 / G20)</div>');
    ctx.hud.setHtml(this.slots.player, lines.join(''));
  }
}

