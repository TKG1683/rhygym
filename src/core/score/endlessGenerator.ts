/**
 * Endless mode (#77) bar-level generator.
 *
 * Stateful streamer that emits one measure at a time. Internally
 * holds a seeded RNG + a running bar counter; the caller asks for
 * `generateBar()` whenever the playback buffer needs more music.
 *
 * Pure logic — no audio, no React. Reproducibility guarantee: same
 * seed + same call sequence + same EndlessGenerator config = same
 * note stream. Drives unit tests, future leaderboard verification,
 * and shared "daily seed" challenges (see #77 拡張案 phase 2).
 */

import { QUARTER_NOTE_TICKS, type RhythmNote } from '../model';
import { createSeededRng, type SeededRng } from '../random/seededRng';
import {
  fragmentsAvailableForTier,
  type RhythmFragment,
} from './endlessVocabulary';
import { rampForBar, type RampStep } from './endlessRamp';

export interface GeneratedBar {
  /** 0-based bar index in the run. */
  index: number;
  /** Absolute tick of this bar's first beat in the overall stream. */
  startTick: number;
  /** Time signature applied to this bar. */
  numerator: number;
  denominator: number;
  /** Tier (vocabulary unlock level) the bar was generated against. */
  tier: number;
  /** True when this bar is a checkpoint "breath" bar. */
  checkpoint: boolean;
  /** Notes for this bar, with ticks relative to the overall stream. */
  notes: RhythmNote[];
}

export interface EndlessGeneratorConfig {
  /** RNG seed — same seed + same playthrough = same notes. */
  seed: number;
  /**
   * Optional override to cap or extend the ramp. Used by tests so the
   * ramp's tier curve doesn't have to be edited to verify generator
   * behaviour at a specific tier.
   */
  rampOverride?: (barIdx: number) => RampStep;
}

export class EndlessGenerator {
  private readonly rng: SeededRng;
  private readonly ramp: (barIdx: number) => RampStep;
  private nextBarIdx = 0;
  private nextStartTick = 0;

  constructor(config: EndlessGeneratorConfig) {
    this.rng = createSeededRng(config.seed);
    this.ramp = config.rampOverride ?? rampForBar;
  }

  /** Get the next measure of generated music. Advances internal state. */
  generateBar(): GeneratedBar {
    const idx = this.nextBarIdx;
    const startTick = this.nextStartTick;
    const step = this.ramp(idx);
    const barTicks = ticksPerMeasure(step.numerator, step.denominator);

    const notes = step.checkpoint
      ? generateCheckpointBar(step.numerator, idx, startTick)
      : generateRichBar(step, this.rng, idx, startTick, barTicks);

    this.nextBarIdx = idx + 1;
    this.nextStartTick = startTick + barTicks;

    return {
      index: idx,
      startTick,
      numerator: step.numerator,
      denominator: step.denominator,
      tier: step.tier,
      checkpoint: step.checkpoint,
      notes,
    };
  }

  /** Convenience — generate `count` bars in one shot. */
  generateBars(count: number): GeneratedBar[] {
    const out: GeneratedBar[] = [];
    for (let i = 0; i < count; i++) out.push(this.generateBar());
    return out;
  }
}

function ticksPerMeasure(numerator: number, denominator: number): number {
  return (QUARTER_NOTE_TICKS * 4 * numerator) / denominator;
}

/**
 * Checkpoint bar — straight quarter notes, no rests, no fragmentation.
 * Gives the player a guaranteed easy bar so they can re-collect their
 * pulse before the next push. Beat count comes from `numerator` so
 * 3/4 checkpoints (if the ramp ever introduces them) emit 3 quarters.
 */
function generateCheckpointBar(
  numerator: number,
  barIdx: number,
  startTick: number,
): RhythmNote[] {
  const notes: RhythmNote[] = [];
  for (let i = 0; i < numerator; i++) {
    notes.push({
      id: `e-${barIdx}-cp-${i}`,
      tick: startTick + i * QUARTER_NOTE_TICKS,
      durationTicks: QUARTER_NOTE_TICKS,
      isRest: false,
    });
  }
  return notes;
}

/**
 * Greedy bar-fill: pick fragments one at a time that fit the
 * remaining room, slot them in order, and emit RhythmNotes with
 * absolute-tick `tick` values.
 *
 * The first pick favours fragments that start on a downbeat-friendly
 * length (one-beat or two-beat fragments preferred over four-beat
 * ones) so a bar with a 4/4 meter doesn't routinely emit a single
 * whole note. After the first slot the natural weight distribution
 * carries the texture.
 */
function generateRichBar(
  step: RampStep,
  rng: SeededRng,
  barIdx: number,
  startTick: number,
  barTicks: number,
): RhythmNote[] {
  const notes: RhythmNote[] = [];
  let cursor = 0;
  let atomCounter = 0;
  while (cursor < barTicks) {
    const remaining = barTicks - cursor;
    const pool = fragmentsAvailableForTier(step.tier, remaining);
    if (pool.length === 0) {
      // Fallback: pad with quarter rest. Shouldn't happen because the
      // tier 1 quarter is always in the pool when remaining >= 1 beat,
      // but defends against future tier table edits.
      const padTicks = Math.min(remaining, QUARTER_NOTE_TICKS);
      notes.push({
        id: `e-${barIdx}-pad-${atomCounter++}`,
        tick: startTick + cursor,
        durationTicks: padTicks,
        isRest: true,
      });
      cursor += padTicks;
      continue;
    }
    const fragment = pickFragmentForSlot(pool, rng, cursor === 0);
    for (const atom of fragment.atoms) {
      notes.push({
        id: `e-${barIdx}-${atomCounter++}`,
        tick: startTick + cursor,
        durationTicks: atom.durationTicks,
        isRest: atom.isRest,
      });
      cursor += atom.durationTicks;
    }
  }
  return notes;
}

/**
 * Weighted sample from the fragment pool. When laying down the FIRST
 * fragment of a bar we down-weight whole-bar fragments (so we don't
 * accidentally land on a single whole-note bar every time the ramp
 * leaves it in the pool), but past the first slot the natural weights
 * take over.
 */
function pickFragmentForSlot(
  pool: readonly RhythmFragment[],
  rng: SeededRng,
  isFirstSlot: boolean,
): RhythmFragment {
  const entries = pool.map((f) => {
    const downWeight = isFirstSlot && f.totalTicks >= QUARTER_NOTE_TICKS * 4 ? 0.2 : 1;
    return { value: f, weight: f.weight * downWeight };
  });
  return rng.pickWeighted(entries);
}
