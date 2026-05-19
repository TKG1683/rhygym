/**
 * Free-running metronome — clicks forever at the given BPM until stopped.
 *
 * Separate from GameScheduler on purpose: the game waits in a `waiting`
 * state where the player can listen to the beat for as long as they want
 * before tapping to start. FreeMetronome fills that state with a steady
 * pulse; once the player taps, the caller stops the FreeMetronome and
 * starts the GameScheduler — both are 100 ms look-ahead schedulers so
 * the handoff is seamless if they share the same BPM.
 */

import { isAccentBeat, scheduleClick, DEFAULT_METRONOME_VOLUME } from './metronome';

const LOOK_AHEAD_SEC = 0.1;
const TICK_INTERVAL_MS = 25;
const SCHEDULE_PAST_TOLERANCE_SEC = 0.01;

export interface FreeMetronomeOptions {
  bpm: number;
  /**
   * Time-signature numerator and denominator. denominator drives the
   * click subdivision (4 → quarter pulses, 8 → eighth pulses).
   * numerator determines where a measure ends; for compound meters
   * (6/8, 9/8, 12/8) clicks are accented every 3 eighths so the pulse
   * reads as "TA-ta-ta" rather than "TA-ta-ta-ta-ta-ta".
   */
  numerator: number;
  denominator: number;
  volume?: number;
}

export class FreeMetronome {
  private readonly ctx: AudioContext;
  private readonly bpm: number;
  private readonly numerator: number;
  private readonly denominator: number;
  private volume: number;

  private startTime = 0;
  private scheduledUpTo = 0; // sec since startTime
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  /**
   * Clicks we've queued into the AudioContext. Each entry remembers the
   * AudioContext time it was scheduled to start at, so stop() can
   * distinguish "still in the future, silence it" from "already
   * firing, let it ring out". This matters at end-of-song: without it
   * the 100 ms look-ahead silently swallowed every still-firing
   * click (sounded clipped), or — with a setTimeout work-around — let
   * the look-ahead's queued next-measure beat play through and the
   * song ran one click too long.
   */
  private scheduledOscs: Array<{ osc: OscillatorNode; startAt: number }> = [];

  constructor(ctx: AudioContext, opts: FreeMetronomeOptions) {
    this.ctx = ctx;
    this.bpm = opts.bpm;
    this.numerator = opts.numerator;
    this.denominator = opts.denominator;
    this.volume = opts.volume ?? DEFAULT_METRONOME_VOLUME;
  }

  get running(): boolean {
    return this._running;
  }

  /**
   * AudioContext time at which the click grid started — i.e. the time
   * of what FreeMetronome considers beat 0. Callers (GameView) need
   * this to align a "next beat to begin the song on" calculation to
   * the same grid the click is rendering on.
   */
  get startTimeAt(): number {
    return this.startTime;
  }

  /**
   * Start the metronome.
   *
   * @param startTime AudioContext.currentTime at which the pulse's beat 1
   *   should land. Defaults to "right now". Pass a precise timestamp
   *   (e.g. the player's tap time) to align the click grid to an external
   *   event without any setTimeout-induced jitter.
   */
  start(startTime?: number): void {
    if (this._running) this.stop();
    this.startTime = startTime ?? this.ctx.currentTime;
    // If startTime is in the past, advance scheduledUpTo so we don't try
    // to back-fill missed clicks.
    const now = this.ctx.currentTime;
    this.scheduledUpTo = Math.max(0, now - this.startTime);
    this._running = true;
    this.intervalId = setInterval(() => this.schedule(), TICK_INTERVAL_MS);
    this.schedule();
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // Silence only the clicks that haven't started yet. Currently-firing
    // ones (startAt <= now) are allowed to ring out — disconnect()ing
    // them would clip the tail mid-decay. Using disconnect() on the
    // future ones is the bulletproof option: scheduleClick already
    // called osc.stop() at audioTime+duration, and per spec a second
    // osc.stop() throws InvalidStateError, so re-stopping wouldn't
    // actually silence them. disconnect() severs the node from the
    // graph unconditionally.
    const now = this.ctx.currentTime;
    for (const { osc, startAt } of this.scheduledOscs) {
      if (startAt <= now) continue;
      try {
        osc.disconnect();
      } catch {
        // Already disconnected — nothing to do.
      }
    }
    this.scheduledOscs.length = 0;
    this._running = false;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  /**
   * AudioContext time of the next downbeat (the next "1" of a measure)
   * after `now`. GameView aligns the song start to this so that the
   * score's beat 1 coincides with one of the metronome's downbeats —
   * keeps the metronome pulse rock-solid through tap-to-start.
   */
  nextDownbeatTimeFromNow(now: number): number {
    const beatSec = this.beatSec();
    const measureSec = beatSec * this.numerator;
    const sinceStart = now - this.startTime;
    const measuresSince = Math.ceil(sinceStart / measureSec);
    // ceil() returns the *current* measure if we're exactly on a downbeat;
    // bump forward in that edge case so callers always get a "future" beat.
    const target = this.startTime + measuresSince * measureSec;
    if (target <= now) return target + measureSec;
    return target;
  }

  /**
   * Seconds per "beat" as defined by the time signature's denominator:
   * 60/bpm × (4/denominator). For 4/4 this is plain 60/bpm (quarter);
   * for 6/8 it's half that (eighth), so the click subdivides into the
   * notated unit instead of always running on quarters.
   */
  private beatSec(): number {
    return (60 / this.bpm) * (4 / this.denominator);
  }

  private schedule(): void {
    if (!this._running) return;
    const now = this.ctx.currentTime;
    const horizon = now - this.startTime + LOOK_AHEAD_SEC;
    const beatSec = this.beatSec();
    // Accent decisions are shared with the scheduled-play click grid
    // (see isAccentBeat) so waiting and playing sound the same.
    // ceil — start at the first beat STRICTLY past what we already
    // scheduled. With floor, scheduledUpTo=0.1 and beatSec=0.5 yielded
    // index 0 again on the next pass; combined with the past-tolerance
    // window it caused the same beat to be queued twice within a few
    // dozen ms, which sounded like a smeared / hollow click.
    const startBeatIndex = Math.max(0, Math.ceil(this.scheduledUpTo / beatSec));
    const endBeatIndex = Math.ceil(horizon / beatSec);

    for (let i = startBeatIndex; i < endBeatIndex; i++) {
      const beatTime = this.startTime + i * beatSec;
      if (beatTime < now - SCHEDULE_PAST_TOLERANCE_SEC) continue;
      const beatInMeasure = i % this.numerator;
      const isAccent = isAccentBeat(this.numerator, this.denominator, beatInMeasure);
      const osc = scheduleClick(this.ctx, beatTime, isAccent, this.volume);
      const entry = { osc, startAt: beatTime };
      this.scheduledOscs.push(entry);
      osc.onended = () => {
        const idx = this.scheduledOscs.indexOf(entry);
        if (idx >= 0) this.scheduledOscs.splice(idx, 1);
      };
    }
    this.scheduledUpTo = horizon;
  }
}
