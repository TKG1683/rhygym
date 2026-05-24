import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getAllBests,
  getBest,
  getFailStreak,
  getLessonsCompleted,
  incrementFailStreak,
  isNewBest,
  markLessonCompleted,
  resetFailStreak,
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
  etudeId: 'movement-1-etude-1',
  score: 8500,
  rank: 'A',
  achievedAt: '2026-05-17T12:00:00.000Z',
};

describe('localStore — empty state', () => {
  it('getAllBests returns {} when storage is empty', () => {
    expect(getAllBests()).toEqual({});
  });

  it('getBest returns null for an unknown étude', () => {
    expect(getBest('anything')).toBeNull();
  });

  it('isNewBest is true when there is no existing record', () => {
    expect(isNewBest({ etudeId: 'movement-1-etude-1', score: 0 })).toBe(true);
  });
});

describe('localStore — write/read round-trip', () => {
  it('setBest then getBest round-trips the record', () => {
    setBest(sample);
    expect(getBest('movement-1-etude-1')).toEqual(sample);
  });

  it('getAllBests returns every saved record keyed by etudeId', () => {
    setBest(sample);
    setBest({ ...sample, etudeId: 'movement-1-etude-2', score: 7000, rank: 'B' });
    const all = getAllBests();
    expect(Object.keys(all).sort()).toEqual([
      'movement-1-etude-1',
      'movement-1-etude-2',
    ]);
    expect(all['movement-1-etude-2']!.score).toBe(7000);
  });

  it('setBest overwrites a previous entry for the same étude', () => {
    setBest(sample);
    setBest({ ...sample, score: 9999, rank: 'S' });
    expect(getBest('movement-1-etude-1')!.score).toBe(9999);
    expect(getBest('movement-1-etude-1')!.rank).toBe('S');
  });
});

describe('localStore — isNewBest', () => {
  it('true when candidate beats existing', () => {
    setBest(sample); // 8500
    expect(isNewBest({ etudeId: 'movement-1-etude-1', score: 8501 })).toBe(true);
  });

  it('false when candidate equals existing (strict greater-than)', () => {
    setBest(sample);
    expect(isNewBest({ etudeId: 'movement-1-etude-1', score: 8500 })).toBe(false);
  });

  it('false when candidate loses to existing', () => {
    setBest(sample);
    expect(isNewBest({ etudeId: 'movement-1-etude-1', score: 8000 })).toBe(false);
  });
});

describe('localStore — corruption tolerance', () => {
  it('returns {} when the stored value is garbage', () => {
    localStorage.setItem('rhygym:best:v2', '{not valid json');
    expect(getAllBests()).toEqual({});
    expect(getBest('movement-1-etude-1')).toBeNull();
  });

  it('returns {} when the stored value is the wrong shape (array)', () => {
    localStorage.setItem('rhygym:best:v2', '[]');
    expect(getAllBests()).toEqual({});
  });
});

describe('localStore — lessons completed (#53)', () => {
  it('returns empty set when nothing has been marked', () => {
    expect(getLessonsCompleted().size).toBe(0);
  });

  it('marks a lesson and reads it back', () => {
    markLessonCompleted('movement-1-lesson');
    const set = getLessonsCompleted();
    expect(set.has('movement-1-lesson')).toBe(true);
    expect(set.size).toBe(1);
  });

  it('marking the same lesson twice is idempotent', () => {
    markLessonCompleted('movement-3-lesson');
    markLessonCompleted('movement-3-lesson');
    expect(getLessonsCompleted().size).toBe(1);
  });

  it('preserves earlier completions when a new one is added', () => {
    markLessonCompleted('movement-1-lesson');
    markLessonCompleted('movement-2-lesson');
    const set = getLessonsCompleted();
    expect(set.has('movement-1-lesson')).toBe(true);
    expect(set.has('movement-2-lesson')).toBe(true);
  });

  it('returns empty set on corrupt storage', () => {
    localStorage.setItem('rhygym:lessonsCompleted:v1', '{garbage');
    expect(getLessonsCompleted().size).toBe(0);
  });

  it('filters non-string entries from a wrong-shape array', () => {
    localStorage.setItem(
      'rhygym:lessonsCompleted:v1',
      JSON.stringify(['movement-1-lesson', 42, null, 'movement-2-lesson']),
    );
    const set = getLessonsCompleted();
    expect(set.size).toBe(2);
    expect(set.has('movement-1-lesson')).toBe(true);
    expect(set.has('movement-2-lesson')).toBe(true);
  });
});

describe('localStore — v1 → v2 migrator', () => {
  it('translates graded stageIds (level-N-M → movement-N-etude-M)', () => {
    const v1 = {
      'level-3-2': {
        stageId: 'level-3-2',
        score: 9000,
        rank: 'S',
        achievedAt: '2026-04-01T00:00:00.000Z',
      },
      'level-10-5': {
        stageId: 'level-10-5',
        score: 7777,
        rank: 'B',
        achievedAt: '2026-04-02T00:00:00.000Z',
      },
    };
    localStorage.setItem('rhygym:best:v1', JSON.stringify(v1));

    const all = getAllBests();
    expect(Object.keys(all).sort()).toEqual([
      'movement-10-etude-5',
      'movement-3-etude-2',
    ]);
    expect(all['movement-3-etude-2']).toEqual({
      etudeId: 'movement-3-etude-2',
      score: 9000,
      rank: 'S',
      achievedAt: '2026-04-01T00:00:00.000Z',
    });
    expect(all['movement-10-etude-5']!.score).toBe(7777);
  });

  it('translates exam stageIds (level-N-exam → movement-N-final)', () => {
    const v1 = {
      'level-1-exam': {
        stageId: 'level-1-exam',
        score: 6000,
        rank: 'C',
        achievedAt: '2026-04-03T00:00:00.000Z',
      },
    };
    localStorage.setItem('rhygym:best:v1', JSON.stringify(v1));

    const all = getAllBests();
    expect(Object.keys(all)).toEqual(['movement-1-final']);
    expect(all['movement-1-final']!.etudeId).toBe('movement-1-final');
  });

  it('clears the v1 key after a successful migration', () => {
    const v1 = {
      'level-2-3': {
        stageId: 'level-2-3',
        score: 5000,
        rank: 'C',
        achievedAt: '2026-04-04T00:00:00.000Z',
      },
    };
    localStorage.setItem('rhygym:best:v1', JSON.stringify(v1));

    getAllBests();

    expect(localStorage.getItem('rhygym:best:v1')).toBeNull();
    expect(localStorage.getItem('rhygym:best:v2')).not.toBeNull();
  });

  it('is idempotent — second call observes v2 unchanged and does not re-translate', () => {
    const v1 = {
      'level-5-1': {
        stageId: 'level-5-1',
        score: 4500,
        rank: 'C',
        achievedAt: '2026-04-05T00:00:00.000Z',
      },
    };
    localStorage.setItem('rhygym:best:v1', JSON.stringify(v1));

    const first = getAllBests();
    const second = getAllBests();
    expect(second).toEqual(first);
    expect(Object.keys(second)).toEqual(['movement-5-etude-1']);
  });

  it('does NOT touch v1 when v2 already exists (v2 wins)', () => {
    const v1 = {
      'level-1-1': {
        stageId: 'level-1-1',
        score: 1234,
        rank: 'D',
        achievedAt: '2026-04-06T00:00:00.000Z',
      },
    };
    const v2 = {
      'movement-9-etude-3': {
        etudeId: 'movement-9-etude-3',
        score: 9876,
        rank: 'S',
        achievedAt: '2026-05-01T00:00:00.000Z',
      },
    };
    localStorage.setItem('rhygym:best:v1', JSON.stringify(v1));
    localStorage.setItem('rhygym:best:v2', JSON.stringify(v2));

    const all = getAllBests();
    expect(Object.keys(all)).toEqual(['movement-9-etude-3']);
    // v1 untouched — bump is one-way, v2 is source of truth from now on.
    expect(localStorage.getItem('rhygym:best:v1')).not.toBeNull();
  });

  it('drops malformed v1 payload (e.g. invalid JSON) without throwing', () => {
    localStorage.setItem('rhygym:best:v1', '{not valid json');
    expect(getAllBests()).toEqual({});
    // malformed v1 is removed so we don't retry on every read.
    expect(localStorage.getItem('rhygym:best:v1')).toBeNull();
  });

  it('skips individual v1 entries whose fields are wrong, keeps the valid ones', () => {
    const v1 = {
      'level-4-2': {
        stageId: 'level-4-2',
        score: 6500,
        rank: 'B',
        achievedAt: '2026-04-07T00:00:00.000Z',
      },
      bogus: { stageId: 12345, score: 'nope' },
    };
    localStorage.setItem('rhygym:best:v1', JSON.stringify(v1));

    const all = getAllBests();
    expect(Object.keys(all)).toEqual(['movement-4-etude-2']);
  });
});

describe('localStore — failStreak (#55)', () => {
  it('getFailStreak returns 0 for an unknown étude', () => {
    expect(getFailStreak('movement-1-etude-1')).toBe(0);
  });

  it('incrementFailStreak counts up by one and returns the new value', () => {
    expect(incrementFailStreak('movement-2-etude-3')).toBe(1);
    expect(incrementFailStreak('movement-2-etude-3')).toBe(2);
    expect(incrementFailStreak('movement-2-etude-3')).toBe(3);
    expect(getFailStreak('movement-2-etude-3')).toBe(3);
  });

  it('resetFailStreak drops the counter back to zero', () => {
    incrementFailStreak('movement-1-etude-1');
    incrementFailStreak('movement-1-etude-1');
    expect(getFailStreak('movement-1-etude-1')).toBe(2);
    resetFailStreak('movement-1-etude-1');
    expect(getFailStreak('movement-1-etude-1')).toBe(0);
  });

  it('counters are independent across etudeIds', () => {
    incrementFailStreak('etude-a');
    incrementFailStreak('etude-a');
    incrementFailStreak('etude-b');
    expect(getFailStreak('etude-a')).toBe(2);
    expect(getFailStreak('etude-b')).toBe(1);
    resetFailStreak('etude-a');
    expect(getFailStreak('etude-a')).toBe(0);
    expect(getFailStreak('etude-b')).toBe(1);
  });

  it('resetFailStreak on an unknown étude is a no-op', () => {
    expect(() => resetFailStreak('never-touched')).not.toThrow();
    expect(getFailStreak('never-touched')).toBe(0);
  });

  it('returns 0 when the stored value is garbage', () => {
    localStorage.setItem('rhygym:failStreak:v1', '{not valid json');
    expect(getFailStreak('any-etude')).toBe(0);
  });

  it('drops corrupted-value entries (non-number / negative) without throwing', () => {
    localStorage.setItem(
      'rhygym:failStreak:v1',
      JSON.stringify({ a: 'oops', b: -3, c: 4 }),
    );
    expect(getFailStreak('a')).toBe(0);
    expect(getFailStreak('b')).toBe(0);
    expect(getFailStreak('c')).toBe(4);
  });
});
