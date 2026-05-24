/**
 * Tap-vs-note timing judgement.
 *
 * Pure functions: the caller (game loop) is responsible for filtering
 * out rests and already-judged notes, and for feeding wall-clock seconds
 * derived from AudioContext.currentTime.
 */

import type { Difficulty } from '../model/types';

export type Judgement = 'PERFECT' | 'GOOD' | 'MISS';

/** Half-width of the PERFECT window in seconds (±50 ms). NORMAL difficulty default. */
export const PERFECT_WINDOW_SEC = 0.05;
/** Half-width of the GOOD window in seconds (±120 ms). Anything outside is MISS. NORMAL default. */
export const GOOD_WINDOW_SEC = 0.12;

/**
 * Half-window pair (PERFECT / GOOD) in seconds. Passed to `judgeTap`
 * and `findExpiredNotes` so the same pipeline can serve BEGINNER and
 * NORMAL plays — BEGINNER widens both windows so first-time readers
 * who haven't built up rhythmic precision yet still land in PERFECT
 * / GOOD rather than racking up MISSes.
 */
export interface JudgementWindows {
  perfect: number;
  good: number;
}

/** NORMAL: original sight-reading windows (#7). Tighter, demands precision. */
export const NORMAL_WINDOWS: JudgementWindows = {
  perfect: 0.05,
  good: 0.12,
};

/** BEGINNER: ~40% wider so first-time players still land hits while learning. */
export const BEGINNER_WINDOWS: JudgementWindows = {
  perfect: 0.07,
  good: 0.18,
};

const WINDOWS_BY_DIFFICULTY: Record<Difficulty, JudgementWindows> = {
  NORMAL: NORMAL_WINDOWS,
  BEGINNER: BEGINNER_WINDOWS,
};

/** Lookup helper — callers (GameView) wire `appStore.difficulty` straight in. */
export function windowsForDifficulty(d: Difficulty): JudgementWindows {
  return WINDOWS_BY_DIFFICULTY[d];
}

export interface NoteCandidate {
  id: string;
  /** Note onset time in seconds (same clock as the tap time). */
  sec: number;
}

export interface JudgedTap {
  noteId: string;
  judgement: Exclude<Judgement, 'MISS'>;
  /** tap − note in seconds; negative means the tap was early. */
  diffSec: number;
}

/**
 * Match a tap against the candidate notes (already filtered to tappable,
 * not-yet-judged). Picks the candidate with the smallest |diff| that
 * falls inside the GOOD window, then assigns PERFECT or GOOD based on
 * how close it landed.
 *
 * Returns null when the tap is outside every candidate's GOOD window —
 * the caller can treat that as a stray tap (no effect / soft penalty
 * depending on game design; Rhygym v1 just ignores it).
 */
export function judgeTap(
  tapSec: number,
  candidates: readonly NoteCandidate[],
  windows: JudgementWindows = NORMAL_WINDOWS,
): JudgedTap | null {
  let best: { c: NoteCandidate; diff: number; abs: number } | null = null;
  for (const c of candidates) {
    const diff = tapSec - c.sec;
    const abs = Math.abs(diff);
    if (abs > windows.good) continue;
    if (!best || abs < best.abs) best = { c, diff, abs };
  }
  if (!best) return null;

  const judgement: Exclude<Judgement, 'MISS'> =
    best.abs <= windows.perfect ? 'PERFECT' : 'GOOD';
  return {
    noteId: best.c.id,
    judgement,
    diffSec: best.diff,
  };
}

/**
 * Find candidates whose GOOD window has fully elapsed at audioSec — they
 * count as MISS. Called every animation frame so MISS verdicts show up
 * even if the player never tapped. The GOOD window scales with the
 * difficulty just like `judgeTap` so a BEGINNER play doesn't MISS notes
 * earlier than its (wider) GOOD window would allow.
 */
export function findExpiredNotes(
  audioSec: number,
  candidates: readonly NoteCandidate[],
  windows: JudgementWindows = NORMAL_WINDOWS,
): NoteCandidate[] {
  return candidates.filter((c) => audioSec - c.sec > windows.good);
}
