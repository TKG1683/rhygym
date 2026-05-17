import { DEFAULT_METRONOME_VOLUME, scheduleClick } from './metronome';

const COUNT_IN_LEAD_SEC = 0.05;

export interface CountInOptions {
  /** Total number of clicks. 4 = "1, 2, 3, 4" before the song begins. */
  beats: number;
  /** Beats per minute (drives the gap between clicks). */
  bpm: number;
  /**
   * Beats per measure — clicks at multiples of this value are accented
   * as downbeats. Defaults to `beats` so the first click is the only
   * downbeat (matches the common "1 2 3 4" pattern).
   */
  beatsPerMeasure?: number;
  volume?: number;
}

/**
 * Schedule a metronome count-in and resolve when the count-in finishes
 * (= the moment the song should start playing).
 *
 * Returns the AudioContext time at which the song should start, so the
 * scheduler can line up its first frame without any extra latency.
 */
export async function countIn(
  ctx: AudioContext,
  opts: CountInOptions,
): Promise<number> {
  const beatsPerMeasure = opts.beatsPerMeasure ?? opts.beats;
  const volume = opts.volume ?? DEFAULT_METRONOME_VOLUME;
  const beatSec = 60 / opts.bpm;
  const startTime = ctx.currentTime + COUNT_IN_LEAD_SEC;

  for (let i = 0; i < opts.beats; i++) {
    const audioTime = startTime + i * beatSec;
    const isDownbeat = i % beatsPerMeasure === 0;
    scheduleClick(ctx, audioTime, isDownbeat, volume);
  }

  const songStartTime = startTime + opts.beats * beatSec;
  await waitUntil(ctx, songStartTime);
  return songStartTime;
}

function waitUntil(ctx: AudioContext, audioTime: number): Promise<void> {
  const remainingMs = (audioTime - ctx.currentTime) * 1000;
  if (remainingMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, remainingMs));
}
