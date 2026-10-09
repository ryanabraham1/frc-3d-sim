import { Alliance, ALLIANCES } from '@engine/coords';
import type { HudSlots, SeasonContext, SeasonHud } from '@engine/core/season';
import type { Hud } from '@engine/hud/hud';
import { RP_THRESHOLDS } from './scoring';
import type { RebuiltRules } from './rules';
import { loadedRobotHeight } from '@engine/robot/config';
import { TRENCH_SAFE_HEIGHT } from './constants';

const LIGHT_TEXT = { off: 'INACTIVE', active: 'ACTIVE', warning: 'ENDING', chase: 'ACTIVE · OFF NEXT', post: 'SCORING' } as const;

/** REBUILT HUD widgets: hub status per alliance, RP progress, shift info, hopper / climb / chute. */
export class RebuiltHud implements SeasonHud {
  private hud: Hud;
  constructor(
    private readonly ctx: SeasonContext,
    private readonly rules: RebuiltRules,
    private readonly slots: HudSlots,
  ) {
    this.hud = ctx.hud;
  }

  update(): void {
    const { rules, ctx } = this;
    const th = RP_THRESHOLDS.regional;
    for (const a of ALLIANCES) {
      const light = rules.light(a);
      const fuel = rules.fuelActive(a);
      const goal = fuel >= th.energized ? th.supercharged : th.energized;
      const rpName = fuel >= th.energized ? 'SUPERCHARGED' : 'ENERGIZED';
      const tower = rules.towerPoints(a);
      this.hud.setHtml(
        this.slots[a],
        `<div class="chip hub-${light}">HUB ${LIGHT_TEXT[light]}</div>` +
          `<div class="mini">FUEL ${fuel}/${goal} <span class="dim">${rpName}</span></div>` +
          `<div class="mini">TOWER ${tower}/${th.traversal} <span class="dim">TRAVERSAL</span></div>` +
          `<div class="mini dim">Chute ${rules.chuteCount(a)}${rules.chuteOpen[a] ? ' · OPEN' : ''}</div>`,
      );
    }

    // Center: what's happening with the shift order.
    const p = ctx.playerRobot;
    const clock = ctx.clock;
    let center = '';
    if (clock.started && !clock.finished && p) {
      const mine: Alliance = p.alliance;
      const active = rules.hubActive(mine);
      if (clock.current.id === 'auto') center = 'Both hubs active · most AUTO fuel → hub OFF in SHIFT 1';
      else if (rules.firstInactive === null) center = '';
      else if (active) {
        const left = rules.secondsActiveRemaining(mine);
        center = `<b class="ok">YOUR HUB ACTIVE</b>${Number.isFinite(left) && left < 200 ? ` · ${Math.ceil(left)}s left` : ''}`;
      } else {
        const until = rules.secondsUntilActive(mine);
        center = `<b class="bad">YOUR HUB INACTIVE</b>${Number.isFinite(until) ? ` · active in ${Math.ceil(until)}s` : ''}`;
      }
    }
    this.hud.setHtml(this.slots.center, center);

    if (p) {
      const cap = p.config.hopperCapacity;
      const pct = cap ? Math.round((p.held.length / cap) * 100) : 0;
      const zone = rules.inAllianceZone(p)
        ? '<span class="ok">IN ALLIANCE ZONE — Space to score</span>'
        : '<span class="dim">Outside zone — hold <b>G</b> to feed FUEL home (scoring from here = G407)</span>';
      const noShot = p.lastCommand.shoot && p.held.length > 0 && !p.lastShotClear ? '<div class="bad">No clean shot from here — move back / sideways</div>' : '';
      const feeding = p.lastCommand.pass && !p.lastCommand.shoot && p.held.length > 0 ? '<div class="ok">Feeding → alliance zone</div>' : '';
      // Net robots swell as they fill; past this count they no longer fit under the TRENCH.
      let trenchMark = '', trenchWarn = '';
      const swells = !!p.config.hopperExpansion && !p.manualHopper && cap > 0;
      if (swells) {
        let safe = 0;
        while (safe < cap && loadedRobotHeight(p.config, safe + 1) <= TRENCH_SAFE_HEIGHT) safe++;
        if (safe < cap) {
          trenchMark = `<i class="trench-mark" style="left:${(safe / cap) * 100}%" title="Over ${safe}: too tall for the TRENCH"></i>`;
          if (p.held.length > safe) trenchWarn = `<div class="bad">TOO TALL FOR TRENCH — hold ${safe} or fewer (${p.held.length - safe} over)</div>`;
        }
      } else if (p.manualHopper && p.hopperRaised) {
        trenchWarn = '<div class="bad">HOPPER RAISED — too tall for TRENCH (lower it)</div>';
      }
      let climb = '';
      if (p.climbPhase === 'hanging') climb = `<div class="ok">Hanging at LEVEL ${p.climbLevel} (X to descend)</div>`;
      else if (p.isClimbing) climb = `<div>Climbing… ${Math.round(p.climbProgress * 100)}%</div>`;
      else {
        const slot = rules.freeSlot(p);
        if (slot && slot.dist < 1.6) climb = '<div class="ok">At TOWER — hold C to climb</div>';
      }
      this.hud.setHtml(
        this.slots.player,
        `<div class="hopper"><div class="hopper-label">FUEL ${p.held.length}/${cap}</div><div class="bar${trenchWarn ? ' over' : ''}"><div style="width:${pct}%"></div>${trenchMark}</div></div>` +
          `${trenchWarn}<div>${zone}</div>${noShot}${feeding}${climb}`,
      );
    }
  }
}
