/**
 * TimingPlot — paired with a ScoreView so every dot sits directly under
 * the notehead it belongs to. Without that alignment the user can read
 * "beat 5 was -50 ms" but can't tell *which* note that is.
 *
 * The parent should render a ScoreView with measuresPerLine matching
 * the score's full bar count (i.e. a single row) and feed its
 * noteCoords map plus its rendered width into this component. The plot
 * SVG then uses the same x coordinates as the staff.
 *
 * Marker semantics:
 *   - Filled dot       : a successful hit (color = verdict tier)
 *   - × on the 0 line  : auto-MISS — note was never tapped
 *
 * Stray taps don't have a target note, so they aren't plotted here.
 * The caller surfaces them as a "余計に N 回タップ" counter alongside.
 */

import type { JudgementRecord } from '../../core/judgement';
import type { NoteCoords } from '../vexflow/ScoreRenderer';

interface Props {
  records: readonly JudgementRecord[];
  noteCoords: Map<string, NoteCoords>;
  /** Same pixel width the companion ScoreView is rendered at. */
  width: number;
}

const HEIGHT = 200;
const PADDING_TOP = 22;
const PADDING_BOTTOM = 20;
const Y_RANGE_MS = 200;
const PERFECT_MS = 50;
const GOOD_MS = 120;

const COLOR_PERFECT = '#cba000';
const COLOR_GOOD = '#3a8dde';
const COLOR_MISS = '#E8612E';
const PERFECT_BG = 'rgba(120, 200, 120, 0.18)';
const GOOD_BG = 'rgba(255, 180, 90, 0.18)';
const MISS_BG = 'rgba(232, 97, 46, 0.18)';

const LABEL_AREA_X = 40;

export function TimingPlot({ records, noteCoords, width }: Props) {
  const innerH = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const yOfMs = (ms: number) =>
    PADDING_TOP + ((Y_RANGE_MS - ms) / (2 * Y_RANGE_MS)) * innerH;
  const yTop = PADDING_TOP;
  const yBottom = PADDING_TOP + innerH;
  // Inner plot area starts after the left-side label gutter so the
  // axis numbers don't crash into the first note's column.
  const xLeft = LABEL_AREA_X;
  const xRight = width;
  const innerW = Math.max(0, xRight - xLeft);

  return (
    <svg
      viewBox={`0 0 ${width} ${HEIGHT}`}
      className="timing-plot"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Zone backgrounds (bottom = late, top = early). */}
      <rect x={xLeft} y={yOfMs(Y_RANGE_MS)} width={innerW} height={yOfMs(GOOD_MS) - yOfMs(Y_RANGE_MS)} fill={MISS_BG} />
      <rect x={xLeft} y={yOfMs(GOOD_MS)} width={innerW} height={yOfMs(PERFECT_MS) - yOfMs(GOOD_MS)} fill={GOOD_BG} />
      <rect x={xLeft} y={yOfMs(PERFECT_MS)} width={innerW} height={yOfMs(-PERFECT_MS) - yOfMs(PERFECT_MS)} fill={PERFECT_BG} />
      <rect x={xLeft} y={yOfMs(-PERFECT_MS)} width={innerW} height={yOfMs(-GOOD_MS) - yOfMs(-PERFECT_MS)} fill={GOOD_BG} />
      <rect x={xLeft} y={yOfMs(-GOOD_MS)} width={innerW} height={yOfMs(-Y_RANGE_MS) - yOfMs(-GOOD_MS)} fill={MISS_BG} />

      {/* Frame */}
      <rect x={xLeft} y={yTop} width={innerW} height={innerH} fill="none" stroke="rgba(42,27,6,0.3)" />

      {/* 0 line (target) */}
      <line x1={xLeft} x2={xRight} y1={yOfMs(0)} y2={yOfMs(0)} stroke="#2A1B06" strokeWidth="1.5" />

      {/* Y-axis labels */}
      <text x={xLeft - 4} y={yOfMs(0) + 4} textAnchor="end" fontSize="10" fill="#2A1B06">0</text>
      <text x={xLeft - 4} y={yOfMs(PERFECT_MS) + 4} textAnchor="end" fontSize="9" fill="#2A1B06" opacity="0.7">+50</text>
      <text x={xLeft - 4} y={yOfMs(-PERFECT_MS) + 4} textAnchor="end" fontSize="9" fill="#2A1B06" opacity="0.7">−50</text>
      <text x={xLeft - 4} y={yOfMs(GOOD_MS) + 4} textAnchor="end" fontSize="9" fill="#2A1B06" opacity="0.5">+120</text>
      <text x={xLeft - 4} y={yOfMs(-GOOD_MS) + 4} textAnchor="end" fontSize="9" fill="#2A1B06" opacity="0.5">−120</text>
      <text x={xLeft - 6} y={yTop + 10} textAnchor="end" fontSize="9" fill="#2A1B06" opacity="0.6">早</text>
      <text x={xLeft - 6} y={yBottom + 8} textAnchor="end" fontSize="9" fill="#2A1B06" opacity="0.6">遅</text>

      {/* Data points — anchored to each note's x position from ScoreView. */}
      {records.map((r, i) => renderRecord(r, i, noteCoords, yOfMs))}
    </svg>
  );
}

function renderRecord(
  r: JudgementRecord,
  i: number,
  noteCoords: Map<string, NoteCoords>,
  yOfMs: (ms: number) => number,
): JSX.Element | null {
  // Hits and auto-MISSes both target a note; stray taps don't.
  if (!r.noteId) return null;
  const coords = noteCoords.get(r.noteId);
  if (!coords) return null;
  const x = coords.x;

  if (r.diffSec !== null) {
    // Real hit — plot the error.
    const diffMs = r.diffSec * 1000;
    const clamped = Math.max(-Y_RANGE_MS + 5, Math.min(Y_RANGE_MS - 5, diffMs));
    const color =
      r.judgement === 'PERFECT' ? COLOR_PERFECT :
      r.judgement === 'GOOD' ? COLOR_GOOD : COLOR_MISS;
    return (
      <g key={`hit-${i}`}>
        {/* Faint vertical line dropping from the 0 baseline to the
         *  dot makes it visually obvious which note it belongs to,
         *  even when several dots are crowded near the same y. */}
        <line
          x1={x}
          x2={x}
          y1={yOfMs(0)}
          y2={yOfMs(clamped)}
          stroke={color}
          strokeOpacity="0.4"
          strokeWidth="1"
        />
        <circle cx={x} cy={yOfMs(clamped)} r={4} fill={color} />
      </g>
    );
  }
  // Auto-MISS — × on the 0 line at the note's x.
  const y = yOfMs(0);
  return (
    <g key={`miss-${i}`} stroke={COLOR_MISS} strokeWidth="1.8">
      <line x1={x - 5} y1={y - 5} x2={x + 5} y2={y + 5} />
      <line x1={x - 5} y1={y + 5} x2={x + 5} y2={y - 5} />
    </g>
  );
}
