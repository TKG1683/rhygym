/**
 * Persistent best-score store backed by window.localStorage.
 *
 * Schema lives behind a versioned key (`rhygym:best:v1`) so future
 * format changes can bump v2 without trashing v1 data. All accessors
 * are defensive: a missing / corrupted / disabled localStorage just
 * looks like "no records yet" to the caller, not an exception.
 */

import type { Rank } from '../judgement/score';

const STORAGE_KEY = 'rhygym:best:v1';

export interface BestRecord {
  stageId: string;
  score: number;
  rank: Rank;
  /** ISO timestamp of when this score was set. */
  achievedAt: string;
}

export function getAllBests(): Record<string, BestRecord> {
  try {
    const raw = readStorage();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, BestRecord>;
    }
    return {};
  } catch {
    return {};
  }
}

export function getBest(stageId: string): BestRecord | null {
  return getAllBests()[stageId] ?? null;
}

/**
 * Write `record` as the new best for its stage. Caller decides "best" —
 * this is unconditional. Failure to write (storage disabled / quota
 * exceeded) is swallowed so a play in private browsing still works.
 */
export function setBest(record: BestRecord): void {
  try {
    const all = getAllBests();
    all[record.stageId] = record;
    writeStorage(JSON.stringify(all));
  } catch {
    // localStorage unavailable — accept silently; in-memory result is
    // unaffected, the player just won't see the new BEST next time.
  }
}

/**
 * Returns true if `candidate.score` would beat the existing best for
 * the stage (or there is no existing best). Lets callers decide whether
 * to write + flash a "NEW BEST!" badge.
 */
export function isNewBest(candidate: { stageId: string; score: number }): boolean {
  const existing = getBest(candidate.stageId);
  if (!existing) return true;
  return candidate.score > existing.score;
}

function readStorage(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY);
}

function writeStorage(value: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, value);
}
