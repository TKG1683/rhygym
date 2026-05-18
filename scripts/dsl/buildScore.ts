/**
 * DSL → Score adapter. Walks a flat list of DslItems and lays them out
 * sequentially on a single voice, returning the same Score shape the
 * runtime app uses.
 */

import type { RhythmNote, Score } from '../../src/core/model';
import type { DslItem } from './notes';

export interface BuildOptions {
  /** [numerator, denominator] — e.g. [4, 4] or [6, 8]. */
  ts: [number, number];
  bpm: number;
}

export function buildScore(opts: BuildOptions, items: ReadonlyArray<DslItem>): Score {
  let tick = 0;
  const notes: RhythmNote[] = items.map((item, i) => {
    const n: RhythmNote = {
      id: `n${i}`,
      tick,
      durationTicks: item.durationTicks,
      isRest: item.isRest,
    };
    tick += item.durationTicks;
    return n;
  });
  return {
    tempos: [{ tick: 0, bpm: opts.bpm }],
    timeSigs: [{ tick: 0, numerator: opts.ts[0], denominator: opts.ts[1] }],
    notes,
    totalTicks: tick,
  };
}
