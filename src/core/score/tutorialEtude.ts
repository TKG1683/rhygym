/**
 * Tutorial etude — used by TutorialScreen for the play-through
 * walkthrough (#26 v2).
 *
 * 2 measures of 4/4 at 60 BPM, all quarter notes, no rests. The
 * simplest possible thing that exercises every part of the game loop:
 *  - tap-to-start on the first downbeat
 *  - one tap per quarter for the remaining 7 onsets
 *  - completion → Result-shaped feedback
 *
 * Slow tempo (60 BPM) gives first-time players ~1 second per beat to
 * react, which is well above typical visual reaction time even with
 * the conductor baton's "tame at apex" hold.
 */

import {
  QUARTER_NOTE_TICKS,
  WHOLE_NOTE_TICKS,
  type Etude,
  type RhythmNote,
} from '../model';

const notes: RhythmNote[] = Array.from({ length: 8 }, (_, i) => ({
  id: `tutorial-${i}`,
  tick: i * QUARTER_NOTE_TICKS,
  durationTicks: QUARTER_NOTE_TICKS,
  isRest: false,
}));

export const TUTORIAL_ETUDE: Etude = {
  id: 'tutorial',
  name: 'チュートリアル',
  description: '4/4 × 2 小節 — 遊び方練習',
  bpm: 60,
  score: {
    tempos: [{ tick: 0, bpm: 60 }],
    timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
    notes,
    totalTicks: WHOLE_NOTE_TICKS * 2,
  },
};
