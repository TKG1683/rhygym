/**
 * Tiny RAF loop that auto-expires un-tapped notes into MISS. Returns a
 * cancel function the caller invokes on unmount or game end.
 *
 * Kept deliberately small: with no playhead to update there is nothing
 * else for the loop to do.
 */

export interface GameLoopOptions {
  /** Current audio-time in seconds (typically scheduler.audioCurrentTick → sec). */
  getAudioSec: () => number;
  /** Called every frame so the caller can check & flag expired notes. */
  onFrame: (audioSec: number) => void;
}

export function startGameLoop(opts: GameLoopOptions): () => void {
  let cancelled = false;
  const tick = () => {
    if (cancelled) return;
    opts.onFrame(opts.getAudioSec());
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    cancelled = true;
  };
}
