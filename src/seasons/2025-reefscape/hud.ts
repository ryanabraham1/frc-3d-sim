import { ALLIANCES } from '@engine/coords';
import type { HudSlots, SeasonContext, SeasonHud } from '@engine/core/season';
import * as C from './constants';
import type { ReefscapeRules } from './rules';

export class ReefscapeHud implements SeasonHud {
  constructor(private readonly ctx: SeasonContext, private readonly rules: ReefscapeRules, private readonly slots: HudSlots) {}
  update(): void {
    const { ctx, slots } = this;
    const coop = ALLIANCES.every((a) => ctx.score.counter(a, 'processor') >= 2);
    for (const a of ALLIANCES) {
      const label = (l: number) => `L${l} ${ctx.score.counter(a, `coralL${l}`)}/7`;
      const levels = `${label(1)} · ${label(2)}</div><div class="mini">${label(3)} · ${label(4)}`;
      ctx.hud.setHtml(slots[a], `<div class="mini">${levels}</div><div class="mini">PROCESSOR ${ctx.score.counter(a, 'processor')} · NET ${ctx.score.counter(a, 'net')}</div><div class="mini dim">COOP ${Math.min(2, ctx.score.counter(a, 'processor'))}/2 · ${coop ? 'BONUS ACTIVE' : 'both alliances need 2'}</div><div class="mini">BARGE ${ctx.score.category(a, 'barge')}/16</div>`);
    }
    ctx.hud.setHtml(slots.center, coop ? '<b class="ok">COOPERTITION · CORAL RP needs 7 on any 3 levels</b>' : 'REEFSCAPE · CORAL RP: 7 on each level · BARGE RP: 16 points');
    const r = ctx.playerRobot;
    if (!r) return;
    const held = ctx.pool.indices('held').filter((i) => ctx.pool.owner[i] === r.id);
    const coral = held.some((i) => i < C.CORAL_COUNT), algae = held.some((i) => i >= C.CORAL_COUNT);
    const m = this.rules.mechanisms.get(r.id);
    const target = this.rules.placementTarget(r, m?.level ?? 4);
    const point = target?.point;
    const near = point && Math.hypot(point.x - r.pose.x, point.y - r.pose.y) <= this.rules.coralReach(r);
    const reef = coral ? !r.config.placement!.enabled ? 'CORAL scorer disabled · G ejects CORAL' : !target ? '<span class="bad">Branch blocked · remove ALGAE or choose another level / face</span>' : near ? '<span class="ok">Space: place CORAL · 1–4: reef level</span>' : 'Drive to your REEF · Space places within reach' : r.config.intake.primary ? 'CORAL: intake at stations or carpet · ALGAE: J at reef' : 'ALGAE: intake on carpet or J at reef';
    const climb = r.isClimbing ? `${r.climbPhase === 'hanging' ? 'Hanging' : 'Climbing'} · ${r.config.climber.maxLevel === 1 ? 'SHALLOW' : 'DEEP'} CAGE · X to descend` : r.config.climber.maxLevel ? 'C: climb your station’s cage · park in your BARGE ZONE for 2' : 'No cage climber · park in your BARGE ZONE for 2';
    const algaeHint = algae ? `<div class="ok">${r.config.launcher.enabled ? coral ? 'Place / eject CORAL before NET shot' : 'Space: shoot NET' : 'NET shooter disabled'} · ${r.config.processor!.enabled ? 'G: feed PROCESSOR nearby' : 'PROCESSOR feeder disabled'}</div>` : '';
    ctx.hud.setHtml(slots.player, `<div class="hopper-label">CORAL ${r.config.intake.primary ? `${coral ? 1 : 0}/1` : 'off'} · ALGAE ${r.config.intake.secondary ? `${algae ? 1 : 0}/1` : 'off'}</div><div>Elevator L${m?.level ?? 4} / L${r.config.placement!.maxLevel} · ${(m?.height ?? 0.45).toFixed(2)} m</div><div>${reef}</div>${algaeHint}<div class="dim">${climb}</div>`);
  }
}
