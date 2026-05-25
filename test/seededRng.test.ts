import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../src/core/random/seededRng';

describe('createSeededRng', () => {
  it('reproduces the same sequence for the same seed', () => {
    const a = createSeededRng(1234);
    const b = createSeededRng(1234);
    const aSeq = Array.from({ length: 10 }, () => a.next());
    const bSeq = Array.from({ length: 10 }, () => b.next());
    expect(aSeq).toEqual(bSeq);
  });

  it('produces different sequences for different seeds', () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    const aSeq = Array.from({ length: 8 }, () => a.next());
    const bSeq = Array.from({ length: 8 }, () => b.next());
    expect(aSeq).not.toEqual(bSeq);
  });

  it('stays inside [0, 1) across many draws', () => {
    const rng = createSeededRng(42);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt is uniform-ish over a small range', () => {
    const rng = createSeededRng(7);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 4000; i++) counts[rng.nextInt(4)]!++;
    for (const c of counts) {
      expect(c).toBeGreaterThan(800);
      expect(c).toBeLessThan(1200);
    }
  });

  it('pickWeighted respects relative weights', () => {
    const rng = createSeededRng(99);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 4000; i++) {
      const v = rng.pickWeighted([
        { value: 'a' as const, weight: 1 },
        { value: 'b' as const, weight: 3 },
      ]);
      counts[v]++;
    }
    // b should land roughly 3x as often as a.
    const ratio = counts.b / counts.a;
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(3.5);
  });

  it('pickWeighted throws on empty / all-zero weights', () => {
    const rng = createSeededRng(0);
    expect(() => rng.pickWeighted([])).toThrow();
    expect(() => rng.pickWeighted([{ value: 'x', weight: 0 }])).toThrow();
  });
});
