import { useCallback } from 'react';
import {
  EIGHTH_NOTE_TICKS,
  HALF_NOTE_TICKS,
  QUARTER_NOTE_TICKS,
  WHOLE_NOTE_TICKS,
  type Score,
} from '../../core/model';
import { useAppStore } from '../store/appStore';
import { ScoreView } from '../vexflow/ScoreView';
import type { NoteCoords } from '../vexflow/ScoreRenderer';

// Demo score for #3: 4 measures of 4/4 mixing quarter / eighth / half rests
// so the renderer is exercised on more than just plain quarters.
const DEMO_SCORE: Score = (() => {
  const notes = [
    // measure 0: q q q q
    { tick: 0, dur: QUARTER_NOTE_TICKS },
    { tick: QUARTER_NOTE_TICKS, dur: QUARTER_NOTE_TICKS },
    { tick: QUARTER_NOTE_TICKS * 2, dur: QUARTER_NOTE_TICKS },
    { tick: QUARTER_NOTE_TICKS * 3, dur: QUARTER_NOTE_TICKS },
    // measure 1: 8 8 8 8 q q
    { tick: WHOLE_NOTE_TICKS + 0, dur: EIGHTH_NOTE_TICKS },
    { tick: WHOLE_NOTE_TICKS + EIGHTH_NOTE_TICKS, dur: EIGHTH_NOTE_TICKS },
    { tick: WHOLE_NOTE_TICKS + EIGHTH_NOTE_TICKS * 2, dur: EIGHTH_NOTE_TICKS },
    { tick: WHOLE_NOTE_TICKS + EIGHTH_NOTE_TICKS * 3, dur: EIGHTH_NOTE_TICKS },
    { tick: WHOLE_NOTE_TICKS + HALF_NOTE_TICKS, dur: QUARTER_NOTE_TICKS },
    { tick: WHOLE_NOTE_TICKS + HALF_NOTE_TICKS + QUARTER_NOTE_TICKS, dur: QUARTER_NOTE_TICKS },
    // measure 2: h h
    { tick: WHOLE_NOTE_TICKS * 2, dur: HALF_NOTE_TICKS },
    { tick: WHOLE_NOTE_TICKS * 2 + HALF_NOTE_TICKS, dur: HALF_NOTE_TICKS },
    // measure 3: q (rest) q (rest) -- single q on beat 1 and beat 3
    { tick: WHOLE_NOTE_TICKS * 3, dur: QUARTER_NOTE_TICKS },
    { tick: WHOLE_NOTE_TICKS * 3 + HALF_NOTE_TICKS, dur: QUARTER_NOTE_TICKS },
  ];
  return {
    tempos: [{ tick: 0, bpm: 120 }],
    timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
    notes: notes.map((n, i) => ({
      id: `demo-${i}`,
      tick: n.tick,
      durationTicks: n.dur,
      isRest: false,
    })),
    totalTicks: WHOLE_NOTE_TICKS * 4,
  };
})();

export function GameScreen() {
  const goto = useAppStore((s) => s.goto);
  const handleRender = useCallback((coords: Map<string, NoteCoords>) => {
    console.log('Rendered note coordinates:', coords);
  }, []);

  return (
    <main className="screen screen-game">
      <h1>ゲーム</h1>
      <p className="muted">(VexFlow デモ — 判定/タップは #6, #7 で実装)</p>
      <ScoreView score={DEMO_SCORE} onRender={handleRender} />
      <div className="row">
        <button className="primary" onClick={() => goto('result')}>
          結果へ
        </button>
        <button className="secondary" onClick={() => goto('select')}>
          中断
        </button>
      </div>
    </main>
  );
}
