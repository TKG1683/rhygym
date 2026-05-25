/**
 * Lane-filtering helpers for two-hand mode (#83).
 *
 * Two-hand etudes carry a `lane: 'L' | 'R'` on every note. The render
 * pipeline ─ ScoreView / scoreToVex ─ is built around a single-voice
 * Score, so we project the original Score onto a per-lane sub-Score
 * before handing it to the renderer (one sub-Score per staff in the
 * grand staff). Same trick lets the judgement pipeline filter
 * candidates by hand without scoreToVex needing to know about lanes
 * at all.
 *
 * Notes without a lane are passed through to every lane on the
 * assumption that the caller is asking for a two-hand projection of
 * a single-hand etude (debug / fallback). Two-hand etudes authored
 * properly will have lane set on every note so this branch never
 * fires in practice.
 */

import type { Lane, Score } from '../model';

export function filterScoreByLane(score: Score, lane: Lane): Score {
  return {
    ...score,
    notes: score.notes.filter((n) => n.lane === undefined || n.lane === lane),
  };
}
