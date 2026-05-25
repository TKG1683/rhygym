/**
 * Two-hand mode (#83) Phase A demo etude.
 *
 * A 4-measure 3:2 hemiola — the classic polyrhythm exercise:
 *   Right hand: 3 evenly-spaced taps per bar (eighth triplets at the
 *     quarter level → dotted-quarter pulse, i.e. three notes that
 *     divide the bar into thirds)
 *   Left hand:  2 half notes per bar (downbeat + middle)
 *
 * In 4/4 with PPQ=480 this means:
 *   - Right (3 per bar): notes at tick 0, 640, 1280 (640 = 1920/3)
 *   - Left  (2 per bar): notes at tick 0, 960
 *
 * The 1920/3 = 640 tick spacing isn't a standard duration — it's the
 * "3-against-4" feel rendered as quarter-note triplets if you squint,
 * but musically it's "3 evenly spaced in a 4/4 bar". For Phase A we
 * use the simplest possible representation: durationTicks = 640 for
 * the right-hand notes (which scoreToVex will draw as a tied
 * combination since 640 isn't a single power-of-two duration).
 *
 * This is purely a render-pipeline smoke test for now — Phase B wires
 * up the actual tap / judgement plumbing.
 */

import {
  HALF_NOTE_TICKS,
  WHOLE_NOTE_TICKS,
  type Etude,
  type RhythmNote,
} from '../model';

const BARS = 4;
const BAR_TICKS = WHOLE_NOTE_TICKS;

const rightHand: RhythmNote[] = [];
const leftHand: RhythmNote[] = [];

for (let bar = 0; bar < BARS; bar++) {
  const barStart = bar * BAR_TICKS;
  // Right hand — 3 evenly-spaced taps. Tick spacing = 1920 / 3 = 640.
  // Render-wise this lands as dotted-quarter onsets (PPQ*1.5/2... ish);
  // VexFlow will decompose via the existing tuplet detection only if
  // the durations match its patterns, otherwise it splits the note.
  // We're not chasing pretty notation in Phase A — just want SOMETHING
  // on the upper staff at three tick positions per bar.
  for (let i = 0; i < 3; i++) {
    const tick = barStart + Math.round((i * BAR_TICKS) / 3);
    rightHand.push({
      id: `r-${bar}-${i}`,
      tick,
      durationTicks: Math.round(BAR_TICKS / 3),
      isRest: false,
      lane: 'R',
    });
  }
  // Left hand — 2 half notes per bar.
  for (let i = 0; i < 2; i++) {
    leftHand.push({
      id: `l-${bar}-${i}`,
      tick: barStart + i * HALF_NOTE_TICKS,
      durationTicks: HALF_NOTE_TICKS,
      isRest: false,
      lane: 'L',
    });
  }
}

export const TWO_HAND_DEMO_ETUDE: Etude = {
  id: 'two-hand-demo-3v2',
  name: '両手モード デモ (3:2)',
  description: '右手 3 連、 左手 2 拍。 ポリリズム入門。',
  bpm: 80,
  twoHand: true,
  score: {
    tempos: [{ tick: 0, bpm: 80 }],
    timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
    notes: [...rightHand, ...leftHand].sort((a, b) => a.tick - b.tick),
    totalTicks: BAR_TICKS * BARS,
  },
};
