import { matchWindow, MODE_SIZE, type RankedMode } from '../src/engine/net/ranked.ts';

/** One player waiting for a ranked match. */
export interface QueueEntry<T = unknown> {
  id: string;
  rating: number;
  /** When they joined the queue (ms). */
  since: number;
  data: T;
}

/**
 * Rating-based queues, one per mode. A group of 2 × team-size players is formed from neighbours in rating
 * order when their spread fits inside the tightest search window of the group; windows widen the longer a
 * player waits, so nobody waits forever on a thin server.
 */
export class Matchmaker<T = unknown> {
  private queues = new Map<RankedMode, QueueEntry<T>[]>();

  add(mode: RankedMode, entry: QueueEntry<T>): void {
    this.remove(entry.id);
    const q = this.queues.get(mode) ?? [];
    q.push(entry);
    this.queues.set(mode, q);
  }

  remove(id: string): boolean {
    let found = false;
    for (const [mode, q] of this.queues) {
      const next = q.filter((e) => e.id !== id);
      if (next.length !== q.length) found = true;
      this.queues.set(mode, next);
    }
    return found;
  }

  has(id: string): boolean {
    for (const q of this.queues.values()) if (q.some((e) => e.id === id)) return true;
    return false;
  }

  size(mode: RankedMode): number {
    return this.queues.get(mode)?.length ?? 0;
  }

  /** Form every match that is possible at `now` (removing the matched players from their queues). */
  tick(now: number): { mode: RankedMode; players: QueueEntry<T>[] }[] {
    const out: { mode: RankedMode; players: QueueEntry<T>[] }[] = [];
    for (const [mode, queue] of this.queues) {
      const need = MODE_SIZE[mode] * 2;
      for (;;) {
        const sorted = [...queue].sort((a, b) => a.rating - b.rating);
        let best: QueueEntry<T>[] | null = null;
        let bestWait = -1;
        for (let i = 0; i + need <= sorted.length; i++) {
          const group = sorted.slice(i, i + need);
          const spread = group[group.length - 1].rating - group[0].rating;
          if (spread > Math.min(...group.map((e) => matchWindow(now - e.since)))) continue;
          const wait = group.reduce((s, e) => s + (now - e.since), 0);
          if (wait > bestWait) {
            best = group;
            bestWait = wait;
          }
        }
        if (!best) break;
        const ids = new Set(best.map((e) => e.id));
        for (let i = queue.length - 1; i >= 0; i--) if (ids.has(queue[i].id)) queue.splice(i, 1);
        out.push({ mode, players: best });
      }
    }
    return out;
  }
}
