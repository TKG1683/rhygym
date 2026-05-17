import { useAppStore } from '../store/appStore';

export function GameScreen() {
  const goto = useAppStore((s) => s.goto);
  return (
    <main className="screen">
      <h1>ゲーム</h1>
      <p className="muted">(placeholder — VexFlow / 判定 は #3, #7 で実装)</p>
      <button className="primary" onClick={() => goto('result')}>
        結果へ
      </button>
      <button className="secondary" onClick={() => goto('select')}>
        中断
      </button>
    </main>
  );
}
