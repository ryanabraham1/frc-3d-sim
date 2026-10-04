import type { Alliance } from '@engine/coords';
import type { MatchResults } from '@engine/core/season';
import type { Scoreboard } from '@engine/match/scoreboard';
import * as C from './constants';

/** PURE scoring helpers for Table 6-2 (unit-tested in tests/crescendo.test.ts). */

export const speakerPoints = (auto: boolean, amplified: boolean) => (auto ? C.POINTS.speakerAuto : amplified ? C.POINTS.speakerAmplified : C.POINTS.speakerTeleop);
export const ampPoints = (auto: boolean) => (auto ? C.POINTS.ampAuto : C.POINTS.ampTeleop);

/** End-of-match state of one robot for STAGE assessment [M 6.5.2]. */
export interface StageRobot {
  /** Chain index the robot is ONSTAGE on, or null. */
  chain: number | null;
  /** Bumpers partially/completely inside its STAGE ZONE. */
  inStageZone: boolean;
}

/**
 * STAGE points for one alliance: PARK 1 (not ONSTAGE), ONSTAGE 3 / SPOTLIT 4, HARMONY 2 per additional robot
 * on a chain, NOTE in TRAP 5 each. `spotlit[c]` = a HIGH NOTE is on chain c's MICROPHONE.
 */
export function stagePoints(robots: StageRobot[], spotlit: boolean[], traps: number) {
  let park = 0, onstage = 0, harmony = 0, onstageCount = 0;
  const perChain = [0, 0, 0];
  for (const r of robots) {
    if (r.chain !== null) {
      onstageCount++;
      perChain[r.chain]++;
      onstage += spotlit[r.chain] ? C.POINTS.onstageSpotlit : C.POINTS.onstage;
    } else if (r.inStageZone) park += C.POINTS.park;
  }
  for (const n of perChain) if (n > 1) harmony += (n - 1) * C.POINTS.harmony;
  const trap = traps * C.POINTS.trap;
  return { park, onstage, harmony, trap, onstageCount, total: park + onstage + harmony + trap };
}

/** MELODY: at least 18 (15 with the Coopertition Bonus) AMP + SPEAKER NOTES. */
export const melodyThreshold = (coop: boolean) => (coop ? C.MELODY_NOTES_COOP : C.MELODY_NOTES);
export const melodyEarned = (notes: number, coop: boolean) => notes >= melodyThreshold(coop);
/** ENSEMBLE: at least 10 STAGE points and at least 2 ONSTAGE robots. */
export const ensembleEarned = (stageTotal: number, onstageCount: number) => stageTotal >= C.ENSEMBLE_STAGE_POINTS && onstageCount >= C.ENSEMBLE_ONSTAGE;

/** Match results + RP from the scoreboard. Counters used: 'notes', 'onstage'; categories per scoring action. */
export function crescendoResults(score: Scoreboard, coop: boolean, forcedEnsemble: Record<Alliance, boolean>): MatchResults {
  const winner = score.winner();
  const rp = { blue: 0, red: 0 };
  const rpDetail: Record<Alliance, string[]> = { blue: [], red: [] };
  for (const a of ['blue', 'red'] as const) {
    const stage = stageCategoryTotal(score, a);
    if (melodyEarned(score.counter(a, 'notes'), coop)) { rp[a]++; rpDetail[a].push('MELODY'); }
    if (ensembleEarned(stage, score.counter(a, 'onstage')) || forcedEnsemble[a]) { rp[a]++; rpDetail[a].push(forcedEnsemble[a] ? 'ENSEMBLE (G424)' : 'ENSEMBLE'); }
    if (winner === a) { rp[a] += 2; rpDetail[a].push('WIN +2'); }
    else if (winner === 'tie') { rp[a] += 1; rpDetail[a].push('TIE +1'); }
  }
  const row = (label: string, ...cats: string[]) => ({ label, cats, blue: cats.reduce((s, c) => s + score.category('blue', c), 0), red: cats.reduce((s, c) => s + score.category('red', c), 0) });
  const count = (label: string, counter: string) => ({ label, blue: score.counter('blue', counter), red: score.counter('red', counter) });
  return {
    winner, rp, rpDetail,
    rows: [
      row('AUTO leave', 'leave'),
      row('AUTO notes (amp + speaker)', 'autoAmp', 'autoSpeaker'),
      row('TELEOP amp', 'amp'),
      row('TELEOP speaker', 'speaker'),
      row('TELEOP speaker · amplified', 'speakerAmplified'),
      row('Stage (park / onstage / harmony / trap)', 'park', 'onstage', 'harmony', 'trap'),
      count('AMP + SPEAKER notes', 'notes'),
      { label: 'Opponent fouls', blue: score.foulPointsFor('blue'), red: score.foulPointsFor('red') },
      { label: 'Cards (yellow / red)', blue: `${score.cardCount('blue', 'yellow')} / ${score.cardCount('blue', 'red')}`, red: `${score.cardCount('red', 'yellow')} / ${score.cardCount('red', 'red')}` },
      { label: 'TOTAL', blue: score.total('blue'), red: score.total('red'), emphasis: true },
      { label: 'Coopertition points', blue: coop ? 1 : 0, red: coop ? 1 : 0 },
      { label: 'Ranking points', blue: rp.blue, red: rp.red, emphasis: true },
    ],
  };
}

export function stageCategoryTotal(score: Scoreboard, a: Alliance): number {
  return ['park', 'onstage', 'harmony', 'trap'].reduce((s, c) => s + score.category(a, c), 0);
}
