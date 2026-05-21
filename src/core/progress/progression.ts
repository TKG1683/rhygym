/**
 * Duolingo-style Movement unlock progression (#31).
 *
 * The unlock state is *derived* from the best-score store rather than
 * persisted separately — that keeps storage trivial (no migration
 * needed when rules change) and makes it impossible for the unlock
 * state to drift out of sync with the actual scores backing it.
 *
 * Rules (per issue #31):
 *
 *  1. Movement 1 is always unlocked.
 *  2. Clearing `NORMAL_CLEAR_THRESHOLD` (= 3) etudes of Movement N at
 *     rank A or S unlocks Movement N+1.
 *  3. Earning rank S on Movement N's Final stage (the skip-test) is
 *     "飛び級" — it unlocks Movement N+2 in one shot.
 *
 * Unlocks are CONTIGUOUS: if a skip-test on M3 pops the player up to
 * M5, M4 is unlocked too (`maxUnlocked = 5` means M1..M5 are all
 * available). This avoids the awkward "M5 is open but M4 isn't"
 * gap that would otherwise leave the player no path to revisit
 * intermediate levels.
 *
 * The skip-test path is always evaluated, even on a movement whose
 * Final wouldn't normally be reachable yet — that's the whole point
 * of 飛び級. The UI exposes a "飛び級試験" sub-button on locked cards
 * so a player can attempt the Final cold to skip ahead.
 */

import type { Rank } from '../judgement';
import type { BestRecord } from '../storage/localStore';

const CLEAR_RANKS: ReadonlySet<Rank> = new Set(['S', 'A']);

/**
 * How many non-Final etudes need to be cleared at A+ in a movement
 * before the next movement unlocks via normal progression.
 *
 * 3-of-5 matches the issue spec ("10級-1, 10級-2, 10級-3 を全部 A 以上
 * → 9級解放") — players can leave the hardest 2 etudes for later
 * polish without it gating their forward progress.
 */
export const NORMAL_CLEAR_THRESHOLD = 3;

/**
 * Minimal shape this module needs from a Movement. Defined inline
 * (rather than imported from `etudes.ts`) so the progression module
 * stays decoupled from the full Etude record — easy to unit-test
 * with fixtures.
 */
export interface MovementForProgression {
  movement: number;
  stages: readonly { id: string; isFinal?: boolean }[];
}

/**
 * Compute the highest movement number the player has currently
 * unlocked. M1 is the floor; the cap is the largest movement in
 * `movements` so a "max=12" overshoot from chained skip-tests at the
 * top of the curriculum can't return a movement that doesn't exist.
 */
export function evaluateMaxUnlocked(
  bests: Record<string, BestRecord>,
  movements: readonly MovementForProgression[],
): number {
  if (movements.length === 0) return 1;
  // Sort so each iteration sees a stable ordering — the unlock max
  // for one movement can be promoted by an earlier movement's S, so
  // processing low → high keeps the chain sensible.
  const sorted = [...movements].sort((a, b) => a.movement - b.movement);
  let maxUnlocked = 1;

  for (const m of sorted) {
    // Skip-test always counts, even when M itself is "locked" — the
    // player can attempt M's Final via the locked-card sub-button.
    const final = m.stages.find((s) => s.isFinal);
    if (final && bests[final.id]?.rank === 'S') {
      maxUnlocked = Math.max(maxUnlocked, m.movement + 2);
    }
    // Normal progression: 3+ non-Final etudes at A or S.
    const normalEtudes = m.stages.filter((s) => !s.isFinal);
    let clearedCount = 0;
    for (const s of normalEtudes) {
      const rank = bests[s.id]?.rank;
      if (rank !== undefined && CLEAR_RANKS.has(rank)) clearedCount++;
    }
    if (clearedCount >= NORMAL_CLEAR_THRESHOLD) {
      maxUnlocked = Math.max(maxUnlocked, m.movement + 1);
    }
  }

  const highestMovement = sorted[sorted.length - 1]!.movement;
  return Math.min(maxUnlocked, highestMovement);
}

/** Convenience: a movement is unlocked iff its number ≤ maxUnlocked. */
export function isMovementUnlocked(movement: number, maxUnlocked: number): boolean {
  return movement <= maxUnlocked;
}
