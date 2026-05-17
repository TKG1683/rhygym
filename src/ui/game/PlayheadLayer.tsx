/**
 * Debug-only moving playhead. Overlays the staff with a red vertical
 * line whose x position is interpolated from the current audio tick
 * against the noteCoords map returned by ScoreRenderer.
 *
 * Not used by the production game flow — the real game intentionally
 * has no playhead (reading practice). This component exists so we can
 * see, while developing, whether judgement timing matches what the
 * staff says is happening.
 *
 * Behaviour:
 *  - Linearly interpolates x between consecutive non-rest notes on the
 *    same staff line.
 *  - When the playhead crosses from one wrapped line to the next, it
 *    snaps to the next line's first note's x (no interpolation across
 *    the line break — that would just visually slingshot back to the
 *    left edge).
 *  - After the last note, the line stops at the last note's x.
 */

import { useEffect, useRef } from 'react';
import type { Score } from '../../core/model';
import type { TickTimeConverter } from '../../core/timing/tickTime';
import type { NoteCoords } from '../vexflow/ScoreRenderer';

interface Props {
  score: Score;
  converter: TickTimeConverter;
  noteCoords: Map<string, NoteCoords>;
  /** Returns the current playback position in song seconds (NOT audio seconds). */
  getSongSec: () => number;
}

export function PlayheadLayer({ score, converter, noteCoords, getSongSec }: Props) {
  const lineRef = useRef<SVGLineElement>(null);

  useEffect(() => {
    let cancelled = false;
    const orderedNotes = score.notes
      .filter((n) => !n.isRest && noteCoords.has(n.id))
      .map((n) => {
        const coords = noteCoords.get(n.id)!;
        return { id: n.id, sec: converter.tickToSec(n.tick), coords };
      })
      .sort((a, b) => a.sec - b.sec);

    if (orderedNotes.length === 0) return;

    const tick = () => {
      if (cancelled) return;
      const lineEl = lineRef.current;
      if (lineEl) {
        const pos = computePlayheadPosition(getSongSec(), orderedNotes);
        if (pos) {
          lineEl.setAttribute('x1', String(pos.x));
          lineEl.setAttribute('x2', String(pos.x));
          lineEl.setAttribute('y1', String(pos.y - 30));
          lineEl.setAttribute('y2', String(pos.y + 30));
          lineEl.setAttribute('opacity', '1');
        } else {
          lineEl.setAttribute('opacity', '0');
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [score, converter, noteCoords, getSongSec]);

  return (
    <svg className="playhead-svg">
      <line
        ref={lineRef}
        x1="0"
        x2="0"
        y1="0"
        y2="0"
        stroke="#E8612E"
        strokeWidth="2"
        opacity="0"
      />
    </svg>
  );
}

interface OrderedNote {
  id: string;
  sec: number;
  coords: NoteCoords;
}

function computePlayheadPosition(
  songSec: number,
  notes: readonly OrderedNote[],
): { x: number; y: number } | null {
  if (notes.length === 0) return null;

  // Before the first note → park at the first note's position.
  if (songSec <= notes[0]!.sec) {
    return { x: notes[0]!.coords.x, y: notes[0]!.coords.y };
  }

  // Between (or past) notes — find the next not-yet-played note.
  for (let i = 1; i < notes.length; i++) {
    const next = notes[i]!;
    if (songSec < next.sec) {
      const prev = notes[i - 1]!;
      // If we'd interpolate across a line break, just snap to the next
      // line's note — the line wraps left and a slingshot looks wrong.
      if (prev.coords.lineIdx !== next.coords.lineIdx) {
        return { x: next.coords.x, y: next.coords.y };
      }
      const ratio = (songSec - prev.sec) / (next.sec - prev.sec);
      return {
        x: prev.coords.x + (next.coords.x - prev.coords.x) * ratio,
        y: prev.coords.y + (next.coords.y - prev.coords.y) * ratio,
      };
    }
  }

  // Past the last note.
  const last = notes[notes.length - 1]!;
  return { x: last.coords.x, y: last.coords.y };
}
