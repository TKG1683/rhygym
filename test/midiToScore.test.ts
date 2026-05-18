import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { HALF_NOTE_TICKS, QUARTER_NOTE_TICKS, WHOLE_NOTE_TICKS } from '../src/core/model';
import { midiToScore } from '../src/core/midi/midiToScore';

/**
 * Build a Midi with PPQ=480 (the @tonejs/midi default — Header.ppq is
 * read-only on a fresh instance) and the requested tempo / time sig /
 * notes. For PPQ-scaling tests further down we hand-craft a Midi-shaped
 * object instead — fighting @tonejs/midi's read-only header isn't
 * worth the ceremony for a unit test of arithmetic.
 */
function buildDefaultPpqMidi(opts: {
  bpm?: number;
  timeSig?: [number, number];
  notes: ReadonlyArray<{ ticks: number; durationTicks: number; midi?: number }>;
}): Midi {
  const m = new Midi();
  if (opts.bpm !== undefined) m.header.setTempo(opts.bpm);
  if (opts.timeSig) {
    m.header.timeSignatures.push({
      ticks: 0,
      timeSignature: opts.timeSig,
      measures: 0,
    });
  }
  const track = m.addTrack();
  for (const n of opts.notes) {
    track.addNote({
      midi: n.midi ?? 60,
      ticks: n.ticks,
      durationTicks: n.durationTicks,
      velocity: 0.8,
    });
  }
  // Encode-then-parse so the test exercises the same path real loads use.
  return new Midi(m.toArray());
}

/**
 * Minimal Midi-shaped value that hits just the fields midiToScore reads.
 * Cast through unknown because we're skipping the rest of the surface.
 */
function fakeMidi(opts: {
  ppq: number;
  tempos?: Array<{ ticks: number; bpm: number }>;
  timeSignatures?: Array<{ ticks: number; timeSignature: [number, number] }>;
  notes?: Array<{ ticks: number; durationTicks: number }>;
}): Midi {
  return {
    header: {
      ppq: opts.ppq,
      tempos: opts.tempos ?? [],
      timeSignatures: opts.timeSignatures ?? [],
    },
    tracks: [{ notes: opts.notes ?? [] }],
  } as unknown as Midi;
}

describe('midiToScore — four quarter notes at PPQ=480', () => {
  const midi = buildDefaultPpqMidi({
    bpm: 120,
    timeSig: [4, 4],
    notes: Array.from({ length: 4 }, (_, i) => ({
      ticks: i * 480,
      durationTicks: 480,
    })),
  });
  const score = midiToScore(midi);

  it('preserves tempo', () => {
    expect(score.tempos).toEqual([{ tick: 0, bpm: 120 }]);
  });

  it('preserves time signature', () => {
    expect(score.timeSigs).toEqual([{ tick: 0, numerator: 4, denominator: 4 }]);
  });

  it('emits four quarter-note notes at the right ticks', () => {
    expect(score.notes.map((n) => n.tick)).toEqual([0, 480, 960, 1440]);
    expect(score.notes.every((n) => n.durationTicks === QUARTER_NOTE_TICKS)).toBe(true);
  });

  it('drops pitch — every emitted note is non-rest with auto id', () => {
    for (const n of score.notes) {
      expect(n.isRest).toBe(false);
      expect(n.id).toMatch(/^n\d+$/);
    }
  });

  it('totalTicks reaches the end of the last note', () => {
    expect(score.totalTicks).toBe(WHOLE_NOTE_TICKS);
  });
});

describe('midiToScore — PPQ rescaling', () => {
  it('rescales source ppq=96 → Rhygym ppq=480 (×5)', () => {
    const midi = fakeMidi({
      ppq: 96,
      notes: [
        { ticks: 0, durationTicks: 96 },    // quarter
        { ticks: 96, durationTicks: 96 },   // quarter
        { ticks: 192, durationTicks: 192 }, // half
      ],
    });
    const score = midiToScore(midi);
    expect(score.notes.map((n) => n.tick)).toEqual([0, 480, 960]);
    expect(score.notes.map((n) => n.durationTicks)).toEqual([
      QUARTER_NOTE_TICKS,
      QUARTER_NOTE_TICKS,
      HALF_NOTE_TICKS,
    ]);
  });

  it('rescales source ppq=960 → Rhygym ppq=480 (÷2)', () => {
    // At ppq=960, 960 ticks = one quarter, 1920 ticks = one half.
    const midi = fakeMidi({
      ppq: 960,
      notes: [{ ticks: 960, durationTicks: 1920 }],
    });
    const score = midiToScore(midi);
    expect(score.notes[0]!.tick).toBe(QUARTER_NOTE_TICKS);
    expect(score.notes[0]!.durationTicks).toBe(HALF_NOTE_TICKS);
  });
});

describe('midiToScore — edge cases', () => {
  it('falls back to default tempo/timeSig when MIDI lacks them', () => {
    const midi = fakeMidi({ ppq: 480, notes: [] });
    const score = midiToScore(midi);
    expect(score.tempos).toEqual([{ tick: 0, bpm: 120 }]);
    expect(score.timeSigs).toEqual([{ tick: 0, numerator: 4, denominator: 4 }]);
    expect(score.notes).toEqual([]);
    expect(score.totalTicks).toBe(0);
  });

  it('clamps a sub-tick duration to at least 1 tick after rescaling', () => {
    // Source ppq 960, durationTicks 1 → rescaled 0.5 → round 0 → clamp to 1.
    const midi = fakeMidi({
      ppq: 960,
      notes: [{ ticks: 0, durationTicks: 1 }],
    });
    const score = midiToScore(midi);
    expect(score.notes[0]!.durationTicks).toBeGreaterThanOrEqual(1);
  });

  it('sorts unsorted notes by tick', () => {
    const midi = fakeMidi({
      ppq: 480,
      notes: [
        { ticks: 1440, durationTicks: 480 },
        { ticks: 0, durationTicks: 480 },
        { ticks: 960, durationTicks: 480 },
      ],
    });
    const score = midiToScore(midi);
    expect(score.notes.map((n) => n.tick)).toEqual([0, 960, 1440]);
  });
});
