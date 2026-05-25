/**
 * Two-hand mode (#83) Phase A debug screen.
 *
 * Renders the GrandStaffView with the hardcoded demo etude. No tap,
 * no judgement, no audio — purely a visual smoke test for the lane
 * split + 2-stave render pipeline. Reachable via `?demo=two-hand` on
 * the page URL so it never appears in the production navigation.
 *
 * Phase B replaces this with a real GameView-two-hand integration.
 */

import { TWO_HAND_DEMO_ETUDE } from '../../core/score/twoHandDemoEtude';
import { GrandStaffView } from '../vexflow/GrandStaffView';
import { useAppStore } from '../store/appStore';

export function TwoHandDemoScreen() {
  const goto = useAppStore((s) => s.goto);
  return (
    <main className="screen screen-two-hand-demo">
      <header className="two-hand-demo-header">
        <h1>{TWO_HAND_DEMO_ETUDE.name}</h1>
        <p className="muted">{TWO_HAND_DEMO_ETUDE.description}</p>
        <p className="muted">
          Phase A デモ — 描画のみ。 タップ・判定は Phase B で。
        </p>
      </header>
      <GrandStaffView score={TWO_HAND_DEMO_ETUDE.score} measuresPerLine={2} />
      <button className="secondary" onClick={() => goto('title')}>
        タイトルへ戻る
      </button>
    </main>
  );
}
