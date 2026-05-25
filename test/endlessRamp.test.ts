import { describe, expect, it } from 'vitest';
import { rampForBar } from '../src/core/score/endlessRamp';

describe('rampForBar', () => {
  it('starts at tier 1 / 4-4 for the first bars', () => {
    for (let i = 0; i < 5; i++) {
      const step = rampForBar(i);
      expect(step.tier).toBe(1);
      expect(step.numerator).toBe(4);
      expect(step.denominator).toBe(4);
      expect(step.checkpoint).toBe(false);
    }
  });

  it('climbs to tier 2 after bar 20 (excluding checkpoint)', () => {
    expect(rampForBar(21).tier).toBe(2);
    expect(rampForBar(22).tier).toBe(2);
  });

  it('climbs to tier 3 after bar 50', () => {
    expect(rampForBar(51).tier).toBe(3);
  });

  it('climbs to tier 4 after bar 90', () => {
    expect(rampForBar(91).tier).toBe(4);
  });

  it('flags a checkpoint every 20 bars (tier drops back to 1)', () => {
    const cp = rampForBar(20);
    expect(cp.checkpoint).toBe(true);
    expect(cp.tier).toBe(1);
    const cp2 = rampForBar(40);
    expect(cp2.checkpoint).toBe(true);
    expect(cp2.tier).toBe(1);
  });

  it('does not flag bar 0 as a checkpoint', () => {
    expect(rampForBar(0).checkpoint).toBe(false);
  });

  it('is deterministic (same bar idx = same step)', () => {
    for (const idx of [0, 1, 5, 19, 20, 50, 91]) {
      const a = rampForBar(idx);
      const b = rampForBar(idx);
      expect(a).toEqual(b);
    }
  });
});
