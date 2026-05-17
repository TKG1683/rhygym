import { useAppStore } from '../store/appStore';

export function ResultScreen() {
  const goto = useAppStore((s) => s.goto);
  return (
    <main className="screen">
      <h1>リザルト</h1>
      <p className="muted">(placeholder — ランク / 内訳は #10 で実装)</p>
      <button className="primary" onClick={() => goto('game')}>
        もう一度
      </button>
      <button className="secondary" onClick={() => goto('select')}>
        級選択へ
      </button>
    </main>
  );
}
