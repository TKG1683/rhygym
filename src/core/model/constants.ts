import { PPQ } from './types';

export const WHOLE_NOTE_TICKS = PPQ * 4;        // 1920
export const HALF_NOTE_TICKS = PPQ * 2;         // 960
export const QUARTER_NOTE_TICKS = PPQ;          // 480
export const EIGHTH_NOTE_TICKS = PPQ / 2;       // 240
export const SIXTEENTH_NOTE_TICKS = PPQ / 4;    // 120
export const THIRTYSECOND_NOTE_TICKS = PPQ / 8; // 60

// Dotted notes are 1.5x the base value (base + half of base).
export const DOTTED_HALF_NOTE_TICKS = HALF_NOTE_TICKS + QUARTER_NOTE_TICKS;             // 1440
export const DOTTED_QUARTER_NOTE_TICKS = QUARTER_NOTE_TICKS + EIGHTH_NOTE_TICKS;        // 720
export const DOTTED_EIGHTH_NOTE_TICKS = EIGHTH_NOTE_TICKS + SIXTEENTH_NOTE_TICKS;       // 360
export const DOTTED_SIXTEENTH_NOTE_TICKS = SIXTEENTH_NOTE_TICKS + THIRTYSECOND_NOTE_TICKS; // 180

// Triplets fit 3 notes in the time of their parent note value.
// All values are integers because PPQ=480 is divisible by 3.
export const QUARTER_TRIPLET_NOTE_TICKS = HALF_NOTE_TICKS / 3;          // 320
export const EIGHTH_TRIPLET_NOTE_TICKS = QUARTER_NOTE_TICKS / 3;        // 160
export const SIXTEENTH_TRIPLET_NOTE_TICKS = EIGHTH_NOTE_TICKS / 3;      // 80
export const THIRTYSECOND_TRIPLET_NOTE_TICKS = SIXTEENTH_NOTE_TICKS / 3; // 40

// Quintuplets / sextuplets fit 5 / 6 notes in the time of a quarter.
// 480 is divisible by both 5 and 6 so values are exact integers.
export const QUINTUPLET_NOTE_TICKS = QUARTER_NOTE_TICKS / 5;  // 96
export const SEXTUPLET_NOTE_TICKS = QUARTER_NOTE_TICKS / 6;   // 80

// Septuplets — 7 in the time of a quarter doesn't divide cleanly
// (480/7 ≈ 68.57). The constant is provided for callers that just need
// a representative subdivision tick value; use the `septuplet()` helper
// in scripts/dsl/notes.ts to emit a 7-item run that sums exactly to a
// quarter (the last item absorbs the rounding remainder).
export const SEPTUPLET_NOTE_TICKS_APPROX = Math.round(QUARTER_NOTE_TICKS / 7); // 69
