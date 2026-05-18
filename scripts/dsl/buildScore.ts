/**
 * DSL → Score adapter. Walks a flat list of DslItems and lays them out
 * sequentially on a single voice, returning the same Score shape the
 * runtime app uses.
 *
 * The item stream is a mix of:
 *   - notes/rests (advance the playhead by their duration)
 *   - timeSigChange / tempoChange markers (consume zero ticks; emit
 *     into Score.timeSigs / Score.tempos at the current playhead)
 */

import type { RhythmNote, Score, TempoEvent, TimeSignatureEvent } from '../../src/core/model';
import type { DslItem } from './notes';

export interface BuildOptions {
  /** [numerator, denominator] — e.g. [4, 4] or [6, 8]. Initial time signature. */
  ts: [number, number];
  bpm: number;
}

export function buildScore(opts: BuildOptions, items: ReadonlyArray<DslItem>): Score {
  let tick = 0;
  const notes: RhythmNote[] = [];
  const tempos: TempoEvent[] = [{ tick: 0, bpm: opts.bpm }];
  const timeSigs: TimeSignatureEvent[] = [
    { tick: 0, numerator: opts.ts[0], denominator: opts.ts[1] },
  ];

  for (const item of items) {
    if (item.kind === 'note') {
      notes.push({
        id: `n${notes.length}`,
        tick,
        durationTicks: item.durationTicks,
        isRest: item.isRest,
      });
      tick += item.durationTicks;
    } else if (item.kind === 'timeSigChange') {
      timeSigs.push({ tick, numerator: item.numerator, denominator: item.denominator });
    } else if (item.kind === 'tempoChange') {
      tempos.push({ tick, bpm: item.bpm });
    }
  }

  return { tempos, timeSigs, notes, totalTicks: tick };
}
