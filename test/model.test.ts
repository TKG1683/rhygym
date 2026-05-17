import { describe, expect, it } from 'vitest';
import {
  DOTTED_QUARTER_NOTE_TICKS,
  EIGHTH_NOTE_TICKS,
  EIGHTH_TRIPLET_NOTE_TICKS,
  HALF_NOTE_TICKS,
  PPQ,
  QUARTER_NOTE_TICKS,
  SIXTEENTH_NOTE_TICKS,
  THIRTYSECOND_NOTE_TICKS,
  WHOLE_NOTE_TICKS,
  type Score,
} from '../src/core/model';

describe('note duration constants', () => {
  it('PPQ is 480', () => {
    expect(PPQ).toBe(480);
  });

  it('powers-of-two values stack as expected', () => {
    expect(QUARTER_NOTE_TICKS).toBe(PPQ);
    expect(HALF_NOTE_TICKS).toBe(QUARTER_NOTE_TICKS * 2);
    expect(WHOLE_NOTE_TICKS).toBe(QUARTER_NOTE_TICKS * 4);
    expect(EIGHTH_NOTE_TICKS * 2).toBe(QUARTER_NOTE_TICKS);
    expect(SIXTEENTH_NOTE_TICKS * 4).toBe(QUARTER_NOTE_TICKS);
    expect(THIRTYSECOND_NOTE_TICKS * 8).toBe(QUARTER_NOTE_TICKS);
  });

  it('dotted value equals base * 1.5', () => {
    expect(DOTTED_QUARTER_NOTE_TICKS).toBe(QUARTER_NOTE_TICKS * 1.5);
  });

  it('triplet fits three notes in the parent value', () => {
    expect(EIGHTH_TRIPLET_NOTE_TICKS * 3).toBe(QUARTER_NOTE_TICKS);
  });

  it('all standard values are integers under PPQ=480', () => {
    for (const v of [
      WHOLE_NOTE_TICKS,
      HALF_NOTE_TICKS,
      QUARTER_NOTE_TICKS,
      EIGHTH_NOTE_TICKS,
      SIXTEENTH_NOTE_TICKS,
      THIRTYSECOND_NOTE_TICKS,
      DOTTED_QUARTER_NOTE_TICKS,
      EIGHTH_TRIPLET_NOTE_TICKS,
    ]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('Score literal', () => {
  it('can be built with notes and rests', () => {
    const score: Score = {
      tempos: [{ tick: 0, bpm: 120 }],
      timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
      notes: [
        { id: 'n1', tick: 0, durationTicks: QUARTER_NOTE_TICKS, isRest: false },
        { id: 'n2', tick: QUARTER_NOTE_TICKS, durationTicks: QUARTER_NOTE_TICKS, isRest: false },
        { id: 'n3', tick: QUARTER_NOTE_TICKS * 2, durationTicks: QUARTER_NOTE_TICKS, isRest: true },
        { id: 'n4', tick: QUARTER_NOTE_TICKS * 3, durationTicks: QUARTER_NOTE_TICKS, isRest: false },
      ],
      totalTicks: WHOLE_NOTE_TICKS,
    };
    expect(score.notes).toHaveLength(4);
    expect(score.notes.filter((n) => !n.isRest)).toHaveLength(3);
    expect(score.totalTicks).toBe(WHOLE_NOTE_TICKS);

    const lastNote = score.notes.at(-1)!;
    expect(lastNote.tick + lastNote.durationTicks).toBe(score.totalTicks);
  });
});
