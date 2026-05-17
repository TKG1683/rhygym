import { useAppStore } from '../store/appStore';

export function ResultScreen() {
  const goto = useAppStore((s) => s.goto);
  const result = useAppStore((s) => s.lastResult);

  if (!result) {
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
    <main className="screen">
      <h1 className="result-rank">{result.rank}</h1>
      <p className="result-score">{result.score}</p>
      <p className="result-accuracy">正確率 {(result.accuracy * 100).toFixed(1)}%</p>
      <div className="result-breakdown">
        <span className="r-perfect">PERFECT {result.perfect}</span>
        <span className="r-good">GOOD {result.good}</span>
        <span className="r-miss">MISS {result.miss}</span>
      </div>
      <div className="row">
        <button className="primary" onClick={() => goto('game')}>
          もう一度
        </button>
        <button className="secondary" onClick={() => goto('select')}>
          級選択へ
        </button>
      </div>
    </main>
  );
}
