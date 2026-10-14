/** A short window of actual rendered-frame gaps; averages alone hide intermittent stalls. */
export class FrameHealth {
  private readonly gaps: number[] = [];
  private next = 0;
  record(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.gaps[this.next] = ms;
    this.next = (this.next + 1) % 360;
  }
  stats(): { p95FrameMs: number; worstFrameMs: number; longFrames: number } {
    if (!this.gaps.length) return { p95FrameMs: 0, worstFrameMs: 0, longFrames: 0 };
    const sorted = [...this.gaps].sort((a, b) => a - b);
    return {
      p95FrameMs: Math.round(sorted[Math.ceil(sorted.length * .95) - 1]),
      worstFrameMs: Math.round(sorted.at(-1)!),
      longFrames: sorted.filter(ms => ms > 100).length,
    };
  }
}
