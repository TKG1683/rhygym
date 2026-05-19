/**
 * Metronome click generator + beat-grid utility.
 *
 * scheduleClick emits a short oscillator tick at a precise AudioContext
 * time (sample-accurate); collectBeats turns a time-signature timeline
 * into the list of beat onsets that fall inside a given tick window so
 * the scheduler can decide which clicks to fire.
 */

import { PPQ, type TimeSignatureEvent } from '../model/types';

// Single click tone shared by every beat — what differs between accent
// and non-accent is gain, not pitch. Two pitches felt like two
// instruments interrupting each other; one pitch with a quieter
// "ghost" reads as the same drum hit softer.
export const METRONOME_CLICK_FREQUENCY_HZ = 1600;
// Back-compat aliases — kept so callers that imported the old names
// keep building. Both point at the same pitch now.
export const METRONOME_DOWNBEAT_FREQUENCY_HZ = METRONOME_CLICK_FREQUENCY_HZ;
export const METRONOME_OFFBEAT_FREQUENCY_HZ = METRONOME_CLICK_FREQUENCY_HZ;

const ACCENT_BASE_GAIN = 1.0;
// Soft beats need a wide gain gap from accents so the listener can
// tell them apart at a glance. 0.55 turned out to read as "same
// volume, slightly less"; 0.25 lands as a clear ghost note.
const SOFT_BASE_GAIN = 0.25;
const CLICK_DURATION_SEC = 0.05;
// Soft beats also decay faster so they sound shorter as well as
// quieter — duration and loudness compound to make them register as
// "between" the accents rather than competing with them.
const SOFT_DURATION_SEC = 0.025;
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
  osc.frequency.value = METRONOME_CLICK_FREQUENCY_HZ;
  const baseGain = isDownbeat ? ACCENT_BASE_GAIN : SOFT_BASE_GAIN;
  const peakGain = baseGain * volume;
  const duration = isDownbeat ? CLICK_DURATION_SEC : SOFT_DURATION_SEC;
  // 0 → peak over 2 ms (linear) → near-zero over the remainder
  // (exponential). Without the attack ramp the gain jumps from 0 to peak
  // in one sample, which makes the audible "pop" that listeners hear on
  // top of the tone, especially on Bluetooth / phone speakers.
  gain.gain.setValueAtTime(0, audioTime);
  gain.gain.linearRampToValueAtTime(peakGain, audioTime + CLICK_ATTACK_SEC);
  gain.gain.exponentialRampToValueAtTime(
    NEAR_ZERO_GAIN,
    audioTime + duration,
  );

  osc.start(audioTime);
  osc.stop(audioTime + duration);
  return osc;
}

function ticksPerBeat(ts: TimeSignatureEvent): number {
  return (PPQ * 4) / ts.denominator;
}

/**
 * Default accent pattern for a time signature, as a boolean array of
 * length numerator (true = accent, false = soft):
 *  - compound 8/ (6/8, 9/8, 12/8): every 3rd eighth ("TA-ta-ta")
 *  - asymmetric 5/8 (3+2): beats 0 and 3
 *  - asymmetric 7/8 (2+2+3): beats 0, 2, 4
 *  - everything else (simple meter): every beat accented — the click
 *    grid stays "neutral" so the player has to read phrasing from
 *    the staff, not the metronome.
 *
 * Stages that want a different grouping (e.g. 7/8 = 3+2+2) plug in a
 * custom override via the appStore metronomeAccents map.
 */
export function defaultAccentPattern(numerator: number, denominator: number): boolean[] {
  if (denominator === 8 && numerator % 3 === 0) {
    return Array.from({ length: numerator }, (_, i) => i % 3 === 0);
  }
  if (denominator === 8 && numerator === 5) {
    return Array.from({ length: numerator }, (_, i) => i === 0 || i === 3);
  }
  if (denominator === 8 && numerator === 7) {
    return Array.from({ length: numerator }, (_, i) => i === 0 || i === 2 || i === 4);
  }
  return Array.from({ length: numerator }, () => true);
}

/**
 * Whether a given beat-within-measure should be accented. If a custom
 * pattern is supplied and its length matches `numerator`, that wins;
 * otherwise the built-in default (see `defaultAccentPattern`) applies.
 */
export function isAccentBeat(
  numerator: number,
  denominator: number,
  beatIndexInMeasure: number,
  customPattern?: readonly boolean[],
): boolean {
  if (customPattern && customPattern.length === numerator) {
    return customPattern[beatIndexInMeasure] ?? false;
  }
  return defaultAccentPattern(numerator, denominator)[beatIndexInMeasure] ?? true;
}

/** Standard "n/d" key used by the accent override map. */
export function tsKey(numerator: number, denominator: number): string {
  return `${numerator}/${denominator}`;
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
  accentOverrides?: Readonly<Record<string, readonly boolean[]>>,
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
    const beatIndexInMeasure = posInMeasure / beatTicks;
    const override = accentOverrides?.[tsKey(ts.numerator, ts.denominator)];
    const isDownbeat = isAccentBeat(
      ts.numerator,
      ts.denominator,
      beatIndexInMeasure,
      override,
    );
    result.push({ tick, isDownbeat });
    tick += beatTicks;
  }

  return result;
}
