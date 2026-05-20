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

  describe('multi-fragment splits (issue #71 cross-bar bug fix)', () => {
    it('emits multiple tokens for a duration with no single-notehead form', () => {
      // 1200 ticks (= 240 + 960) has no single VexFlow duration. It must
      // decompose into two tokens that sum to 1200 — historically the
      // renderer would either crash or silently drop the remainder.
      const score: Score = {
        tempos: [{ tick: 0, bpm: 120 }],
        timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
        notes: [
          { id: 'long', tick: 0, durationTicks: 1200, isRest: false },
        ],
        totalTicks: WHOLE_NOTE_TICKS,
      };
      const m = scoreToVex(score).measures[0]!;
      const noteTokens = m.notes.filter((n) => !n.isRest);
      expect(noteTokens).toHaveLength(2);
      // Only the head fragment claims the originalNoteId; continuation
      // fragments are not tap targets.
      expect(noteTokens[0]!.originalNoteId).toBe('long');
      expect(noteTokens[1]!.originalNoteId).toBe(null);
    });

    it('renders an expressible duration as a single notehead', () => {
      // 1440 ticks = dotted half. Even though it could have been authored
      // as tie(q(), h()), the renderer collapses it to one notehead because
      // Rhygym tracks onset only — no tie metadata survives the MIDI
      // roundtrip and we don't reconstruct one.
      const score: Score = {
        tempos: [{ tick: 0, bpm: 120 }],
        timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
        notes: [
          { id: 'dotted', tick: 0, durationTicks: 1440, isRest: false },
        ],
        totalTicks: WHOLE_NOTE_TICKS,
      };
      const m = scoreToVex(score).measures[0]!;
      const head = m.notes.find((n) => !n.isRest)!;
      expect(head.vexBaseDuration).toBe('hd');
      expect(head.originalNoteId).toBe('dotted');
    });

    it('splits a note that overflows a barline into per-measure fragments', () => {
      // Starting at tick 960 in 4/4, a 1920-tick note must spill 960
      // into bar 1's tail and the remaining 960 into bar 2's head. The
      // previous renderer over-consumed the cursor and rendered bar 2 as
      // a full-measure rest; this test pins the correct two-fragment
      // shape with the tap target on the head fragment only.
      const score: Score = {
        tempos: [{ tick: 0, bpm: 120 }],
        timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
        notes: [
          { id: 'lead', tick: 0, durationTicks: HALF_NOTE_TICKS, isRest: false },
          { id: 'spans', tick: HALF_NOTE_TICKS, durationTicks: 1920, isRest: false },
          { id: 'tail', tick: HALF_NOTE_TICKS + 1920, durationTicks: HALF_NOTE_TICKS, isRest: false },
        ],
        totalTicks: WHOLE_NOTE_TICKS * 2,
      };
      const vex = scoreToVex(score);
      expect(vex.measures).toHaveLength(2);
      const bar1 = vex.measures[0]!;
      const bar2 = vex.measures[1]!;
      const lastInBar1 = bar1.notes[bar1.notes.length - 1]!;
      // Head fragment owns the originalNoteId (= tap target).
      expect(lastInBar1.originalNoteId).toBe('spans');
      // The carry-over fragment in bar 2 must NOT claim the same id —
      // otherwise the player gets two tap targets for one onset.
      const firstInBar2 = bar2.notes[0]!;
      expect(firstInBar2.isRest).toBe(false);
      expect(firstInBar2.originalNoteId).toBe(null);
    });
  });
});
