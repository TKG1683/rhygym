/**
 * Metronome click generator + beat-grid utility.
 *
 * scheduleClick emits a short oscillator tick at a precise AudioContext
 * time (sample-accurate); collectBeats turns a time-signature timeline
 * into the list of beat onsets that fall inside a given tick window so
 * the scheduler can decide which clicks to fire.
 */

import { PPQ, type TimeSignatureEvent } from '../model/types';

export const METRONOME_DOWNBEAT_FREQUENCY_HZ = 1600;
export const METRONOME_OFFBEAT_FREQUENCY_HZ = 1200;

const DOWNBEAT_BASE_GAIN = 1.0;
const OFFBEAT_BASE_GAIN = 0.6;
const CLICK_DURATION_SEC = 0.05;
/** Short fade-in so the oscillator doesn't pop when it switches on. */
const CLICK_ATTACK_SEC = 0.002;
/** exponentialRamp cannot reach 0; -60dB is effectively inaudible. */
const NEAR_ZERO_GAIN = 0.001;

export const DEFAULT_METRONOME_VOLUME = 0.7;

export interface Beat {
  tick: number;
  isDownbeat: boolean;
}

export function scheduleClick(
  ctx: AudioContext,
  audioTime: number,
  isDownbeat: boolean,
  volume: number = DEFAULT_METRONOME_VOLUME,
): OscillatorNode {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  // Triangle wave for a crisper, more "click"-shaped attack than sine.
  // Pure sine at 1 kHz is soft and a little muddy on small speakers;
  // triangle has odd harmonics that fall off ~9 dB/octave, giving it
  // body without the harshness of a square wave.
  osc.type = 'triangle';
  osc.frequency.value = isDownbeat
    ? METRONOME_DOWNBEAT_FREQUENCY_HZ
    : METRONOME_OFFBEAT_FREQUENCY_HZ;
  const baseGain = isDownbeat ? DOWNBEAT_BASE_GAIN : OFFBEAT_BASE_GAIN;
  const peakGain = baseGain * volume;
  // 0 → peak over 2 ms (linear) → near-zero over the remainder
  // (exponential). Without the attack ramp the gain jumps from 0 to peak
  // in one sample, which makes the audible "pop" that listeners hear on
  // top of the tone, especially on Bluetooth / phone speakers.
  gain.gain.setValueAtTime(0, audioTime);
  gain.gain.linearRampToValueAtTime(peakGain, audioTime + CLICK_ATTACK_SEC);
  gain.gain.exponentialRampToValueAtTime(
    NEAR_ZERO_GAIN,
    audioTime + CLICK_DURATION_SEC,
  );

  osc.start(audioTime);
  osc.stop(audioTime + CLICK_DURATION_SEC);
  return osc;
}

function ticksPerBeat(ts: TimeSignatureEvent): number {
  return (PPQ * 4) / ts.denominator;
}

function ticksPerMeasure(ts: TimeSignatureEvent): number {
  return ticksPerBeat(ts) * ts.numerator;
}

/**
 * Return every beat onset in the half-open tick window [fromTick, toTick),
 * honoring time-signature changes. The first beat of each measure is
 * flagged isDownbeat.
 *
 * The timeSigs array must contain at least one event at tick=0 (the
 * caller is expected to normalise — Score construction or the
 * scheduler does this).
 */
export function collectBeats(
  timeSigs: readonly TimeSignatureEvent[],
  fromTick: number,
  toTick: number,
): Beat[] {
  const result: Beat[] = [];
  if (timeSigs.length === 0 || toTick <= fromTick) return result;

  // Find the active time signature for the starting tick.
  let tsIdx = 0;
  for (let i = 1; i < timeSigs.length; i++) {
    if (timeSigs[i]!.tick <= fromTick) tsIdx = i;
    else break;
  }

  let ts = timeSigs[tsIdx]!;
  let beatTicks = ticksPerBeat(ts);
  let measureTicks = ticksPerMeasure(ts);

  // Snap forward to the first beat at or after fromTick.
  let tick = ts.tick;
  if (tick < fromTick) {
    const stepsBehind = Math.ceil((fromTick - tick) / beatTicks);
    tick += stepsBehind * beatTicks;
  }

  while (tick < toTick) {
    // Advance past any time-signature boundary we've stepped over.
    if (tsIdx + 1 < timeSigs.length && tick >= timeSigs[tsIdx + 1]!.tick) {
      tsIdx++;
      ts = timeSigs[tsIdx]!;
      beatTicks = ticksPerBeat(ts);
      measureTicks = ticksPerMeasure(ts);
      tick = ts.tick;
      continue;
    }
    const posInMeasure = (tick - ts.tick) % measureTicks;
    result.push({ tick, isDownbeat: posInMeasure === 0 });
    tick += beatTicks;
  }

  return result;
}
