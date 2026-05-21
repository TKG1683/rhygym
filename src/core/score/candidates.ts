/**
 * RhythmNote → NoteCandidate expansion for the judgement pipeline.
 *
 * Plain notes map 1:1 (id + onset sec). Tremolo notes (#82) expand
 * into 2^strokes equal-subdivision onsets across the note's duration,
 * so a `tremolo(q(), 2)` (quarter w/ 2 slashes) requires four
 * sixteenth-rate taps instead of one quarter-onset tap.
 *
 * The first expanded candidate keeps the source note's id so the
 * existing noteCoords map (rendered notehead → on-screen position)
 * still resolves; subsequent candidates get derived `${id}-trem-N`
 * ids that are unique but don't try to claim the same notehead.
 */

import type { RhythmNote } from '../model';
import type { TickTimeConverter } from '../timing/tickTime';
import type { NoteCandidate } from '../judgement';

export function expandToCandidates(
  notes: readonly RhythmNote[],
  converter: TickTimeConverter,
): NoteCandidate[] {
  const out: NoteCandidate[] = [];
  for (const n of notes) {
    if (n.isRest) continue;
    const strokes = n.tremoloStrokes ?? 0;
    if (strokes > 0) {
      const count = 1 << strokes; // 2^strokes
      const stepTicks = n.durationTicks / count;
      for (let i = 0; i < count; i++) {
        const tick = n.tick + i * stepTicks;
        out.push({
          id: i === 0 ? n.id : `${n.id}-trem-${i}`,
          sec: converter.tickToSec(tick),
        });
      }
    } else {
      out.push({ id: n.id, sec: converter.tickToSec(n.tick) });
    }
  }
  return out;
}
