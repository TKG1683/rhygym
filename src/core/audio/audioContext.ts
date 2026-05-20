/**
 * Cross-browser AudioContext factory. Older iOS Safari needs the
 * `webkitAudioContext` prefix; modern Safari has the unprefixed name
 * but we keep the fallback as defensive code (cheap, never hurts).
 */
export function createAudioContext(): AudioContext {
  const Ctx: typeof AudioContext | undefined =
    typeof window === 'undefined'
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    throw new Error('AudioContext not supported in this browser.');
  }
  return new Ctx();
}
