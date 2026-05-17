import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QUARTER_NOTE_TICKS,
  WHOLE_NOTE_TICKS,
  type Score,
} from '../src/core/model';
import {
  GameScheduler,
  SCHEDULER_TICK_INTERVAL_MS,
} from '../src/core/audio/scheduler';
import {
  METRONOME_DOWNBEAT_FREQUENCY_HZ,
  METRONOME_OFFBEAT_FREQUENCY_HZ,
} from '../src/core/audio/metronome';
import { MockAudioContext } from './mockAudioContext';

function makeScore(measures = 2): Score {
  return {
    tempos: [{ tick: 0, bpm: 120 }],
    timeSigs: [{ tick: 0, numerator: 4, denominator: 4 }],
    notes: [],
    totalTicks: WHOLE_NOTE_TICKS * measures,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GameScheduler — lifecycle', () => {
  it('starts not playing', () => {
    const ctx = new MockAudioContext();
    const s = new GameScheduler({
      score: makeScore(),
      audioContext: ctx as unknown as AudioContext,
    });
    expect(s.playing).toBe(false);
    expect(s.currentTick).toBe(0);
  });

  it('play() flips playing flag and starts ticking', async () => {
    const ctx = new MockAudioContext();
    const s = new GameScheduler({
      score: makeScore(),
      audioContext: ctx as unknown as AudioContext,
    });
    await s.play(0);
    expect(s.playing).toBe(true);
  });

  it('stop() freezes currentTick at the audio position', async () => {
    const ctx = new MockAudioContext();
    const s = new GameScheduler({
      score: makeScore(),
      audioContext: ctx as unknown as AudioContext,
    });
    await s.play(0);
    ctx.advance(0.25); // 0.25 sec of song time = 0.5 beat at 120 BPM
    s.stop();
    expect(s.playing).toBe(false);
    const frozen = s.currentTick;
    ctx.advance(1.0);
    expect(s.currentTick).toBe(frozen);
  });
});

describe('GameScheduler — metronome scheduling', () => {
  it('schedules look-ahead clicks at every quarter-note beat (120 BPM, 4/4)', async () => {
    const ctx = new MockAudioContext();
    const s = new GameScheduler({
      score: makeScore(1), // 4 beats total
      audioContext: ctx as unknown as AudioContext,
    });
    await s.play(0);
    // play() already ran one schedule frame. Advance the audio clock far
    // enough that every beat in the 4-beat measure ends up in the
    // look-ahead window after a few wakeups.
    for (let i = 0; i < 4; i++) {
      ctx.advance(0.5); // 0.5 sec per quarter note at 120 BPM
      vi.advanceTimersByTime(SCHEDULER_TICK_INTERVAL_MS * 5);
    }

    // 4 beats expected: 0.0, 0.5, 1.0, 1.5 sec
    expect(ctx.oscStarts).toEqual([0.0, 0.5, 1.0, 1.5]);
    expect(ctx.oscFreqs).toEqual([
      METRONOME_DOWNBEAT_FREQUENCY_HZ,
      METRONOME_OFFBEAT_FREQUENCY_HZ,
      METRONOME_OFFBEAT_FREQUENCY_HZ,
      METRONOME_OFFBEAT_FREQUENCY_HZ,
    ]);
    s.dispose();
  });

  it('does not schedule clicks when metronome is disabled', async () => {
    const ctx = new MockAudioContext();
    const s = new GameScheduler({
      score: makeScore(1),
      audioContext: ctx as unknown as AudioContext,
      metronomeEnabled: false,
    });
    await s.play(0);
    ctx.advance(2.0);
    vi.advanceTimersByTime(SCHEDULER_TICK_INTERVAL_MS * 20);
    expect(ctx.oscStarts).toEqual([]);
    s.dispose();
  });

  it('setMetronome(false) stops emitting future clicks', async () => {
    const ctx = new MockAudioContext();
    const s = new GameScheduler({
      score: makeScore(2),
      audioContext: ctx as unknown as AudioContext,
    });
    await s.play(0);
    s.setMetronome(false);
    ctx.advance(2.0);
    vi.advanceTimersByTime(SCHEDULER_TICK_INTERVAL_MS * 20);
    // Only the very first frame (during play()) might have queued the
    // tick=0 downbeat; depending on look-ahead it may or may not have.
    // The guarantee: nothing past beat 1 was emitted.
    for (const t of ctx.oscStarts) {
      expect(t).toBeLessThan(0.5);
    }
    s.dispose();
  });
});

describe('GameScheduler — currentTick clocks', () => {
  it('audioCurrentTick advances with ctx.currentTime', async () => {
    const ctx = new MockAudioContext();
    const s = new GameScheduler({
      score: makeScore(),
      audioContext: ctx as unknown as AudioContext,
    });
    await s.play(0);
    ctx.advance(0.5); // one quarter at 120 BPM
    expect(s.audioCurrentTick).toBeCloseTo(QUARTER_NOTE_TICKS, 0);
    s.dispose();
  });

  it('currentTick leads audioCurrentTick by the visual lead', async () => {
    const ctx = new MockAudioContext();
    const s = new GameScheduler({
      score: makeScore(),
      audioContext: ctx as unknown as AudioContext,
    });
    await s.play(0);
    ctx.advance(0.5);
    expect(s.currentTick).toBeGreaterThan(s.audioCurrentTick);
    s.dispose();
  });
});

describe('GameScheduler — completion', () => {
  it('fires onComplete when playback reaches totalTicks and stops', async () => {
    const ctx = new MockAudioContext();
    const onComplete = vi.fn();
    const s = new GameScheduler({
      score: makeScore(1), // 2 sec at 120 BPM
      audioContext: ctx as unknown as AudioContext,
      metronomeEnabled: false,
      onComplete,
    });
    await s.play(0);
    ctx.advance(3.0); // past the end
    vi.advanceTimersByTime(SCHEDULER_TICK_INTERVAL_MS * 2);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(s.playing).toBe(false);
  });
});
