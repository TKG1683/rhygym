/**
 * Final-gated Movement unlock progression (#31, revised twice).
 *
 * The unlock state is *derived* from the best-score store + a small
 * skip-test marker set rather than persisted as its own unlock store
 * — keeps things hard to desync.
 *
 * Rules:
 *
 *  1. Movement 1's etudes are always playable.
 *  2. Within a playable Movement, its FINAL stage unlocks once the
 *     player clears `FINAL_UNLOCK_THRESHOLD` (= 3) of its non-Final
 *     etudes at rank A or S. Etudes themselves remain freely
 *     playable from the moment the Movement opens.
 *  3. Clearing M's Final at rank B+ via the NORMAL path (etude list,
 *     post 3-etude unlock) opens Movement M+1's etudes. Skip-test
 *     records don't count — see (4).
 *  4. The locked-card 飛び級試験 sub-button lets a player attempt
 *     M's Final cold. Earning S there:
 *       - Opens M's ETUDES (not its Final and not M+1).
 *       - Marks every locked Movement between the previous
 *         max-unlock and M as "auto-cleared" — Final included in
 *         finalsUnlocked so the player can replay them at will,
 *         and they don't have to grind through them to advance.
 *       - To unlock M+1, the player still has to grind M's etudes
 *         (3 A+) AND clear M's Final normally (B+). The skip-test
 *         S itself doesn't satisfy the gate; only a NORMAL-mode
 *         Final clear (tracked via `skipTestFinals` set) does.
 *     Rank A or lower on a skip-test does nothing — the player
 *     retries or works through earlier Movements the long way.
 *  5. Legacy backward-compat: 3 etudes A+ in M implies the player
 *     reached M at some point — lift maxUnlocked to M so old save
 *     data isn't stranded after rule changes. (M+1 still gated by
 *     rule 3.)
 *
 * Unlocks are CONTIGUOUS: `maxMovementUnlocked = N` means M1..MN
 * etudes are all available.
 *
 * Returns a ProgressionState bundling per-Movement etude + Final
 * unlock state so callers don't have to query the two rules
 * separately.
 */

import type { Rank } from '../judgement';
import type { BestRecord } from '../storage/localStore';

const ETUDE_CLEAR_RANKS: ReadonlySet<Rank> = new Set(['S', 'A']);
// Pass threshold for treating a Final as "cleared" in the normal
// (non-skip-test) flow. Matches the game's general PASS_RANK_THRESHOLD.
const FINAL_CLEAR_RANKS: ReadonlySet<Rank> = new Set(['S', 'A', 'B']);

/**
 * How many non-Final etudes the player must clear at rank A or S to
 * unlock the Final within that Movement. 3-of-5 leaves room for the
 * player to defer the two hardest etudes without it gating the
 * Final.
 */
export const FINAL_UNLOCK_THRESHOLD = 3;
/**
 * Legacy export for any consumer that imported the old name.
 * Behaviour unchanged — the 3-etude clear is still the same gate,
 * it's just no longer the gate for the *next Movement* (that's the
 * Final's job now). The Final unlock keeps the same numeric rule.
 */
export const NORMAL_CLEAR_THRESHOLD = FINAL_UNLOCK_THRESHOLD;

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

export interface ProgressionState {
  /** Highest Movement number whose etudes are playable. */
  maxMovementUnlocked: number;
  /** Movement numbers whose Final is also playable from the etude list. */
  finalsUnlocked: ReadonlySet<number>;
}

export interface ProgressionOptions {
  /**
   * Final stage IDs whose CURRENT best record is from a skip-test
   * (rank S via locked-card sub-button) that has NOT been superseded
   * by a normal-mode B+ clear. Used to gate the "Final B+ → M+1
   * unlocks" rule: a Final in this set won't unlock M+1 even though
   * its rank is S, because the player hasn't proven competence at
   * the Movement's etude grind yet.
   */
  skipTestFinals?: ReadonlySet<string>;
}

function countClearedEtudes(
  stages: readonly { id: string; isFinal?: boolean }[],
  bests: Record<string, BestRecord>,
): number {
  let count = 0;
  for (const s of stages) {
    if (s.isFinal) continue;
    const rank = bests[s.id]?.rank;
    if (rank !== undefined && ETUDE_CLEAR_RANKS.has(rank)) count++;
  }
  return count;
}

/** Convenience predicate for a single Movement's Final unlock status. */
export function isFinalUnlocked(
  movement: MovementForProgression,
  bests: Record<string, BestRecord>,
): boolean {
  return countClearedEtudes(movement.stages, bests) >= FINAL_UNLOCK_THRESHOLD;
}

/**
 * Compute the highest playable Movement + the set of Movements whose
 * Final is also unlocked. M1 is the floor; the cap is the largest
 * Movement in `movements` so chained skip-tests can't return a
 * Movement number that doesn't exist.
 *
 * Processing order matters — earlier Movements' Finals unlock later
 * ones in the normal flow, so we walk low → high. Skip-tests are
 * handled by checking each Movement's Final rank regardless of
 * whether the Movement was reachable yet (a locked Movement's S
 * Final counts as a skip-test pass).
 */
export function evaluateProgression(
  bests: Record<string, BestRecord>,
  movements: readonly MovementForProgression[],
  options: ProgressionOptions = {},
): ProgressionState {
  const skipTestFinals = options.skipTestFinals ?? EMPTY_SET;
  if (movements.length === 0) {
    return { maxMovementUnlocked: 1, finalsUnlocked: new Set() };
  }
  const sorted = [...movements].sort((a, b) => a.movement - b.movement);
  const highestMovement = sorted[sorted.length - 1]!.movement;
  let maxUnlocked = 1;
  const finalsUnlocked = new Set<number>();

  for (const m of sorted) {
    const final = m.stages.find((s) => s.isFinal);
    const finalRank = final ? bests[final.id]?.rank : undefined;
    const finalViaSkipTestOnly = final ? skipTestFinals.has(final.id) : false;
    const threeEtudesCleared = isFinalUnlocked(m, bests);

    // Legacy/backward-compat (rule 5): 3 etudes A+ in M ⇒ player
    // reached M to play them. Lift maxUnlocked to M.
    if (threeEtudesCleared) {
      maxUnlocked = Math.max(maxUnlocked, m.movement);
    }

    // Final unlock within this Movement (rule 2): M itself reachable
    // AND 3+ etudes A+.
    if (m.movement <= maxUnlocked && threeEtudesCleared) {
      finalsUnlocked.add(m.movement);
    }

    if (finalRank === undefined) continue;
    if (m.movement <= maxUnlocked) {
      // Normal flow (rule 3): Final B+ opens M+1, but ONLY if the
      // rank wasn't earned via skip-test (would otherwise let a
      // skip-test S short-circuit the etude grind).
      if (FINAL_CLEAR_RANKS.has(finalRank) && !finalViaSkipTestOnly) {
        maxUnlocked = Math.max(maxUnlocked, m.movement + 1);
      }
    } else {
      // Skip-test path (rule 4): M unreachable. S on Final unlocks
      // M's etudes only (NOT M's Final, NOT M+1), and marks every
      // intermediate locked Movement as auto-cleared so the player
      // doesn't have to grind back through them.
      if (finalRank === 'S') {
        const previousMax = maxUnlocked;
        maxUnlocked = Math.max(maxUnlocked, m.movement);
        for (let i = previousMax + 1; i < m.movement; i++) {
          finalsUnlocked.add(i);
        }
        // M itself's Final stays out of finalsUnlocked — player
        // must clear 3 M etudes to expose it, then beat it normally
        // to unlock M+1.
      }
    }
  }

  return {
    maxMovementUnlocked: Math.min(maxUnlocked, highestMovement),
    finalsUnlocked,
  };
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Back-compat wrapper for callers that only need the etude-unlock
 * ceiling. Prefer `evaluateProgression` when you also need the
 * per-Movement Final state.
 */
export function evaluateMaxUnlocked(
  bests: Record<string, BestRecord>,
  movements: readonly MovementForProgression[],
  options?: ProgressionOptions,
): number {
  return evaluateProgression(bests, movements, options).maxMovementUnlocked;
}

/** Convenience: a movement is unlocked iff its number ≤ maxUnlocked. */
export function isMovementUnlocked(movement: number, maxUnlocked: number): boolean {
  return movement <= maxUnlocked;
}
