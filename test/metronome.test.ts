import { describe, expect, it } from 'vitest';
import { PPQ, QUARTER_NOTE_TICKS, WHOLE_NOTE_TICKS } from '../src/core/model';
import {
  collectBeats,
  METRONOME_DOWNBEAT_FREQUENCY_HZ,
  METRONOME_OFFBEAT_FREQUENCY_HZ,
  scheduleClick,
} from '../src/core/audio/metronome';
import { MockAudioContext } from './mockAudioContext';

describe('collectBeats — 4/4', () => {
  const ts = [{ tick: 0, numerator: 4, denominator: 4 }];

  it('returns 4 beats in one measure, downbeat on beat 1 only', () => {
    const beats = collectBeats(ts, 0, WHOLE_NOTE_TICKS);
    expect(beats).toEqual([
      { tick: 0, isDownbeat: true },
      { tick: QUARTER_NOTE_TICKS, isDownbeat: false },
      { tick: QUARTER_NOTE_TICKS * 2, isDownbeat: false },
      { tick: QUARTER_NOTE_TICKS * 3, isDownbeat: false },
    ]);
  });

  it('starts at the first beat >= fromTick', () => {
    const beats = collectBeats(ts, QUARTER_NOTE_TICKS + 1, WHOLE_NOTE_TICKS);
    expect(beats.map((b) => b.tick)).toEqual([
      QUARTER_NOTE_TICKS * 2,
      QUARTER_NOTE_TICKS * 3,
    ]);
  });

  it('the next measure begins with a downbeat', () => {
    const beats = collectBeats(ts, WHOLE_NOTE_TICKS, WHOLE_NOTE_TICKS * 2);
    expect(beats[0]).toEqual({ tick: WHOLE_NOTE_TICKS, isDownbeat: true });
    expect(beats.slice(1).every((b) => !b.isDownbeat)).toBe(true);
  });

  it('half-open: toTick is exclusive', () => {
    const beats = collectBeats(ts, 0, QUARTER_NOTE_TICKS);
    expect(beats).toEqual([{ tick: 0, isDownbeat: true }]);
  });
});

describe('collectBeats — 3/4', () => {
  it('three beats per measure, only beat 1 is downbeat', () => {
    const ts = [{ tick: 0, numerator: 3, denominator: 4 }];
    const measureTicks = QUARTER_NOTE_TICKS * 3;
    const beats = collectBeats(ts, 0, measureTicks);
    expect(beats).toEqual([
      { tick: 0, isDownbeat: true },
      { tick: QUARTER_NOTE_TICKS, isDownbeat: false },
      { tick: QUARTER_NOTE_TICKS * 2, isDownbeat: false },
    ]);
  });
});

describe('collectBeats — denominator other than 4', () => {
  it('6/8: six beats of an eighth each', () => {
    const ts = [{ tick: 0, numerator: 6, denominator: 8 }];
    const eighth = PPQ / 2;
    const beats = collectBeats(ts, 0, eighth * 6);
    expect(beats.map((b) => b.tick)).toEqual([
      0,
      eighth,
      eighth * 2,
      eighth * 3,
      eighth * 4,
      eighth * 5,
    ]);
    expect(beats[0]!.isDownbeat).toBe(true);
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

describe('scheduleClick', () => {
  it('downbeat: uses downbeat frequency on the oscillator', () => {
    const ctx = new MockAudioContext();
    scheduleClick(ctx as unknown as AudioContext, 1.5, true, 0.5);
    expect(ctx.oscStarts).toEqual([1.5]);
    expect(ctx.oscFreqs).toEqual([METRONOME_DOWNBEAT_FREQUENCY_HZ]);
  });

  it('offbeat: uses offbeat frequency', () => {
    const ctx = new MockAudioContext();
    scheduleClick(ctx as unknown as AudioContext, 2.0, false, 0.5);
    expect(ctx.oscFreqs).toEqual([METRONOME_OFFBEAT_FREQUENCY_HZ]);
  });
});
