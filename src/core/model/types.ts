/**
 * Ticks per quarter note. All time positions and note values are stored
 * as integer ticks so tempo changes and BPM math stay exact.
 */
export const PPQ = 480;

/**
 * Player-selectable difficulty (#20 → #54). Three Italian-musical
 * tiers that escalate by removing scaffolding:
 *
 * - **Dolce** (やさしく): widest judgement windows AND a moving
 *   playhead over the staff. For first-time readers who need both
 *   audio and visual anchors.
 * - **Espressivo** (表情豊かに): original Rhygym mode — tight
 *   judgement windows, no playhead, metronome always on. The
 *   standard sight-reading challenge.
 * - **Bravura** (技巧をもって): tight judgement windows, no
 *   playhead, AND the metronome falls silent once the song starts
 *   (count-in still plays). Forces the player to hold their own
 *   internal pulse — virtuoso-only territory.
 *
 * Best records are stored independently per difficulty, so a Dolce
 * practice run never overwrites an Espressivo grade.
 */
export type Difficulty = 'DOLCE' | 'ESPRESSIVO' | 'BRAVURA';

export const DEFAULT_DIFFICULTY: Difficulty = 'ESPRESSIVO';
export const ALL_DIFFICULTIES: readonly Difficulty[] = ['DOLCE', 'ESPRESSIVO', 'BRAVURA'];

/**
 * Endless-mode (#77) difficulty selector. Each tier picks the BPM the
 * run plays at (BPM never changes mid-run per
 * [[feedback_no_runtime_bpm_change]]); ramp/vocabulary curves are
 * shared across difficulties and don't shift with this choice.
 *
 * Names follow Italian tempo markings to match the rest of the
 * difficulty vocabulary (Dolce / Espressivo / Bravura on the single-
 * hand side), and BPM values sit inside the canonical ranges those
 * markings denote — see #77 spec table.
 */
export type EndlessDifficulty = 'andante' | 'moderato' | 'allegro' | 'presto';

export const ENDLESS_DIFFICULTY_BPM: Record<EndlessDifficulty, number> = {
  andante: 80,
  moderato: 108,
  allegro: 132,
  presto: 168,
};

export const ALL_ENDLESS_DIFFICULTIES: readonly EndlessDifficulty[] = [
  'andante',
  'moderato',
  'allegro',
  'presto',
];

export const DEFAULT_ENDLESS_DIFFICULTY: EndlessDifficulty = 'moderato';

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
 * Which hand a note belongs to in two-hand mode (#83). Undefined for
 * single-hand etudes — the original single-tap experience treats every
 * note as belonging to the only available tap zone.
 */
export type Lane = 'L' | 'R';

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
  /**
   * Two-hand mode lane assignment (#83). Required on every note when
   * the parent Etude has `twoHand: true`; ignored otherwise. The lane
   * decides which TapArea (left/right) and which staff (upper/lower)
   * the note belongs to.
   */
  lane?: Lane;
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
  /**
   * Two-hand mode etude (#83). When true, every note in `score.notes`
   * must carry a `lane: 'L' | 'R'` and the player taps on a split
   * left/right TapArea while reading a grand-staff (upper = right
   * hand, lower = left hand). Single-hand etudes leave this unset and
   * keep the original full-area tap behaviour.
   */
  twoHand?: boolean;
}
