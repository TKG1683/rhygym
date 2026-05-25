import { describe, it, expect } from 'vitest';
import { filterScoreByLane } from '../src/core/score/lanes';
import { QUARTER_NOTE_TICKS, WHOLE_NOTE_TICKS, type Score } from '../src/core/model';

const baseScore: Score = {
  tempos: [{ tick: 0, bpm: 100 }],
  timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
  totalTicks: WHOLE_NOTE_TICKS,
  notes: [
    { id: 'r1', tick: 0, durationTicks: QUARTER_NOTE_TICKS, isRest: false, lane: 'R' },
    { id: 'l1', tick: 0, durationTicks: QUARTER_NOTE_TICKS, isRest: false, lane: 'L' },
    { id: 'r2', tick: QUARTER_NOTE_TICKS, durationTicks: QUARTER_NOTE_TICKS, isRest: false, lane: 'R' },
    { id: 'l2', tick: QUARTER_NOTE_TICKS, durationTicks: QUARTER_NOTE_TICKS, isRest: false, lane: 'L' },
    { id: 'unscoped', tick: WHOLE_NOTE_TICKS - QUARTER_NOTE_TICKS, durationTicks: QUARTER_NOTE_TICKS, isRest: false },
  ],
};

describe('filterScoreByLane', () => {
  it('keeps only R-lane notes (plus unscoped) when asked for R', () => {
    const filtered = filterScoreByLane(baseScore, 'R');
    expect(filtered.notes.map((n) => n.id)).toEqual(['r1', 'r2', 'unscoped']);
  });

  it('keeps only L-lane notes (plus unscoped) when asked for L', () => {
    const filtered = filterScoreByLane(baseScore, 'L');
    expect(filtered.notes.map((n) => n.id)).toEqual(['l1', 'l2', 'unscoped']);
  });

  it('preserves tempos / timeSigs / totalTicks unchanged', () => {
    const filtered = filterScoreByLane(baseScore, 'R');
    expect(filtered.tempos).toBe(baseScore.tempos);
    expect(filtered.timeSigs).toBe(baseScore.timeSigs);
    expect(filtered.totalTicks).toBe(baseScore.totalTicks);
  });

  it('does not mutate the original score notes array', () => {
    const before = baseScore.notes.length;
    filterScoreByLane(baseScore, 'R');
    expect(baseScore.notes.length).toBe(before);
  });
});
