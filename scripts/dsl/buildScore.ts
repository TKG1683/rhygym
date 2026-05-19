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

  // Tempo semantic: opts.bpm is what the *author* feels — for compound
  // primary meters (6/8, 9/8, 12/8) that's the dotted-quarter pulse
  // (♩.=N), so the internal MIDI tempo (quarter per minute) needs a
  // ×1.5 scale to play back at the same audible speed the author
  // expected. Simple primary meters interpret opts.bpm as ♩=N (the
  // MIDI default), so no scale. tempoChange events use the same scale,
  // so a mid-piece "tempoChange(120)" in a 6/8 piece still means
  // ♩.=120 to the author.
  const isCompoundPrimary = opts.ts[1] === 8 && opts.ts[0] % 3 === 0;
  const tempoScale = isCompoundPrimary ? 1.5 : 1.0;
  const tempos: TempoEvent[] = [{ tick: 0, bpm: opts.bpm * tempoScale }];
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
      tempos.push({ tick, bpm: item.bpm * tempoScale });
    }
  }

  return { tempos, timeSigs, notes, totalTicks: tick };
}
