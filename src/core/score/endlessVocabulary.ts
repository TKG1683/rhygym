/**
 * Tier-gated rhythm vocabulary for the endless mode generator (#77).
 *
 * Each "fragment" is a self-contained rhythm cell that sums to a known
 * tick count (typically one beat or two beats). The generator strings
 * fragments together to fill a measure. A fragment's `tier` is the
 * earliest tier at which it may appear — higher-tier fragments stay
 * locked until the run's ramp opens them up, so the run starts gentle
 * (only quarter notes, half notes, whole notes) and gradually unlocks
 * eighths, dotted notes, sixteenths, triplets as distance grows.
 *
 * Phase A keeps the vocabulary small and one-beat-aligned — covers
 * the rhythmic ground from Movement 1–7 and is enough to generate
 * "5 minutes of music that escalates". Heavier vocabulary (variable
 * meter cells, ties, complex syncopation) lands later.
 */

import {
  EIGHTH_NOTE_TICKS,
  EIGHTH_TRIPLET_NOTE_TICKS,
  HALF_NOTE_TICKS,
  QUARTER_NOTE_TICKS,
  SIXTEENTH_NOTE_TICKS,
  WHOLE_NOTE_TICKS,
  DOTTED_QUARTER_NOTE_TICKS,
  DOTTED_EIGHTH_NOTE_TICKS,
} from '../model/constants';

/**
 * One rhythm-cell entry: a list of durations to lay out left to right.
 * `isRest` tells the renderer / judge whether the tick belongs to a
 * tappable onset (false) or a rest (true). Cell sum = `totalTicks`.
 */
export interface RhythmFragment {
  /** Stable id used by tests + (eventual) telemetry. */
  id: string;
  /** Minimum tier at which the generator may select this fragment. */
  tier: number;
  /** Total tick length — generator uses this to decide whether the fragment fits the remaining bar room. */
  totalTicks: number;
  /** Sampling weight relative to other fragments at or below the current tier. */
  weight: number;
  /** Sequence of "atoms" — each is one drawn rhythm token (note or rest). */
  atoms: ReadonlyArray<{ durationTicks: number; isRest: boolean }>;
}

const beat = QUARTER_NOTE_TICKS;
const twoBeats = HALF_NOTE_TICKS;
const fourBeats = WHOLE_NOTE_TICKS;

/**
 * Master fragment list. The endless ramp filters this set down by
 * the current tier before sampling. Tiers roughly mirror the
 * single-hand Movement curriculum:
 *
 *   Tier 1: q, h, w + leading qr (basic note values)
 *   Tier 2: eighth pair, dotted-quarter + eighth (syncopation kernel)
 *   Tier 3: sixteenth quad, eighth + two sixteenths
 *   Tier 4: triplets, dotted-eighth + sixteenth
 *
 * Weights bias toward "simple, beat-aligned" so the texture feels
 * musical rather than maximally random.
 */
export const ALL_FRAGMENTS: readonly RhythmFragment[] = [
  // ---- Tier 1 ----
  {
    id: 'q',
    tier: 1,
    totalTicks: beat,
    weight: 6,
    atoms: [{ durationTicks: beat, isRest: false }],
  },
  {
    id: 'qr',
    tier: 1,
    totalTicks: beat,
    weight: 1,
    atoms: [{ durationTicks: beat, isRest: true }],
  },
  {
    id: 'h',
    tier: 1,
    totalTicks: twoBeats,
    weight: 3,
    atoms: [{ durationTicks: twoBeats, isRest: false }],
  },
  {
    id: 'w',
    tier: 1,
    totalTicks: fourBeats,
    weight: 1,
    atoms: [{ durationTicks: fourBeats, isRest: false }],
  },
  // ---- Tier 2 ----
  {
    id: '8-8',
    tier: 2,
    totalTicks: beat,
    weight: 4,
    atoms: [
      { durationTicks: EIGHTH_NOTE_TICKS, isRest: false },
      { durationTicks: EIGHTH_NOTE_TICKS, isRest: false },
    ],
  },
  {
    id: 'q.-8',
    tier: 2,
    totalTicks: twoBeats,
    weight: 2,
    atoms: [
      { durationTicks: DOTTED_QUARTER_NOTE_TICKS, isRest: false },
      { durationTicks: EIGHTH_NOTE_TICKS, isRest: false },
    ],
  },
  {
    id: '8-q-8',
    tier: 2,
    totalTicks: twoBeats,
    weight: 1,
    atoms: [
      { durationTicks: EIGHTH_NOTE_TICKS, isRest: false },
      { durationTicks: beat, isRest: false },
      { durationTicks: EIGHTH_NOTE_TICKS, isRest: false },
    ],
  },
  // ---- Tier 3 ----
  {
    id: '16-16-16-16',
    tier: 3,
    totalTicks: beat,
    weight: 2,
    atoms: [
      { durationTicks: SIXTEENTH_NOTE_TICKS, isRest: false },
      { durationTicks: SIXTEENTH_NOTE_TICKS, isRest: false },
      { durationTicks: SIXTEENTH_NOTE_TICKS, isRest: false },
      { durationTicks: SIXTEENTH_NOTE_TICKS, isRest: false },
    ],
  },
  {
    id: '8-16-16',
    tier: 3,
    totalTicks: beat,
    weight: 2,
    atoms: [
      { durationTicks: EIGHTH_NOTE_TICKS, isRest: false },
      { durationTicks: SIXTEENTH_NOTE_TICKS, isRest: false },
      { durationTicks: SIXTEENTH_NOTE_TICKS, isRest: false },
    ],
  },
  {
    id: '16-16-8',
    tier: 3,
    totalTicks: beat,
    weight: 2,
    atoms: [
      { durationTicks: SIXTEENTH_NOTE_TICKS, isRest: false },
      { durationTicks: SIXTEENTH_NOTE_TICKS, isRest: false },
      { durationTicks: EIGHTH_NOTE_TICKS, isRest: false },
    ],
  },
  {
    id: '8.-16',
    tier: 3,
    totalTicks: beat,
    weight: 1,
    atoms: [
      { durationTicks: DOTTED_EIGHTH_NOTE_TICKS, isRest: false },
      { durationTicks: SIXTEENTH_NOTE_TICKS, isRest: false },
    ],
  },
  // ---- Tier 4 ----
  {
    id: 'triplet-8',
    tier: 4,
    totalTicks: beat,
    weight: 1,
    atoms: [
      { durationTicks: EIGHTH_TRIPLET_NOTE_TICKS, isRest: false },
      { durationTicks: EIGHTH_TRIPLET_NOTE_TICKS, isRest: false },
      { durationTicks: EIGHTH_TRIPLET_NOTE_TICKS, isRest: false },
    ],
  },
];

/**
 * Earliest tier at which a fragment list contains anything that fits
 * a given beat-aligned slot of `remainingTicks`. Used by the
 * generator's fragment picker so we don't accidentally try to pack a
 * 4-beat whole-note into a 1-beat tail.
 */
export function fragmentsAvailableForTier(
  tier: number,
  remainingTicks: number,
): RhythmFragment[] {
  return ALL_FRAGMENTS.filter(
    (f) => f.tier <= tier && f.totalTicks <= remainingTicks,
  );
}
