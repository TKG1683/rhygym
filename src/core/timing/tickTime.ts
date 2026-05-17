import { PPQ, type TempoEvent } from '../model/types';

/**
 * Bidirectional tick↔second converter built from a piecewise-constant BPM
 * timeline. Each TempoEvent starts a segment that holds until the next
 * event; within a segment, time accumulates linearly at `60 / (bpm * PPQ)`
 * seconds per tick.
 *
 * Construction normalises the input (sorts ascending, prepends a BPM=120
 * segment if there isn't one at tick=0). Lookups are O(log n) via binary
 * search over the segment table.
 */

interface Segment {
  tick: number;
  sec: number;
  bpm: number;
  secPerTick: number;
}

const DEFAULT_BPM = 120;

export class TickTimeConverter {
  private readonly segments: Segment[];

  constructor(tempos: readonly TempoEvent[]) {
    const sorted = [...tempos].sort((a, b) => a.tick - b.tick);
    if (sorted.length === 0 || sorted[0]!.tick > 0) {
      sorted.unshift({ tick: 0, bpm: DEFAULT_BPM });
    }

    this.segments = [];
    for (let i = 0; i < sorted.length; i++) {
      const ev = sorted[i]!;
      let sec = 0;
      if (i > 0) {
        const prev = this.segments[i - 1]!;
        sec = prev.sec + (ev.tick - prev.tick) * prev.secPerTick;
      }
      this.segments.push({
        tick: ev.tick,
        sec,
        bpm: ev.bpm,
        secPerTick: 60 / (ev.bpm * PPQ),
      });
    }
  }

  tickToSec(tick: number): number {
    const seg = this.segmentAtTick(tick);
    return seg.sec + (tick - seg.tick) * seg.secPerTick;
  }

  secToTick(sec: number): number {
    const seg = this.segmentAtSec(sec);
    if (seg.secPerTick === 0) return seg.tick;
    return seg.tick + (sec - seg.sec) / seg.secPerTick;
  }

  bpmAtTick(tick: number): number {
    return this.segmentAtTick(tick).bpm;
  }

  get segmentCount(): number {
    return this.segments.length;
  }

  private segmentAtTick(tick: number): Segment {
    return this.findSegment((s) => s.tick <= tick);
  }

  private segmentAtSec(sec: number): Segment {
    return this.findSegment((s) => s.sec <= sec);
  }

  private findSegment(predicate: (s: Segment) => boolean): Segment {
    // Binary search for the latest segment satisfying `predicate`. Both
    // tick and sec are monotonically non-decreasing across segments, so
    // the predicate flips from true → false at most once.
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (predicate(this.segments[mid]!)) lo = mid;
      else hi = mid - 1;
    }
    return this.segments[lo]!;
  }
}
