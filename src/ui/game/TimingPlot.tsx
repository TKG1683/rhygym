/**
 * TimingPlot — a time-axis dot plot of how the player's taps landed
 * relative to each target note. Sits below the Result-screen staff
 * (which uses VexFlow's measure-based even spacing) and provides the
 * timing layer the staff can't: the dot's horizontal position is
 * derived from real seconds, so the same ±50ms drift always renders
 * at the same visual distance no matter where in the piece it occurs.
 *
 * Marker semantics:
 *   - Filled dot       : a successful hit (color = verdict tier)
 *   - × on the 0 line  : auto-MISS — note was never tapped
 *
 * Stray taps don't have a target note, so they aren't plotted here.
 * The caller surfaces them as a "余計に N 回タップ" counter alongside.
 */

import type { JudgementRecord } from '../../core/judgement';

interface Props {
  records: readonly JudgementRecord[];
  /** Same pixel width the companion ScoreView is rendered at. */
  width: number;
  /**
   * Total song duration in seconds. Used to map each record's
   * `noteSec` to a horizontal pixel position so timing distances on
   * the plot are perceptually consistent (1 second of music = N
   * pixels everywhere). When `totalSec <= 0` the plot still renders
   * the frame/axes but skips data points.
   */
  totalSec: number;
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

export const LABEL_AREA_X = 40;
/**
 * Right-edge breathing room — without this, a tap at exactly t=totalSec
 * would land flush against the frame and visually disappear under it.
 */
export const RIGHT_EDGE_PAD = 8;

/**
 * Map a note-onset time (seconds) to a horizontal pixel position
 * inside the plot frame. Time is clamped to [0, totalSec] so a
 * stray-but-attributed record can't render outside the frame. When
 * the song has no duration (totalSec <= 0) or the frame is collapsed
 * (innerW <= 0) every note falls back to the left edge — the plot
 * still renders its axes but data dots stack at x=xLeft, which is
 * the same defensive behavior the screen wrapper guards against
 * (it only mounts TimingPlot once totalScoreSec > 0).
 */
export function timeToX(sec: number, totalSec: number, width: number): number {
  const xLeft = LABEL_AREA_X;
  const xRight = Math.max(xLeft, width - RIGHT_EDGE_PAD);
  const innerW = Math.max(0, xRight - xLeft);
  if (totalSec <= 0 || innerW <= 0) return xLeft;
  const t = Math.max(0, Math.min(totalSec, sec));
  return xLeft + (t / totalSec) * innerW;
}

export function TimingPlot({ records, width, totalSec }: Props) {
  const innerH = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const yOfMs = (ms: number) =>
    PADDING_TOP + ((Y_RANGE_MS - ms) / (2 * Y_RANGE_MS)) * innerH;
  const yTop = PADDING_TOP;
  const yBottom = PADDING_TOP + innerH;
  // Inner plot area starts after the left-side label gutter so the
  // axis numbers don't crash into the first note's column.
  const xLeft = LABEL_AREA_X;
  const xRight = Math.max(xLeft, width - RIGHT_EDGE_PAD);
  const innerW = Math.max(0, xRight - xLeft);

  const xOfSec = (sec: number): number => timeToX(sec, totalSec, width);

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

      {/* Data points — x derived from each note's onset time. */}
      {records.map((r, i) => renderRecord(r, i, xOfSec, yOfMs))}
    </svg>
  );
}

function renderRecord(
  r: JudgementRecord,
  i: number,
  xOfSec: (sec: number) => number,
  yOfMs: (ms: number) => number,
): JSX.Element | null {
  // Hits and auto-MISSes both target a note; stray taps don't.
  if (!r.noteId || r.noteSec === null) return null;
  const x = xOfSec(r.noteSec);

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
        {/* Target marker on the 0 line — the "perfect" position for
         *  this note. The filled dot below sits at the player's actual
         *  tap; the gap between this ring and that dot IS the error. */}
        <circle cx={x} cy={yOfMs(0)} r={3.5} fill="#fffaef" stroke="#2A1B06" strokeWidth="1.2" />
        <circle cx={x} cy={yOfMs(clamped)} r={4} fill={color} />
      </g>
    );
  }
  // Auto-MISS — × on the 0 line at the note's x. The × itself sits at
  // the target, so no extra target marker is needed.
  const y = yOfMs(0);
  return (
    <g key={`miss-${i}`} stroke={COLOR_MISS} strokeWidth="1.8">
      <line x1={x - 5} y1={y - 5} x2={x + 5} y2={y + 5} />
      <line x1={x - 5} y1={y + 5} x2={x + 5} y2={y - 5} />
    </g>
  );
}
