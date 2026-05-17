/**
 * Hardcoded demo stage used until real stage content lands in #9.
 * 4 measures of 4/4 mixing quarter, eighth, half and a rest pattern so
 * the end-to-end game loop has something representative to chew on.
 */

import {
  EIGHTH_NOTE_TICKS,
  HALF_NOTE_TICKS,
  QUARTER_NOTE_TICKS,
  WHOLE_NOTE_TICKS,
  type RhythmNote,
  type Stage,
} from '../model';

const PATTERN: ReadonlyArray<{ tick: number; dur: number }> = [
  // measure 0: q q q q
  { tick: 0, dur: QUARTER_NOTE_TICKS },
  { tick: QUARTER_NOTE_TICKS, dur: QUARTER_NOTE_TICKS },
  { tick: QUARTER_NOTE_TICKS * 2, dur: QUARTER_NOTE_TICKS },
  { tick: QUARTER_NOTE_TICKS * 3, dur: QUARTER_NOTE_TICKS },
  // measure 1: 8 8 8 8 q q
  { tick: WHOLE_NOTE_TICKS, dur: EIGHTH_NOTE_TICKS },
  { tick: WHOLE_NOTE_TICKS + EIGHTH_NOTE_TICKS, dur: EIGHTH_NOTE_TICKS },
  { tick: WHOLE_NOTE_TICKS + EIGHTH_NOTE_TICKS * 2, dur: EIGHTH_NOTE_TICKS },
  { tick: WHOLE_NOTE_TICKS + EIGHTH_NOTE_TICKS * 3, dur: EIGHTH_NOTE_TICKS },
  { tick: WHOLE_NOTE_TICKS + HALF_NOTE_TICKS, dur: QUARTER_NOTE_TICKS },
  { tick: WHOLE_NOTE_TICKS + HALF_NOTE_TICKS + QUARTER_NOTE_TICKS, dur: QUARTER_NOTE_TICKS },
  // measure 2: h h
  { tick: WHOLE_NOTE_TICKS * 2, dur: HALF_NOTE_TICKS },
  { tick: WHOLE_NOTE_TICKS * 2 + HALF_NOTE_TICKS, dur: HALF_NOTE_TICKS },
  // measure 3: q 𝄽 q 𝄽 (notes on beats 1 and 3, rests fill the gaps)
  { tick: WHOLE_NOTE_TICKS * 3, dur: QUARTER_NOTE_TICKS },
  { tick: WHOLE_NOTE_TICKS * 3 + HALF_NOTE_TICKS, dur: QUARTER_NOTE_TICKS },
];

const notes: RhythmNote[] = PATTERN.map((p, i) => ({
  id: `demo-${i}`,
  tick: p.tick,
  durationTicks: p.dur,
  isRest: false,
}));

export const DEMO_STAGE: Stage = {
  id: 'demo',
  name: 'Demo Stage',
  description: '4/4 × 4 小節 — 動作確認用',
  bpm: 100,
  score: {
    tempos: [{ tick: 0, bpm: 100 }],
    timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
    notes,
    totalTicks: WHOLE_NOTE_TICKS * 4,
  },
};
