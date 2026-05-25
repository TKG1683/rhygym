/**
 * Endless mode (#77) — Etude builder.
 *
 * Wraps the bar generator (Phase A) into the same `Etude` shape the
 * single-hand `GameView` already consumes, so Phase B can wire the
 * procedural rhythm stream straight into the existing audio /
 * judgement / render pipeline without forking GameView.
 *
 * "Endless" is approximated by pre-generating a long buffer
 * (`barCount`) up front and treating it as a long-but-finite song.
 * True streaming — append-as-you-go + visual rolling window —
 * arrives with the HUD work (Phase C/D). The 32-bar default is
 * roughly:
 *   80 BPM = 96 s
 *   108 BPM = 71 s
 *   132 BPM = 58 s
 *   168 BPM = 46 s
 * which is "long enough to feel like a run" but short enough that
 * the existing Score-driven scheduler can hold the whole thing
 * without surgery.
 */

import {
  ENDLESS_DIFFICULTY_BPM,
  QUARTER_NOTE_TICKS,
  type Etude,
  type EndlessDifficulty,
  type RhythmNote,
  type TimeSignatureEvent,
} from '../model';
import { EndlessGenerator } from './endlessGenerator';

interface BuildOpts {
  difficulty: EndlessDifficulty;
  seed: number;
  /** Number of bars to pre-generate. Defaults to 32. */
  barCount?: number;
}

export function buildEndlessStage(opts: BuildOpts): Etude {
  const barCount = opts.barCount ?? 32;
  const bpm = ENDLESS_DIFFICULTY_BPM[opts.difficulty];
  const gen = new EndlessGenerator({ seed: opts.seed });
  const bars = gen.generateBars(barCount);

  const notes: RhythmNote[] = [];
  const timeSigs: TimeSignatureEvent[] = [];
  let prevNum = -1;
  let prevDen = -1;
  for (const bar of bars) {
    if (bar.numerator !== prevNum || bar.denominator !== prevDen) {
      timeSigs.push({
        tick: bar.startTick,
        numerator: bar.numerator,
        denominator: bar.denominator,
      });
      prevNum = bar.numerator;
      prevDen = bar.denominator;
    }
    for (const n of bar.notes) notes.push(n);
  }

  const lastBar = bars[bars.length - 1]!;
  const totalTicks =
    lastBar.startTick +
    (QUARTER_NOTE_TICKS * 4 * lastBar.numerator) / lastBar.denominator;

  return {
    id: `endless-${opts.difficulty}-${opts.seed}-${barCount}`,
    name: `エンドレス (${labelForDifficulty(opts.difficulty)})`,
    description: `seed=${opts.seed} / ${barCount} 小節 / ♩=${bpm}`,
    bpm,
    score: {
      tempos: [{ tick: 0, bpm }],
      timeSigs,
      notes,
      totalTicks,
    },
  };
}

function labelForDifficulty(d: EndlessDifficulty): string {
  switch (d) {
    case 'andante':
      return 'Andante';
    case 'moderato':
      return 'Moderato';
    case 'allegro':
      return 'Allegro';
    case 'presto':
      return 'Presto';
  }
}
