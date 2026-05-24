import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAudioContext } from '../../core/audio/audioContext';
import {
  collectBeats,
  isAccentBeat,
  scheduleClick,
  tsKey,
} from '../../core/audio/metronome';
import { PPQ } from '../../core/model';
import { expandToCandidates } from '../../core/score/candidates';
import { ETUDES, type EtudeWithMovementMeta } from '../../core/score/etudes';
import { markLessonCompleted } from '../../core/storage/localStore';
import { TickTimeConverter } from '../../core/timing/tickTime';
import { useAppStore } from '../store/appStore';
import { ScoreView } from '../vexflow/ScoreView';
import type { MeasureBounds, NoteCoords } from '../vexflow/ScoreRenderer';

/**
 * Lead before the first audible click so playback never starts in the
 * past (the AudioContext clock keeps running between scheduling and
 * the first event). 150ms is comfortably above the worst-case scheduling
 * jitter without feeling like a perceivable delay.
 */
const PLAYBACK_LEAD_SEC = 0.15;

/**
 * Duration of the per-note visual highlight during preview playback.
 * Matches the assist-mode flash so the same CSS animation can be
 * reused without theming a second variant.
 */
const PREVIEW_FLASH_MS = 200;

/**
 * Lower volume for the metronome during preview playback. The note
 * clicks are the thing the player needs to hear (= "what to tap");
 * the metronome is the underlying grid context, intentionally pushed
 * back so the rhythm comes forward.
 */
const PREVIEW_METRONOME_VOLUME = 0.35;

/**
 * Dedicated "note click" — a distinctly-different timbre from the
 * metronome (lower pitch, longer decay, sine wave) so the player can
 * tell at a glance which clicks are the BEAT (metronome) vs which are
 * the NOTES they need to tap. Without this differentiation, note
 * onsets that coincide with beats get masked by the metronome and
 * sound like "metronome only" — which is exactly the bug the user hit
 * in the first take of this feature.
 */
/**
 * Empirical nudge added to `staffMidY` so the playhead bar's vertical
 * center actually overlaps the rendered notehead (= the "ball" the
 * cursor is meant to chase). VexFlow's `getYForLine(2)` returns the
 * middle staff line's coordinate, but rasterised noteheads at b/4
 * sit a couple of pixels below that line in practice — so the bar
 * looks "slightly above" the notes without this fudge.
 */
const PLAYHEAD_VERTICAL_NUDGE_PX = 8;

interface TickPoint {
  tick: number;
  x: number;
  y: number;
}

interface RowPoints {
  lineIdx: number;
  rowStartTick: number;
  /** Exclusive — the tick that starts the next row (or songEnd). */
  rowEndTick: number;
  /**
   * Per-note anchor points (tick → formatted x) for THIS row plus a
   * trailing virtual point at `rowEndTick` mapped to the row's
   * staveRightX. Sorted by tick. Linear interp between consecutive
   * entries gives a cursor that hits every notehead exactly when its
   * onset fires — equivalent to mimic-groove's `tickPoints` approach.
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
function buildRowPoints(
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
  // freezing on it (the prior bug for half-note row endings).
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
    // tickPoint of its own — covers the case where the first note
    // sits a few ticks into the measure (uncommon for lessons, but
    // defensive). Falls back to the first note's x.
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
 * fires (mimic-groove's approach). Past the score end, parks on the
 * last row's right edge.
 *
 * Returns null only when no rows have been built yet.
 */
function findPlayheadPos(
  tick: number,
  rows: readonly RowPoints[],
): { x: number; y: number } | null {
  if (rows.length === 0) return null;
  // Walk forward to the row containing `tick`. Rows are sorted; the
  // last row whose start <= tick wins. Linear is fine — lessons have
  // ≤5 rows.
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

function scheduleNoteClick(ctx: AudioContext, audioTime: number): OscillatorNode {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.value = 880; // A5 — clearly below the 1.6 kHz metronome
  const peakGain = 0.55;
  const duration = 0.09;
  gain.gain.setValueAtTime(0, audioTime);
  gain.gain.linearRampToValueAtTime(peakGain, audioTime + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.001, audioTime + duration);
  osc.start(audioTime);
  osc.stop(audioTime + duration);
  return osc;
}

/**
 * Per-Movement explanation of the new rhythmic element. Authored as
 * data so the screen stays a thin renderer; if a Movement isn't in
 * the map (shouldn't happen) the screen falls back to a generic
 * "新しいリズムに慣れよう" intro so the flow never dead-ends.
 */
interface LessonElement {
  /**
   * Display glyph. Either a Unicode music character / short text
   * label (string) or a custom JSX element — used for the symbols
   * (single sixteenth, beamed four-sixteenths) whose SMuFL Unicode
   * codepoints render with stem/head gaps in the system serif font
   * available on Windows.
   */
  glyph: React.ReactNode;
  /** Element name in Japanese. */
  name: string;
  /** Beginner-friendly explanation. */
  description: string;
}

/**
 * Hand-drawn SVG of a single sixteenth note (notehead + stem + two
 * flags). Stand-in for the Unicode `𝅘𝅥𝅯` codepoint which falls back
 * to component glyphs on systems without a SMuFL-capable serif font,
 * producing a visible gap between the head and the stem.
 *
 * Height tracks the surrounding font-size via `1em` so the symbol
 * scales with the responsive lesson-intro glyph rule. `currentColor`
 * inherits the text color so the SVG matches the rest of the page.
 */
function SixteenthNoteGlyph() {
  return (
    <svg
      viewBox="0 0 22 44"
      style={{ height: '1em', verticalAlign: 'middle' }}
      role="img"
      aria-label="16 分音符"
    >
      {/* Notehead — filled, tilted ellipse so it reads as a single
        * piece even at small sizes. */}
      <ellipse cx="6" cy="36" rx="5" ry="3.6" fill="currentColor" transform="rotate(-20 6 36)" />
      {/* Stem — strokeWidth picked so it visually aligns with the
        * notehead's right edge at the SVG's intended size. */}
      <line x1="10.5" y1="34" x2="10.5" y2="10" stroke="currentColor" strokeWidth="1.4" />
      {/* Two flags — short curved hooks indicating sixteenth speed. */}
      <path d="M10.5 10 Q19 13 19.5 19 Q15 15 10.5 18 Z" fill="currentColor" />
      <path d="M10.5 17 Q19 20 19.5 26 Q15 22 10.5 25 Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Three eighth notes beamed together with a "3" centred above the
 * beam — the canonical triplet visual. Used for Movement 7's lesson
 * intro because `♪♪♪³` (three unbeamed eighths + a tiny superscript
 * three) reads as "three flagged notes that happen to have a small
 * number near them", which is the OPPOSITE of how a real triplet
 * is notated.
 */
function EighthTripletGlyph() {
  const xs = [3, 18, 33];
  const beamY = 14;
  return (
    <svg
      viewBox="0 0 50 44"
      style={{ height: '1em', verticalAlign: 'middle' }}
      role="img"
      aria-label="8 分 3 連符"
    >
      {/* "3" indicator centred above the beam — italic serif to read
        * as the conventional triplet numeral. */}
      <text
        x={(xs[0]! + xs[xs.length - 1]!) / 2 + 4}
        y="10"
        textAnchor="middle"
        fontSize="9"
        fontStyle="italic"
        fontFamily="serif"
        fill="currentColor"
      >
        3
      </text>
      {xs.map((x) => (
        <g key={x}>
          <ellipse
            cx={x}
            cy="36"
            rx="4.5"
            ry="3.2"
            fill="currentColor"
            transform={`rotate(-20 ${x} 36)`}
          />
          <line
            x1={x + 4}
            y1="34.2"
            x2={x + 4}
            y2={beamY}
            stroke="currentColor"
            strokeWidth="1.3"
          />
        </g>
      ))}
      {/* Single beam — eighth-note thickness, no parallel beam below
        * (that would make it a sixteenth grouping). */}
      <rect
        x={xs[0]! + 3.4}
        y={beamY - 0.5}
        width={xs[xs.length - 1]! - xs[0]! + 1.2}
        height={3.2}
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Six sixteenth-rate notes beamed together with a "6" centred above
 * — the sextuplet (6 連符) visual. Used for Movement 7's lesson
 * because the etudes in this Movement start emitting sextuplets (and
 * Movement 10-3 brings them back) but nothing in the prior lessons
 * told the player what the "6" / "6:4" bracket means.
 */
function SextupletGlyph() {
  const xs = [3, 14, 25, 36, 47, 58];
  const beamTop = 14;
  const beamGap = 6;
  return (
    <svg
      viewBox="0 0 68 44"
      style={{ height: '1em', verticalAlign: 'middle' }}
      role="img"
      aria-label="6 連符"
    >
      <text
        x={(xs[0]! + xs[xs.length - 1]!) / 2 + 4}
        y="10"
        textAnchor="middle"
        fontSize="9"
        fontStyle="italic"
        fontFamily="serif"
        fill="currentColor"
      >
        6
      </text>
      {xs.map((x) => (
        <g key={x}>
          <ellipse
            cx={x}
            cy="36"
            rx="3.8"
            ry="2.8"
            fill="currentColor"
            transform={`rotate(-20 ${x} 36)`}
          />
          <line
            x1={x + 3.5}
            y1="34.5"
            x2={x + 3.5}
            y2={beamTop}
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </g>
      ))}
      {/* Two beams (sixteenth-rate notation). Sextuplets are six
        * sixteenth-equivalents in the time of four — sharing the
        * sixteenth-note beam thickness keeps the inline glyph
        * visually consistent with the score's actual rendering. */}
      <rect
        x={xs[0]! + 3}
        y={beamTop - 0.5}
        width={xs[xs.length - 1]! - xs[0]! + 1.2}
        height={2.6}
        fill="currentColor"
      />
      <rect
        x={xs[0]! + 3}
        y={beamTop + beamGap - 0.5}
        width={xs[xs.length - 1]! - xs[0]! + 1.2}
        height={2.6}
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Four sixteenth notes beamed together (two parallel beams across
 * the stem tops). Used for the "4 つ並ぶとビーム 2 本" element on
 * Movement 5's lesson intro — the canonical visual for "this is a
 * beat's worth of sixteenths".
 */
function BeamedSixteenthsGlyph() {
  const xs = [3, 18, 33, 48];
  const beamTop = 10;
  const beamGap = 6;
  return (
    <svg
      viewBox="0 0 62 44"
      style={{ height: '1em', verticalAlign: 'middle' }}
      role="img"
      aria-label="16 分 4 連"
    >
      {xs.map((x) => (
        <g key={x}>
          <ellipse
            cx={x}
            cy="36"
            rx="4.5"
            ry="3.2"
            fill="currentColor"
            transform={`rotate(-20 ${x} 36)`}
          />
          <line
            x1={x + 4}
            y1="34.2"
            x2={x + 4}
            y2={beamTop}
            stroke="currentColor"
            strokeWidth="1.3"
          />
        </g>
      ))}
      {/* Two beams (sixteenth-note thickness). The 3.2 px height
        * mirrors VexFlow's default sixteenth beam thickness so the
        * inline glyph reads as the same notation the lesson actually
        * uses on its score. */}
      <rect
        x={xs[0]! + 3.4}
        y={beamTop - 0.5}
        width={xs[xs.length - 1]! - xs[0]! + 1.2}
        height={3.2}
        fill="currentColor"
      />
      <rect
        x={xs[0]! + 3.4}
        y={beamTop + beamGap - 0.5}
        width={xs[xs.length - 1]! - xs[0]! + 1.2}
        height={3.2}
        fill="currentColor"
      />
    </svg>
  );
}

interface LessonContent {
  /** Big heading on the screen, e.g. "音符の基本". */
  conceptTitle: string;
  /** Intro paragraph — sets the stage in 1-2 sentences. */
  intro: string;
  /** Per-element breakdown rendered as a list of cards. */
  elements: readonly LessonElement[];
  /** Optional closing hint shown right above the action buttons. */
  closingHint?: string;
}

/**
 * Per-Movement lesson content. Keep these tight — players who skip
 * the intro should miss nothing critical, and the beginners who read
 * it should walk away with a one-sentence mental model of the new
 * element. Detailed theory belongs in external docs, not here.
 */
const LESSON_CONTENT: Record<number, LessonContent> = {
  1: {
    conceptTitle: '音符の基本 3 種',
    intro: 'メトロノームのカチカチに合わせてタップする最初のレッスン。まずは長さの違う 3 種類の音符に慣れよう。',
    elements: [
      { glyph: '♩', name: '4 分音符', description: '1 拍ぶんの長さ。メトロノーム 1 回ぶん、 一番基本の音符。' },
      { glyph: '𝅗𝅥', name: '2 分音符', description: '4 分音符の 2 倍 = 2 拍ぶん。タップしてから次のメトロノーム 1 回ぶん伸ばす。' },
      { glyph: '𝅝', name: '全音符', description: '4 分音符の 4 倍 = 4 拍ぶん。1 小節まるごとを 1 つのタップでカバー。' },
    ],
    closingHint: '長さは見た目で覚える。 真ん中が塗りつぶしで棒あり = 4 分、 中が白で棒あり = 2 分、 中が白で棒なし = 全音符。',
  },
  2: {
    conceptTitle: '4 分休符 — 音を出さない時間',
    intro: 'リズムは音を出すタイミングだけじゃなく、 「出さないタイミング」もある。 今回は最初の休符を覚えよう。',
    elements: [
      { glyph: '𝄽', name: '4 分休符', description: '4 分音符と同じ長さの「音を出さない 1 拍」。 タップせずに 1 拍数える。' },
      { glyph: '♩', name: '4 分音符 (復習)', description: '休符の前後で出てくる。 音を出すタイミングは変わらない。' },
    ],
    closingHint: '休符の間もメトロノームは鳴ってる。 心の中で「ウン」と数えてから次のタップへ。',
  },
  3: {
    conceptTitle: '8 分音符 — 「タタ」 の細かい刻み',
    intro: '4 分音符より速い音符。 1 拍を 2 つに割ったぶんの長さ。 連続するときは旗を横線でつなぐ。',
    elements: [
      { glyph: '♪', name: '8 分音符 (単体)', description: '4 分音符の半分 = 0.5 拍。 旗 (フラッグ) が 1 本付く。' },
      { glyph: '♫', name: '8 分音符 (連結)', description: '2 つ並ぶと旗が横線 (ビーム) になる。 「タタ」 と素早く 2 回タップ。' },
    ],
    closingHint: 'メトロノーム 1 回の間に 2 回タップ。 最初のタップは拍頭 (「タ」)、 2 回目は裏拍 (「カ」) と呼ばれる。',
  },
  4: {
    conceptTitle: '付点 4 分音符 — 1.5 拍ぶんの伸び',
    intro: '音符の右に小さな点が付くと、 元の長さの 1.5 倍になる。 4 分音符 + 8 分音符の長さと同じ。',
    elements: [
      { glyph: '♩.', name: '付点 4 分音符', description: '4 分音符 (1 拍) + 8 分音符 (0.5 拍) = 1.5 拍ぶん。 「タ ー ア」 と長めに伸ばす。' },
      { glyph: '♩.+♪', name: '付点 4 分 + 8 分の定番', description: '付点 4 分 (1.5 拍) のあとに 8 分 (0.5 拍) で合計ちょうど 2 拍。 4 分 2 つぶんと同じ長さだけど、 リズムにメリハリが出る組み合わせ。' },
    ],
    closingHint: '点 1 つ = 元の長さの半分を足す。 譜面で点を見落とすとリズムが半拍ずれるので注意。',
  },
  5: {
    conceptTitle: '16 分音符 — さらに細かい刻み',
    intro: '8 分音符をさらに半分にしたぶんの長さ。 1 拍の中に 4 つ入る。 速い細かいパッセージで登場。',
    elements: [
      { glyph: <SixteenthNoteGlyph />, name: '16 分音符 (単体)', description: '8 分音符の半分 = 0.25 拍。 旗が 2 本付く。' },
      { glyph: <BeamedSixteenthsGlyph />, name: '16 分 4 連 (連結)', description: '4 つ並ぶとビームが 2 本でつながる。 「タカタカ」 と素早く 4 回、 ちょうど 1 拍ぶん。' },
    ],
    closingHint: 'BPM が遅めでも 16 分は速く感じる。 まずはメトロノームをガイドにゆっくり練習。',
  },
  6: {
    conceptTitle: 'ヘミオラ — クロスリズム入門',
    intro: '4/4 拍子なのに 3 拍ぶんの「付点 4 分」が連続すると、 拍子に対して斜めに走るリズムが生まれる。 これがヘミオラ。',
    elements: [
      { glyph: '♩.', name: '付点 4 分の連続', description: '付点 4 分音符を 2 回続けると 3 拍ぶん。 残り 1 拍を 4 分音符で埋めると 4/4 の 1 小節 = 「3 + 3 + 2」。' },
      { glyph: '♩', name: '4 分音符 (拍頭の地面)', description: 'クロスリズムの中で拍子の感覚を保つ役。 これがあるからヘミオラが「ずれてる感じ」 として聞こえる。' },
    ],
    closingHint: 'メトロノームの拍と「タップの間隔」 がズレていく感覚を味わう曲。 ジャズやロックでよく出てくる技。',
  },
  7: {
    conceptTitle: '3 連符・6 連符 — 拍を 3 や 6 に等分する',
    intro: 'いつもは 1 拍 = 8 分音符 2 つ (タタ) や 16 分 4 つ (タカタカ)。 連符は 1 拍に 3 つ や 6 つを 均等に詰め込む特別な分割。',
    elements: [
      { glyph: <EighthTripletGlyph />, name: '8 分 3 連符', description: '1 拍を 3 等分。 ビームでつないだ 8 分音符 3 つの上に「3」が書かれる。 「タタタ」 と均等に 3 回タップ。' },
      { glyph: <SextupletGlyph />, name: '6 連符', description: '1 拍を 6 等分。 16 分よりさらに細かい刻み。 ビーム 2 本 + 上に「6」 (譜面によっては「6:4」)。 「タタタタタタ」 と素早く 6 回。' },
    ],
    closingHint: '連符は「いつもと違う個数を 1 拍に詰める」 発想。 メトロノームに合わせて「タタタ」 (3連) や「タタタタタタ」 (6連) と声に出すと掴みやすい。',
  },
  8: {
    conceptTitle: '5/8 拍子 — 変拍子に挑戦',
    intro: '今までの 4/4 や 3/4 と違って、 1 小節が 8 分音符 5 つぶん。 「2 + 3」 か 「3 + 2」 のグループで感じるのがコツ。',
    elements: [
      { glyph: '5/8', name: '5/8 拍子記号', description: '上の 5 = 1 小節に入る音符の数、 下の 8 = その音符の種類 (8 分音符)。 つまり 1 小節 = 8 分音符 5 つぶん。' },
      { glyph: '♩+♩.', name: '「2 + 3」 のグルーピング', description: '4 分音符 (8 分 2 つ) + 付点 4 分 (8 分 3 つ) = 8 分 5 つ。 これで 5/8 の 1 小節を 2 拍として感じる。' },
    ],
    closingHint: '変拍子は最初は数えづらい。 メトロノームと一緒に「いち・に、 いち・に・さん」 と声に出してみよう。',
  },
  9: {
    conceptTitle: '5/4 拍子 — 不規則な 5 拍',
    intro: '1 小節が 4 分音符 5 つぶん。 4/4 より 1 拍長い変拍子。 クラシック・ジャズ・現代曲でおなじみ。',
    elements: [
      { glyph: '5/4', name: '5/4 拍子記号', description: '1 小節 = 4 分音符 5 つ。 4/4 の親戚で、 拍の感覚は同じ ♩ = 1 拍。 ただし 1 小節がちょっと長い。' },
      { glyph: '𝅗𝅥+♩♩♩', name: '「2 + 3」 グルーピング', description: '2 分音符 (2 拍) + 4 分音符 3 つ (3 拍) = 5 拍。 Take Five (ジャズの名曲) もこのパターン。' },
    ],
    closingHint: '5 拍を 「2 + 3」 か 「3 + 2」 のかたまりで感じると数えやすい。 5 個並列で数えると迷子になる。',
  },
  10: {
    conceptTitle: '拍子切替 — 1 曲の中で拍子が変わる',
    intro: '今までは 1 曲を通して同じ拍子だった。 Movement 10 では小節の途中で拍子が変わる。 譜面の小節頭に新しい拍子記号が出てくる。',
    elements: [
      { glyph: '4/4→3/4', name: '拍子記号の切替', description: '小節の先頭に新しい拍子記号 (例: 3/4) が書かれていたら、 その小節から拍子が変わる合図。' },
      { glyph: '♩=♩', name: 'BPM は変わらない', description: '1 拍ぶんの長さは同じまま (Rhygym のルール)。 変わるのは「1 小節に入る拍数」 だけ。' },
    ],
    closingHint: '譜面を見るとき、 各小節の頭に拍子記号があるかどうかを必ずチェック。 見落とすと小節線がズレて読譜不能になる。',
  },
};

const FALLBACK_CONTENT: LessonContent = {
  conceptTitle: '新しいリズム',
  intro: 'この Movement で新しく登場するリズムを学ぶレッスン。 譜面を見ながら、 各音符の長さを確認してから演奏に進もう。',
  elements: [],
};

export function LessonIntroScreen() {
  const goto = useAppStore((s) => s.goto);
  const selectedEtudeId = useAppStore((s) => s.selectedEtudeId);
  const loadedEtudes = useAppStore((s) => s.loadedEtudes);
  const audioContext = useAppStore((s) => s.audioContext);
  const setAudioContext = useAppStore((s) => s.setAudioContext);
  const metronomeAccents = useAppStore((s) => s.metronomeAccents);
  const setSelectInitialMovement = useAppStore((s) => s.setSelectInitialMovement);

  // Prefer the network-loaded roster; fall back to bundled ETUDES so
  // a slow / failed manifest fetch doesn't break the intro flow.
  const roster: readonly EtudeWithMovementMeta[] = loadedEtudes ?? ETUDES;
  const lesson = useMemo(
    () => (selectedEtudeId ? roster.find((s) => s.id === selectedEtudeId) : null),
    [roster, selectedEtudeId],
  );

  // ----------------------------------------------------------------
  // Preview auto-play (#53 follow-up)
  // ----------------------------------------------------------------
  // Lets the player HEAR the lesson rhythm before tapping it themselves.
  // Schedules: (a) metronome ticks on every beat, (b) softer note clicks
  // on each note onset, (c) visual flashes on the rendered noteheads —
  // same `.assist-flash` style the GameView's assist mode uses.
  //
  // All audio nodes go through `scheduleClick` which returns the
  // OscillatorNode — we keep references so the stop button can cut them
  // mid-playback (otherwise scheduled clicks would continue firing for
  // the rest of the song after the player tried to stop).
  const [isPlaying, setIsPlaying] = useState(false);
  const noteElementsRef = useRef<Map<string, SVGElement>>(new Map());
  const scheduledOscRef = useRef<OscillatorNode[]>([]);
  const pendingTimeoutsRef = useRef<number[]>([]);

  // Playhead overlay (#53 follow-up). Tracks current play position by
  // reading AudioContext.currentTime in a requestAnimationFrame loop
  // and snapping a vertical bar across the rendered noteheads.
  const playheadRef = useRef<HTMLDivElement>(null);
  // Playback bookkeeping the rAF loop needs but that doesn't drive
  // React render. Stored in a ref so updates inside playPreview can be
  // picked up by the running animation frame without re-renders.
  const playbackInfoRef = useRef<{
    ctx: AudioContext;
    songStartTime: number;
    totalSec: number;
    converter: TickTimeConverter;
  } | null>(null);
  // Per-row tick→pixel anchor tables (the mimic-groove pattern).
  // Rebuilt whenever ScoreView re-renders and gives us a fresh pair
  // of noteCoords + measureBounds. The rAF loop reads from this ref
  // each frame to position the cursor.
  const rowPointsRef = useRef<readonly RowPoints[]>([]);
  // Latest noteCoords from ScoreView's onRender. Stored separately
  // because the rowPoints rebuild needs both noteCoords AND
  // measureBounds; ScoreView fires onRender first, then
  // onMeasureBounds — the latter triggers the actual rebuild using
  // whatever noteCoords were just cached.
  const lastNoteCoordsRef = useRef<ReadonlyMap<string, NoteCoords>>(new Map());

  const cleanupPlayback = useCallback(() => {
    // Cancel pending visual flashes BEFORE killing oscillators so the
    // setTimeout callbacks don't fire into an already-stopped audio
    // graph and leave a stuck-on .assist-flash class.
    for (const id of pendingTimeoutsRef.current) {
      window.clearTimeout(id);
    }
    pendingTimeoutsRef.current = [];
    for (const osc of scheduledOscRef.current) {
      try {
        osc.stop();
      } catch {
        // Oscillator already finished naturally — Web Audio throws
        // InvalidStateError if you stop() a stopped node.
      }
    }
    scheduledOscRef.current = [];
    for (const el of noteElementsRef.current.values()) {
      el.classList.remove('assist-flash');
    }
    // Drop the playback bookkeeping so the rAF loop sees a null info
    // and parks; the loop is also torn down by the isPlaying effect's
    // cleanup but this guards against a race where the loop polls
    // mid-cleanup.
    playbackInfoRef.current = null;
    if (playheadRef.current) {
      playheadRef.current.style.opacity = '0';
    }
  }, []);

  // Stop playback whenever the screen unmounts or the lesson changes —
  // otherwise navigating away mid-preview would leave the audio graph
  // playing into the background and visual flashes orphaned.
  useEffect(() => {
    return () => cleanupPlayback();
  }, [cleanupPlayback]);

  const stopPreview = useCallback(() => {
    cleanupPlayback();
    setIsPlaying(false);
  }, [cleanupPlayback]);

  const playPreview = useCallback(() => {
    if (!lesson) return;
    if (isPlaying) {
      stopPreview();
      return;
    }
    // Lazy AudioContext init — the player might land on lesson-intro
    // before Title's はじめる had a chance to create one (page reload
    // mid-flow). Tap is a real user gesture so the context's autoplay
    // policy will accept it.
    let ctx = audioContext;
    if (!ctx) {
      ctx = createAudioContext();
      setAudioContext(ctx);
    }
    // Resume in case the context was suspended (Safari sometimes does
    // this on tab switch). resume() is a no-op if already running.
    void ctx.resume();

    cleanupPlayback();
    setIsPlaying(true);

    // The scheduling block below pushes oscillators / timeouts as it
    // goes; refs get assigned BEFORE the doneId timer so that an
    // exception thrown mid-loop (e.g. AudioContext suddenly closed)
    // still leaves the stop button able to cancel what was set up so
    // far. A try/finally also guarantees the safety done-timer fires
    // so the button can't get permanently stuck in "停止" mode.
    const converter = new TickTimeConverter(lesson.score.tempos);
    const startTime = ctx.currentTime + PLAYBACK_LEAD_SEC;
    const oscs: OscillatorNode[] = [];
    const timeouts: number[] = [];
    scheduledOscRef.current = oscs;
    pendingTimeoutsRef.current = timeouts;

    // ----- 1 measure count-in -----
    // Schedule a full measure of metronome ticks BEFORE the song
    // starts so the player can feel the pulse before the rhythm hits.
    // Mirrors the in-game count-in. Accent pattern comes from the
    // SAME source as the live game (isAccentBeat + accent overrides)
    // so what they hear here matches what they'll hear playing.
    const ts0 = lesson.score.timeSigs[0];
    let songStartTime = startTime;
    if (ts0) {
      const beatTicks = (PPQ * 4) / ts0.denominator;
      const measureTicks = beatTicks * ts0.numerator;
      // tickToSec(measureTicks) is the duration of the first measure
      // at the score's tempo — i.e., exactly one bar's worth of audio.
      const measureSec = converter.tickToSec(measureTicks);
      const accentOverride = metronomeAccents[tsKey(ts0.numerator, ts0.denominator)];
      for (let i = 0; i < ts0.numerator; i++) {
        const beatTime = startTime + (i / ts0.numerator) * measureSec;
        const isAccent = isAccentBeat(
          ts0.numerator,
          ts0.denominator,
          i,
          accentOverride,
        );
        oscs.push(scheduleClick(ctx, beatTime, isAccent, PREVIEW_METRONOME_VOLUME));
      }
      songStartTime = startTime + measureSec;
    }

    const totalSec = converter.tickToSec(lesson.score.totalTicks);
    // Bookkeeping ref for the playhead rAF loop. Set BEFORE any
    // failure path so the loop can rely on a valid info if it polls
    // mid-setup. Cleared in cleanupPlayback.
    playbackInfoRef.current = { ctx, songStartTime, totalSec, converter };

    // Belt-and-braces auto-reset: even if every scheduled audio event
    // fails to fire, this timer flips the button back so the UI never
    // ends up stuck. Anchored to songStartTime so the count-in time
    // is included in the total wait.
    const safetyDelayMs =
      Math.max(0, (songStartTime - ctx.currentTime) * 1000 + totalSec * 1000 + 500);
    const safetyId = window.setTimeout(() => {
      cleanupPlayback();
      setIsPlaying(false);
    }, safetyDelayMs);
    timeouts.push(safetyId);

    try {
      // 1) Song-side metronome clicks — accent on downbeats, soft on the
      //    rest. Honors the player's accent overrides so the click
      //    pattern in the preview matches what they'll hear during
      //    actual play. Pushed back in the mix (PREVIEW_METRONOME_VOLUME)
      //    so the note clicks below sit on top.
      const beats = collectBeats(
        lesson.score.timeSigs,
        0,
        lesson.score.totalTicks,
        metronomeAccents,
      );
      for (const beat of beats) {
        const t = songStartTime + converter.tickToSec(beat.tick);
        oscs.push(scheduleClick(ctx, t, beat.isDownbeat, PREVIEW_METRONOME_VOLUME));
      }

      // 2) Note clicks + visual flash. The note click is a dedicated
      //    timbre (see scheduleNoteClick) so it doesn't get masked by
      //    the metronome on beats that happen to coincide with notes.
      const candidates = expandToCandidates(lesson.score.notes, converter);
      for (const c of candidates) {
        const targetAudioTime = songStartTime + c.sec;
        oscs.push(scheduleNoteClick(ctx, targetAudioTime));

        // Tremolo sub-onsets (`${id}-trem-N`) don't have their own SVG
        // element — flash the base notehead for each sub-onset instead.
        const baseId = c.id.includes('-trem-') ? c.id.split('-trem-')[0]! : c.id;
        const delayMs = Math.max(0, (targetAudioTime - ctx.currentTime) * 1000);
        const flashId = window.setTimeout(() => {
          const el = noteElementsRef.current.get(baseId);
          if (!el) return;
          el.classList.add('assist-flash');
          const rmId = window.setTimeout(() => {
            el.classList.remove('assist-flash');
          }, PREVIEW_FLASH_MS);
          pendingTimeoutsRef.current.push(rmId);
        }, delayMs);
        timeouts.push(flashId);
      }
    } catch (err) {
      // Scheduling failed mid-way — kill what we've already booked and
      // bounce the button back. The safety timer above would catch this
      // eventually too, but failing fast is much better UX.
      console.error('[LessonIntro] preview scheduling failed', err);
      cleanupPlayback();
      setIsPlaying(false);
    }
  }, [lesson, isPlaying, audioContext, setAudioContext, metronomeAccents, cleanupPlayback, stopPreview]);

  // ----------------------------------------------------------------
  // Playhead animation loop
  // ----------------------------------------------------------------
  // Runs only while `isPlaying`. Each frame: read AudioContext clock,
  // compute current song tick, look up screen position in the
  // pre-built tick→coords table, and move the overlay element. Pure
  // DOM mutation — no React state churn so the cursor stays smooth
  // even when the lesson score is long.
  useEffect(() => {
    if (!isPlaying) {
      if (playheadRef.current) {
        playheadRef.current.style.opacity = '0';
      }
      return;
    }
    let rafId: number | null = null;
    const tickFn = () => {
      const info = playbackInfoRef.current;
      const el = playheadRef.current;
      const rows = rowPointsRef.current;
      if (!info || !el || rows.length === 0) {
        rafId = requestAnimationFrame(tickFn);
        return;
      }
      const elapsed = info.ctx.currentTime - info.songStartTime;
      const songTick = elapsed < 0 ? 0 : info.converter.secToTick(elapsed);
      const pos = findPlayheadPos(songTick, rows);
      if (pos) {
        // Bar height 44 → centre offset 22 so the bar straddles the
        // middle line (pos.y) symmetrically.
        el.style.transform = `translate(${pos.x - 1.5}px, ${pos.y - 22}px)`;
        // Half-opacity during the count-in so the cursor is visible
        // but visually distinct from "actually playing the score".
        el.style.opacity = elapsed < 0 ? '0.35' : '0.85';
      }
      // Keep animating past totalSec so the cursor reaches the very
      // end of the staff; the safety timer in playPreview handles
      // the final isPlaying=false flip ~500 ms later.
      rafId = requestAnimationFrame(tickFn);
    };
    rafId = requestAnimationFrame(tickFn);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isPlaying]);

  // ScoreView fires onRender → onNoteElements → onMeasureBounds on
  // every render. We cache noteCoords first, then rebuild the
  // per-row tick→x tables in handleMeasureBounds so both inputs are
  // guaranteed to be the latest snapshot.
  const handleNoteCoords = useCallback((coords: Map<string, NoteCoords>) => {
    lastNoteCoordsRef.current = coords;
  }, []);
  const handleMeasureBounds = useCallback(
    (bounds: readonly MeasureBounds[]) => {
      if (!lesson) {
        rowPointsRef.current = [];
        return;
      }
      rowPointsRef.current = buildRowPoints(bounds, lastNoteCoordsRef.current);
    },
    [lesson],
  );

  // Defensive: a stray nav (deep-link, history pop) into lesson-intro
  // without a selected lesson Etude shouldn't blank the screen.
  if (!lesson || !lesson.isLesson) {
    return (
      <main className="screen screen-lesson-intro">
        <h1>レッスン</h1>
        <p className="muted">レッスンが見つかりませんでした。</p>
        <button className="primary" onClick={() => goto('select')}>
          Movement 一覧へ
        </button>
      </main>
    );
  }

  const content = LESSON_CONTENT[lesson.movement] ?? FALLBACK_CONTENT;

  const startLesson = () => {
    // Don't mark completed yet — completion fires when the player
    // reaches the Result screen for this lesson play (ResultScreen
    // has the markLessonCompleted hook already wired up).
    goto('game');
  };

  const skipLesson = () => {
    // Skipping the intro is a deliberate "I get it, let me go play
    // graded etudes" — stamp the lesson as completed so the next
    // visit to this Movement skips the auto-prompt and drops the
    // player straight into the etude list.
    markLessonCompleted(lesson.id);
    // Tell MovementSelect to open THIS Movement's etude list on
    // mount instead of the top-level Movement grid. Without this
    // the user lands on the Movement list and has to re-enter the
    // Movement they were already inside.
    setSelectInitialMovement(lesson.movement);
    goto('select');
  };

  return (
    <main className="screen screen-lesson-intro">
      <header className="lesson-intro-header" style={{ borderColor: lesson.themeColor }}>
        <span className="lesson-intro-tag">📖 レッスン</span>
        <h1 className="lesson-intro-movement-name">Movement {lesson.movement}</h1>
      </header>

      <section className="lesson-intro-concept">
        <h2 className="lesson-intro-concept-title">{content.conceptTitle}</h2>
        <p className="lesson-intro-body">{content.intro}</p>
      </section>

      {content.elements.length > 0 && (
        <section className="lesson-intro-elements">
          {content.elements.map((el) => (
            <div key={el.name} className="lesson-intro-element">
              <div className="lesson-intro-element-glyph" aria-hidden="true">
                {el.glyph}
              </div>
              <div className="lesson-intro-element-text">
                <div className="lesson-intro-element-name">{el.name}</div>
                <div className="lesson-intro-element-desc">{el.description}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="lesson-intro-demo">
        <div className="lesson-intro-demo-head">
          <h3 className="lesson-intro-demo-title">この譜面を演奏します</h3>
          {/* Preview auto-play — listen to the rhythm before tapping
           *  it. The button doubles as stop while playing so the
           *  player can bail without waiting for the song to end. */}
          <button
            type="button"
            className="secondary lesson-intro-preview-btn"
            onClick={playPreview}
            aria-pressed={isPlaying}
          >
            {isPlaying ? '⏹ 停止' : '▶ お手本を聴く'}
          </button>
        </div>
        <div className="lesson-intro-demo-frame">
          {/* position:relative so the absolute-positioned playhead
            * overlay below shares the score's coordinate origin. */}
          <div className="lesson-intro-staff-wrap">
            <ScoreView
              score={lesson.score}
              measuresPerLine={2}
              onRender={handleNoteCoords}
              onMeasureBounds={handleMeasureBounds}
              onNoteElements={(els) => {
                noteElementsRef.current = els;
              }}
            />
            {/* Absolutely-positioned playhead. Its translate is
              * driven imperatively from the rAF loop so we never
              * touch React state mid-animation. */}
            <div ref={playheadRef} className="lesson-playhead" aria-hidden="true" />
          </div>
        </div>
        <p className="lesson-intro-demo-meta">
          {lesson.score.timeSigs[0]?.numerator ?? 4}/{lesson.score.timeSigs[0]?.denominator ?? 4} 拍子・BPM {lesson.bpm}
          {isPlaying ? ' ・▶ 再生中' : ''}
        </p>
      </section>

      {content.closingHint && (
        <p className="lesson-intro-hint">💡 {content.closingHint}</p>
      )}

      <div className="lesson-intro-actions">
        <button className="primary lesson-intro-start" onClick={startLesson}>
          レッスンを始める →
        </button>
        <button className="secondary lesson-intro-skip" onClick={skipLesson}>
          スキップして Etude 一覧へ
        </button>
      </div>
    </main>
  );
}
