/**
 * Note-value helpers for the stage-authoring DSL.
 *
 * Each helper returns a `DslItem`: a duration in ticks + whether it's
 * a rest. Items are placed onto the score head-to-tail by buildScore,
 * so the author just lists them in playing order.
 *
 * Naming:
 *   q / h / w           = quarter / half / whole note
 *   eighth / sixteenth  = 1/8, 1/16 (spelled out — `e` is ambiguous)
 *   qd / eighthDotted   = dotted variants
 *   qr / eighthRest...  = rest variants of the same value
 *   tripletEighth / ... = triplet subdivisions
 *   quintuplet / sextuplet / septuplet = N-in-the-time-of-a-quarter
 *
 * Cross-bar / cross-beat ties:
 *   tie(...items) → one DslItem whose duration is the sum. Rhygym's
 *   internal model doesn't represent a tie as a separate object — a
 *   tied note IS a single note whose duration spans the tied span — so
 *   the helper is just sugar for the sum.
 *
 * Meta events (time-sig / tempo change mid-piece):
 *   tsChange(n, d) → emit a TimeSigChange marker into the item stream
 *   tempoChange(bpm) → emit a TempoChange marker into the item stream
 *   buildScore translates these into Score.timeSigs / Score.tempos
 *   entries at the current playhead tick. They consume zero ticks.
 */

import {
  DOTTED_EIGHTH_NOTE_TICKS,
  DOTTED_HALF_NOTE_TICKS,
  DOTTED_QUARTER_NOTE_TICKS,
  DOTTED_SIXTEENTH_NOTE_TICKS,
  EIGHTH_NOTE_TICKS,
  EIGHTH_TRIPLET_NOTE_TICKS,
  HALF_NOTE_TICKS,
  QUARTER_NOTE_TICKS,
  QUARTER_TRIPLET_NOTE_TICKS,
  QUINTUPLET_NOTE_TICKS,
  SEPTUPLET_NOTE_TICKS_APPROX,
  SEXTUPLET_NOTE_TICKS,
  SIXTEENTH_NOTE_TICKS,
  SIXTEENTH_TRIPLET_NOTE_TICKS,
  THIRTYSECOND_NOTE_TICKS,
  WHOLE_NOTE_TICKS,
} from '../../src/core/model';

export interface NoteItem {
  kind: 'note';
  durationTicks: number;
  isRest: boolean;
  /**
   * Tremolo stroke count (#82). When set the renderer draws this many
   * diagonal slashes through the stem and judgement expands the note
   * into 2^n equal-subdivision onsets. Authored via the `tremolo()`
   * helper, not by hand.
   */
  tremoloStrokes?: number;
}

export interface TimeSigChangeItem {
  kind: 'timeSigChange';
  numerator: number;
  denominator: number;
}

export interface TempoChangeItem {
  kind: 'tempoChange';
  bpm: number;
}

export type DslItem = NoteItem | TimeSigChangeItem | TempoChangeItem;

const note = (durationTicks: number): NoteItem => ({ kind: 'note', durationTicks, isRest: false });
const rest = (durationTicks: number): NoteItem => ({ kind: 'note', durationTicks, isRest: true });

// Notes
export const w = () => note(WHOLE_NOTE_TICKS);
export const h = () => note(HALF_NOTE_TICKS);
export const q = () => note(QUARTER_NOTE_TICKS);
export const eighth = () => note(EIGHTH_NOTE_TICKS);
export const sixteenth = () => note(SIXTEENTH_NOTE_TICKS);
export const thirtysecond = () => note(THIRTYSECOND_NOTE_TICKS);

// Dotted notes
export const hd = () => note(DOTTED_HALF_NOTE_TICKS);
export const qd = () => note(DOTTED_QUARTER_NOTE_TICKS);
export const eighthDotted = () => note(DOTTED_EIGHTH_NOTE_TICKS);
export const sixteenthDotted = () => note(DOTTED_SIXTEENTH_NOTE_TICKS);

// Triplets (three of these fit in the parent value)
export const quarterTriplet = () => note(QUARTER_TRIPLET_NOTE_TICKS);
export const eighthTriplet = () => note(EIGHTH_TRIPLET_NOTE_TICKS);
export const sixteenthTriplet = () => note(SIXTEENTH_TRIPLET_NOTE_TICKS);

// Quintuplet / sextuplet — one note's worth (N fit in a quarter).
// Authors write the full N-note run by repeating the helper N times.
export const fiveTuplet = () => note(QUINTUPLET_NOTE_TICKS);
export const sixTuplet = () => note(SEXTUPLET_NOTE_TICKS);

// Rests
export const wr = () => rest(WHOLE_NOTE_TICKS);
export const hr = () => rest(HALF_NOTE_TICKS);
export const qr = () => rest(QUARTER_NOTE_TICKS);
export const eighthRest = () => rest(EIGHTH_NOTE_TICKS);
export const sixteenthRest = () => rest(SIXTEENTH_NOTE_TICKS);

/**
 * Tremolo helper (#82). Wraps a note value and tags it with a stroke
 * count. The note still occupies its written duration; the strokes
 * declare HOW MANY equal-subdivision onsets the player must tap
 * within that duration (2^strokes — 1 slash = 2 onsets, 2 = 4, 3 = 8).
 *
 * `tremolo(q(), 2)` = quarter-note with 2 slashes = 4 sixteenth-note taps.
 * `tremolo(h(), 3)` = half-note with 3 slashes = 16 thirty-second taps.
 *
 * Rests are rejected — a silent tremolo has no musical meaning.
 */
export function tremolo(value: NoteItem, strokes: number): NoteItem {
  if (value.isRest) {
    throw new Error('tremolo() cannot wrap a rest — pick a note value');
  }
  if (!Number.isInteger(strokes) || strokes < 1) {
    throw new Error('tremolo() strokes must be a positive integer');
  }
  return { ...value, tremoloStrokes: strokes };
}

/**
 * Tie helper. Returns ONE NoteItem whose duration is the sum of its
 * inputs, with rest-ness taken from the first item. Use this when a
 * note's value isn't expressible as a single note (e.g. quarter + half
 * tied across a barline, or a dotted-quarter span starting off-beat).
 *
 * `tie(q(), h())` = quarter tied to half = single 720-tick note.
 */
export function tie(...items: NoteItem[]): NoteItem {
  if (items.length === 0) throw new Error('tie() requires at least one item');
  const first = items[0]!;
  const total = items.reduce((sum, it) => sum + it.durationTicks, 0);
  return { kind: 'note', durationTicks: total, isRest: first.isRest };
}

/**
 * Septuplet — 7 notes in the time of a quarter. 480 doesn't divide
 * cleanly by 7, so the run is built as six items of 69 ticks + one
 * item of 66 ticks so the total is exactly 480. Returns an ARRAY;
 * spread it into the buildScore item list: `...septuplet()`.
 */
export function septuplet(): NoteItem[] {
  const base = SEPTUPLET_NOTE_TICKS_APPROX; // 69
  const remainder = QUARTER_NOTE_TICKS - base * 7; // -3
  const lastTicks = base + remainder; // 66
  return [
    note(base), note(base), note(base), note(base), note(base), note(base),
    note(lastTicks),
  ];
}

// Mid-piece meta events. Consume zero ticks.
export const tsChange = (numerator: number, denominator: number): TimeSigChangeItem => ({
  kind: 'timeSigChange',
  numerator,
  denominator,
});
export const tempoChange = (bpm: number): TempoChangeItem => ({ kind: 'tempoChange', bpm });
