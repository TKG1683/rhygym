import { describe, expect, it } from 'vitest';
import {
  computeResult,
  computeTimingStats,
  findExpiredNotes,
  GOOD_WINDOW_SEC,
  judgeTap,
  PERFECT_WINDOW_SEC,
  rankForAccuracy,
  type Judgement,
  type JudgementRecord,
  type NoteCandidate,
} from '../src/core/judgement';

/** Test helper: build the simplest possible record for a given verdict. */
function rec(j: Judgement): JudgementRecord {
  return { noteId: null, noteSec: null, tapSec: null, diffSec: null, judgement: j };
}

const notes: NoteCandidate[] = [
  { id: 'n0', sec: 1.0 },
  { id: 'n1', sec: 2.0 },
  { id: 'n2', sec: 3.0 },
];

describe('judgeTap — boundary values', () => {
  it('exact tap → PERFECT with diff 0', () => {
    const r = judgeTap(1.0, notes);
    expect(r).toEqual({ noteId: 'n0', judgement: 'PERFECT', diffSec: 0 });
  });

  it('just inside PERFECT window (±49 ms) → PERFECT', () => {
    expect(judgeTap(1.0 - (PERFECT_WINDOW_SEC - 0.001), notes)!.judgement).toBe('PERFECT');
    expect(judgeTap(1.0 + (PERFECT_WINDOW_SEC - 0.001), notes)!.judgement).toBe('PERFECT');
  });

  it('just past PERFECT window → GOOD', () => {
    expect(judgeTap(1.0 + PERFECT_WINDOW_SEC + 0.001, notes)!.judgement).toBe('GOOD');
    expect(judgeTap(1.0 - PERFECT_WINDOW_SEC - 0.001, notes)!.judgement).toBe('GOOD');
  });

  it('inside GOOD window → GOOD', () => {
    expect(judgeTap(1.0 + GOOD_WINDOW_SEC - 0.001, notes)!.judgement).toBe('GOOD');
    expect(judgeTap(1.0 - GOOD_WINDOW_SEC + 0.001, notes)!.judgement).toBe('GOOD');
  });

  it('just past GOOD window → null (stray tap)', () => {
    expect(judgeTap(1.0 + GOOD_WINDOW_SEC + 0.001, notes)).toBeNull();
    expect(judgeTap(1.0 - GOOD_WINDOW_SEC - 0.001, notes)).toBeNull();
  });

  it('sign of diff reflects early vs late', () => {
    const early = judgeTap(0.97, notes)!;
    const late = judgeTap(1.03, notes)!;
    expect(early.diffSec).toBeLessThan(0);
    expect(late.diffSec).toBeGreaterThan(0);
  });
});

describe('judgeTap — picks the nearest candidate', () => {
  it('between two notes, picks the closer one', () => {
    const r = judgeTap(1.06, notes); // 0.06 from n0, 0.94 from n1
    expect(r?.noteId).toBe('n0');
  });

  it('skips candidates that are outside their own GOOD window', () => {
    // tap at 1.3: 0.3 from n0 (out), 0.7 from n1 (out). null.
    expect(judgeTap(1.3, notes)).toBeNull();
  });

  it('empty candidates → null', () => {
    expect(judgeTap(1.0, [])).toBeNull();
  });
});

describe('findExpiredNotes', () => {
  it('flags candidates whose GOOD window has fully elapsed', () => {
    const expired = findExpiredNotes(1.5, notes);
    // At t=1.5, n0 (sec=1.0) is 0.5s past — well beyond GOOD window.
    // n1 (sec=2.0) is still in the future.
    expect(expired.map((c) => c.id)).toEqual(['n0']);
  });

  it('returns empty when no note has fully expired yet', () => {
    // At t=1.05, n0 (sec=1.0) is 0.05s past → still inside GOOD window.
    expect(findExpiredNotes(1.05, notes)).toEqual([]);
  });

  it('does not flag a note still inside the GOOD edge', () => {
    // diff just inside the GOOD window → judgeable (not yet MISS).
    expect(findExpiredNotes(1.0 + GOOD_WINDOW_SEC - 0.001, notes)).toEqual([]);
  });
});

describe('computeResult — counts and accuracy', () => {
  it('empty list → all zero, rank D', () => {
    const r = computeResult([]);
    expect(r).toEqual({
      perfect: 0,
      good: 0,
      miss: 0,
      total: 0,
      accuracy: 0,
      score: 0,
      rank: 'D',
    });
  });

  it('all PERFECT → rank S, score 10000', () => {
    const r = computeResult((['PERFECT', 'PERFECT', 'PERFECT', 'PERFECT'] as Judgement[]).map(rec));
    expect(r.accuracy).toBe(1.0);
    expect(r.score).toBe(10000);
    expect(r.rank).toBe('S');
  });

  it('all GOOD → accuracy 0.5, rank C', () => {
    const r = computeResult((['GOOD', 'GOOD', 'GOOD', 'GOOD'] as Judgement[]).map(rec));
    expect(r.accuracy).toBe(0.5);
    expect(r.rank).toBe('C');
  });

  it('all MISS → accuracy 0, rank D', () => {
    const r = computeResult((['MISS', 'MISS', 'MISS'] as Judgement[]).map(rec));
    expect(r.accuracy).toBe(0);
    expect(r.rank).toBe('D');
  });

  it('mixed verdict counts and weights add up', () => {
    const r = computeResult((['PERFECT', 'PERFECT', 'GOOD', 'MISS'] as Judgement[]).map(rec));
    expect(r.perfect).toBe(2);
    expect(r.good).toBe(1);
    expect(r.miss).toBe(1);
    expect(r.accuracy).toBeCloseTo((2 + 0.5) / 4, 9);
  });
});

describe('computeTimingStats', () => {
  it('returns zero stats when there are no diffs (e.g. all auto-MISS)', () => {
    const s = computeTimingStats([
      { noteId: 'n0', noteSec: 1, tapSec: null, diffSec: null, judgement: 'MISS' },
      { noteId: null, noteSec: null, tapSec: 1.5, diffSec: null, judgement: 'MISS' },
    ]);
    expect(s).toEqual({ meanDiffMs: 0, stdDiffMs: 0, hitCount: 0 });
  });

  it('ignores records without diffSec, averages the rest', () => {
    const s = computeTimingStats([
      { noteId: 'n0', noteSec: 1, tapSec: 1.02, diffSec: 0.02, judgement: 'PERFECT' },
      { noteId: 'n1', noteSec: 2, tapSec: 2.04, diffSec: 0.04, judgement: 'PERFECT' },
      { noteId: 'n2', noteSec: 3, tapSec: null, diffSec: null, judgement: 'MISS' }, // ignored
    ]);
    // Mean of 20 ms and 40 ms = 30 ms; std (population) = 10 ms.
    expect(s.hitCount).toBe(2);
    expect(s.meanDiffMs).toBeCloseTo(30, 6);
    expect(s.stdDiffMs).toBeCloseTo(10, 6);
  });

  it('sign of meanDiffMs reflects rushing vs dragging', () => {
    const early = computeTimingStats([
      { noteId: 'n0', noteSec: 1, tapSec: 0.95, diffSec: -0.05, judgement: 'GOOD' },
      { noteId: 'n1', noteSec: 2, tapSec: 1.97, diffSec: -0.03, judgement: 'PERFECT' },
    ]);
    expect(early.meanDiffMs).toBeLessThan(0); // rushing

    const late = computeTimingStats([
      { noteId: 'n0', noteSec: 1, tapSec: 1.05, diffSec: 0.05, judgement: 'GOOD' },
      { noteId: 'n1', noteSec: 2, tapSec: 2.03, diffSec: 0.03, judgement: 'PERFECT' },
    ]);
    expect(late.meanDiffMs).toBeGreaterThan(0); // dragging
  });
});

describe('rankForAccuracy — threshold boundaries', () => {
  it('honors each rank threshold', () => {
    expect(rankForAccuracy(1.0)).toBe('S');
    expect(rankForAccuracy(0.95)).toBe('S');
    expect(rankForAccuracy(0.949)).toBe('A');
    expect(rankForAccuracy(0.85)).toBe('A');
    expect(rankForAccuracy(0.849)).toBe('B');
    expect(rankForAccuracy(0.7)).toBe('B');
    expect(rankForAccuracy(0.699)).toBe('C');
    expect(rankForAccuracy(0.5)).toBe('C');
    expect(rankForAccuracy(0.499)).toBe('D');
    expect(rankForAccuracy(0)).toBe('D');
  });
});

describe('Judgement type roundtrip', () => {
  // Type-level sanity: make sure the union is exhaustive in computeResult.
  it('accepts each variant', () => {
    const all: Judgement[] = ['PERFECT', 'GOOD', 'MISS'];
    expect(computeResult(all.map(rec)).total).toBe(3);
  });
});
