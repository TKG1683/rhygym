/**
 * Procedural menu BGM — a tiny softsynth + looping scheduler.
 *
 * Rhygym never ships audio files; every sound is an oscillator rendered
 * on the fly (see metronome.ts). The menu music follows the same rule:
 * a short chord/bass/lead loop is authored as note *data* (see
 * bgmTracks.ts) and this module turns it into sound with a handful of
 * ADSR-shaped voices, scheduled 120 ms ahead against the AudioContext
 * clock so the loop stays glitch-free even when the JS thread jitters.
 *
 * Deliberately kept away from the game grid: BGM only ever runs on the
 * title / stage-select menus, never during a play (reading the staff
 * and the metronome must stay uncluttered — see
 * feedback_minimal_game_feel).
 */

const LOOK_AHEAD_SEC = 0.12;
const TICK_INTERVAL_MS = 30;
const SCHEDULE_PAST_TOLERANCE_SEC = 0.02;
/** exponentialRamp can't reach 0; -60 dB is effectively silent. */
const NEAR_ZERO_GAIN = 0.001;
/** Fade the whole loop in/out so start/stop and screen swaps aren't abrupt. */
const FADE_IN_SEC = 0.8;
const FADE_OUT_SEC = 0.4;

export type VoiceName = 'pad' | 'ep' | 'bass' | 'stab' | 'lead' | 'hat';

/** One scheduled note in a track. Times are in *beats* from loop start. */
export interface BgmEvent {
  /** Onset, in beats from the top of the loop. */
  t: number;
  /** Duration in beats. */
  d: number;
  /** MIDI note number (ignored by the noise-based 'hat' voice). */
  note: number;
  voice: VoiceName;
  /** Per-note gain multiplier (0..1), default 1. */
  g?: number;
}

export interface BgmTrack {
  bpm: number;
  bars: number;
  beatsPerBar: number;
  /** Master gain when the loop is at full volume (0..1). */
  gain: number;
  events: readonly BgmEvent[];
}

/** Equal-tempered MIDI note → frequency (A4 = 69 = 440 Hz). */
export function midiToFreq(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

interface VoiceSpec {
  /** Layered oscillators — each may be detuned / attenuated vs the first. */
  waves: { type: OscillatorType; detuneCents?: number; gain?: number }[];
  filter?: { type: BiquadFilterType; freq: number; q?: number };
  /** ADSR, in seconds (attack/decay/release) and 0..1 (sustain fraction). */
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Peak gain before the per-note multiplier and master gain. */
  peak: number;
}

// Timbres. Peaks are intentionally modest: a pad chord stacks 3-4 notes,
// and everything is summed under the track's master gain, so leaving
// headroom here is what keeps the mix from clipping when voices overlap.
const VOICES: Record<Exclude<VoiceName, 'hat'>, VoiceSpec> = {
  // Warm sustained chord bed — two slightly detuned layers through a
  // gentle low-pass so it reads as a pad, not a raw synth tone.
  pad: {
    waves: [{ type: 'triangle' }, { type: 'sine', detuneCents: 7, gain: 0.6 }],
    filter: { type: 'lowpass', freq: 1900, q: 0.7 },
    attack: 0.06,
    decay: 0.3,
    sustain: 0.7,
    release: 0.5,
    peak: 0.16,
  },
  // Electric-piano-ish pluck for lo-fi comping: fast attack, quick decay
  // to a low sustain so repeated stabs stay distinct and mellow.
  ep: {
    waves: [{ type: 'sine' }, { type: 'sine', detuneCents: 6, gain: 0.5 }],
    filter: { type: 'lowpass', freq: 2600, q: 0.6 },
    attack: 0.005,
    decay: 0.4,
    sustain: 0.22,
    release: 0.35,
    peak: 0.22,
  },
  // Round low end. Low-passed triangle+sine = a soft "finger bass" that
  // sits under the chords without honking.
  bass: {
    waves: [{ type: 'triangle' }, { type: 'sine', gain: 0.5 }],
    filter: { type: 'lowpass', freq: 800, q: 0.9 },
    attack: 0.005,
    decay: 0.12,
    sustain: 0.75,
    release: 0.12,
    peak: 0.3,
  },
  // Funk chord "chank" — bright, percussive, zero sustain so it pops on
  // the off-beat and gets out of the way immediately.
  stab: {
    waves: [{ type: 'sawtooth', gain: 0.5 }, { type: 'square', gain: 0.4 }],
    filter: { type: 'lowpass', freq: 2500, q: 0.9 },
    attack: 0.004,
    decay: 0.1,
    sustain: 0,
    release: 0.06,
    peak: 0.12,
  },
  // Single-note hook. A square/triangle blend with a short tail.
  lead: {
    waves: [{ type: 'square', gain: 0.5 }, { type: 'triangle', gain: 0.5 }],
    filter: { type: 'lowpass', freq: 3200, q: 0.7 },
    attack: 0.005,
    decay: 0.15,
    sustain: 0.4,
    release: 0.16,
    peak: 0.14,
  },
};

/**
 * Schedule one pitched note: build the oscillator stack → filter → ADSR
 * gain → dest, all torn down automatically when the oscillators stop.
 */
function playVoice(
  ctx: AudioContext,
  dest: AudioNode,
  spec: VoiceSpec,
  freq: number,
  start: number,
  durSec: number,
  gainMul: number,
): void {
  const env = ctx.createGain();
  let sink: AudioNode = env;
  if (spec.filter) {
    const filter = ctx.createBiquadFilter();
    filter.type = spec.filter.type;
    filter.frequency.value = spec.filter.freq;
    if (spec.filter.q != null) filter.Q.value = spec.filter.q;
    filter.connect(env);
    sink = filter;
  }
  env.connect(dest);

  const oscs: OscillatorNode[] = [];
  for (const wave of spec.waves) {
    const osc = ctx.createOscillator();
    osc.type = wave.type;
    osc.frequency.value = freq;
    if (wave.detuneCents) osc.detune.value = wave.detuneCents;
    if (wave.gain != null && wave.gain !== 1) {
      const wg = ctx.createGain();
      wg.gain.value = wave.gain;
      osc.connect(wg);
      wg.connect(sink);
    } else {
      osc.connect(sink);
    }
    oscs.push(osc);
  }

  // ADSR. Linear attack from 0 (no start-of-note pop), exponential decay
  // to the sustain floor, then an exponential release starting at the
  // note's end (or the end of the decay, whichever is later so a short
  // note doesn't try to release before it finished decaying).
  const peak = spec.peak * gainMul;
  const sustainLevel = Math.max(peak * spec.sustain, NEAR_ZERO_GAIN);
  const noteEnd = start + durSec;
  const releaseStart = Math.max(noteEnd, start + spec.attack + spec.decay);
  const g = env.gain;
  g.setValueAtTime(0, start);
  g.linearRampToValueAtTime(peak, start + spec.attack);
  g.exponentialRampToValueAtTime(sustainLevel, start + spec.attack + spec.decay);
  g.setValueAtTime(sustainLevel, releaseStart);
  g.exponentialRampToValueAtTime(NEAR_ZERO_GAIN, releaseStart + spec.release);

  const stopAt = releaseStart + spec.release + 0.02;
  for (const osc of oscs) {
    osc.start(start);
    osc.stop(stopAt);
  }
}

/** Schedule one hi-hat tick from a pre-baked noise buffer. */
function playHat(
  ctx: AudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  start: number,
  durSec: number,
  gainMul: number,
): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const env = ctx.createGain();
  src.connect(hp);
  hp.connect(env);
  env.connect(dest);
  const peak = 0.11 * gainMul;
  const dur = Math.max(0.03, durSec);
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(peak, start + 0.002);
  env.gain.exponentialRampToValueAtTime(NEAR_ZERO_GAIN, start + dur);
  src.start(start);
  src.stop(start + dur + 0.02);
}

/**
 * Loops a single {@link BgmTrack} until stopped. One player owns one
 * track; the controller creates a fresh player when the menu music
 * should change (title funk → select lo-fi) and stops the old one.
 */
export class BgmPlayer {
  private readonly ctx: AudioContext;
  private readonly track: BgmTrack;
  private readonly beatSec: number;
  private readonly loopSec: number;
  private readonly noise: AudioBuffer;

  private master: GainNode | null = null;
  /** User volume (0..1) layered on top of the track's own mix gain. */
  private userVolume: number;
  private startTime = 0;
  /** Song-seconds (from loop top, monotonic across loops) already queued. */
  private scheduledUpTo = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(ctx: AudioContext, track: BgmTrack, volume = 1) {
    this.ctx = ctx;
    this.track = track;
    this.userVolume = clamp01(volume);
    this.beatSec = 60 / track.bpm;
    this.loopSec = track.bars * track.beatsPerBar * this.beatSec;
    this.noise = makeNoiseBuffer(ctx);
  }

  /** Full-volume master target = track mix gain × user volume. */
  private targetGain(): number {
    return this.track.gain * this.userVolume;
  }

  start(atTime?: number): void {
    const now = this.ctx.currentTime;
    this.master = this.ctx.createGain();
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(this.targetGain(), now + FADE_IN_SEC);
    this.master.connect(this.ctx.destination);

    // Small lead so the first notes aren't scheduled in the past.
    this.startTime = atTime ?? now + 0.05;
    this.scheduledUpTo = 0;
    this.intervalId = setInterval(() => this.schedule(), TICK_INTERVAL_MS);
    this.schedule();
  }

  /**
   * Live volume change (0..1). Ramps the master over ~120 ms so dragging
   * the slider is smooth rather than zippering. No-op after stop().
   */
  setVolume(volume: number): void {
    this.userVolume = clamp01(volume);
    if (this.stopped || !this.master) return;
    const now = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, NEAR_ZERO_GAIN), now);
    g.linearRampToValueAtTime(Math.max(this.targetGain(), 0), now + 0.12);
  }

  /**
   * Fade out and detach. Already-queued notes keep their own stop()
   * schedule and simply play into the muted master, so nothing clicks;
   * the master is disconnected once the fade has fully rung out.
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    const master = this.master;
    if (!master) return;
    const now = this.ctx.currentTime;
    const current = master.gain.value;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(current, NEAR_ZERO_GAIN), now);
    master.gain.exponentialRampToValueAtTime(NEAR_ZERO_GAIN, now + FADE_OUT_SEC);
    window.setTimeout(() => {
      try {
        master.disconnect();
      } catch {
        // already detached
      }
    }, (FADE_OUT_SEC + 0.1) * 1000);
    this.master = null;
  }

  private schedule(): void {
    if (this.stopped || !this.master) return;
    const now = this.ctx.currentTime;
    const horizon = now - this.startTime + LOOK_AHEAD_SEC;
    if (horizon <= this.scheduledUpTo) return;

    const firstLoop = Math.floor(this.scheduledUpTo / this.loopSec);
    const lastLoop = Math.floor(horizon / this.loopSec);
    for (let loop = firstLoop; loop <= lastLoop; loop++) {
      const loopBase = loop * this.loopSec;
      for (const ev of this.track.events) {
        const evSec = loopBase + ev.t * this.beatSec;
        if (evSec < this.scheduledUpTo || evSec >= horizon) continue;
        const audioTime = this.startTime + evSec;
        if (audioTime < now - SCHEDULE_PAST_TOLERANCE_SEC) continue;
        const durSec = ev.d * this.beatSec;
        const gainMul = ev.g ?? 1;
        if (ev.voice === 'hat') {
          playHat(this.ctx, this.master, this.noise, audioTime, durSec, gainMul);
        } else {
          playVoice(
            this.ctx,
            this.master,
            VOICES[ev.voice],
            midiToFreq(ev.note),
            audioTime,
            durSec,
            gainMul,
          );
        }
      }
    }
    this.scheduledUpTo = horizon;
  }
}

/** ~0.2 s of white noise, reused for every hat tick in a track. */
function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.ceil(ctx.sampleRate * 0.2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Deterministic LCG so we don't reach for Math.random(); the exact
  // noise shape is irrelevant, we just need broadband hiss.
  let seed = 0x2545f4914f6cdd1d >>> 0;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  return buffer;
}
