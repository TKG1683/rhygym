import { useEffect, useMemo, useRef, useState } from 'react';
import { computeTimingStats } from '../../core/judgement';
import {
  CALIBRATION_SUGGEST_THRESHOLD_MS,
  PASS_RANK_THRESHOLD,
} from '../../core/judgement/score';
import { PPQ } from '../../core/model';
import { STAGES, type StageWithMeta } from '../../core/score/stages';
import { getBest, isNewBest, setBest } from '../../core/storage/localStore';
import { TimingPlot } from '../game/TimingPlot';
import { ScoreView } from '../vexflow/ScoreView';
import type { NoteCoords } from '../vexflow/ScoreRenderer';
import { adaptiveMeasureWidth, scoreToVex } from '../vexflow/scoreToVex';
import { useAppStore } from '../store/appStore';

/** Rank ordering for "is this rank at least PASS_RANK_THRESHOLD?". */
const RANK_ORDER = ['D', 'C', 'B', 'A', 'S'] as const;
function rankAtLeast(rank: string, min: string): boolean {
  return RANK_ORDER.indexOf(rank as (typeof RANK_ORDER)[number]) >=
    RANK_ORDER.indexOf(min as (typeof RANK_ORDER)[number]);
}

/**
 * Pick the "next stage" relative to `current` from the loaded roster.
 *  1. Same level, indexInLevel + 1 (or — if neither carries an index —
 *     the next entry in the roster that shares the same level).
 *  2. Otherwise, the first stage of the next-higher level.
 *  3. Otherwise (current is the last stage of the highest level), null.
 *
 * Exam stages count as the end of their level, so "next" from an exam
 * is the next level's stage 1.
 */
function findNextEtude(
  roster: readonly StageWithMeta[],
  current: StageWithMeta,
): StageWithMeta | null {
  if (current.isExam) {
    return firstEtudeOfMovement(roster, current.level + 1);
  }
  if (current.indexInLevel != null) {
    const sameLevelNext = roster.find(
      (s) => s.level === current.level && s.indexInLevel === current.indexInLevel! + 1,
    );
    if (sameLevelNext) return sameLevelNext;
  } else {
    // Roster doesn't carry per-stage indices (placeholder STAGES): use
    // roster order within the level.
    const sameLevel = roster.filter((s) => s.level === current.level);
    const idx = sameLevel.findIndex((s) => s.id === current.id);
    if (idx >= 0 && idx + 1 < sameLevel.length) return sameLevel[idx + 1]!;
  }
  return firstEtudeOfMovement(roster, current.level + 1);
}

function firstEtudeOfMovement(
  roster: readonly StageWithMeta[],
  level: number,
): StageWithMeta | null {
  const inLevel = roster.filter((s) => s.level === level);
  if (inLevel.length === 0) return null;
  const withIndex = inLevel.find((s) => s.indexInLevel === 1);
  return withIndex ?? inLevel[0] ?? null;
}

export function ResultScreen() {
  const goto = useAppStore((s) => s.goto);
  const selectStage = useAppStore((s) => s.selectStage);
  const result = useAppStore((s) => s.lastResult);
  const stage = useAppStore((s) => s.lastStage);
  const records = useAppStore((s) => s.lastRecords);
  const calibrationOffsetSec = useAppStore((s) => s.calibrationOffsetSec);
  const loadedStages = useAppStore((s) => s.loadedStages);
  const setCalibrationReturnScreen = useAppStore((s) => s.setCalibrationReturnScreen);
  const setSelectInitialLevel = useAppStore((s) => s.setSelectInitialLevel);
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
      const roster = loadedStages ?? STAGES;
      const meta = roster.find((s) => s.id === stage.id);
      if (meta) setSelectInitialLevel(meta.level);
    }
    goto('select');
  };

  const [noteCoords, setNoteCoords] = useState<Map<string, NoteCoords> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [wrapperWidth, setWrapperWidth] = useState(0);

  // Track the wrapper width so the timing plot sits at exactly the same
  // pixel width as the ScoreView and the x coordinates line up.
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

  // Per-measure widths driven by note density: a bar of sixteenths
  // gets more room than a bar of two halves. The wrapper is scrollable
  // so overflow is fine; min-width = the sum guarantees the staff
  // never gets squeezed below the natural per-bar widths.
  const measureWidths = useMemo<number[]>(() => {
    if (!stage) return [];
    return scoreToVex(stage.score).measures.map(adaptiveMeasureWidth);
  }, [stage]);
  const scoreMinWidth = useMemo(
    () => measureWidths.reduce((s, w) => s + w, 0) + 40,
    [measureWidths],
  );

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

  const newBest =
    stage && result
      ? isNewBest({ stageId: stage.id, score: result.score })
      : false;

  useEffect(() => {
    if (!stage || !result || !newBest) return;
    setBest({
      stageId: stage.id,
      score: result.score,
      rank: result.rank,
      achievedAt: new Date().toISOString(),
    });
  }, [stage, result, newBest]);

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
  // bundled STAGES as a fallback for the same reasons GameScreen does).
  const nextEtude = useMemo<StageWithMeta | null>(() => {
    if (!stage || !result) return null;
    if (!rankAtLeast(result.rank, PASS_RANK_THRESHOLD)) return null;
    const roster = loadedStages ?? STAGES;
    const currentMeta = roster.find((s) => s.id === stage.id);
    if (!currentMeta) return null;
    return findNextEtude(roster, currentMeta);
  }, [stage, result, loadedStages]);

  const passed =
    result != null && rankAtLeast(result.rank, PASS_RANK_THRESHOLD);
  // If the player cleared the very last stage there's no "next" to go
  // to — the level-list itself becomes the celebration target.
  const endOfRoster = passed && nextEtude === null;

  const goNext = () => {
    if (!nextEtude) return;
    selectStage(nextEtude.id);
    goto('game');
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
              onRender={setNoteCoords}
              measuresPerLine={totalMeasures}
              measureWidths={measureWidths}
            />
            {records && noteCoords && wrapperWidth > 0 && (
              <TimingPlot
                records={records}
                noteCoords={noteCoords}
                width={wrapperWidth}
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
        </>
      ) : (
        <div className="row">
          <button className="primary" onClick={() => goto('game')}>
            リトライ
          </button>
          <button className="secondary" onClick={goEtudeSelect}>
            Etude 一覧へ
          </button>
        </div>
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
