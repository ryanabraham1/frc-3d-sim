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
    const app = target?.approach.pos;
    const reefC = C.reefCenter(r.alliance);
    const near = !!app && Math.hypot(reefC.x - r.pose.x, reefC.y - r.pose.y) < C.REEF_APOTHEM + 2.2;
    const face = C.nearestFace(r.alliance, r.pose);
    const knock = !r.config.intake.secondary || algae ? ' · J: knock staged ALGAE off' : ' · J: remove ALGAE';
    const blocked = this.rules.reefAlgae(r.alliance, face) && (m?.level ?? 4) === (face % 2 === 0 ? 3 : 2);
    const lateral = app ? (-(app.x - r.pose.x) * Math.sin(r.pose.yaw) + (app.y - r.pose.y) * Math.cos(r.pose.yaw)) / 0.0254 : 0;
    const align = r.config.autoAlign ? 'hold Space: auto-align + place' : `Space: release · line up the BRANCH (${lateral >= 0 ? 'left' : 'right'} ${Math.abs(lateral).toFixed(1)} in)`;
    const intakeHint = !r.config.intake.primary ? 'ALGAE: intake on carpet or J at reef'
      : r.config.intake.ground && r.config.intake.station ? 'CORAL: back the orange INTAKE over it, or back up to a CORAL STATION (H drops one)'
      : r.config.intake.ground ? 'CORAL: back the orange INTAKE over it (no funnel — H drops one onto the floor)' : 'CORAL: back your funnel up to a CORAL STATION (H drops one)';
    const reef = coral ? !r.config.placement!.enabled ? 'No CORAL scorer · G ejects CORAL' : blocked ? `<span class="bad">L${m?.level} blocked by ALGAE${knock}</span>` : near ? `<span class="ok">L${m?.level ?? 4} · ${align}</span>` : 'Drive to your REEF · 1–4 selects the level' : intakeHint;
    const depth = this.rules.climberDepth(r)?.toUpperCase();
    const slot = r.climbSlot ?? -1;
    const climb = r.isClimbing ? `${r.climbPhase === 'hanging' ? 'Hanging' : 'Climbing'} · ${(this.rules.refs.cageDepth[r.alliance][slot] ?? depth ?? 'DEEP').toUpperCase()} CAGE · X to descend` : depth ? `C: climb any of your ${depth} cages (${this.rules.refs.cageDepth[r.alliance].filter((d) => d.toUpperCase() === depth).length}) · park in your BARGE ZONE for 2` : 'No cage climber · park in your BARGE ZONE for 2';
    const algaeHint = algae ? `<div class="ok">${r.config.options?.net ? `G: ALGAE → NET at the BARGE${coral ? '' : ' (or Space)'}` : 'NET shooter disabled'} · ${r.config.processor!.enabled ? 'G: feed PROCESSOR nearby' : 'PROCESSOR feeder disabled'}</div>` : '';
    ctx.hud.setHtml(slots.player, `<div class="hopper-label">CORAL ${r.config.intake.primary ? `${coral ? 1 : 0}/1` : 'off'} · ALGAE ${r.config.intake.secondary ? `${algae ? 1 : 0}/1` : 'off'}</div><div>Elevator L${m?.level ?? 4} / L${r.config.placement!.maxLevel} · ${(m?.height ?? 0.45).toFixed(2)} m</div><div>${reef}</div>${algaeHint}<div class="dim">${climb}</div>`);
  }
}
