import { useEffect, useMemo, useRef, useState } from 'react';
import { computeTimingStats } from '../../core/judgement';
import { PPQ } from '../../core/model';
import { getBest, isNewBest, setBest } from '../../core/storage/localStore';
import { TimingPlot } from '../game/TimingPlot';
import { ScoreView } from '../vexflow/ScoreView';
import type { NoteCoords } from '../vexflow/ScoreRenderer';
import { useAppStore } from '../store/appStore';

export function ResultScreen() {
  const goto = useAppStore((s) => s.goto);
  const result = useAppStore((s) => s.lastResult);
  const stage = useAppStore((s) => s.lastStage);
  const records = useAppStore((s) => s.lastRecords);

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

  if (!result || !stage) {
    return (
      <main className="screen">
        <h1>リザルト</h1>
        <p className="muted">直前のプレイ結果が見つかりません。</p>
        <button className="primary" onClick={() => goto('select')}>
          級選択へ
        </button>
      </main>
    );
  }

  return (
    <main className="screen screen-result">
      <section className="result-plot-section">
        <h2 className="result-section-title">タイミング</h2>
        <div ref={wrapperRef} className="score-with-timing">
          <ScoreView
            score={stage.score}
            onRender={setNoteCoords}
            measuresPerLine={totalMeasures}
          />
          {records && noteCoords && wrapperWidth > 0 && (
            <TimingPlot
              records={records}
              noteCoords={noteCoords}
              width={wrapperWidth}
            />
          )}
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
      <h1 className="result-rank">{result.rank}</h1>
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
      <div className="row">
        <button className="primary" onClick={() => goto('game')}>
          リトライ
        </button>
        <button className="secondary" onClick={() => goto('select')}>
          級選択へ
        </button>
      </div>
    </main>
  );
}

function formatBiasMs(ms: number): string {
  const rounded = Math.round(ms);
  if (rounded === 0) return '±0ms';
  if (rounded > 0) return `+${rounded}ms (やや遅め)`;
  return `${rounded}ms (やや早め)`;
}
