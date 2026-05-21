import { describe, expect, it } from 'vitest';
import {
  evaluateMaxUnlocked,
  isMovementUnlocked,
  NORMAL_CLEAR_THRESHOLD,
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
  return [id, { etudeId: id, score: 1000, rank, achievedAt: '2026-01-01T00:00:00Z' }];
}

describe('evaluateMaxUnlocked', () => {
  const movements = buildMovements();

  it('no bests → only M1 is unlocked (floor)', () => {
    expect(evaluateMaxUnlocked({}, movements)).toBe(1);
  });

  it(`clearing ${NORMAL_CLEAR_THRESHOLD} M1 etudes at A unlocks M2`, () => {
    const bests = Object.fromEntries([
      best('movement-1-etude-1', 'A'),
      best('movement-1-etude-2', 'A'),
      best('movement-1-etude-3', 'A'),
    ]);
    expect(evaluateMaxUnlocked(bests, movements)).toBe(2);
  });

  it('a mix of S and A counts toward the clear threshold', () => {
    const bests = Object.fromEntries([
      best('movement-1-etude-1', 'S'),
      best('movement-1-etude-2', 'A'),
      best('movement-1-etude-3', 'S'),
    ]);
    expect(evaluateMaxUnlocked(bests, movements)).toBe(2);
  });

  it('B / C / D clears do not count', () => {
    const bests = Object.fromEntries([
      best('movement-1-etude-1', 'B'),
      best('movement-1-etude-2', 'B'),
      best('movement-1-etude-3', 'C'),
      best('movement-1-etude-4', 'D'),
    ]);
    expect(evaluateMaxUnlocked(bests, movements)).toBe(1);
  });

  it('M1 Final S → 飛び級 → M3 unlocked even without etude clears', () => {
    const bests = Object.fromEntries([best('movement-1-final', 'S')]);
    expect(evaluateMaxUnlocked(bests, movements)).toBe(3);
  });

  it('Final at A or below does NOT trigger skip-test unlock', () => {
    const bests = Object.fromEntries([best('movement-1-final', 'A')]);
    expect(evaluateMaxUnlocked(bests, movements)).toBe(1);
  });

  it('skip-test on a locked movement still works (M3 Final S → M5)', () => {
    // Player has done nothing else; only beat M3's Final via the
    // skip-test sub-button.
    const bests = Object.fromEntries([best('movement-3-final', 'S')]);
    expect(evaluateMaxUnlocked(bests, movements)).toBe(5);
  });

  it('normal + skip-test compound: clear M1 etudes AND M3 skip → M5', () => {
    const bests = Object.fromEntries([
      best('movement-1-etude-1', 'A'),
      best('movement-1-etude-2', 'A'),
      best('movement-1-etude-3', 'A'),
      best('movement-3-final', 'S'),
    ]);
    expect(evaluateMaxUnlocked(bests, movements)).toBe(5);
  });

  it('chained skip-tests stack: M1 Final S → M3; M3 Final S → M5', () => {
    const bests = Object.fromEntries([
      best('movement-1-final', 'S'),
      best('movement-3-final', 'S'),
    ]);
    expect(evaluateMaxUnlocked(bests, movements)).toBe(5);
  });

  it('clearing top of curriculum caps at the highest movement', () => {
    // S on M10 etudes + S on Final would push max to 12; cap at 10.
    const bests = Object.fromEntries([
      best('movement-10-etude-1', 'S'),
      best('movement-10-etude-2', 'S'),
      best('movement-10-etude-3', 'S'),
      best('movement-10-final', 'S'),
    ]);
    expect(evaluateMaxUnlocked(bests, movements)).toBe(10);
  });

  it('Final stage A+ clears do NOT count toward the 3-etude threshold', () => {
    // M1 etudes 1-2 cleared + Final S — only 2 normal clears, doesn't
    // meet threshold. But Final S triggers skip → M3.
    const bests = Object.fromEntries([
      best('movement-1-etude-1', 'A'),
      best('movement-1-etude-2', 'A'),
      best('movement-1-final', 'S'),
    ]);
    expect(evaluateMaxUnlocked(bests, movements)).toBe(3);
  });

  it('empty movements list → returns 1 (defensive)', () => {
    expect(evaluateMaxUnlocked({}, [])).toBe(1);
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
