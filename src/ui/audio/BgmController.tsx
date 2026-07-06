/**
 * BgmController — headless component that owns the menu music lifecycle.
 *
 * Mounted once in App (outside the screen switch) so a single BgmPlayer
 * survives screen changes and can cross-fade rather than restart on
 * every navigation. It maps the current screen to a track:
 *
 *   title             → TITLE_FUNK
 *   select (Movements) → SELECT_LOFI   (chill browsing)
 *   select (Etudes)    → ETUDE_GROOVE  (upbeat, once you're picking)
 *   else              → silence (play screens stay clean —
 *                        feedback_minimal_game_feel)
 *
 * Autoplay note: browsers refuse audio until a user gesture, and the
 * AudioContext isn't created until the player first taps Start / a menu
 * button. So on a freshly-loaded title the ctx may not exist yet; we
 * attach a one-shot pointer/key listener that spins it up on the very
 * first interaction, after which the effect below starts the loop.
 */

import { useEffect, useRef } from 'react';
import { createAudioContext } from '../../core/audio/audioContext';
import { BgmPlayer } from '../../core/audio/bgm';
import { TITLE_FUNK, SELECT_LOFI, ETUDE_GROOVE } from '../../core/audio/bgmTracks';
import { useAppStore } from '../store/appStore';
import type { Screen } from '../store/appStore';

type TrackKey = 'funk' | 'lofi' | 'groove';

const TRACKS: Record<TrackKey, typeof TITLE_FUNK> = {
  funk: TITLE_FUNK,
  lofi: SELECT_LOFI,
  groove: ETUDE_GROOVE,
};

function trackKeyForScreen(screen: Screen, selectView: 'movements' | 'etudes'): TrackKey | null {
  if (screen === 'title') return 'funk';
  if (screen === 'select') return selectView === 'etudes' ? 'groove' : 'lofi';
  return null;
}

export function BgmController() {
  const screen = useAppStore((s) => s.screen);
  const selectView = useAppStore((s) => s.selectView);
  const audioContext = useAppStore((s) => s.audioContext);
  const setAudioContext = useAppStore((s) => s.setAudioContext);
  const bgmEnabled = useAppStore((s) => s.bgmEnabled);
  const bgmVolume = useAppStore((s) => s.bgmVolume);

  const desiredKey = bgmEnabled ? trackKeyForScreen(screen, selectView) : null;

  const playerRef = useRef<BgmPlayer | null>(null);
  const currentKeyRef = useRef<TrackKey | null>(null);

  // Bootstrap the AudioContext on the first user gesture if we want music
  // but nothing has created the ctx yet (fresh title, no button pressed).
  // Setting it in the store re-runs the start/stop effect below.
  useEffect(() => {
    if (audioContext || desiredKey == null) return;
    const bootstrap = () => {
      let ctx = useAppStore.getState().audioContext;
      if (!ctx) {
        ctx = createAudioContext();
        setAudioContext(ctx);
      }
      if (ctx.state === 'suspended') void ctx.resume();
    };
    const opts: AddEventListenerOptions = { once: true };
    window.addEventListener('pointerdown', bootstrap, opts);
    window.addEventListener('keydown', bootstrap, opts);
    return () => {
      window.removeEventListener('pointerdown', bootstrap, opts);
      window.removeEventListener('keydown', bootstrap, opts);
    };
  }, [audioContext, desiredKey, setAudioContext]);

  // Start / stop / swap the loop to match the desired track.
  useEffect(() => {
    const ctx = audioContext;
    if (!ctx || desiredKey == null) {
      playerRef.current?.stop();
      playerRef.current = null;
      currentKeyRef.current = null;
      return;
    }
    // A resumed context is a prerequisite for any sound; a screen change
    // arriving via a button tap keeps the gesture token alive here.
    if (ctx.state === 'suspended') void ctx.resume();
    if (currentKeyRef.current === desiredKey && playerRef.current) return;
    playerRef.current?.stop();
    // Read volume via getState so it isn't a dep here — a volume change
    // must adjust the live master gain (effect below), never restart the
    // loop.
    const player = new BgmPlayer(ctx, TRACKS[desiredKey], useAppStore.getState().bgmVolume);
    player.start();
    playerRef.current = player;
    currentKeyRef.current = desiredKey;
  }, [audioContext, desiredKey]);

  // Apply volume changes to the running loop without restarting it.
  useEffect(() => {
    playerRef.current?.setVolume(bgmVolume);
  }, [bgmVolume]);

  // Stop cleanly if the app ever unmounts (e.g. hot reload in dev).
  useEffect(
    () => () => {
      playerRef.current?.stop();
      playerRef.current = null;
    },
    [],
  );

  return null;
}
