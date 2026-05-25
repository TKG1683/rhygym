import { describe, expect, it } from 'vitest';
import { EndlessGenerator } from '../src/core/score/endlessGenerator';
import { QUARTER_NOTE_TICKS, WHOLE_NOTE_TICKS } from '../src/core/model';
import type { RampStep } from '../src/core/score/endlessRamp';

function tier1Ramp(barIdx: number): RampStep {
  return { tier: 1, numerator: 4, denominator: 4, checkpoint: barIdx > 0 && barIdx % 20 === 0 };
}

function tier4Ramp(_barIdx: number): RampStep {
  return { tier: 4, numerator: 4, denominator: 4, checkpoint: false };
}

describe('EndlessGenerator', () => {
  it('reproduces the same bars for the same seed', () => {
    const a = new EndlessGenerator({ seed: 17 });
    const b = new EndlessGenerator({ seed: 17 });
    const aBars = a.generateBars(10);
    const bBars = b.generateBars(10);
    expect(aBars).toEqual(bBars);
  });

  it('produces different bars for different seeds', () => {
    const a = new EndlessGenerator({ seed: 1 }).generateBars(6);
    const b = new EndlessGenerator({ seed: 2 }).generateBars(6);
    // Bars share startTick/index but the note layout should differ
    // somewhere across 6 generated bars.
    const aSerial = a.map((bar) => bar.notes.map((n) => `${n.tick}:${n.durationTicks}:${n.isRest}`).join('|')).join(';');
    const bSerial = b.map((bar) => bar.notes.map((n) => `${n.tick}:${n.durationTicks}:${n.isRest}`).join('|')).join(';');
    expect(aSerial).not.toEqual(bSerial);
  });

  it('each generated bar fills exactly its measure-tick budget', () => {
    const gen = new EndlessGenerator({ seed: 123 });
    const bars = gen.generateBars(30);
    for (const bar of bars) {
      const total = bar.notes.reduce((sum, n) => sum + n.durationTicks, 0);
      const expected = (QUARTER_NOTE_TICKS * 4 * bar.numerator) / bar.denominator;
      expect(total).toBe(expected);
    }
  });

  it('notes are tick-monotonic within and across bars', () => {
    const gen = new EndlessGenerator({ seed: 5 });
    const bars = gen.generateBars(15);
    let prevTick = -1;
    for (const bar of bars) {
      for (const n of bar.notes) {
        expect(n.tick).toBeGreaterThanOrEqual(prevTick);
        prevTick = n.tick;
      }
    }
  });

  it('respects the tier limit — tier 1 generates only quarter / half / whole / qr durations', () => {
    const gen = new EndlessGenerator({ seed: 999, rampOverride: tier1Ramp });
    const allowed = new Set([QUARTER_NOTE_TICKS, QUARTER_NOTE_TICKS * 2, WHOLE_NOTE_TICKS]);
    const bars = gen.generateBars(20);
    for (const bar of bars) {
      // Skip checkpoint bars — they're always plain quarters which are already in the set.
      for (const n of bar.notes) {
        expect(allowed.has(n.durationTicks)).toBe(true);
      }
    }
  });

  it('a tier-4 ramp emits at least some sub-quarter durations across a long run', () => {
    const gen = new EndlessGenerator({ seed: 31, rampOverride: tier4Ramp });
    const bars = gen.generateBars(40);
    const hasSubQuarter = bars.some((b) => b.notes.some((n) => n.durationTicks < QUARTER_NOTE_TICKS));
    expect(hasSubQuarter).toBe(true);
  });

  it('checkpoint bars (via default ramp) are plain quarter notes', () => {
    const gen = new EndlessGenerator({ seed: 77 });
    // Burn through to bar 20 — the first checkpoint per endlessRamp.
    const bars = gen.generateBars(25);
    const cp = bars[20]!;
    expect(cp.checkpoint).toBe(true);
    for (const n of cp.notes) {
      expect(n.isRest).toBe(false);
      expect(n.durationTicks).toBe(QUARTER_NOTE_TICKS);
    }
    expect(cp.notes.length).toBe(cp.numerator); // 4 quarters per 4/4 bar
  });

  it('bar startTick accumulates correctly across the stream', () => {
    const gen = new EndlessGenerator({ seed: 8 });
    const bars = gen.generateBars(8);
    let expected = 0;
    for (const bar of bars) {
      expect(bar.startTick).toBe(expected);
      expected += (QUARTER_NOTE_TICKS * 4 * bar.numerator) / bar.denominator;
    }
  });
});
