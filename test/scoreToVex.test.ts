import { describe, expect, it } from 'vitest';
import {
  HALF_NOTE_TICKS,
  QUARTER_NOTE_TICKS,
  WHOLE_NOTE_TICKS,
  type Score,
} from '../src/core/model';
import { decomposeTicks, scoreToVex } from '../src/ui/vexflow/scoreToVex';

describe('decomposeTicks', () => {
  it('returns empty for non-positive input', () => {
    expect(decomposeTicks(0)).toEqual([]);
    expect(decomposeTicks(-100)).toEqual([]);
  });

  it('returns the matching single token when exact', () => {
    expect(decomposeTicks(QUARTER_NOTE_TICKS)).toEqual(['q']);
    expect(decomposeTicks(WHOLE_NOTE_TICKS)).toEqual(['w']);
  });

  it('decomposes greedily largest-first', () => {
    // three quarter notes worth = dotted half (1440)
    expect(decomposeTicks(QUARTER_NOTE_TICKS * 3)).toEqual(['hd']);
    // half + quarter = also dotted half
    expect(decomposeTicks(HALF_NOTE_TICKS + QUARTER_NOTE_TICKS)).toEqual(['hd']);
  });
});

describe('scoreToVex', () => {
  it('renders four quarter notes in one 4/4 measure', () => {
    const score: Score = {
      tempos: [{ tick: 0, bpm: 120 }],
      timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
      notes: Array.from({ length: 4 }, (_, i) => ({
        id: `n${i}`,
        tick: i * QUARTER_NOTE_TICKS,
        durationTicks: QUARTER_NOTE_TICKS,
        isRest: false,
      })),
      totalTicks: WHOLE_NOTE_TICKS,
    };

    const vex = scoreToVex(score);
    expect(vex.measures).toHaveLength(1);
    const m = vex.measures[0]!;
    expect(m.notes).toHaveLength(4);
    expect(m.notes.every((n) => n.vexBaseDuration === 'q' && !n.isRest)).toBe(true);
    expect(m.notes.map((n) => n.originalNoteId)).toEqual(['n0', 'n1', 'n2', 'n3']);
  });

  it('fills a leading rest gap before the first note', () => {
    const score: Score = {
      tempos: [{ tick: 0, bpm: 120 }],
      timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
      notes: [
        {
          id: 'late',
          tick: HALF_NOTE_TICKS,
          durationTicks: HALF_NOTE_TICKS,
          isRest: false,
        },
      ],
      totalTicks: WHOLE_NOTE_TICKS,
    };

    const m = scoreToVex(score).measures[0]!;
    // half rest + half note
    expect(m.notes).toHaveLength(2);
    expect(m.notes[0]!.isRest).toBe(true);
    expect(m.notes[0]!.vexBaseDuration).toBe('h');
    expect(m.notes[1]!.isRest).toBe(false);
    expect(m.notes[1]!.originalNoteId).toBe('late');
  });

  it('fills trailing silence with rests', () => {
    const score: Score = {
      tempos: [{ tick: 0, bpm: 120 }],
      timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
      notes: [
        { id: 'a', tick: 0, durationTicks: QUARTER_NOTE_TICKS, isRest: false },
      ],
      totalTicks: WHOLE_NOTE_TICKS,
    };

    const m = scoreToVex(score).measures[0]!;
    // q + (dotted half rest)
    expect(m.notes.map((n) => n.vexBaseDuration)).toEqual(['q', 'hd']);
    expect(m.notes[1]!.isRest).toBe(true);
  });

  it('spans multiple measures', () => {
    const score: Score = {
      tempos: [{ tick: 0, bpm: 120 }],
      timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
      notes: Array.from({ length: 8 }, (_, i) => ({
        id: `n${i}`,
        tick: i * QUARTER_NOTE_TICKS,
        durationTicks: QUARTER_NOTE_TICKS,
        isRest: false,
      })),
      totalTicks: WHOLE_NOTE_TICKS * 2,
    };

    const vex = scoreToVex(score);
    expect(vex.measures).toHaveLength(2);
    expect(vex.measures[0]!.notes).toHaveLength(4);
    expect(vex.measures[1]!.notes).toHaveLength(4);
    expect(vex.measures[1]!.startTick).toBe(WHOLE_NOTE_TICKS);
  });
});
