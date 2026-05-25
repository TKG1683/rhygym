/**
 * Endless mode (#77) difficulty ramp — pure function from bar index
 * to {tier, timeSig, checkpoint?}.
 *
 * Drives the run's progression curve: easy first 20 bars (tier 1,
 * straight 4/4), then progressively higher tiers + occasional
 * time-signature changes. A "checkpoint" bar drops back to tier 1
 * for one bar every CHECKPOINT_EVERY bars — gives the player a
 * 呼吸 (breath) and matches the issue spec's "陸上競技感" framing.
 *
 * BPM is intentionally NOT in this function. The endless run's BPM is
 * fixed by the player's difficulty selection (Andante/Moderato/
 * Allegro/Presto) and never changes mid-run — see
 * [[feedback_no_runtime_bpm_change]].
 */

export interface RampStep {
  /** Vocabulary tier unlocked at this bar (1..5). */
  tier: number;
  /** Time signature for this bar. */
  numerator: number;
  denominator: number;
  /** True when this bar is a "breath" — generator should emit easy quarter notes only. */
  checkpoint: boolean;
}

const CHECKPOINT_EVERY = 20;

/**
 * Tier thresholds expressed as a step function over bar index. Each
 * entry says "from this bar onward, the tier is N". Easier to tweak
 * than a piecewise formula, and the schedule is reproducible per
 * issue spec so a seeded run lands on the same tier curve every time.
 */
const TIER_STEPS: ReadonlyArray<{ startBar: number; tier: number }> = [
  { startBar: 0, tier: 1 },
  { startBar: 20, tier: 2 },
  { startBar: 50, tier: 3 },
  { startBar: 90, tier: 4 },
];

/**
 * Time-signature schedule. Below the first 3/4 introduction the run
 * stays in 4/4; above the variable-meter threshold the renderer can
 * occasionally see 3/4 bars. Variable meter (5/8, 7/8) lands later
 * once the generator + UI can prove it's stable in straight time.
 */
function timeSigForBar(barIdx: number): { numerator: number; denominator: number } {
  if (barIdx >= 60 && barIdx % 8 === 0) return { numerator: 3, denominator: 4 };
  return { numerator: 4, denominator: 4 };
}

export function rampForBar(barIdx: number): RampStep {
  // Checkpoint bar overrides — drop to tier 1, 4/4 so the player gets
  // a guaranteed breather every CHECKPOINT_EVERY bars (= 200 m at the
  // 10 m / bar distance convention from the issue spec).
  const isCheckpoint = barIdx > 0 && barIdx % CHECKPOINT_EVERY === 0;
  if (isCheckpoint) {
    return { tier: 1, numerator: 4, denominator: 4, checkpoint: true };
  }
  let tier = 1;
  for (const step of TIER_STEPS) {
    if (barIdx >= step.startBar) tier = step.tier;
    else break;
  }
  const ts = timeSigForBar(barIdx);
  return { tier, numerator: ts.numerator, denominator: ts.denominator, checkpoint: false };
}

/** Cap the tier so playtesting can clamp a runaway curve. */
export const MAX_TIER = 4;
