/**
 * Ticks per quarter note. All time positions and note values are stored
 * as integer ticks so tempo changes and BPM math stay exact.
 */
export const PPQ = 480;

/**
 * Player-selectable difficulty (#20). BEGINNER widens the judgement
 * windows and draws a moving playhead cursor over the staff so first-
 * time readers can correlate the metronome with the score. NORMAL is
 * the original sight-reading-focused mode (no playhead, tighter
 * windows). Best records are stored independently per difficulty.
 */
export type Difficulty = 'BEGINNER' | 'NORMAL';

export const DEFAULT_DIFFICULTY: Difficulty = 'NORMAL';
export const ALL_DIFFICULTIES: readonly Difficulty[] = ['BEGINNER', 'NORMAL'];

export interface TempoEvent {
  /** Position (tick) where this tempo takes effect. 0 = song start. */
  tick: number;
  bpm: number;
}

export interface TimeSignatureEvent {
  tick: number;
  numerator: number;
  denominator: number;
}

/**
 * A single rhythmic event on the staff. Carries no pitch — the player
 * just needs to tap on time. Rests are rendered but not tappable.
 */
export interface RhythmNote {
  id: string;
  /** Onset position (tick) from song start. */
  tick: number;
  durationTicks: number;
  isRest: boolean;
  /**
   * Tremolo stroke count (#82). When > 0, the renderer draws that
   * many diagonal slashes through the note's stem and the judgement
   * pipeline expands the note into 2^n equal-subdivision onset
   * candidates spread across its duration — e.g. tremoloStrokes=2
   * on a quarter note = 4 sixteenth-note taps. Undefined / 0 = plain
   * single-tap note. Only meaningful for non-rest notes.
   */
  tremoloStrokes?: number;
}

export interface Score {
  tempos: TempoEvent[];
  timeSigs: TimeSignatureEvent[];
  notes: RhythmNote[];
  totalTicks: number;
}

/** A 級 (difficulty tier) — one playable challenge. */
export interface Etude {
  id: string;
  name: string;
  description: string;
  bpm: number;
  score: Score;
  /** 1-based position within a Level's stage list. Undefined for single-stage Levels. */
  indexInMovement?: number;
  /** True for the "skip-test" stage in the Duolingo-style Level progression. */
  isFinal?: boolean;
  /**
   * True for the optional Lesson stage prepended to each Movement (#53).
   * Lessons sit at indexInMovement = 0, run at a reduced BPM with the
   * Movement's signature element in isolation, and are intentionally
   * excluded from progression accounting (`countClearedEtudes`) so the
   * "3 etudes A+ → Final unlocks" rule still counts Etudes 1-5 only.
   * Completion is tracked separately via `getLessonsCompleted()`.
   */
  isLesson?: boolean;
}
