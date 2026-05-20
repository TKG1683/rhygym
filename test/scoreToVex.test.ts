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

  describe('tied splits (issue #71)', () => {
    it('marks the first piece of a split note as tied to the next', () => {
      // Pick a duration with NO single-notehead representation. 1200 ticks
      // (= tie(eighth(), h()) = 240 + 960) decomposes to h(960) + 8(240) =
      // two tokens. The first must be tiedToNext: true, the second false.
      const score: Score = {
        tempos: [{ tick: 0, bpm: 120 }],
        timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
        notes: [
          { id: 'tied', tick: 0, durationTicks: 1200, isRest: false },
          // pad the bar with a quarter rest gap (1920 - 1200 = 720)
        ],
        totalTicks: WHOLE_NOTE_TICKS,
      };
      const m = scoreToVex(score).measures[0]!;
      const noteTokens = m.notes.filter((n) => !n.isRest);
      expect(noteTokens).toHaveLength(2);
      expect(noteTokens[0]!.tiedToNext).toBe(true);
      expect(noteTokens[1]!.tiedToNext).toBe(false);
      // originalNoteId only on the head fragment.
      expect(noteTokens[0]!.originalNoteId).toBe('tied');
      expect(noteTokens[1]!.originalNoteId).toBe(null);
    });

    it('does not mark expressible single-notehead durations as tied', () => {
      // tie(q(), h()) = 1440 = dotted half (single notehead).
      const score: Score = {
        tempos: [{ tick: 0, bpm: 120 }],
        timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
        notes: [
          { id: 'whole-ish', tick: 0, durationTicks: 1440, isRest: false },
        ],
        totalTicks: WHOLE_NOTE_TICKS,
      };
      const m = scoreToVex(score).measures[0]!;
      const head = m.notes.find((n) => !n.isRest)!;
      expect(head.vexBaseDuration).toBe('hd');
      expect(head.tiedToNext).toBe(false);
    });

    it('marks every fragment except the last in a three-way split', () => {
      // 1380 ticks decomposes to h(960) + 8d(360) + 32(60) = 3 tokens via
      // the greedy largest-first scheme. All but the last must be tied.
      const score: Score = {
        tempos: [{ tick: 0, bpm: 120 }],
        timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
        notes: [
          { id: 'long', tick: 0, durationTicks: 1380, isRest: false },
        ],
        totalTicks: WHOLE_NOTE_TICKS,
      };
      const m = scoreToVex(score).measures[0]!;
      const noteTokens = m.notes.filter((n) => !n.isRest);
      expect(noteTokens.length).toBeGreaterThanOrEqual(3);
      // All but the last fragment of the source note must be tied.
      for (let i = 0; i < noteTokens.length - 1; i++) {
        expect(noteTokens[i]!.tiedToNext).toBe(true);
      }
      expect(noteTokens[noteTokens.length - 1]!.tiedToNext).toBe(false);
    });

    it('ties a note across a barline', () => {
      // tie(q(), hd()) starting at tick 960 in 4/4: 480 ticks fit in bar 1
      // (one quarter), 1440 ticks spill into bar 2 (dotted half).
      const score: Score = {
        tempos: [{ tick: 0, bpm: 120 }],
        timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
        notes: [
          // half-note rest filler at start
          { id: 'lead', tick: 0, durationTicks: HALF_NOTE_TICKS, isRest: false },
          // tie(q, hd) = 480 + 1440 = 1920 starting at tick 960 (mid bar 1).
          // Fits 960 of bar 1, 960 into bar 2.
          { id: 'tied', tick: HALF_NOTE_TICKS, durationTicks: 1920, isRest: false },
          // trailing note in bar 2
          { id: 'tail', tick: HALF_NOTE_TICKS + 1920, durationTicks: HALF_NOTE_TICKS, isRest: false },
        ],
        totalTicks: WHOLE_NOTE_TICKS * 2,
      };
      const vex = scoreToVex(score);
      expect(vex.measures).toHaveLength(2);
      const bar1 = vex.measures[0]!;
      const bar2 = vex.measures[1]!;
      // Bar 1: lead (h) + tied portion that fills the rest of the bar.
      // 1920 - 960 = 960 ticks left → half note. Last note in bar 1 must
      // be tiedToNext: true (continues into bar 2).
      const lastInBar1 = bar1.notes[bar1.notes.length - 1]!;
      expect(lastInBar1.tiedToNext).toBe(true);
      expect(lastInBar1.originalNoteId).toBe('tied');
      // Bar 2: tail portion (960 ticks = half note) followed by 'tail'.
      // The tied tail fragment must NOT claim originalNoteId (judgement
      // already counted the head onset in bar 1).
      const firstInBar2 = bar2.notes[0]!;
      expect(firstInBar2.isRest).toBe(false);
      expect(firstInBar2.originalNoteId).toBe(null);
      // The tail fragment ends the tie (no more pieces).
      expect(firstInBar2.tiedToNext).toBe(false);
    });
  });
});
