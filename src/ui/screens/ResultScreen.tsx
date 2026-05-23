import { useEffect, useMemo, useRef, useState } from 'react';
import { computeTimingStats } from '../../core/judgement';
import {
  CALIBRATION_SUGGEST_THRESHOLD_MS,
  PASS_RANK_THRESHOLD,
} from '../../core/judgement/score';
import { PPQ } from '../../core/model';
import { ETUDES, type EtudeWithMovementMeta } from '../../core/score/etudes';
import { getBest, isNewBest, setBest } from '../../core/storage/localStore';
import { TickTimeConverter } from '../../core/timing/tickTime';
import { TimingPlot } from '../game/TimingPlot';
import { ScoreView } from '../vexflow/ScoreView';
import { useAppStore } from '../store/appStore';

/** Rank ordering for "is this rank at least PASS_RANK_THRESHOLD?". */
const RANK_ORDER = ['D', 'C', 'B', 'A', 'S'] as const;

/**
 * Production URL for the share intent. Hard-coded rather than read
 * from `location.origin` so a share from a local dev session still
 * links to the live app — sharing "http://localhost:5173/rhygym/"
 * would be useless to whoever clicks the link.
 */
const SHARE_URL = 'https://tkg1683.github.io/rhygym/';
function rankAtLeast(rank: string, min: string): boolean {
  return RANK_ORDER.indexOf(rank as (typeof RANK_ORDER)[number]) >=
    RANK_ORDER.indexOf(min as (typeof RANK_ORDER)[number]);
}

/**
 * Pick the "next stage" relative to `current` from the loaded roster.
 *  1. Same level, indexInMovement + 1 (or — if neither carries an index —
 *     the next entry in the roster that shares the same level).
 *  2. Otherwise, the first stage of the next-higher level.
 *  3. Otherwise (current is the last stage of the highest level), null.
 *
 * Exam stages count as the end of their level, so "next" from an exam
 * is the next level's stage 1.
 */
function findNextEtude(
  roster: readonly EtudeWithMovementMeta[],
  current: EtudeWithMovementMeta,
): EtudeWithMovementMeta | null {
  if (current.isFinal) {
    return firstEtudeOfMovement(roster, current.movement + 1);
  }
  if (current.indexInMovement != null) {
    const sameLevelNext = roster.find(
      (s) => s.movement === current.movement && s.indexInMovement === current.indexInMovement! + 1,
    );
    if (sameLevelNext) return sameLevelNext;
  } else {
    // Roster doesn't carry per-stage indices (placeholder ETUDES): use
    // roster order within the level.
    const sameLevel = roster.filter((s) => s.movement === current.movement);
    const idx = sameLevel.findIndex((s) => s.id === current.id);
    if (idx >= 0 && idx + 1 < sameLevel.length) return sameLevel[idx + 1]!;
  }
  return firstEtudeOfMovement(roster, current.movement + 1);
}

function firstEtudeOfMovement(
  roster: readonly EtudeWithMovementMeta[],
  movement: number,
): EtudeWithMovementMeta | null {
  const inLevel = roster.filter((s) => s.movement === movement);
  if (inLevel.length === 0) return null;
  const withIndex = inLevel.find((s) => s.indexInMovement === 1);
  return withIndex ?? inLevel[0] ?? null;
}

export function ResultScreen() {
  const goto = useAppStore((s) => s.goto);
  const selectEtude = useAppStore((s) => s.selectEtude);
  const result = useAppStore((s) => s.lastResult);
  const stage = useAppStore((s) => s.lastEtude);
  const records = useAppStore((s) => s.lastRecords);
  const lastPlayedBpm = useAppStore((s) => s.lastPlayedBpm);
  const calibrationOffsetSec = useAppStore((s) => s.calibrationOffsetSec);
  const loadedEtudes = useAppStore((s) => s.loadedEtudes);
  const setCalibrationReturnScreen = useAppStore((s) => s.setCalibrationReturnScreen);
  const setSelectInitialMovement = useAppStore((s) => s.setSelectInitialMovement);
  const calibrated = calibrationOffsetSec !== 0;

  // Mark this screen as the return target so calibration can bring the
  // player back here (with their same result still on display) rather
  // than dropping them on Title.
  const goCalibration = () => {
    setCalibrationReturnScreen('result');
    goto('calibration');
  };

  // "ステージ選択へ" — drop the player back into the stage list for the
  // level they just played, not the top-level Level list. Looks up the
  // stage's level from the roster (network or fallback) and asks
  // StageSelect to open it on mount.
  const goEtudeSelect = () => {
    if (stage) {
      const roster = loadedEtudes ?? ETUDES;
      const meta = roster.find((s) => s.id === stage.id);
      if (meta) setSelectInitialMovement(meta.movement);
    }
    goto('select');
  };

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [wrapperWidth, setWrapperWidth] = useState(0);

  // Track the wrapper width so the timing plot sits at exactly the
  // same pixel width as the ScoreView above it; the plot's internal
  // x-axis is then mapped from song time onto that width.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => setWrapperWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Force the staff onto one row so every note has an unambiguous x
  // position; the plot beneath uses those same coordinates.
  const totalMeasures = useMemo(() => {
    if (!stage) return 1;
    const ts = stage.score.timeSigs[0] ?? { tick: 0, numerator: 4, denominator: 4 };
    const ticksPerMeasure = (PPQ * 4 * ts.numerator) / ts.denominator;
    return Math.max(1, Math.ceil(stage.score.totalTicks / ticksPerMeasure));
  }, [stage]);

  // Every measure gets the same generous width so notes always have
  // room to breathe — sparse bars don't waste space, dense bars don't
  // get squeezed. The horizontal scroll wrapper lets long pieces
  // overflow the viewport. This uniform spacing also means the staff
  // and the time-axis TimingPlot beneath stay in approximate visual
  // alignment (an even bar = an even slice of total time).
  const FIXED_MEASURE_WIDTH = 240;
  const measureWidths = useMemo<number[]>(() => {
    if (!stage) return [];
    return new Array(totalMeasures).fill(FIXED_MEASURE_WIDTH);
  }, [stage, totalMeasures]);
  const scoreMinWidth = useMemo(
    () => measureWidths.reduce((s, w) => s + w, 0) + 40,
    [measureWidths],
  );

  // Total song duration in seconds — drives the TimingPlot's x axis
  // so a given ms drift always renders at the same visual distance,
  // regardless of which measure the note lives in.
  const totalScoreSec = useMemo(() => {
    if (!stage) return 0;
    const converter = new TickTimeConverter(stage.score.tempos);
    return converter.tickToSec(stage.score.totalTicks);
  }, [stage]);

  const stats = useMemo(
    () => (records ? computeTimingStats(records) : null),
    [records],
  );

  const strayCount = useMemo(
    () =>
      records
        ? records.filter((r) => !r.noteId && r.tapSec !== null).length
        : 0,
    [records],
  );

  const prevBest = useMemo(
    () => (stage ? getBest(stage.id) : null),
    // Re-snapshot every time a new result comes in so retries can
    // compare against the not-yet-overwritten best.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stage, result],
  );

  // A run is "below threshold" when the player chose a tempo slower
  // than the stage's authored BPM. Authored BPM is the *minimum to
  // pass*: the player can still play below it (useful for practice)
  // but the run won't count as a best-score entry. lastPlayedBpm is
  // pinned at run completion so a later slider nudge can't retro-
  // actively unlock a record.
  const belowPassThreshold =
    stage != null &&
    lastPlayedBpm != null &&
    lastPlayedBpm < stage.bpm;

  const newBest =
    stage && result && !belowPassThreshold
      ? isNewBest({ etudeId: stage.id, score: result.score })
      : false;

  useEffect(() => {
    if (!stage || !result || !newBest) return;
    // Defensive — newBest is already gated on belowPassThreshold above,
    // but spelling out the guard here makes the "don't promote a below-
    // threshold run" rule readable next to the actual setBest call.
    if (belowPassThreshold) return;
    setBest({
      etudeId: stage.id,
      score: result.score,
      rank: result.rank,
      achievedAt: new Date().toISOString(),
    });
  }, [stage, result, newBest, belowPassThreshold]);

  // Drift large enough to suggest (re-)calibration. Reuses the same
  // mean-signed-error already computed for the timing-stats line so we
  // don't re-walk the audit trail.
  const driftSuggestion = useMemo(() => {
    if (!stats || stats.hitCount === 0) return null;
    if (Math.abs(stats.meanDiffMs) < CALIBRATION_SUGGEST_THRESHOLD_MS) return null;
    return Math.round(stats.meanDiffMs);
  }, [stats]);

  // "Next stage" lookup — only relevant once we know the player cleared
  // (rank A or higher). Resolved against the loaded roster (with the
  // bundled ETUDES as a fallback for the same reasons GameScreen does).
  const nextEtude = useMemo<EtudeWithMovementMeta | null>(() => {
    if (!stage || !result) return null;
    if (!rankAtLeast(result.rank, PASS_RANK_THRESHOLD)) return null;
    const roster = loadedEtudes ?? ETUDES;
    const currentMeta = roster.find((s) => s.id === stage.id);
    if (!currentMeta) return null;
    return findNextEtude(roster, currentMeta);
  }, [stage, result, loadedEtudes]);

  const passed =
    result != null && rankAtLeast(result.rank, PASS_RANK_THRESHOLD);
  // If the player cleared the very last stage there's no "next" to go
  // to — the level-list itself becomes the celebration target.
  const endOfRoster = passed && nextEtude === null;

  const goNext = () => {
    if (!nextEtude) return;
    selectEtude(nextEtude.id);
    goto('game');
  };

  // Share the run. Path picked by environment:
  //  - Touch device (mobile / tablet) → Web Share API with a 1080×1080
  //    image attached. The system share sheet is the native UX there
  //    and lets the player pick X / IG / Discord / wherever.
  //  - Desktop → X's post-intent URL in a new tab. The OS share sheet
  //    on desktop feels intrusive vs the expected "open X" flow, and
  //    most desktop browsers can't share files to X anyway. Text only.
  const shareToX = async () => {
    if (!stage || !result) return;
    const text = `Rhygym「${stage.name}」で ${result.rank} ランク達成！ (スコア ${result.score})`;
    const isTouchDevice =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0);

    if (isTouchDevice) {
      try {
        const blob = await generateResultImage(stage.name, result);
        if (blob) {
          const file = new File([blob], 'rhygym-result.png', { type: 'image/png' });
          if (
            typeof navigator.canShare === 'function' &&
            navigator.canShare({ files: [file] })
          ) {
            await navigator.share({
              text: `${text} #Rhygym`,
              url: SHARE_URL,
              files: [file],
            });
            return;
          }
        }
      } catch (err) {
        // User cancelled the system share sheet → bail silently.
        if ((err as Error)?.name === 'AbortError') return;
        // Other failures fall through to the intent URL so the
        // player still has a working share path.
      }
    }

    // Desktop / fallback: open X's post-intent in a new tab.
    const intent = new URL('https://x.com/intent/post');
    intent.searchParams.set('text', text);
    intent.searchParams.set('url', SHARE_URL);
    intent.searchParams.set('hashtags', 'Rhygym');
    window.open(intent.toString(), '_blank', 'noopener,noreferrer');
  };

  if (!result || !stage) {
    return (
      <main className="screen">
        <h1>リザルト</h1>
        <p className="muted">直前のプレイ結果が見つかりません。</p>
        <button className="primary" onClick={() => goto('select')}>
          Movement 一覧へ
        </button>
      </main>
    );
  }

  return (
    <main className="screen screen-result">
      <section className="result-plot-section">
        <h2 className="result-section-title">タイミング</h2>
        <div className="result-score-scroll">
          <div
            ref={wrapperRef}
            className="score-with-timing"
            style={{ minWidth: scoreMinWidth }}
          >
            <ScoreView
              score={stage.score}
              measuresPerLine={totalMeasures}
              measureWidths={measureWidths}
            />
            {records && wrapperWidth > 0 && totalScoreSec > 0 && (
              <TimingPlot
                records={records}
                width={wrapperWidth}
                totalSec={totalScoreSec}
              />
            )}
          </div>
        </div>
        {stats && stats.hitCount > 0 && (
          <p className="timing-stats">
            <span>平均 {formatBiasMs(stats.meanDiffMs)}</span>
            <span className="dot-sep">·</span>
            <span>バラつき ±{Math.round(stats.stdDiffMs)}ms</span>
            {strayCount > 0 && (
              <>
                <span className="dot-sep">·</span>
                <span>余計に {strayCount} 回タップ</span>
              </>
            )}
          </p>
        )}
      </section>

      {belowPassThreshold && (
        <div className="bpm-threshold-banner" role="status">
          <p className="bpm-threshold-text">
            このBPM ({lastPlayedBpm}) は合格基準 ({stage.bpm}) 未満のため、記録は残りません。
          </p>
        </div>
      )}
      {newBest && <p className="new-best-badge">NEW BEST!</p>}
      <div
        className={`result-rank-chip rank-${result.rank}`}
        aria-label={`ランク ${result.rank}`}
      >
        <h1 className="result-rank">{result.rank}</h1>
      </div>
      <p className="result-score">{result.score}</p>
      <p className="result-accuracy">正確率 {(result.accuracy * 100).toFixed(1)}%</p>
      {prevBest && !newBest && (
        <p className="muted">
          自己ベスト: {prevBest.score} ({prevBest.rank})
        </p>
      )}
      <div className="result-breakdown">
        <span className="r-perfect">PERFECT {result.perfect}</span>
        <span className="r-good">GOOD {result.good}</span>
        <span className="r-miss">MISS {result.miss}</span>
      </div>
      {driftSuggestion !== null && (
        <div className="calib-suggest-banner">
          <p className="calib-suggest-text">
            {calibrated
              ? `端末を変えた？再キャリブレーションがおすすめです。(現在の傾向: ${formatSignedMs(driftSuggestion)})`
              : `全体的に ${formatSignedMs(driftSuggestion)} ${driftSuggestion > 0 ? '遅め' : '早め'}傾向です。キャリブレーションで精度が上がる可能性があります。`}
          </p>
          <button className="primary calib-suggest-cta" onClick={goCalibration}>
            キャリブレーションする
          </button>
        </div>
      )}

      {passed ? (
        <>
          {nextEtude ? (
            <button className="primary next-etude-cta" onClick={goNext}>
              次の Etude へ →
            </button>
          ) : (
            <button className="primary next-etude-cta" onClick={goEtudeSelect}>
              Movement 一覧へ
            </button>
          )}
          <div className="row result-secondary-row">
            <button className="secondary result-secondary-btn" onClick={() => goto('game')}>
              リトライ
            </button>
            {!endOfRoster && (
              <button className="secondary result-secondary-btn" onClick={goEtudeSelect}>
                Etude 一覧へ
              </button>
            )}
          </div>
          <div className="row result-share-row">
            <ShareToXButton onClick={shareToX} />
          </div>
        </>
      ) : (
        <>
          <div className="row">
            <button className="primary" onClick={() => goto('game')}>
              リトライ
            </button>
            <button className="secondary" onClick={goEtudeSelect}>
              Etude 一覧へ
            </button>
          </div>
          <div className="row result-share-row">
            <ShareToXButton onClick={shareToX} />
          </div>
        </>
      )}
      {/* When the drift banner is up it already carries a calibration
       * CTA, so the permanent funnel button would just be redundant. */}
      {driftSuggestion === null && (
        <div className="row">
          <button className="secondary calib-funnel-btn" onClick={goCalibration}>
            {calibrated
              ? `再キャリブレーションする (現在 ${formatSignedMs(Math.round(calibrationOffsetSec * 1000))})`
              : 'キャリブレーションする'}
          </button>
        </div>
      )}
    </main>
  );
}

function formatSignedMs(ms: number): string {
  if (ms > 0) return `+${ms}ms`;
  return `${ms}ms`;
}

function formatBiasMs(ms: number): string {
  const rounded = Math.round(ms);
  if (rounded === 0) return '±0ms';
  if (rounded > 0) return `+${rounded}ms (やや遅め)`;
  return `${rounded}ms (やや早め)`;
}

/**
 * X (formerly Twitter) brand-style share button. Inline SVG for the
 * 𝕏 mark — keeps it crisp at any size and avoids a network fetch for
 * a logo. Spelled-out label tells the player WHAT will be shared
 * (the score), since "シェア" alone left some users unsure whether
 * it'd post their result or just the app link.
 */
function ShareToXButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="secondary result-share-btn"
      onClick={onClick}
      aria-label="X (旧 Twitter) にスコアを共有する"
    >
      <svg className="result-share-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"
        />
      </svg>
      <span>スコアを共有する</span>
    </button>
  );
}

/**
 * Build a 1080×1080 PNG of the run's headline numbers — stage name,
 * rank in a tier-colored slab, score, accuracy and breakdown — so the
 * X post carries a visual hook instead of just a sentence. Pure
 * Canvas, no DOM dependency, so generation runs the same in any
 * browser. Returns null if the canvas context can't be created (jsdom
 * tests, ancient browsers) — caller falls back to text-only share.
 */
const RANK_FILL: Record<string, string> = {
  S: '#d4a017',
  A: '#3a8dde',
  B: '#6aa84f',
  C: '#b58c50',
  D: '#8a6b4a',
};

async function generateResultImage(
  stageName: string,
  result: { rank: string; score: number; accuracy: number; perfect: number; good: number; miss: number },
): Promise<Blob | null> {
  const SIZE = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Brand-yellow background + accent stripe across the top so the
  // card reads as "Rhygym" at a glance even thumbnailed in a feed.
  ctx.fillStyle = '#FFD24A';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#E8612E';
  ctx.fillRect(0, 0, SIZE, 16);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2A1B06';

  // Wordmark
  ctx.font = '800 96px "Poppins", "Noto Sans JP", sans-serif';
  ctx.fillText('♪ Rhygym 🏋', SIZE / 2, 150);

  // Stage name
  ctx.font = '500 56px "Noto Sans JP", sans-serif';
  ctx.fillStyle = 'rgba(42, 27, 6, 0.85)';
  ctx.fillText(stageName, SIZE / 2, 250);

  // Rank chip — same brand badge as the on-screen ResultScreen: tier
  // base colour + sheen gradient + inset highlight/shadow stack +
  // drop shadow, with the letter floating on top with a soft drop
  // shadow of its own. Centred horizontally; vertical anchor places
  // the chip in the headline slot between the stage name and score.
  const CHIP_SIZE = 380;
  const CHIP_X = (SIZE - CHIP_SIZE) / 2;
  const CHIP_Y = 360;
  drawRankChip(ctx, CHIP_X, CHIP_Y, CHIP_SIZE, result.rank);

  // Score (big) — sits below the chip with a clear visual gap.
  ctx.fillStyle = '#2A1B06';
  ctx.font = '800 120px "Poppins", sans-serif';
  ctx.fillText(String(result.score), SIZE / 2, 830);

  // Accuracy
  ctx.font = '500 44px "Noto Sans JP", sans-serif';
  ctx.fillStyle = 'rgba(42, 27, 6, 0.7)';
  ctx.fillText(`正確率 ${(result.accuracy * 100).toFixed(1)}%`, SIZE / 2, 910);

  // Breakdown row (PERFECT / GOOD / MISS)
  ctx.font = '600 40px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#2A1B06';
  ctx.fillText(
    `PERFECT ${result.perfect}   GOOD ${result.good}   MISS ${result.miss}`,
    SIZE / 2,
    975,
  );

  // Footer / URL
  ctx.font = '500 32px "Noto Sans JP", sans-serif';
  ctx.fillStyle = 'rgba(42, 27, 6, 0.55)';
  ctx.fillText('tkg1683.github.io/rhygym', SIZE / 2, 1030);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/**
 * Path helper — rounded rectangle compatible with browsers that ship
 * before the native `roundRect` API (Safari <16 etc.). Defines the
 * path on the context; caller fills / strokes it.
 */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Replicate the on-screen .result-rank-chip badge in canvas: tier
 * colour base + diagonal sheen gradient + inset white-top / dark-
 * bottom highlights + outer drop shadow, with the rank letter
 * floating on top. Mirrors the CSS rule pixel-for-pixel as closely
 * as Canvas allows so the shared image reads as "same badge, just
 * exported".
 */
function drawRankChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rank: string,
): void {
  const radius = Math.round(size * 0.21); // 28/132 ≈ 0.21
  const base = RANK_FILL[rank] ?? '#8a6b4a';

  // 1. Drop shadow + base fill
  ctx.save();
  ctx.shadowOffsetY = 10;
  ctx.shadowBlur = 22;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
  ctx.fillStyle = base;
  roundRectPath(ctx, x, y, size, size, radius);
  ctx.fill();
  ctx.restore();

  // 2. Diagonal sheen gradient — matches the 5-stop CSS gradient.
  const grad = ctx.createLinearGradient(x, y, x + size, y + size);
  grad.addColorStop(0,    'rgba(255, 255, 255, 0.60)');
  grad.addColorStop(0.28, 'rgba(255, 255, 255, 0.10)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.18)');
  grad.addColorStop(0.78, 'rgba(255, 255, 255, 0.22)');
  grad.addColorStop(1,    'rgba(0, 0, 0, 0.30)');
  ctx.fillStyle = grad;
  roundRectPath(ctx, x, y, size, size, radius);
  ctx.fill();

  // 3. Inset edge stroke (subtle dark rim) — matches
  //    `inset 0 0 0 2px rgba(0, 0, 0, 0.18)`.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = 4;
  roundRectPath(ctx, x + 2, y + 2, size - 4, size - 4, radius - 2);
  ctx.stroke();

  // 4. Top highlight — `inset 0 2px 1px rgba(255, 255, 255, 0.85)`.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 3;
  roundRectPath(ctx, x + 3, y + 3, size - 6, size - 6, radius - 3);
  // Only stroke the top edge by clipping; cheaper to draw thinner all
  // around so the bottom inherits a soft glow too.
  ctx.stroke();

  // 5. The rank letter itself — large weight 800, cream fill, soft
  //    drop shadow.
  ctx.save();
  ctx.fillStyle = '#fffaef'; // --text-on-dark
  ctx.font = `800 ${Math.round(size * 0.62)}px "Poppins", "Noto Sans JP", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowOffsetY = 3;
  ctx.shadowBlur = 4;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.fillText(rank, x + size / 2, y + size / 2 + size * 0.02);
  ctx.restore();
}
