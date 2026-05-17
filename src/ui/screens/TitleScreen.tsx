import { useAppStore } from '../store/appStore';

export function TitleScreen() {
  const goto = useAppStore((s) => s.goto);
  return (
    <main className="screen">
      <h1 className="logo">Rhygym</h1>
      <p className="tagline">楽譜を読み、タップでリズムを叩け。</p>
      <button className="primary" onClick={() => goto('select')}>
        Start
      </button>
    </main>
  );
}
