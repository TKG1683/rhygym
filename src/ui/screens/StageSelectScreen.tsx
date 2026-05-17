import { useAppStore } from '../store/appStore';

export function StageSelectScreen() {
  const goto = useAppStore((s) => s.goto);
  const selectStage = useAppStore((s) => s.selectStage);
  return (
    <main className="screen">
      <h1>級を選ぶ</h1>
      <p className="muted">(placeholder — 級リストは #9 で実装)</p>
      <button
        className="primary"
        onClick={() => {
          selectStage('demo');
          goto('game');
        }}
      >
        仮ステージへ
      </button>
      <button className="secondary" onClick={() => goto('title')}>
        戻る
      </button>
    </main>
  );
}
