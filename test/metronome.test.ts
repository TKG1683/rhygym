import { describe, expect, it } from 'vitest';
import { PPQ, QUARTER_NOTE_TICKS, WHOLE_NOTE_TICKS } from '../src/core/model';
import {
  collectBeats,
  defaultAccentPattern,
  isAccentBeat,
  METRONOME_DOWNBEAT_FREQUENCY_HZ,
  METRONOME_OFFBEAT_FREQUENCY_HZ,
  scheduleClick,
} from '../src/core/audio/metronome';
import { MockAudioContext } from './mockAudioContext';

describe('collectBeats — 4/4', () => {
  const ts = [{ tick: 0, numerator: 4, denominator: 4 }];

  it('returns 4 beats in one measure, every beat marked accent (simple meter)', () => {
    const beats = collectBeats(ts, 0, WHOLE_NOTE_TICKS);
    expect(beats).toEqual([
      { tick: 0, isDownbeat: true },
      { tick: QUARTER_NOTE_TICKS, isDownbeat: true },
      { tick: QUARTER_NOTE_TICKS * 2, isDownbeat: true },
      { tick: QUARTER_NOTE_TICKS * 3, isDownbeat: true },
    ]);
  });

  it('starts at the first beat >= fromTick', () => {
    const beats = collectBeats(ts, QUARTER_NOTE_TICKS + 1, WHOLE_NOTE_TICKS);
    expect(beats.map((b) => b.tick)).toEqual([
      QUARTER_NOTE_TICKS * 2,
      QUARTER_NOTE_TICKS * 3,
    ]);
  });

  it('the next measure stays accented across the board (simple meter)', () => {
    const beats = collectBeats(ts, WHOLE_NOTE_TICKS, WHOLE_NOTE_TICKS * 2);
    expect(beats.every((b) => b.isDownbeat)).toBe(true);
  });

  it('half-open: toTick is exclusive', () => {
    const beats = collectBeats(ts, 0, QUARTER_NOTE_TICKS);
    expect(beats).toEqual([{ tick: 0, isDownbeat: true }]);
  });
});

describe('collectBeats — 3/4', () => {
  it('three accented beats per measure (simple meter)', () => {
    const ts = [{ tick: 0, numerator: 3, denominator: 4 }];
    const measureTicks = QUARTER_NOTE_TICKS * 3;
    const beats = collectBeats(ts, 0, measureTicks);
    expect(beats).toEqual([
      { tick: 0, isDownbeat: true },
      { tick: QUARTER_NOTE_TICKS, isDownbeat: true },
      { tick: QUARTER_NOTE_TICKS * 2, isDownbeat: true },
    ]);
  });
});

describe('collectBeats — denominator other than 4', () => {
  it('6/8 (compound): six eighth pulses, only the 1st and 4th are accents', () => {
    const ts = [{ tick: 0, numerator: 6, denominator: 8 }];
    const eighth = PPQ / 2;
    const beats = collectBeats(ts, 0, eighth * 6);
    expect(beats).toEqual([
      { tick: 0,          isDownbeat: true },
      { tick: eighth,     isDownbeat: false },
      { tick: eighth * 2, isDownbeat: false },
      { tick: eighth * 3, isDownbeat: true },
      { tick: eighth * 4, isDownbeat: false },
      { tick: eighth * 5, isDownbeat: false },
    ]);
  });

  it('5/8 (asymmetric 3+2): accents on the 1st and 4th eighth', () => {
    const ts = [{ tick: 0, numerator: 5, denominator: 8 }];
    const eighth = PPQ / 2;
    const beats = collectBeats(ts, 0, eighth * 5);
    expect(beats.map((b) => b.isDownbeat)).toEqual([true, false, false, true, false]);
  });

  it('7/8 (asymmetric 2+2+3): accents on the 1st, 3rd and 5th eighth', () => {
    const ts = [{ tick: 0, numerator: 7, denominator: 8 }];
    const eighth = PPQ / 2;
    const beats = collectBeats(ts, 0, eighth * 7);
    expect(beats.map((b) => b.isDownbeat)).toEqual([
      true, false, true, false, true, false, false,
    ]);
  });
});

describe('collectBeats — time-signature change mid-window', () => {
  it('switches to the new meter at the change tick', () => {
    const ts = [
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: WHOLE_NOTE_TICKS, numerator: 3, denominator: 4 },
    ];
    const beats = collectBeats(ts, 0, WHOLE_NOTE_TICKS + QUARTER_NOTE_TICKS * 3);
    // 4 beats in measure 1, then 3 beats in the 3/4 measure
    expect(beats.map((b) => b.tick)).toEqual([
      0,
      QUARTER_NOTE_TICKS,
      QUARTER_NOTE_TICKS * 2,
      QUARTER_NOTE_TICKS * 3,
      WHOLE_NOTE_TICKS,
      WHOLE_NOTE_TICKS + QUARTER_NOTE_TICKS,
      WHOLE_NOTE_TICKS + QUARTER_NOTE_TICKS * 2,
    ]);
    expect(beats[4]!.isDownbeat).toBe(true);
  });
});

describe('collectBeats — accent overrides', () => {
  it('user-supplied 4/4 pattern (only beat 1 accented) overrides the simple-meter default', () => {
    const ts = [{ tick: 0, numerator: 4, denominator: 4 }];
    const overrides = { '4/4': [true, false, false, false] };
    const beats = collectBeats(ts, 0, WHOLE_NOTE_TICKS, overrides);
    expect(beats.map((b) => b.isDownbeat)).toEqual([true, false, false, false]);
  });

  it('override of wrong length is ignored — defaults apply', () => {
    const ts = [{ tick: 0, numerator: 4, denominator: 4 }];
    const overrides = { '4/4': [true, false] }; // wrong length
    const beats = collectBeats(ts, 0, WHOLE_NOTE_TICKS, overrides);
    expect(beats.map((b) => b.isDownbeat)).toEqual([true, true, true, true]);
  });

  it('a custom 6/8 pattern lets the player flatten the dotted-quarter accent', () => {
    const ts = [{ tick: 0, numerator: 6, denominator: 8 }];
    const eighth = PPQ / 2;
    const overrides = { '6/8': [true, true, true, true, true, true] };
    const beats = collectBeats(ts, 0, eighth * 6, overrides);
    expect(beats.every((b) => b.isDownbeat)).toBe(true);
  });
});

describe('defaultAccentPattern + isAccentBeat', () => {
  it('defaultAccentPattern returns a length-numerator array', () => {
    expect(defaultAccentPattern(4, 4)).toEqual([true, true, true, true]);
    expect(defaultAccentPattern(6, 8)).toEqual([true, false, false, true, false, false]);
    expect(defaultAccentPattern(5, 8)).toEqual([true, false, false, true, false]);
    expect(defaultAccentPattern(7, 8)).toEqual([true, false, true, false, true, false, false]);
  });

  it('isAccentBeat with custom pattern wins over defaults', () => {
    // 4/4 default = all accent; custom = only beat 1
    expect(isAccentBeat(4, 4, 0, [true, false, false, false])).toBe(true);
    expect(isAccentBeat(4, 4, 2, [true, false, false, false])).toBe(false);
  });
});

describe('scheduleClick', () => {
  it('accent: uses the single click frequency on the oscillator', () => {
    const ctx = new MockAudioContext();
    scheduleClick(ctx as unknown as AudioContext, 1.5, true, 0.5);
    expect(ctx.oscStarts).toEqual([1.5]);
    expect(ctx.oscFreqs).toEqual([METRONOME_DOWNBEAT_FREQUENCY_HZ]);
  });

  it('soft (non-accent) uses the same pitch — accent/non-accent differ by gain, not tone', () => {
    const ctx = new MockAudioContext();
    scheduleClick(ctx as unknown as AudioContext, 2.0, false, 0.5);
    expect(ctx.oscFreqs).toEqual([METRONOME_OFFBEAT_FREQUENCY_HZ]);
    // The OFFBEAT alias resolves to the same value as DOWNBEAT under
    // the new single-pitch scheme.
    expect(METRONOME_OFFBEAT_FREQUENCY_HZ).toBe(METRONOME_DOWNBEAT_FREQUENCY_HZ);
  });
});
