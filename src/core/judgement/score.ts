import type { Judgement } from './timing';

export type Rank = 'S' | 'A' | 'B' | 'C' | 'D';

/** Accuracy thresholds for each rank. First match wins. */
const RANK_THRESHOLDS: ReadonlyArray<{ rank: Rank; min: number }> = [
  { rank: 'S', min: 0.95 },
  { rank: 'A', min: 0.85 },
  { rank: 'B', min: 0.7 },
  { rank: 'C', min: 0.5 },
  { rank: 'D', min: 0 },
];

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

export function computeResult(judgements: readonly Judgement[]): GameResult {
  let perfect = 0;
  let good = 0;
  let miss = 0;
  for (const j of judgements) {
    if (j === 'PERFECT') perfect++;
    else if (j === 'GOOD') good++;
    else miss++;
  }
  const total = judgements.length;
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

export function rankForAccuracy(accuracy: number): Rank {
  for (const t of RANK_THRESHOLDS) {
    if (accuracy >= t.min) return t.rank;
  }
  // Unreachable: 'D' has min=0 and accuracy is clamped to [0, 1].
  return 'D';
}
