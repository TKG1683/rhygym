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
  type RhythmNote,
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
   * a split note; null for rests and subsequent continuation fragments
   * (e.g. the tail of a cross-bar note). Tap judgement uses this to map a
   * rendered notehead back to the source note — only the head fragment is
   * a valid tap target so the player isn't asked to tap the held-out tail.
   */
  originalNoteId: string | null;
  /**
   * When this note is part of an N-in-the-time-of-M tuplet (triplet,
   * quintuplet, sextuplet, septuplet), the ratio used to draw the
   * Tuplet bracket. Adjacent notes sharing the same `tupletGroupId`
   * form one bracket.
   */
  tupletShape?: { num: number; denom: number };
  /** Per-measure index identifying which tuplet bracket this note belongs to. */
  tupletGroupId?: number;
  /**
   * Tremolo stroke count (#82). Only set on the head segment of the
   * source RhythmNote so VexFlow draws the slashes on exactly one
   * notehead even when a tremolo note spans multiple tokens (split by
   * a barline, etc.). Renderer applies VexFlow's Tremolo modifier.
   */
  tremoloStrokes?: number;
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

/**
 * For tuplet member notes, what VexFlow base duration should the single
 * notehead use? The Tuplet bracket (drawn separately by ScoreRenderer)
 * conveys the actual rhythmic ratio; the notehead just needs a value
 * that VexFlow's layout engine accepts.
 *  - 320 ticks → 'q' (quarter triplet: 3 in a half)
 *  - 160 ticks → '8' (eighth triplet: 3 in a quarter)
 *  - 80  ticks → '16' (sixteenth triplet OR sextuplet — detection
 *    later resolves which based on run length)
 *  - 96  ticks → '16' (quintuplet: 5 in a quarter)
 *  - 69/66 ticks → '16' (septuplet: 7 in a quarter, last note absorbs
 *    the 480/7 rounding remainder)
 */
function tupletSingleDuration(ticks: number): string | null {
  switch (ticks) {
    case 320: return 'q';
    case 160: return '8';
    case 80:  return '16';
    case 96:  return '16';
    case 69:  return '16';
    case 66:  return '16';
    default:  return null;
  }
}

/**
 * Tuplet detection patterns. Each entry says "a run of `groupSize`
 * consecutive non-rest notes with `ticks` each → tuplet with this
 * shape." Order matters: 80-tick sextuplet (groupSize 6) is checked
 * before 80-tick sixteenth-triplet (groupSize 3) so a 6-note run
 * gets one bracket instead of two.
 */
const TUPLET_PATTERNS: ReadonlyArray<{
  ticks: number;
  groupSize: number;
  shape: { num: number; denom: number };
}> = [
  { ticks: 320, groupSize: 3, shape: { num: 3, denom: 2 } }, // quarter triplet
  { ticks: 160, groupSize: 3, shape: { num: 3, denom: 2 } }, // eighth triplet
  { ticks: 80,  groupSize: 6, shape: { num: 6, denom: 4 } }, // sextuplet
  { ticks: 80,  groupSize: 3, shape: { num: 3, denom: 2 } }, // sixteenth triplet
  { ticks: 96,  groupSize: 5, shape: { num: 5, denom: 4 } }, // quintuplet
];

/**
 * Septuplet has mixed-tick members (six 69-tick + one 66-tick) so it
 * doesn't fit the constant-ticks pattern table. Checked separately.
 */
function septupletAt(notes: VexNote[], start: number): boolean {
  if (start + 6 >= notes.length) return false;
  for (let k = 0; k < 6; k++) {
    const n = notes[start + k]!;
    if (n.ticks !== 69 || n.isRest) return false;
  }
  const last = notes[start + 6]!;
  return last.ticks === 66 && !last.isRest;
}

/**
 * Walk a measure's note list, marking runs of consecutive equal-tick
 * notes that look like tuplets. Each detected group gets a shared
 * `tupletGroupId` and matching `tupletShape`; ScoreRenderer later turns
 * each unique groupId into one VexFlow Tuplet bracket.
 */
function detectTuplets(notes: VexNote[], measureIdx: number): void {
  let i = 0;
  let nextGroupId = measureIdx * 1000;
  while (i < notes.length) {
    if (septupletAt(notes, i)) {
      const gid = nextGroupId++;
      for (let k = 0; k < 7; k++) {
        notes[i + k]!.tupletShape = { num: 7, denom: 4 };
        notes[i + k]!.tupletGroupId = gid;
      }
      i += 7;
      continue;
    }
    let matched = false;
    for (const p of TUPLET_PATTERNS) {
      if (notes[i]!.ticks !== p.ticks) continue;
      if (notes[i]!.isRest) continue;
      // Need groupSize consecutive same-tick non-rest notes.
      let ok = true;
      for (let k = 0; k < p.groupSize; k++) {
        const n = notes[i + k];
        if (!n || n.ticks !== p.ticks || n.isRest) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const gid = nextGroupId++;
      for (let k = 0; k < p.groupSize; k++) {
        notes[i + k]!.tupletShape = { num: p.shape.num, denom: p.shape.denom };
        notes[i + k]!.tupletGroupId = gid;
      }
      i += p.groupSize;
      matched = true;
      break;
    }
    if (!matched) i++;
  }
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

  // Carry-over from the previous measure when a note's duration spans the
  // barline. `partIndex` keeps `${note.id}-partN` ids unique across the
  // bar split so consumers can still treat each fragment as its own token.
  let pending: { note: RhythmNote; remainingTicks: number; partIndex: number } | null = null;

  while (measureStart < score.totalTicks) {
    const ts = findTimeSigAt(sortedTimeSigs, measureStart);
    const measureLength = ticksPerMeasure(ts);
    const measureEnd = Math.min(measureStart + measureLength, score.totalTicks);
    const measureNotes: VexNote[] = [];

    let cursor = measureStart;

    // First: consume any tail carried over from the previous measure. It
    // starts at the bar's downbeat, so no leading-rest fill is needed.
    if (pending !== null) {
      const available = measureEnd - cursor;
      const consumed = Math.min(pending.remainingTicks, available);
      const continuesPastBar = consumed < pending.remainingTicks;
      emitNoteTokens(
        measureNotes,
        pending.note,
        consumed,
        pending.partIndex,
        continuesPastBar,
      );
      cursor += consumed;
      if (continuesPastBar) {
        // Hop the bar again. partIndex advances by however many tokens we
        // emitted; emitNoteTokens returns nothing so just bump by the
        // typical 1 (each split chunk == one or more tokens, but the
        // exact count doesn't matter for uniqueness as long as we keep
        // climbing — collisions only happen if we reuse a value).
        pending = {
          note: pending.note,
          remainingTicks: pending.remainingTicks - consumed,
          partIndex: pending.partIndex + measureNotes.length, // monotonic
        };
      } else {
        pending = null;
      }
    }

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

      // Does this note fit entirely in the current measure?
      const available = measureEnd - cursor;
      const consumed = Math.min(n.durationTicks, available);
      const spansBarline = consumed < n.durationTicks;

      emitNoteTokens(measureNotes, n, consumed, 0, spansBarline);
      cursor += consumed;

      if (spansBarline) {
        pending = {
          note: n,
          remainingTicks: n.durationTicks - consumed,
          partIndex: measureNotes.length, // monotonic counter, used for unique ids
        };
        // No more notes can fit in this measure — the bar is full.
        break;
      }
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

    detectTuplets(measureNotes, measureIdx);

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

/**
 * Emit one note's worth of VexNote tokens into `out`, covering exactly
 * `consumeTicks` (which may be less than `n.durationTicks` when the note
 * spans a barline and only the portion before the bar is being placed now).
 *
 * `startPartIndex` seeds the unique-id counter for split tokens; for the
 * head segment (first measure of the note) pass 0, for a carry-over tail
 * pass any monotonically increasing value.
 *
 * `continuesPastSegment` signals that more of this RhythmNote will be
 * emitted after this call (next measure). It only affects the tuplet
 * single-notehead shortcut — a fragment that continues past its segment
 * isn't a tuplet member, so we fall through to the multi-token split
 * path. No tie metadata is emitted because Rhygym judges onsets only;
 * the held tail just renders as plain notes without a slur arc.
 */
function emitNoteTokens(
  out: VexNote[],
  n: RhythmNote,
  consumeTicks: number,
  startPartIndex: number,
  continuesPastSegment: boolean,
): void {
  if (consumeTicks <= 0) return;

  const isHeadSegment = startPartIndex === 0;
  const single = exactDuration(consumeTicks);
  // Tuplet members carry their fixed per-note tick value (e.g. 320 for
  // quarter-triplet). Only the head segment is eligible for the tuplet
  // single-notehead path — a tail fragment that happens to land on the
  // same tick count is a coincidence, not a tuplet.
  const tupletSingle =
    single === null && isHeadSegment && !continuesPastSegment
      ? tupletSingleDuration(consumeTicks)
      : null;
  const isRest = n.isRest;

  // Tremolo decoration only belongs on the head of the source note,
  // and only on the first emitted token (so multi-token splits put it
  // on the leading notehead rather than every fragment).
  const tremoloHeadStrokes =
    !isRest && isHeadSegment && n.tremoloStrokes != null
      ? n.tremoloStrokes
      : undefined;

  if (single !== null) {
    const token: VexNote = {
      id: isHeadSegment ? n.id : `${n.id}-part${startPartIndex}`,
      vexBaseDuration: single,
      isRest,
      ticks: consumeTicks,
      // originalNoteId is set only on the very first emitted token of a
      // RhythmNote so tap judgement maps one tap event to one note id.
      // Continuation fragments (later split pieces or cross-bar tails)
      // mustn't claim the same tap target.
      originalNoteId: !isRest && isHeadSegment ? n.id : null,
    };
    if (tremoloHeadStrokes !== undefined) token.tremoloStrokes = tremoloHeadStrokes;
    out.push(token);
  } else if (tupletSingle !== null) {
    // Tuplet member: keep its true tick count so cursor math stays honest,
    // but render the head with a duration VexFlow accepts. The Tuplet
    // bracket added later carries the rhythmic ratio.
    const token: VexNote = {
      id: n.id,
      vexBaseDuration: tupletSingle,
      isRest,
      ticks: consumeTicks,
      originalNoteId: isRest ? null : n.id,
    };
    if (tremoloHeadStrokes !== undefined) token.tremoloStrokes = tremoloHeadStrokes;
    out.push(token);
  } else {
    // Duration doesn't fit a single notehead — split into a run of tokens
    // that sum to `consumeTicks`. Only the first token of the head segment
    // claims the originalNoteId (= tap target); subsequent split tokens
    // are continuation fragments.
    const tokens = decomposeTicks(consumeTicks);
    tokens.forEach((dur, i) => {
      const partIdx = startPartIndex + i;
      const isFirstEver = isHeadSegment && i === 0;
      const token: VexNote = {
        id: isFirstEver ? n.id : `${n.id}-part${partIdx}`,
        vexBaseDuration: dur,
        isRest,
        ticks: durTicks(dur),
        originalNoteId: !isRest && isFirstEver ? n.id : null,
      };
      if (isFirstEver && tremoloHeadStrokes !== undefined) {
        token.tremoloStrokes = tremoloHeadStrokes;
      }
      out.push(token);
    });
  }
}
