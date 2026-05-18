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
  SIXTEENTH_NOTE_TICKS,
  SIXTEENTH_TRIPLET_NOTE_TICKS,
  THIRTYSECOND_NOTE_TICKS,
  WHOLE_NOTE_TICKS,
} from '../../src/core/model';

export interface DslItem {
  durationTicks: number;
  isRest: boolean;
}

const note = (durationTicks: number): DslItem => ({ durationTicks, isRest: false });
const rest = (durationTicks: number): DslItem => ({ durationTicks, isRest: true });

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

// Rests
export const wr = () => rest(WHOLE_NOTE_TICKS);
export const hr = () => rest(HALF_NOTE_TICKS);
export const qr = () => rest(QUARTER_NOTE_TICKS);
export const eighthRest = () => rest(EIGHTH_NOTE_TICKS);
export const sixteenthRest = () => rest(SIXTEENTH_NOTE_TICKS);
