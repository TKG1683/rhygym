import type { Judgement } from './timing';

export type Rank = 'S' | 'A' | 'B' | 'C' | 'D';

/**
 * Per-tap audit trail used by Result-screen feedback (timing plot,
 * accuracy stats, eventual replay). One record is appended for every
 * judgement event the game emits — successful hits, stray taps, and
 * auto-MISS expirations.
 *
 * Field semantics by record source:
 * - successful hit:  noteId set, noteSec set, tapSec set, diffSec set
 * - stray tap:       noteId null, noteSec null, tapSec set, diffSec null
 * - auto-MISS:       noteId set, noteSec set, tapSec null, diffSec null
 */
export interface JudgementRecord {
  noteId: string | null;
  noteSec: number | null;
  tapSec: number | null;
  /** tap − noteSec in seconds. Positive = late tap. Null for stray / auto-MISS. */
  diffSec: number | null;
  judgement: Judgement;
}

/** Accuracy thresholds for each rank. First match wins. */
const RANK_THRESHOLDS: ReadonlyArray<{ rank: Rank; min: number }> = [
  { rank: 'S', min: 0.95 },
  { rank: 'A', min: 0.85 },
  { rank: 'B', min: 0.7 },
  { rank: 'C', min: 0.5 },
  { rank: 'D', min: 0 },
];

/**
 * Rank at which a stage is considered "passed" — the UI promotes the
 * "next stage" CTA above retry once the player clears this bar. Kept
 * separate from `CLEAR_RANKS` in StageSelect (which is also S/A) so
 * the two can diverge later without one silently breaking the other.
 */
export const PASS_RANK_THRESHOLD: Rank = 'A';

/**
 * Mean-signed-error magnitude (ms) above which we suggest the player
 * (re-)calibrate. Tuned around the calibration screen's own MAX_TAP_
 * DEVIATION_SEC: well within the bounds of "real drift, not noise",
 * but small enough to catch a Bluetooth-headset switch.
 */
export const CALIBRATION_SUGGEST_THRESHOLD_MS = 30;

const PERFECT_WEIGHT = 1.0;
const GOOD_WEIGHT = 0.5;
const MAX_SCORE = 10000;

export interface GameResult {
  perfect: number;
  good: number;
  miss: number;
  total: number;
  /** PERFECT=1, GOOD=0.5, MISS=0 → averaged. Range [0, 1]. */
  accuracy: number;
  /** Round-number score: accuracy × 10000. Integer 0..10000. */
  score: number;
  rank: Rank;
}

export function computeResult(records: readonly JudgementRecord[]): GameResult {
  let perfect = 0;
  let good = 0;
  let miss = 0;
  for (const r of records) {
    if (r.judgement === 'PERFECT') perfect++;
    else if (r.judgement === 'GOOD') good++;
    else miss++;
  }
  const total = records.length;
  const accuracy =
    total === 0 ? 0 : (perfect * PERFECT_WEIGHT + good * GOOD_WEIGHT) / total;
  return {
    perfect,
    good,
    miss,
    total,
    accuracy,
    score: Math.round(accuracy * MAX_SCORE),
    rank: rankForAccuracy(accuracy),
  };
}

export interface TimingStats {
  /** Mean of all (tapSec - noteSec) values, in ms. Positive = consistently late. */
  meanDiffMs: number;
  /** Standard deviation across hits, in ms. Smaller = more consistent. */
  stdDiffMs: number;
  /** Number of records that actually carry a diff (i.e. real hits, not stray/auto-MISS). */
  hitCount: number;
}

/**
 * Summary statistics over the diffSec values in the audit trail. Only
 * records with a non-null diffSec contribute — stray taps and auto-
 * MISSes are excluded since they aren't paired with a target note.
 *
 * Tells the player two things at a glance:
 *  - meanDiffMs: whether they consistently rush (negative) or drag (positive)
 *  - stdDiffMs: how tight their timing is, irrespective of bias
 */
export function computeTimingStats(records: readonly JudgementRecord[]): TimingStats {
  const diffsMs: number[] = [];
  for (const r of records) {
    if (r.diffSec !== null) diffsMs.push(r.diffSec * 1000);
  }
  const n = diffsMs.length;
  if (n === 0) return { meanDiffMs: 0, stdDiffMs: 0, hitCount: 0 };
  const mean = diffsMs.reduce((a, b) => a + b, 0) / n;
  const variance = diffsMs.reduce((s, d) => s + (d - mean) ** 2, 0) / n;
  return { meanDiffMs: mean, stdDiffMs: Math.sqrt(variance), hitCount: n };
}

export function rankForAccuracy(accuracy: number): Rank {
  for (const t of RANK_THRESHOLDS) {
    if (accuracy >= t.min) return t.rank;
  }
  // Unreachable: 'D' has min=0 and accuracy is clamped to [0, 1].
  return 'D';
}
