import type { Alliance } from '../coords';
import type { MatchResults, PlayerResults } from '../core/season';
import type { FoulKind, Scoreboard } from './scoreboard';

export interface PlayerInfo {
  id: number;
  alliance: Alliance;
  name: string;
  team: number;
}

/**
 * Per-player breakdown for the results screen. Pure: reads the season's results rows (the ones that list their
 * score `cats`) and the per-robot credit on the scoreboard. Counters used, all optional:
 * `shots` (launches / placement attempts) and `scored` (pieces that scored).
 */
export function buildPlayerResults(
  res: MatchResults,
  score: Scoreboard,
  infos: PlayerInfo[],
  foulValues: Record<FoulKind, number>,
  pieceLabel = 'Pieces',
): Pick<Required<MatchResults>, 'players' | 'uncredited'> {
  const rows = res.rows.filter((r) => r.cats?.length);
  const allCats = rows.flatMap((r) => r.cats!);
  const players: PlayerResults[] = infos.map((p) => {
    const lines = rows.map((r) => ({ label: r.label, value: r.cats!.reduce((s, c) => s + score.robotCategory(p.id, c), 0) }));
    const shots = score.robotCounter(p.id, 'shots');
    const scored = score.robotCounter(p.id, 'scored');
    const minor = score.foulsBy(p.id, 'minor');
    const major = score.foulsBy(p.id, 'major');
    const stats: PlayerResults['stats'] = [{ label: `${pieceLabel} scored`, value: scored }];
    if (shots > 0) {
      stats.push({ label: 'Shots', value: shots });
      stats.push({ label: 'Accuracy', value: `${Math.round((Math.min(scored, shots) / shots) * 100)}%` });
    }
    stats.push({ label: 'Fouls (minor / major)', value: `${minor} / ${major}` });
    const yellow = score.cardsFor(p.id, 'yellow'), red = score.cardsFor(p.id, 'red');
    if (yellow + red > 0) stats.push({ label: 'Cards (yellow / red)', value: `${yellow} / ${red}` });
    if (minor + major > 0) stats.push({ label: 'Foul points given', value: minor * foulValues.minor + major * foulValues.major });
    return { ...p, total: lines.reduce((s, l) => s + l.value, 0), rows: lines, stats };
  });
  const uncredited = { red: 0, blue: 0 } as Record<Alliance, number>;
  for (const a of ['red', 'blue'] as const) {
    const earned = allCats.reduce((s, c) => s + score.category(a, c), 0);
    const credited = players.filter((p) => p.alliance === a).reduce((s, p) => s + p.total, 0);
    uncredited[a] = Math.max(0, earned - credited);
  }
  return { players, uncredited };
}
