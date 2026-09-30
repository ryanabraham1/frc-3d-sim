import { ALLIANCES } from '@engine/coords';
import type { HudSlots, SeasonContext, SeasonHud } from '@engine/core/season';
import * as C from './constants';
import type { CrescendoRules } from './rules';
import { melodyThreshold, stageCategoryTotal } from './scoring';

export class CrescendoHud implements SeasonHud {
  constructor(private readonly ctx: SeasonContext, private readonly rules: CrescendoRules, private readonly slots: HudSlots) {}

  update(): void {
    const { ctx, rules, slots } = this;
    const coop = rules.coopBonus();
    for (const a of ALLIANCES) {
      const amp = rules.amplified(a);
      const lights = `${rules.bank[a] >= 1 ? '●' : '○'}${rules.bank[a] >= 2 ? '●' : '○'}`;
      const ampLine = amp ? `<b class="ok">AMPLIFIED ${Math.ceil(rules.amplifyRemaining(a))} s</b>` : `AMP ${lights}${rules.bank[a] >= 2 ? ' · <b class="ok">ready</b>' : ''}`;
      const notes = ctx.score.counter(a, 'notes');
      const coopLine = rules.coopUsed[a] ? (coop ? 'COOP ✓ bonus' : 'COOP pressed') : rules.coopWindowOpen() || rules.isAuto() ? 'COOP open' : 'COOP —';
      const spot = rules.spotlit[a].filter(Boolean).length;
      const trap = rules.trapScored[a].filter(Boolean).length;
      ctx.hud.setHtml(slots[a], `<div class="mini">${ampLine}</div>` +
        `<div class="mini">MELODY ${notes}/${melodyThreshold(coop)} · ${coopLine}</div>` +
        `<div class="mini dim">STAGE ${stageCategoryTotal(ctx.score, a)} · TRAP ${trap}/3 · SPOTLIT ${spot}/3 · HIGH NOTES ${rules.highNotesLeft[a]}</div>`);
    }
    const tele = rules.teleopElapsed();
    const center = rules.isEndgame()
      ? '<b>END GAME</b> · STAGE protected · HIGH NOTES (N) · ONSTAGE 3 / SPOTLIT 4 / HARMONY +2 / TRAP 5'
      : tele < C.COOP_WINDOW
        ? `Coopertition window ${Math.ceil(C.COOP_WINDOW - tele)} s · both alliances press B with a banked AMP NOTE`
        : coop ? '<b class="ok">COOPERTITION BONUS · MELODY needs 15</b>' : 'CRESCENDO · MELODY: 18 AMP + SPEAKER NOTES · ENSEMBLE: 10 STAGE pts + 2 ONSTAGE';
    ctx.hud.setHtml(slots.center, center);

    const r = ctx.playerRobot;
    if (!r) return;
    const holding = r.held.length > 0;
    let hint: string;
    if (r.isClimbing) {
      const c = r.climbSlot ?? 0;
      hint = r.climbPhase === 'hanging'
        ? `ONSTAGE · ${C.chainLabel(r.alliance, c)}${rules.spotlit[r.alliance][c] ? ' · SPOTLIT' : ''}${holding && r.config.climber.maxLevel >= 2 && !rules.trapScored[r.alliance][c] ? ' · <b class="ok">Space: TRAP</b>' : ''} · X to descend`
        : 'Climbing…';
    } else if (holding) {
      hint = rules.nearAmp(r) ? '<b class="ok">G: score in the AMP</b> · Space: shoot SPEAKER' : 'Space: shoot SPEAKER · G: pass / score at your AMP';
    } else hint = 'Intake a NOTE from the carpet or your SOURCE (opponent end)';
    const climb = r.isClimbing ? '' : rules.chainFor(r) && rules.isTeleop() ? '<div class="ok">C: climb this chain</div>' : '';
    const unclear = holding && !r.lastShotClear ? '<div class="bad">No clean SPEAKER shot from here</div>' : '';
    ctx.hud.setHtml(slots.player, `<div class="hopper-label">NOTE ${holding ? '1' : '0'}/1</div><div>${hint}</div>${unclear}${climb}` +
      `<div class="dim">H: AMPLIFY · B: Coopertition · N: HIGH NOTE</div>`);
  }
}
