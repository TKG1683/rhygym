import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getAllBests,
  getBest,
  isNewBest,
  setBest,
  type BestRecord,
} from '../src/core/storage/localStore';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

const sample: BestRecord = {
  stageId: 'kyu-10',
  score: 8500,
  rank: 'A',
  achievedAt: '2026-05-17T12:00:00.000Z',
};

describe('localStore — empty state', () => {
  it('getAllBests returns {} when storage is empty', () => {
    expect(getAllBests()).toEqual({});
  });

  it('getBest returns null for an unknown stage', () => {
    expect(getBest('anything')).toBeNull();
  });

  it('isNewBest is true when there is no existing record', () => {
    expect(isNewBest({ stageId: 'kyu-10', score: 0 })).toBe(true);
  });
});

describe('localStore — write/read round-trip', () => {
  it('setBest then getBest round-trips the record', () => {
    setBest(sample);
    expect(getBest('kyu-10')).toEqual(sample);
  });

  it('getAllBests returns every saved record keyed by stageId', () => {
    setBest(sample);
    setBest({ ...sample, stageId: 'kyu-9', score: 7000, rank: 'B' });
    const all = getAllBests();
    expect(Object.keys(all).sort()).toEqual(['kyu-10', 'kyu-9']);
    expect(all['kyu-9']!.score).toBe(7000);
  });

  it('setBest overwrites a previous entry for the same stage', () => {
    setBest(sample);
    setBest({ ...sample, score: 9999, rank: 'S' });
    expect(getBest('kyu-10')!.score).toBe(9999);
    expect(getBest('kyu-10')!.rank).toBe('S');
  });
});

describe('localStore — isNewBest', () => {
  it('true when candidate beats existing', () => {
    setBest(sample); // 8500
    expect(isNewBest({ stageId: 'kyu-10', score: 8501 })).toBe(true);
  });

  it('false when candidate equals existing (strict greater-than)', () => {
    setBest(sample);
    expect(isNewBest({ stageId: 'kyu-10', score: 8500 })).toBe(false);
  });

  it('false when candidate loses to existing', () => {
    setBest(sample);
    expect(isNewBest({ stageId: 'kyu-10', score: 8000 })).toBe(false);
  });
});

describe('localStore — corruption tolerance', () => {
  it('returns {} when the stored value is garbage', () => {
    localStorage.setItem('rhygym:best:v1', '{not valid json');
    expect(getAllBests()).toEqual({});
    expect(getBest('kyu-10')).toBeNull();
  });

  it('returns {} when the stored value is the wrong shape (array)', () => {
    localStorage.setItem('rhygym:best:v1', '[]');
    expect(getAllBests()).toEqual({});
  });
});
