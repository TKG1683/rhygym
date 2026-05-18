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

import { scheduleClick, DEFAULT_METRONOME_VOLUME } from './metronome';

const LOOK_AHEAD_SEC = 0.1;
const TICK_INTERVAL_MS = 25;
const SCHEDULE_PAST_TOLERANCE_SEC = 0.01;

export interface FreeMetronomeOptions {
  bpm: number;
  /**
   * How many beats make up one measure. Currently unused by the click
   * itself — every beat renders identically (see schedule() for why).
   * Kept on the API so a future "accent downbeat" setting can plug in
   * without changing the constructor signature.
   */
  beatsPerMeasure: number;
  volume?: number;
}

export class FreeMetronome {
  private readonly ctx: AudioContext;
  private readonly bpm: number;
  private readonly beatsPerMeasure: number;
  private volume: number;

  private startTime = 0;
  private scheduledUpTo = 0; // sec since startTime
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  /**
   * Oscillators we've queued into the AudioContext but haven't actually
   * fired yet. Tracking them lets stop() cancel pending clicks instead
   * of leaving zombies that keep firing after the FreeMetronome instance
   * has been disposed. This matters under React StrictMode where the
   * setup effect runs twice and the first instance's queued clicks
   * would otherwise double-up with the second instance's.
   */
  private scheduledOscs: OscillatorNode[] = [];

  constructor(ctx: AudioContext, opts: FreeMetronomeOptions) {
    this.ctx = ctx;
    this.bpm = opts.bpm;
    this.beatsPerMeasure = opts.beatsPerMeasure;
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
    // Silence any pending clicks. Using disconnect() rather than osc.stop()
    // is the bulletproof option: scheduleClick already calls osc.stop()
    // once (at audioTime + duration), and per spec a second osc.stop()
    // call throws InvalidStateError, so the silence ramp wouldn't actually
    // take effect. disconnect() severs the node from the audio graph,
    // guaranteeing no further output regardless of scheduled callbacks.
    for (const osc of this.scheduledOscs) {
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
    const beatSec = 60 / this.bpm;
    const measureSec = beatSec * this.beatsPerMeasure;
    const sinceStart = now - this.startTime;
    const measuresSince = Math.ceil(sinceStart / measureSec);
    // ceil() returns the *current* measure if we're exactly on a downbeat;
    // bump forward in that edge case so callers always get a "future" beat.
    const target = this.startTime + measuresSince * measureSec;
    if (target <= now) return target + measureSec;
    return target;
  }

  private schedule(): void {
    if (!this._running) return;
    const now = this.ctx.currentTime;
    const horizon = now - this.startTime + LOOK_AHEAD_SEC;
    const beatSec = 60 / this.bpm;
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
      // Always render every click identically (no downbeat accent).
      // Accenting beat 1 would tell the player exactly where the
      // measure begins, which is the exact thing we want them reading
      // off the staff. Flat clicks also mean the player can choose any
      // beat as their starting "1" when they tap to begin — the click
      // grid carries no opinion about phrasing.
      const osc = scheduleClick(this.ctx, beatTime, false, this.volume);
      this.scheduledOscs.push(osc);
      osc.onended = () => {
        const idx = this.scheduledOscs.indexOf(osc);
        if (idx >= 0) this.scheduledOscs.splice(idx, 1);
      };
    }
    this.scheduledUpTo = horizon;
  }
}
