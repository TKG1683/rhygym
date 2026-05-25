/**
 * Tiny deterministic PRNG for the endless mode (#77).
 *
 * mulberry32 is fast, 32-bit state, and good enough for "pick the
 * next rhythm pattern" sampling — it's not a cryptographic RNG and
 * shouldn't be used as one. The point is reproducibility: same seed
 * + same call sequence = same output. Lets us replay a run from a
 * shared seed (daily-seed leaderboards, regression tests, debug
 * reproduction of a generator bug) without storing the full output.
 */

export interface SeededRng {
  /** Next float in [0, 1). */
  next(): number;
  /** Next integer in [0, n). */
  nextInt(n: number): number;
  /** Pick one element from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /**
   * Weighted pick. Each entry's `weight` is its relative likelihood;
   * weights don't need to normalize. Returns the picked entry's `value`.
   * Throws on empty input or all-zero weights so caller bugs surface
   * immediately instead of silently returning undefined.
   */
  pickWeighted<T>(entries: readonly { value: T; weight: number }[]): T;
}

export function createSeededRng(seed: number): SeededRng {
  // Coerce to a stable 32-bit state. Math.floor handles non-integer
  // seeds; >>> 0 normalises negatives into the unsigned range so the
  // generator's behaviour matches across positive/negative seed inputs.
  let t = Math.floor(seed) >>> 0;
  const nextFloat = (): number => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const nextInt = (n: number): number => {
    if (n <= 0) throw new Error(`nextInt requires n > 0, got ${n}`);
    return Math.floor(nextFloat() * n);
  };
  const pick = <T,>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('pick from empty array');
    return items[nextInt(items.length)]!;
  };
  const pickWeighted = <T,>(entries: readonly { value: T; weight: number }[]): T => {
    if (entries.length === 0) throw new Error('pickWeighted from empty entries');
    let total = 0;
    for (const e of entries) total += Math.max(0, e.weight);
    if (total <= 0) throw new Error('pickWeighted requires at least one positive weight');
    let roll = nextFloat() * total;
    for (const e of entries) {
      const w = Math.max(0, e.weight);
      if (roll < w) return e.value;
      roll -= w;
    }
    // Float drift insurance — return the last positive-weight entry.
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i]!.weight > 0) return entries[i]!.value;
    }
    // Unreachable given the total > 0 check above.
    throw new Error('pickWeighted reached unreachable branch');
  };
  return { next: nextFloat, nextInt, pick, pickWeighted };
}
