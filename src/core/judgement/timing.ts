/**
 * Tap-vs-note timing judgement.
 *
 * Pure functions: the caller (game loop) is responsible for filtering
 * out rests and already-judged notes, and for feeding wall-clock seconds
 * derived from AudioContext.currentTime.
 */

export type Judgement = 'PERFECT' | 'GOOD' | 'MISS';

/** Half-width of the PERFECT window in seconds (±50 ms). */
export const PERFECT_WINDOW_SEC = 0.05;
/** Half-width of the GOOD window in seconds (±120 ms). Anything outside is MISS. */
export const GOOD_WINDOW_SEC = 0.12;

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
): JudgedTap | null {
  let best: { c: NoteCandidate; diff: number; abs: number } | null = null;
  for (const c of candidates) {
    const diff = tapSec - c.sec;
    const abs = Math.abs(diff);
    if (abs > GOOD_WINDOW_SEC) continue;
    if (!best || abs < best.abs) best = { c, diff, abs };
  }
  if (!best) return null;

  const judgement: Exclude<Judgement, 'MISS'> =
    best.abs <= PERFECT_WINDOW_SEC ? 'PERFECT' : 'GOOD';
  return {
    noteId: best.c.id,
    judgement,
    diffSec: best.diff,
  };
}

/**
 * Find candidates whose GOOD window has fully elapsed at audioSec — they
 * count as MISS. Called every animation frame so MISS verdicts show up
 * even if the player never tapped.
 */
export function findExpiredNotes(
  audioSec: number,
  candidates: readonly NoteCandidate[],
): NoteCandidate[] {
  return candidates.filter((c) => audioSec - c.sec > GOOD_WINDOW_SEC);
}
