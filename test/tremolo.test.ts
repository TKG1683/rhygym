import { describe, expect, it } from 'vitest';
import { buildScore } from '../scripts/dsl/buildScore';
import { eighth, h, q, tie, tremolo, w } from '../scripts/dsl/notes';
import { expandToCandidates } from '../src/core/score/candidates';
import { TickTimeConverter } from '../src/core/timing/tickTime';
import { PPQ } from '../src/core/model';

describe('tremolo() DSL helper', () => {
  it('returns a NoteItem with the original duration and the stroke count', () => {
    const item = tremolo(q(), 2);
    expect(item.kind).toBe('note');
    expect(item.isRest).toBe(false);
    expect(item.durationTicks).toBe(PPQ); // unchanged from q()
    expect(item.tremoloStrokes).toBe(2);
  });

  it('strokes=1 wraps a half note (16 implicit half subdivisions… no wait, 2)', () => {
    const item = tremolo(h(), 1);
    expect(item.durationTicks).toBe(PPQ * 2);
    expect(item.tremoloStrokes).toBe(1);
  });

  it('rejects rest values — a silent tremolo has no musical meaning', () => {
    const rest = { kind: 'note' as const, durationTicks: PPQ, isRest: true };
    expect(() => tremolo(rest, 2)).toThrow(/cannot wrap a rest/);
  });

  it('rejects non-positive strokes', () => {
    expect(() => tremolo(q(), 0)).toThrow(/positive integer/);
    expect(() => tremolo(q(), -1)).toThrow(/positive integer/);
    expect(() => tremolo(q(), 1.5)).toThrow(/positive integer/);
  });

  it('preserves duration when wrapping a tied span', () => {
    const tied = tie(q(), h()); // 3 quarters
    const t = tremolo(tied, 2);
    expect(t.durationTicks).toBe(PPQ * 3);
    expect(t.tremoloStrokes).toBe(2);
  });
});

describe('buildScore — tremolo propagation', () => {
  it('writes tremoloStrokes onto the resulting RhythmNote', () => {
    const score = buildScore({ ts: [4, 4], bpm: 120 }, [
      q(),
      tremolo(q(), 2),
      h(),
    ]);
    expect(score.notes).toHaveLength(3);
    expect(score.notes[0]!.tremoloStrokes).toBeUndefined();
    expect(score.notes[1]!.tremoloStrokes).toBe(2);
    expect(score.notes[2]!.tremoloStrokes).toBeUndefined();
  });

  it('a plain note has no tremoloStrokes field at all (kept clean)', () => {
    const score = buildScore({ ts: [4, 4], bpm: 120 }, [q()]);
    const n = score.notes[0]!;
    expect('tremoloStrokes' in n).toBe(false);
  });
});

describe('expandToCandidates — tremolo onset expansion', () => {
  const converter = new TickTimeConverter([{ tick: 0, bpm: 60 }]); // 1 sec per quarter

  it('plain note → 1 candidate at the note onset', () => {
    const score = buildScore({ ts: [4, 4], bpm: 60 }, [q(), q()]);
    const c = expandToCandidates(score.notes, converter);
    expect(c).toEqual([
      { id: 'n0', sec: 0 },
      { id: 'n1', sec: 1 },
    ]);
  });

  it('rest notes are skipped (existing behaviour preserved)', () => {
    const restItem = { kind: 'note' as const, durationTicks: PPQ, isRest: true };
    const score = buildScore({ ts: [4, 4], bpm: 60 }, [q(), restItem, q()]);
    const c = expandToCandidates(score.notes, converter);
    expect(c.map((x) => x.id)).toEqual(['n0', 'n2']);
  });

  it('tremolo(q(), 1) → 2 eighth-rate candidates evenly across the quarter', () => {
    const score = buildScore({ ts: [4, 4], bpm: 60 }, [tremolo(q(), 1), q()]);
    const c = expandToCandidates(score.notes, converter);
    expect(c).toEqual([
      { id: 'n0', sec: 0 },
      { id: 'n0-trem-1', sec: 0.5 },
      { id: 'n1', sec: 1 },
    ]);
  });

  it('tremolo(q(), 2) → 4 sixteenth-rate candidates evenly across the quarter', () => {
    const score = buildScore({ ts: [4, 4], bpm: 60 }, [tremolo(q(), 2)]);
    const c = expandToCandidates(score.notes, converter);
    expect(c).toEqual([
      { id: 'n0',         sec: 0 },
      { id: 'n0-trem-1',  sec: 0.25 },
      { id: 'n0-trem-2',  sec: 0.5 },
      { id: 'n0-trem-3',  sec: 0.75 },
    ]);
  });

  it('tremolo(h(), 3) → 8 thirty-second-rate candidates across the half', () => {
    const score = buildScore({ ts: [4, 4], bpm: 60 }, [tremolo(h(), 3)]);
    const c = expandToCandidates(score.notes, converter);
    expect(c).toHaveLength(8);
    // First and last positions pin the span; spacing is half / 8 = 0.25 sec.
    expect(c[0]!.sec).toBeCloseTo(0);
    expect(c[1]!.sec).toBeCloseTo(0.25);
    expect(c[7]!.sec).toBeCloseTo(1.75);
    // First candidate keeps the source id so noteCoords still resolves.
    expect(c[0]!.id).toBe('n0');
    expect(c[1]!.id).toBe('n0-trem-1');
    expect(c[7]!.id).toBe('n0-trem-7');
  });

  it('whole-note tremolo with 1 stroke (= 2 half-onsets) covers the bar', () => {
    const score = buildScore({ ts: [4, 4], bpm: 60 }, [tremolo(w(), 1)]);
    const c = expandToCandidates(score.notes, converter);
    expect(c).toEqual([
      { id: 'n0', sec: 0 },
      { id: 'n0-trem-1', sec: 2 },
    ]);
  });

  it('tremolo + plain notes interleaved keep their independent ids', () => {
    const score = buildScore({ ts: [4, 4], bpm: 60 }, [
      q(),
      tremolo(q(), 1),
      eighth(),
      eighth(),
    ]);
    const c = expandToCandidates(score.notes, converter);
    expect(c.map((x) => x.id)).toEqual([
      'n0',           // plain quarter at 0
      'n1',           // tremolo head at 1.0
      'n1-trem-1',    // tremolo tail at 1.5
      'n2',           // plain eighth at 2.0
      'n3',           // plain eighth at 2.5
    ]);
  });
});
