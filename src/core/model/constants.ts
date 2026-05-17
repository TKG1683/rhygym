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
