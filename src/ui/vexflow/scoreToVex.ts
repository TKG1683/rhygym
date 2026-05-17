/**
 * Convert a Score (tick-based, single rhythm voice) to a VexFlow-friendly
 * intermediate representation grouped by measure.
 *
 * Design constraints:
 * - Single voice (no chords, no parallel parts).
 * - Notes never span across measures in this initial version (the score
 *   builder is responsible for keeping note onsets and durations measure-
 *   aligned).
 * - Gaps between notes are filled with rests via greedy duration
 *   decomposition.
 */

import {
  DOTTED_EIGHTH_NOTE_TICKS,
  DOTTED_HALF_NOTE_TICKS,
  DOTTED_QUARTER_NOTE_TICKS,
  DOTTED_SIXTEENTH_NOTE_TICKS,
  EIGHTH_NOTE_TICKS,
  HALF_NOTE_TICKS,
  PPQ,
  QUARTER_NOTE_TICKS,
  SIXTEENTH_NOTE_TICKS,
  THIRTYSECOND_NOTE_TICKS,
  WHOLE_NOTE_TICKS,
  type Score,
  type TimeSignatureEvent,
} from '../../core/model';

/** VexFlow note representation: duration string + rest flag, no pitch (rhythm only). */
export interface VexNote {
  /** Unique key for this token (may differ from source RhythmNote.id when split). */
  id: string;
  /** Base value: w/h/q/8/16/32 plus optional 'd' suffix for dotted. No 'r' suffix. */
  vexBaseDuration: string;
  isRest: boolean;
  ticks: number;
  /**
   * Original RhythmNote.id this token came from. Set on the first token of
   * a split note; null for rests and subsequent tied fragments. Tap
   * judgement uses this to map a rendered notehead back to the source note.
   */
  originalNoteId: string | null;
}

export interface VexMeasure {
  index: number;
  startTick: number;
  ticks: number;
  numerator: number;
  denominator: number;
  notes: VexNote[];
}

export interface VexScore {
  measures: VexMeasure[];
}

const DURATION_TABLE: ReadonlyArray<{ ticks: number; dur: string }> = [
  { ticks: WHOLE_NOTE_TICKS, dur: 'w' },
  { ticks: DOTTED_HALF_NOTE_TICKS, dur: 'hd' },
  { ticks: HALF_NOTE_TICKS, dur: 'h' },
  { ticks: DOTTED_QUARTER_NOTE_TICKS, dur: 'qd' },
  { ticks: QUARTER_NOTE_TICKS, dur: 'q' },
  { ticks: DOTTED_EIGHTH_NOTE_TICKS, dur: '8d' },
  { ticks: EIGHTH_NOTE_TICKS, dur: '8' },
  { ticks: DOTTED_SIXTEENTH_NOTE_TICKS, dur: '16d' },
  { ticks: SIXTEENTH_NOTE_TICKS, dur: '16' },
  { ticks: THIRTYSECOND_NOTE_TICKS, dur: '32' },
];

const DUR_TO_TICKS = new Map(DURATION_TABLE.map((e) => [e.dur, e.ticks]));

function exactDuration(ticks: number): string | null {
  const hit = DURATION_TABLE.find((e) => e.ticks === ticks);
  return hit ? hit.dur : null;
}

/** Greedy largest-first decomposition. Returns [] for ticks <= 0 or undefined for unsupported residue. */
export function decomposeTicks(ticks: number): string[] {
  if (ticks <= 0) return [];
  const out: string[] = [];
  let remaining = ticks;
  while (remaining > 0) {
    const fit = DURATION_TABLE.find((e) => e.ticks <= remaining);
    if (!fit) break;
    out.push(fit.dur);
    remaining -= fit.ticks;
  }
  return out;
}

function durTicks(dur: string): number {
  return DUR_TO_TICKS.get(dur) ?? 0;
}

function ticksPerMeasure(ts: TimeSignatureEvent): number {
  return (PPQ * 4 * ts.numerator) / ts.denominator;
}

function findTimeSigAt(timeSigs: TimeSignatureEvent[], tick: number): TimeSignatureEvent {
  let cur = timeSigs[0]!;
  for (const ts of timeSigs) {
    if (ts.tick <= tick) cur = ts;
    else break;
  }
  return cur;
}

export function scoreToVex(score: Score): VexScore {
  const sortedTimeSigs = [...score.timeSigs].sort((a, b) => a.tick - b.tick);
  if (sortedTimeSigs.length === 0 || sortedTimeSigs[0]!.tick > 0) {
    sortedTimeSigs.unshift({ tick: 0, numerator: 4, denominator: 4 });
  }
  const sortedNotes = [...score.notes].sort((a, b) => a.tick - b.tick);

  const measures: VexMeasure[] = [];
  let measureIdx = 0;
  let measureStart = 0;

  while (measureStart < score.totalTicks) {
    const ts = findTimeSigAt(sortedTimeSigs, measureStart);
    const measureLength = ticksPerMeasure(ts);
    const measureEnd = Math.min(measureStart + measureLength, score.totalTicks);
    const measureNotes: VexNote[] = [];

    let cursor = measureStart;

    for (const n of sortedNotes) {
      if (n.tick < measureStart || n.tick >= measureEnd) continue;

      // Fill any rest gap before this note.
      if (n.tick > cursor) {
        for (const dur of decomposeTicks(n.tick - cursor)) {
          measureNotes.push({
            id: `m${measureIdx}-rest-${cursor}`,
            vexBaseDuration: dur,
            isRest: true,
            ticks: durTicks(dur),
            originalNoteId: null,
          });
          cursor += durTicks(dur);
        }
      }

      // Emit the note (or split it if it doesn't match a single duration).
      const single = exactDuration(n.durationTicks);
      if (single !== null) {
        measureNotes.push({
          id: n.id,
          vexBaseDuration: single,
          isRest: n.isRest,
          ticks: n.durationTicks,
          originalNoteId: n.isRest ? null : n.id,
        });
      } else {
        const tokens = decomposeTicks(n.durationTicks);
        tokens.forEach((dur, i) => {
          measureNotes.push({
            id: i === 0 ? n.id : `${n.id}-part${i}`,
            vexBaseDuration: dur,
            isRest: n.isRest,
            ticks: durTicks(dur),
            originalNoteId: n.isRest || i > 0 ? null : n.id,
          });
        });
      }
      cursor += n.durationTicks;
    }

    // Trailing rest fill.
    if (cursor < measureEnd) {
      for (const dur of decomposeTicks(measureEnd - cursor)) {
        measureNotes.push({
          id: `m${measureIdx}-rest-${cursor}`,
          vexBaseDuration: dur,
          isRest: true,
          ticks: durTicks(dur),
          originalNoteId: null,
        });
        cursor += durTicks(dur);
      }
    }

    measures.push({
      index: measureIdx,
      startTick: measureStart,
      ticks: measureEnd - measureStart,
      numerator: ts.numerator,
      denominator: ts.denominator,
      notes: measureNotes,
    });

    measureStart = measureEnd;
    measureIdx++;
  }

  return { measures };
}
