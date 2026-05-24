import { describe, expect, it } from 'vitest';
import {
  evaluateMaxUnlocked,
  evaluateProgression,
  isFinalUnlocked,
  isMovementUnlocked,
  FINAL_UNLOCK_THRESHOLD,
  type MovementForProgression,
} from '../src/core/progress/progression';
import type { BestRecord } from '../src/core/storage/localStore';
import type { Rank } from '../src/core/judgement';

// Build the same movement structure the live game has — 10 movements,
// each with 5 etudes + 1 Final — so tests exercise the real shape and
// not a toy approximation that might hide off-by-ones.
function buildMovements(count = 10): MovementForProgression[] {
  return Array.from({ length: count }, (_, i) => {
    const m = i + 1;
    return {
      movement: m,
      stages: [
        { id: `movement-${m}-etude-1` },
        { id: `movement-${m}-etude-2` },
        { id: `movement-${m}-etude-3` },
        { id: `movement-${m}-etude-4` },
        { id: `movement-${m}-etude-5` },
        { id: `movement-${m}-final`, isFinal: true },
      ],
    };
  });
}

function best(id: string, rank: Rank): [string, BestRecord] {
  return [
    id,
    {
      etudeId: id,
      difficulty: 'ESPRESSIVO',
      score: 1000,
      rank,
      achievedAt: '2026-01-01T00:00:00Z',
    },
  ];
}

describe('evaluateMaxUnlocked — normal flow', () => {
  const movements = buildMovements();

  it('no bests → only M1 is unlocked (floor)', () => {
    expect(evaluateMaxUnlocked({}, movements)).toBe(1);
  });

  it('3 M1 etude clears do NOT unlock M2 by themselves — the Final is the gate', () => {
    const bests = Object.fromEntries([
      best('movement-1-etude-1', 'A'),
      best('movement-1-etude-2', 'A'),
      best('movement-1-etude-3', 'A'),
    ]);
    expect(evaluateMaxUnlocked(bests, movements)).toBe(1);
  });

  it('3 M1 etudes A+ AND M1 Final B+ → M2 unlocks', () => {
    const bests = Object.fromEntries([
      best('movement-1-etude-1', 'A'),
      best('movement-1-etude-2', 'A'),
      best('movement-1-etude-3', 'A'),
      best('movement-1-final', 'B'),
    ]);
    expect(evaluateMaxUnlocked(bests, movements)).toBe(2);
  });

  it('M1 Final S (no skip-test mark) → M2 unlocks via normal flow', () => {
    // No skipTestFinals passed → Final rank counts as a normal clear.
    const bests = Object.fromEntries([best('movement-1-final', 'S')]);
    expect(evaluateMaxUnlocked(bests, movements)).toBe(2);
  });

  it('M1 Final C does NOT unlock M2 (rank below B is not a clear)', () => {
    const bests = Object.fromEntries([best('movement-1-final', 'C')]);
    expect(evaluateMaxUnlocked(bests, movements)).toBe(1);
  });

  it('clearing top of curriculum caps at the highest movement', () => {
    // 3 A on M10 etudes + Final S would push past 10; cap at 10.
    const bests = Object.fromEntries([
      best('movement-10-etude-1', 'S'),
      best('movement-10-etude-2', 'S'),
      best('movement-10-etude-3', 'S'),
      best('movement-10-final', 'S'),
    ]);
    expect(evaluateMaxUnlocked(bests, movements)).toBe(10);
  });

  it('legacy / backward-compat: 3 M5 etudes A+ alone keeps M5 reachable', () => {
    const bests = Object.fromEntries([
      best('movement-5-etude-1', 'A'),
      best('movement-5-etude-2', 'A'),
      best('movement-5-etude-3', 'A'),
    ]);
    const result = evaluateProgression(bests, movements);
    expect(result.maxMovementUnlocked).toBe(5);
    expect(result.finalsUnlocked.has(5)).toBe(true);
    expect(result.finalsUnlocked.has(6)).toBe(false);
  });

  it('empty movements list → returns 1 (defensive)', () => {
    expect(evaluateMaxUnlocked({}, [])).toBe(1);
  });

  // ============================================================
  // #53 — Lessons are an OPTIONAL onboarding stage and must NOT
  //       count toward the 3-of-5 Final unlock gate. A player who
  //       only plays the lesson (or even gets S on it) shouldn't
  //       see the Final magically appear.
  // ============================================================
  it('lesson S best does NOT count toward Final unlock', () => {
    const movementsWithLesson: MovementForProgression[] = [
      {
        movement: 1,
        stages: [
          { id: 'movement-1-lesson', isLesson: true },
          { id: 'movement-1-etude-1' },
          { id: 'movement-1-etude-2' },
          { id: 'movement-1-etude-3' },
          { id: 'movement-1-etude-4' },
          { id: 'movement-1-etude-5' },
          { id: 'movement-1-final', isFinal: true },
        ],
      },
    ];
    const bests = Object.fromEntries([
      best('movement-1-lesson', 'S'),
      best('movement-1-etude-1', 'A'),
      best('movement-1-etude-2', 'A'),
    ]);
    // Only 2 graded etudes A+; lesson S doesn't bump that to 3.
    const result = evaluateProgression(bests, movementsWithLesson);
    expect(result.finalsUnlocked.has(1)).toBe(false);
  });

  it('three graded A+ unlocks Final even with lesson present', () => {
    const movementsWithLesson: MovementForProgression[] = [
      {
        movement: 1,
        stages: [
          { id: 'movement-1-lesson', isLesson: true },
          { id: 'movement-1-etude-1' },
          { id: 'movement-1-etude-2' },
          { id: 'movement-1-etude-3' },
          { id: 'movement-1-etude-4' },
          { id: 'movement-1-etude-5' },
          { id: 'movement-1-final', isFinal: true },
        ],
      },
    ];
    const bests = Object.fromEntries([
      best('movement-1-etude-1', 'A'),
      best('movement-1-etude-2', 'A'),
      best('movement-1-etude-3', 'A'),
    ]);
    const result = evaluateProgression(bests, movementsWithLesson);
    expect(result.finalsUnlocked.has(1)).toBe(true);
  });
});

describe('evaluateProgression — skip-test path', () => {
  const movements = buildMovements();

  it('M3 skip-test S → maxUnlocked=3 (M3 etudes only), M2 auto-cleared', () => {
    // skipTestFinals marks the M3 final as "earned via skip-test only"
    // so the normal-flow gate doesn't accidentally bump M4 here.
    const bests = Object.fromEntries([best('movement-3-final', 'S')]);
    const result = evaluateProgression(bests, movements, {
      skipTestFinals: new Set(['movement-3-final']),
    });
    // M3 etudes accessible, but M4 stays locked.
    expect(result.maxMovementUnlocked).toBe(3);
    // M2 is the intermediate that got auto-cleared by the skip.
    expect(result.finalsUnlocked.has(2)).toBe(true);
    // M3 itself's Final stays locked — player must grind 3 etudes
    // to unlock it, then beat it normally to unlock M4.
    expect(result.finalsUnlocked.has(3)).toBe(false);
    // M4 isn't touched.
    expect(result.finalsUnlocked.has(4)).toBe(false);
  });

  it('skip-test at A does NOT unlock anything', () => {
    const bests = Object.fromEntries([best('movement-3-final', 'A')]);
    const result = evaluateProgression(bests, movements, {
      skipTestFinals: new Set(['movement-3-final']),
    });
    expect(result.maxMovementUnlocked).toBe(1);
    expect(result.finalsUnlocked.size).toBe(0);
  });

  it('skip-test at B does NOT unlock anything either', () => {
    const bests = Object.fromEntries([best('movement-3-final', 'B')]);
    const result = evaluateProgression(bests, movements, {
      skipTestFinals: new Set(['movement-3-final']),
    });
    expect(result.maxMovementUnlocked).toBe(1);
  });

  it('chained skip-tests: M3 S then M6 S → maxUnlocked=6, intermediates 2/4/5 auto-cleared', () => {
    const bests = Object.fromEntries([
      best('movement-3-final', 'S'),
      best('movement-6-final', 'S'),
    ]);
    const result = evaluateProgression(bests, movements, {
      skipTestFinals: new Set(['movement-3-final', 'movement-6-final']),
    });
    expect(result.maxMovementUnlocked).toBe(6);
    expect(result.finalsUnlocked.has(2)).toBe(true);
    expect(result.finalsUnlocked.has(4)).toBe(true);
    expect(result.finalsUnlocked.has(5)).toBe(true);
    // Skip-tested Movements themselves stay locked at the Final
    // until 3 etudes are cleared.
    expect(result.finalsUnlocked.has(3)).toBe(false);
    expect(result.finalsUnlocked.has(6)).toBe(false);
  });

  it('skip-test S + 3 etudes A+ + normal Final clear → M+1 unlocks (full path)', () => {
    // Player skip-tested M3 (S), then ground M3 etudes (3 A+), then
    // replayed M3 Final normally. The normal replay would remove
    // M3-final from skipTestFinals (callers do that). Verify that
    // once it's NOT in skipTestFinals, M4 unlocks.
    const bests = Object.fromEntries([
      best('movement-3-final', 'S'),
      best('movement-3-etude-1', 'A'),
      best('movement-3-etude-2', 'A'),
      best('movement-3-etude-3', 'A'),
    ]);
    // Empty skipTestFinals = the normal replay already happened.
    const result = evaluateProgression(bests, movements, {
      skipTestFinals: new Set(),
    });
    expect(result.maxMovementUnlocked).toBe(4);
    expect(result.finalsUnlocked.has(3)).toBe(true);
  });

  it('skip-test S + 3 etudes A+ but skipTest still set → M+1 stays locked', () => {
    // The player ground etudes but hasn't replayed the Final
    // normally yet. M3 Final is now playable from the etude list,
    // but M4 stays locked since the skip-test rank is the only
    // Final clear on record.
    const bests = Object.fromEntries([
      best('movement-3-final', 'S'),
      best('movement-3-etude-1', 'A'),
      best('movement-3-etude-2', 'A'),
      best('movement-3-etude-3', 'A'),
    ]);
    const result = evaluateProgression(bests, movements, {
      skipTestFinals: new Set(['movement-3-final']),
    });
    expect(result.maxMovementUnlocked).toBe(3);
    expect(result.finalsUnlocked.has(3)).toBe(true);
  });

  it('skip-test S without 3 etudes → M Final stays locked in etude list', () => {
    const bests = Object.fromEntries([best('movement-3-final', 'S')]);
    const result = evaluateProgression(bests, movements, {
      skipTestFinals: new Set(['movement-3-final']),
    });
    expect(result.finalsUnlocked.has(3)).toBe(false);
  });
});

describe('evaluateProgression — Final unlock state (etude list)', () => {
  const movements = buildMovements();

  it('no clears → no Finals unlocked', () => {
    const result = evaluateProgression({}, movements);
    expect(result.maxMovementUnlocked).toBe(1);
    expect(result.finalsUnlocked.size).toBe(0);
  });

  it(`${FINAL_UNLOCK_THRESHOLD} M1 etudes A+ → M1 Final unlocks (but M2 stays locked)`, () => {
    const bests = Object.fromEntries([
      best('movement-1-etude-1', 'A'),
      best('movement-1-etude-2', 'S'),
      best('movement-1-etude-3', 'A'),
    ]);
    const result = evaluateProgression(bests, movements);
    expect(result.maxMovementUnlocked).toBe(1);
    expect(result.finalsUnlocked.has(1)).toBe(true);
    expect(result.finalsUnlocked.has(2)).toBe(false);
  });

  it('2 M1 etude clears is below threshold → Final stays locked', () => {
    const bests = Object.fromEntries([
      best('movement-1-etude-1', 'A'),
      best('movement-1-etude-2', 'A'),
    ]);
    const result = evaluateProgression(bests, movements);
    expect(result.finalsUnlocked.has(1)).toBe(false);
  });

  it('normal progression: M1+M2 Final cleared, 3 M3 etudes A → M3 Final unlocks', () => {
    const bests = Object.fromEntries([
      best('movement-1-etude-1', 'A'),
      best('movement-1-etude-2', 'A'),
      best('movement-1-etude-3', 'A'),
      best('movement-1-final', 'B'),
      best('movement-2-etude-1', 'A'),
      best('movement-2-etude-2', 'A'),
      best('movement-2-etude-3', 'A'),
      best('movement-2-final', 'B'),
      best('movement-3-etude-1', 'A'),
      best('movement-3-etude-2', 'A'),
      best('movement-3-etude-3', 'A'),
    ]);
    const result = evaluateProgression(bests, movements);
    expect(result.maxMovementUnlocked).toBe(3);
    expect(result.finalsUnlocked.has(1)).toBe(true);
    expect(result.finalsUnlocked.has(2)).toBe(true);
    expect(result.finalsUnlocked.has(3)).toBe(true);
  });

  it('Final-stage A+ clears do NOT count toward the 3-etude threshold', () => {
    // 2 etudes A + Final S. Final's S still unlocks M2 via the
    // normal flow (no skip-test mark) — that's a separate axis from
    // the Final's *etude-list* visibility on M1.
    const bests = Object.fromEntries([
      best('movement-1-etude-1', 'A'),
      best('movement-1-etude-2', 'A'),
      best('movement-1-final', 'S'),
    ]);
    const result = evaluateProgression(bests, movements);
    expect(result.maxMovementUnlocked).toBe(2);
    expect(result.finalsUnlocked.has(1)).toBe(false);
  });
});

describe('isFinalUnlocked', () => {
  const movements = buildMovements();
  const m1 = movements[0]!;

  it('returns true at threshold of A+ clears', () => {
    const bests = Object.fromEntries([
      best('movement-1-etude-1', 'A'),
      best('movement-1-etude-2', 'A'),
      best('movement-1-etude-3', 'S'),
    ]);
    expect(isFinalUnlocked(m1, bests)).toBe(true);
  });

  it('returns false below threshold', () => {
    const bests = Object.fromEntries([
      best('movement-1-etude-1', 'A'),
      best('movement-1-etude-2', 'A'),
    ]);
    expect(isFinalUnlocked(m1, bests)).toBe(false);
  });

  it('B/C/D clears do not count', () => {
    const bests = Object.fromEntries([
      best('movement-1-etude-1', 'B'),
      best('movement-1-etude-2', 'B'),
      best('movement-1-etude-3', 'C'),
    ]);
    expect(isFinalUnlocked(m1, bests)).toBe(false);
  });
});

describe('isMovementUnlocked', () => {
  it('movements ≤ maxUnlocked are unlocked', () => {
    expect(isMovementUnlocked(1, 5)).toBe(true);
    expect(isMovementUnlocked(5, 5)).toBe(true);
  });

  it('movements > maxUnlocked are locked', () => {
    expect(isMovementUnlocked(6, 5)).toBe(false);
    expect(isMovementUnlocked(10, 1)).toBe(false);
  });
});
