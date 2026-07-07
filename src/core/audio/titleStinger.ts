/**
 * Title-screen "reveal" sting.
 *
 * The menu BGM can only start after the browser's first user gesture,
 * and even then it fades in over ~0.8 s (see FADE_IN_SEC in bgm.ts), so
 * the music appears to creep in from silence — it reads as lag. This is
 * a short, bright bell arpeggio fired the instant menu audio engages: it
 * gives the onset a percussive attack that lands together with the title
 * logo while the BGM swells in underneath.
 *
 * Voiced as an E-major triad — the same key as TITLE_FUNK — so the sting
 * is in tune with the loop that comes up behind it. Like every other
 * Rhygym sound it's synthesised on the fly (no audio files).
 */

import { midiToFreq } from './bgm';

/** exponentialRamp can't reach 0; -60 dB is effectively silent. */
const NEAR_ZERO_GAIN = 0.001;

// E major across two octaves: E4, G#4, B4, E5. Struck in quick
// succession so it reads as one bright "ta-da", not four separate hits.
const ARPEGGIO_MIDI = [64, 68, 71, 76];
const ARPEGGIO_STEP_SEC = 0.05;
/** Each struck note's decay tail. */
const RING_SEC = 0.7;
/** Short fade-in so the note doesn't pop on. */
const ATTACK_SEC = 0.004;

/**
 * Play the reveal sting once. `at` defaults to now; `volume` is the peak
 * gain of the first (loudest) note before the per-note roll-off — kept
 * modest so it sits over, not on top of, the BGM.
 */
export function playTitleStinger(
  ctx: AudioContext,
  at: number = ctx.currentTime,
  volume = 0.35,
): void {
  const start0 = Math.max(at, ctx.currentTime + 0.005);
  ARPEGGIO_MIDI.forEach((midi, i) => {
    // Later notes ring a touch quieter so the arpeggio tapers upward
    // rather than piling up.
    bell(ctx, midiToFreq(midi), start0 + i * ARPEGGIO_STEP_SEC, volume * (1 - i * 0.12));
  });
  // A quiet high shimmer (B5) that swells in slightly late for sparkle.
  shimmer(ctx, midiToFreq(83), start0 + 0.06, volume * 0.16);
}

/** One bell voice: sine + softer triangle through a gentle low-pass. */
function bell(ctx: AudioContext, freq: number, start: number, peak: number): void {
  const env = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  lp.Q.value = 0.6;
  lp.connect(env);
  env.connect(ctx.destination);

  const o1 = ctx.createOscillator();
  o1.type = 'sine';
  o1.frequency.value = freq;
  o1.connect(lp);

  const o2 = ctx.createOscillator();
  o2.type = 'triangle';
  o2.frequency.value = freq;
  const o2g = ctx.createGain();
  o2g.gain.value = 0.5;
  o2.connect(o2g);
  o2g.connect(lp);

  const g = env.gain;
  const peakGain = Math.max(peak, NEAR_ZERO_GAIN);
  g.setValueAtTime(0, start);
  g.linearRampToValueAtTime(peakGain, start + ATTACK_SEC);
  g.exponentialRampToValueAtTime(NEAR_ZERO_GAIN, start + RING_SEC);

  const stopAt = start + RING_SEC + 0.02;
  o1.start(start); o1.stop(stopAt);
  o2.start(start); o2.stop(stopAt);
}

/** Faint sine swell that adds air above the arpeggio. */
function shimmer(ctx: AudioContext, freq: number, start: number, peak: number): void {
  const env = ctx.createGain();
  env.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.connect(env);

  const dur = 0.9;
  const g = env.gain;
  g.setValueAtTime(0, start);
  g.linearRampToValueAtTime(Math.max(peak, NEAR_ZERO_GAIN), start + 0.25);
  g.exponentialRampToValueAtTime(NEAR_ZERO_GAIN, start + dur);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}
