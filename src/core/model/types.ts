/**
 * Ticks per quarter note. All time positions and note values are stored
 * as integer ticks so tempo changes and BPM math stay exact.
 */
export const PPQ = 480;

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
  indexInLevel?: number;
  /** True for the "skip-test" stage in the Duolingo-style Level progression. */
  isExam?: boolean;
}
