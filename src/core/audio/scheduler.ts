/**
 * GameScheduler — look-ahead audio scheduler for Rhygym.
 *
 * Runs a 25 ms wakeup timer that schedules metronome clicks up to 100 ms
 * into the future against AudioContext.currentTime, so playback is
 * sample-accurate even when the JS thread jitters.
 *
 * Two clocks are exposed:
 *   - audioCurrentTick: the tick that matches what the user actually
 *     hears right now. Used by tap-judgement.
 *   - currentTick: audioCurrentTick plus a small visual lead (~60 ms) so
 *     the on-screen playhead reaches each note slightly before the click,
 *     compensating for typical display/speaker latency.
 *
 * Scope kept tight on purpose: no BGM, no loop, no pitch preservation.
 * The mimic-groove scheduler covers all of those — we deliberately
 * strip them away here for a rhythm-only learning app.
 */

import { TickTimeConverter } from '../timing/tickTime';
import type { Score, TimeSignatureEvent } from '../model/types';
import { collectBeats, DEFAULT_METRONOME_VOLUME, scheduleClick } from './metronome';

export const SCHEDULER_LOOK_AHEAD_SEC = 0.1;
export const SCHEDULER_TICK_INTERVAL_MS = 25;
export const VISUAL_PLAYHEAD_LEAD_SEC = 0.06;

/** Tolerance when deciding "is this scheduling target in the past?". */
const SCHEDULE_PAST_TOLERANCE_SEC = 0.01;

const METRONOME_VOLUME_MIN = 0;
const METRONOME_VOLUME_MAX = 1;

export interface GameSchedulerOptions {
  score: Score;
  /** Optional pre-existing AudioContext. If omitted, one is created on first play(). */
  audioContext?: AudioContext | null;
  onTick?: (tick: number) => void;
  /** Fired once when playback reaches score.totalTicks. */
  onComplete?: () => void;
  metronomeEnabled?: boolean;
  metronomeVolume?: number;
  /**
   * Per-time-sig accent overrides. Key = "<numerator>/<denominator>"
   * (e.g. "6/8"); value = boolean[] of length numerator. When a time
   * signature isn't in the map, the metronome's built-in defaults
   * apply.
   */
  accentOverrides?: Readonly<Record<string, readonly boolean[]>>;
}

export class GameScheduler {
  private ctx: AudioContext | null;
  private ownsCtx = false;
  private readonly converter: TickTimeConverter;
  private readonly score: Score;
  private readonly timeSigs: TimeSignatureEvent[];

  private startAudioTime = 0;
  /** Song-time (sec) at which the current playback frame started. */
  private startSec = 0;
  /** Song-time (sec) already covered by past schedule() calls. */
  private scheduledUpTo = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _currentTick = 0;
  private _playing = false;
  /**
   * Set in dispose() so any pending setInterval / setTimeout callbacks
   * that fire afterwards are no-ops instead of touching a closed ctx.
   */
  private _disposed = false;

  private metronomeEnabled: boolean;
  private metronomeVolume: number;
  private accentOverrides: Readonly<Record<string, readonly boolean[]>> | undefined;

  private onTickCb: ((tick: number) => void) | null;
  private onCompleteCb: (() => void) | null;

  constructor(opts: GameSchedulerOptions) {
    this.score = opts.score;
    this.ctx = opts.audioContext ?? null;
    this.converter = new TickTimeConverter(opts.score.tempos);
    this.timeSigs = normaliseTimeSigs(opts.score.timeSigs);
    this.metronomeEnabled = opts.metronomeEnabled ?? true;
    this.metronomeVolume = clampVolume(opts.metronomeVolume ?? DEFAULT_METRONOME_VOLUME);
    this.accentOverrides = opts.accentOverrides;
    this.onTickCb = opts.onTick ?? null;
    this.onCompleteCb = opts.onComplete ?? null;
  }

  get playing(): boolean {
    return this._playing;
  }

  /** Tick that matches what the user is hearing right now (no visual lead). */
  get audioCurrentTick(): number {
    if (!this._playing || !this.ctx) return this._currentTick;
    const elapsed = this.ctx.currentTime - this.startAudioTime;
    return this.converter.secToTick(this.startSec + elapsed);
  }

  /**
   * Tick for on-screen playhead: leads the audio clock by
   * VISUAL_PLAYHEAD_LEAD_SEC so the visible bar reaches each note just
   * before it sounds (cancels typical display/speaker latency).
   */
  get currentTick(): number {
    if (!this._playing || !this.ctx) return this._currentTick;
    const visualAudioTime = this.ctx.currentTime + VISUAL_PLAYHEAD_LEAD_SEC;
    const elapsed = visualAudioTime - this.startAudioTime;
    return this.converter.secToTick(this.startSec + elapsed);
  }

  setMetronome(enabled: boolean, volume?: number): void {
    this.metronomeEnabled = enabled;
    if (volume !== undefined) this.metronomeVolume = clampVolume(volume);
  }

  /**
   * Start playback.
   *
   * @param fromTick     song tick to start from (default 0).
   * @param opts.atAudioTime  optional AudioContext.currentTime at which
   *   beat 1 of the song should align. Use this to dovetail with an
   *   external clock (e.g. a free-running metronome): the scheduler
   *   queues clicks/notes for that exact audio time instead of "now",
   *   so the song's first beat lands on the next external downbeat
   *   without jittering the surrounding pulse.
   */
  async play(fromTick = 0, opts: { atAudioTime?: number } = {}): Promise<void> {
    if (this._playing) this.stop();

    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.ownsCtx = true;
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this._currentTick = Math.max(0, fromTick);
    this.startSec = this.converter.tickToSec(this._currentTick);
    this.startAudioTime = opts.atAudioTime ?? this.ctx.currentTime;
    this.scheduledUpTo = this.startSec;
    this._playing = true;

    this.intervalId = setInterval(() => this.scheduleSafely(), SCHEDULER_TICK_INTERVAL_MS);
    this.scheduleSafely();
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // Freeze the visible tick at wherever audio actually was, so any UI
    // that polls currentTick after stop() reads a stable value.
    this._currentTick = this.audioCurrentTick;
    this._playing = false;
  }

  dispose(): void {
    this._disposed = true;
    this.stop();
    if (this.ctx && this.ownsCtx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }

  /**
   * Replace the per-time-sig accent overrides. Picked up by the next
   * schedule pass (so within ~25 ms / one tick-interval the new pattern
   * is audible). Lets the player toggle accents from the popover and
   * hear the change mid-piece without having to abort the run.
   */
  setAccentOverrides(overrides: Readonly<Record<string, readonly boolean[]>> | undefined): void {
    this.accentOverrides = overrides;
  }

  private scheduleSafely(): void {
    if (this._disposed) return;
    if (!this.ctx || !this._playing) return;
    this.runScheduleFrame();
  }

  private runScheduleFrame(): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const elapsed = now - this.startAudioTime;
    const songSecNow = this.startSec + elapsed;
    const songSecHorizon = songSecNow + SCHEDULER_LOOK_AHEAD_SEC;

    const endSec = this.converter.tickToSec(this.score.totalTicks);
    if (songSecNow >= endSec) {
      this.stop();
      this._currentTick = this.score.totalTicks;
      this.onCompleteCb?.();
      return;
    }

    this._currentTick = this.converter.secToTick(songSecNow);
    this.onTickCb?.(this._currentTick);

    if (this.metronomeEnabled) {
      this.scheduleClicksUntil(songSecHorizon, now);
    }

    this.scheduledUpTo = songSecHorizon;
  }

  private scheduleClicksUntil(horizonSec: number, now: number): void {
    const ctx = this.ctx!;
    const fromTick = Math.max(0, this.converter.secToTick(this.scheduledUpTo));
    const toTick = this.converter.secToTick(horizonSec);
    const beats = collectBeats(this.timeSigs, fromTick, toTick, this.accentOverrides);

    for (const beat of beats) {
      const beatSec = this.converter.tickToSec(beat.tick);
      if (beatSec < this.scheduledUpTo) continue;
      const audioTime = this.startAudioTime + (beatSec - this.startSec);
      if (audioTime < now - SCHEDULE_PAST_TOLERANCE_SEC) continue;
      scheduleClick(ctx, audioTime, beat.isDownbeat, this.metronomeVolume);
    }
  }
}

function normaliseTimeSigs(input: readonly TimeSignatureEvent[]): TimeSignatureEvent[] {
  const sorted = [...input].sort((a, b) => a.tick - b.tick);
  if (sorted.length === 0 || sorted[0]!.tick > 0) {
    sorted.unshift({ tick: 0, numerator: 4, denominator: 4 });
  }
  return sorted;
}

function clampVolume(v: number): number {
  return Math.max(METRONOME_VOLUME_MIN, Math.min(METRONOME_VOLUME_MAX, v));
}
