import { describe, expect, it } from 'vitest';
import { PPQ, QUARTER_NOTE_TICKS, WHOLE_NOTE_TICKS } from '../src/core/model';
import { TickTimeConverter } from '../src/core/timing/tickTime';

describe('TickTimeConverter — single tempo', () => {
  it('BPM=120: one quarter note = 0.5 sec', () => {
    const c = new TickTimeConverter([{ tick: 0, bpm: 120 }]);
    expect(c.tickToSec(QUARTER_NOTE_TICKS)).toBeCloseTo(0.5, 9);
    expect(c.tickToSec(WHOLE_NOTE_TICKS)).toBeCloseTo(2.0, 9);
  });

  it('BPM=60: one quarter note = 1.0 sec', () => {
    const c = new TickTimeConverter([{ tick: 0, bpm: 60 }]);
    expect(c.tickToSec(QUARTER_NOTE_TICKS)).toBeCloseTo(1.0, 9);
  });

  it('tick=0 maps to sec=0', () => {
    const c = new TickTimeConverter([{ tick: 0, bpm: 120 }]);
    expect(c.tickToSec(0)).toBe(0);
    expect(c.secToTick(0)).toBe(0);
  });

  it('round-trips tick → sec → tick exactly within a single segment', () => {
    const c = new TickTimeConverter([{ tick: 0, bpm: 144 }]);
    for (const tick of [0, 100, 480, 1234, 9999]) {
      expect(c.secToTick(c.tickToSec(tick))).toBeCloseTo(tick, 6);
    }
  });
});

describe('TickTimeConverter — defaults', () => {
  it('inserts a 120 BPM segment at tick=0 when missing', () => {
    const c = new TickTimeConverter([]);
    expect(c.bpmAtTick(0)).toBe(120);
    expect(c.tickToSec(QUARTER_NOTE_TICKS)).toBeCloseTo(0.5, 9);
  });

  it('inserts a leading default when the first event is at tick > 0', () => {
    const c = new TickTimeConverter([{ tick: PPQ * 4, bpm: 60 }]);
    // tick 0..1920 plays at the default 120 BPM (1920 ticks = 2 sec)
    expect(c.tickToSec(PPQ * 4)).toBeCloseTo(2.0, 9);
    // tick 1920..2400 plays at 60 BPM (480 ticks = 1 sec)
    expect(c.tickToSec(PPQ * 4 + QUARTER_NOTE_TICKS)).toBeCloseTo(3.0, 9);
  });
});

describe('TickTimeConverter — multiple tempos', () => {
  it('continues sec accumulation across a tempo change', () => {
    // 2 measures at 120 BPM, then switch to 60 BPM.
    const c = new TickTimeConverter([
      { tick: 0, bpm: 120 },
      { tick: WHOLE_NOTE_TICKS * 2, bpm: 60 },
    ]);
    // First switch happens at 4 sec (2 measures of 4/4 at 120 BPM).
    expect(c.tickToSec(WHOLE_NOTE_TICKS * 2)).toBeCloseTo(4.0, 9);
    // One more quarter at 60 BPM = +1.0 sec → 5.0 sec total.
    expect(c.tickToSec(WHOLE_NOTE_TICKS * 2 + QUARTER_NOTE_TICKS)).toBeCloseTo(5.0, 9);
  });

  it('round-trips through a tempo change', () => {
    const c = new TickTimeConverter([
      { tick: 0, bpm: 120 },
      { tick: WHOLE_NOTE_TICKS, bpm: 90 },
      { tick: WHOLE_NOTE_TICKS * 3, bpm: 200 },
    ]);
    for (const tick of [0, 240, 1920, 2400, 5760, 7000]) {
      expect(c.secToTick(c.tickToSec(tick))).toBeCloseTo(tick, 5);
    }
  });

  it('bpmAtTick reports the right tempo at boundaries', () => {
    const c = new TickTimeConverter([
      { tick: 0, bpm: 100 },
      { tick: 1000, bpm: 140 },
    ]);
    expect(c.bpmAtTick(0)).toBe(100);
    expect(c.bpmAtTick(999)).toBe(100);
    expect(c.bpmAtTick(1000)).toBe(140);
    expect(c.bpmAtTick(99999)).toBe(140);
  });

  it('accepts unsorted tempo input', () => {
    const c = new TickTimeConverter([
      { tick: WHOLE_NOTE_TICKS, bpm: 60 },
      { tick: 0, bpm: 120 },
    ]);
    expect(c.tickToSec(WHOLE_NOTE_TICKS)).toBeCloseTo(2.0, 9);
    expect(c.tickToSec(WHOLE_NOTE_TICKS + QUARTER_NOTE_TICKS)).toBeCloseTo(3.0, 9);
  });
});
