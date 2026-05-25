/**
 * Two-hand mode (#83) Phase C etude pack.
 *
 * Five progressively-harder polyrhythm exercises authored as
 * `lane`-tagged RhythmNotes so the grand-staff renderer (#83 Phase A)
 * splits them onto upper (R) / lower (L) staves automatically.
 *
 * Difficulty ladder per the issue spec:
 *   Lv1 4:4 — both hands tap quarter notes together (warm-up)
 *   Lv2 4:2 — R quarters, L half notes (one hand drives)
 *   Lv3 3:2 — R three-evenly-spaced, L half notes (classic hemiola)
 *   Lv4 4:3 — R quarters, L three-evenly-spaced
 *   Lv5 5:4 — R five-evenly-spaced, L quarters (上級)
 *
 * The "evenly-spaced N in a 4/4 bar" durations don't always land on
 * VexFlow's tuplet detection table (we'd need a bar-level quintuplet
 * pattern for Lv5), so a couple of these will render as tied note
 * combinations rather than the canonical tuplet bracket. Functionally
 * fine — the judgement pipeline doesn't care, the etudes still play
 * correctly at the authored tick positions. Notation polish is a
 * future renderer improvement, not a blocker for the friend-playtest
 * loop.
 */

import { WHOLE_NOTE_TICKS, type Etude, type RhythmNote } from '../model';

const BAR_TICKS = WHOLE_NOTE_TICKS;

/**
 * Build N evenly-spaced taps in a single bar for one hand. Each tap
 * gets a uniform duration of barTicks / count so the rendered notation
 * reads as "this hand divides the bar into N equal pieces".
 */
function evenlySpacedBar(
  barIdx: number,
  count: number,
  lane: 'L' | 'R',
  idPrefix: string,
): RhythmNote[] {
  const barStart = barIdx * BAR_TICKS;
  const stepTicks = Math.round(BAR_TICKS / count);
  return Array.from({ length: count }, (_, i) => ({
    id: `${idPrefix}-${barIdx}-${i}`,
    tick: barStart + Math.round((i * BAR_TICKS) / count),
    durationTicks: stepTicks,
    isRest: false,
    lane,
  }));
}

/**
 * Assemble an etude where each bar gets `rightCount` evenly-spaced
 * right-hand taps and `leftCount` evenly-spaced left-hand taps. The
 * polyrhythm ratio is `rightCount:leftCount`.
 */
function makePolyrhythmEtude(
  id: string,
  name: string,
  description: string,
  bpm: number,
  bars: number,
  rightCount: number,
  leftCount: number,
): Etude {
  const notes: RhythmNote[] = [];
  for (let bar = 0; bar < bars; bar++) {
    notes.push(...evenlySpacedBar(bar, rightCount, 'R', 'r'));
    notes.push(...evenlySpacedBar(bar, leftCount, 'L', 'l'));
  }
  notes.sort((a, b) => a.tick - b.tick);
  return {
    id,
    name,
    description,
    bpm,
    twoHand: true,
    score: {
      tempos: [{ tick: 0, bpm }],
      timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
      notes,
      totalTicks: BAR_TICKS * bars,
    },
  };
}

export const TWO_HAND_ETUDES: readonly Etude[] = [
  // Lv1 — 4:4 同期。両手 4 分音符。 両手モードの導入。
  makePolyrhythmEtude(
    'two-hand-lv1-4v4',
    'Lv1 4:4 同期',
    '両手とも 4 分音符。 まずは両手モードの操作に慣れよう。',
    80,
    2,
    4,
    4,
  ),
  // Lv2 — 4:2 片手刻み。右が刻み、 左は伸ばす。
  makePolyrhythmEtude(
    'two-hand-lv2-4v2',
    'Lv2 4:2 片手だけ刻む',
    '右手は 4 分、 左手は 2 分。 片手だけ刻む基本練習。',
    80,
    2,
    4,
    2,
  ),
  // Lv3 — 3:2 ヘミオラ (Phase A デモ流用の改名版)。
  makePolyrhythmEtude(
    'two-hand-lv3-3v2',
    'Lv3 3:2 ヘミオラ',
    '右手 3 連、 左手 2 拍。 ポリリズム入門の定番。',
    80,
    4,
    3,
    2,
  ),
  // Lv4 — 4:3。右が刻み、 左が 1 拍を 3 等分する複雑なやつ。
  // ↑↑↑ 実際は 4/4 1 小節を 3 等分なので「拍が異なる」 感覚。
  makePolyrhythmEtude(
    'two-hand-lv4-4v3',
    'Lv4 4:3',
    '右手 4 分、 左手は 1 小節を 3 等分。 ポリリズム中級。',
    72,
    4,
    4,
    3,
  ),
  // Lv5 — 5:4。 上級ポリリズム。 右が 5 等分、 左が 4 分。
  makePolyrhythmEtude(
    'two-hand-lv5-5v4',
    'Lv5 5:4',
    '右手 5 等分、 左手 4 分。 上級ポリリズム。 BPM 落としても OK。',
    64,
    4,
    5,
    4,
  ),
];

