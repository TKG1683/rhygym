/**
 * Shared playhead positioning utilities (lesson preview + BEGINNER
 * mode in-game cursor). Implements the mimic-groove "tickPoints"
 * pattern: linear interpolation between consecutive (tick, x) anchor
 * points built from VexFlow's formatted notehead positions, with
 * synthesised row-end virtual points so the cursor walks all the way
 * to the right edge of each row instead of freezing on the last
 * notehead.
 *
 * Pure functions + types — no React, no DOM. The caller is
 * responsible for wiring an animation loop that reads the current
 * tick and applies the returned position to a DOM element.
 */

import type { MeasureBounds, NoteCoords } from '../vexflow/ScoreRenderer';

/**
 * Empirical nudge added to `staffMidY` so the playhead bar's vertical
 * center actually overlaps the rendered notehead (= the "ball" the
 * cursor is meant to chase). VexFlow's `getYForLine(2)` returns the
 * middle staff line's coordinate, but rasterised noteheads at b/4
 * sit a couple of pixels below that line in practice — without this
 * fudge the bar reads as "slightly above" the notes.
 */
export const PLAYHEAD_VERTICAL_NUDGE_PX = 8;

export interface TickPoint {
  tick: number;
  x: number;
  y: number;
}

export interface RowPoints {
  lineIdx: number;
  rowStartTick: number;
  /** Exclusive — the tick that starts the next row (or song end). */
  rowEndTick: number;
  /**
   * Per-note anchor points (tick → formatted x) for THIS row plus a
   * trailing virtual point at `rowEndTick` mapped to the row's
   * staveRightX. Sorted by tick. Linear interp between consecutive
   * entries gives a cursor that hits every notehead exactly when its
   * onset fires — the mimic-groove `tickPoints` approach.
   */
  pts: TickPoint[];
}

/**
 * Build per-row tick→pixel anchor tables from rendered note positions
 * and measure bounds. Linear interpolation between consecutive
 * tickPoints (mimic-groove pattern) keeps the playhead visually
 * locked to noteheads even in mixed-rhythm bars where VexFlow's
 * Formatter spaces notes non-uniformly.
 *
 * Iterates ALL noteCoords entries — sounding notes AND synthesised
 * rest entries — so rest-leading measures (e.g. `qr q q q`) get an
 * anchor at the rest's x. Without it the playhead would skip the
 * rest beat and jump to the first sounding note's x.
 */
export function buildRowPoints(
  bounds: readonly MeasureBounds[],
  noteCoords: ReadonlyMap<string, NoteCoords>,
): RowPoints[] {
  if (bounds.length === 0) return [];
  // Group every coord (note + rest) by its rendered row.
  const byRow = new Map<number, TickPoint[]>();
  for (const coord of noteCoords.values()) {
    const list = byRow.get(coord.lineIdx) ?? [];
    list.push({ tick: coord.tick, x: coord.x, y: 0 /* filled below */ });
    byRow.set(coord.lineIdx, list);
  }
  // For each row, attach the staffMidY (constant per row) + the
  // row-end virtual point at staveRightX so the cursor can slide
  // past the last note toward the bar's right edge instead of
  // freezing on it.
  const lastByRow = new Map<number, MeasureBounds>();
  const firstByRow = new Map<number, MeasureBounds>();
  for (const m of bounds) {
    const seenLast = lastByRow.get(m.lineIdx);
    if (!seenLast || m.measureIdx > seenLast.measureIdx) lastByRow.set(m.lineIdx, m);
    const seenFirst = firstByRow.get(m.lineIdx);
    if (!seenFirst || m.measureIdx < seenFirst.measureIdx) firstByRow.set(m.lineIdx, m);
  }
  const rows: RowPoints[] = [];
  for (const [lineIdx, firstMeasure] of firstByRow) {
    const lastMeasure = lastByRow.get(lineIdx)!;
    const staffMidY = firstMeasure.staffMidY + PLAYHEAD_VERTICAL_NUDGE_PX;
    const pts = byRow.get(lineIdx) ?? [];
    for (const p of pts) p.y = staffMidY;
    pts.sort((a, b) => a.tick - b.tick);
    const rowEndTick = lastMeasure.startTick + lastMeasure.ticks;
    // Anchor at row's first beat tick (= firstMeasure.startTick) for
    // the cursor's parked position before the first note has a
    // tickPoint of its own. Falls back to the first note's x.
    if (pts.length === 0 || pts[0]!.tick > firstMeasure.startTick) {
      const headX = pts[0]?.x ?? firstMeasure.firstNoteX ?? firstMeasure.noteStartX;
      pts.unshift({ tick: firstMeasure.startTick, x: headX, y: staffMidY });
    }
    // Trailing anchor at row's end mapped to the bar's right edge so
    // the cursor walks all the way to the visible end of the row.
    pts.push({ tick: rowEndTick, x: lastMeasure.staveRightX, y: staffMidY });
    rows.push({
      lineIdx,
      rowStartTick: firstMeasure.startTick,
      rowEndTick,
      pts,
    });
  }
  rows.sort((a, b) => a.rowStartTick - b.rowStartTick);
  return rows;
}

/**
 * Pixel position of the playhead at score tick `tick`. Finds the
 * active row, then linearly interpolates between the row's adjacent
 * tickPoints — so every notehead is hit at the exact tick its onset
 * fires. Past the score end, parks on the last row's right edge.
 *
 * Returns null only when no rows have been built yet.
 */
export function findPlayheadPos(
  tick: number,
  rows: readonly RowPoints[],
): { x: number; y: number } | null {
  if (rows.length === 0) return null;
  // Walk forward to the row containing `tick`. Rows are sorted; the
  // last row whose start <= tick wins. Linear is fine — lessons /
  // études fit in ≤5 rows on typical viewports.
  let row = rows[0]!;
  for (const r of rows) {
    if (r.rowStartTick <= tick) row = r;
    else break;
  }
  const pts = row.pts;
  if (pts.length === 0) return null;
  if (tick <= pts[0]!.tick) {
    const p = pts[0]!;
    return { x: p.x, y: p.y };
  }
  if (tick >= pts[pts.length - 1]!.tick) {
    const p = pts[pts.length - 1]!;
    return { x: p.x, y: p.y };
  }
  // Binary search for the bracketing pair.
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.tick <= tick) lo = mid;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[hi]!;
  const dur = b.tick - a.tick;
  if (dur <= 0) return { x: a.x, y: a.y };
  const t = (tick - a.tick) / dur;
  return { x: a.x + t * (b.x - a.x), y: a.y };
}
