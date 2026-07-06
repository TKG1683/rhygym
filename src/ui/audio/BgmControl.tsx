/**
 * BgmControl — the 🔊 button + its settings popover.
 *
 * Rendered by App on the title/select screens (there's no general
 * settings screen to hang this off, so the speaker icon is its home).
 * Tapping the icon opens a small panel with an ON/OFF switch and a
 * volume slider; both persist via the store. Any interaction here also
 * doubles as the audio-unlock gesture, so a fresh title can start (or
 * adjust) the loop on this very tap instead of waiting for the next one.
 */

import { useEffect, useRef, useState } from 'react';
import { createAudioContext } from '../../core/audio/audioContext';
import { useAppStore } from '../store/appStore';

export function BgmControl() {
  const bgmEnabled = useAppStore((s) => s.bgmEnabled);
  const setBgmEnabled = useAppStore((s) => s.setBgmEnabled);
  const bgmVolume = useAppStore((s) => s.bgmVolume);
  const setBgmVolume = useAppStore((s) => s.setBgmVolume);
  const setAudioContext = useAppStore((s) => s.setAudioContext);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Create + resume the AudioContext on interaction so audio is unlocked
  // by this gesture. Reads the ctx fresh from the store to avoid racing
  // BgmController's own first-gesture bootstrap into a duplicate context.
  const unlockAudio = () => {
    let ctx = useAppStore.getState().audioContext;
    if (!ctx) {
      ctx = createAudioContext();
      setAudioContext(ctx);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  };

  // Dismiss the panel on an outside click or Escape — standard popover
  // affordances.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const volumePct = Math.round(bgmVolume * 100);
  const muted = !bgmEnabled || volumePct === 0;

  return (
    <div className="bgm-control no-tap" ref={rootRef}>
      <button
        type="button"
        className="bgm-toggle"
        aria-label="BGM設定"
        aria-expanded={open}
        aria-pressed={!muted}
        onClick={() => {
          unlockAudio();
          setOpen((o) => !o);
        }}
      >
        {muted ? '🔈' : '🔊'}
      </button>
      {open && (
        <div className="bgm-panel" role="dialog" aria-label="BGM設定">
          <div className="bgm-panel-row">
            <span className="bgm-panel-label">BGM</span>
            <button
              type="button"
              role="switch"
              aria-checked={bgmEnabled}
              className={`bgm-switch${bgmEnabled ? ' is-on' : ''}`}
              onClick={() => {
                unlockAudio();
                setBgmEnabled(!bgmEnabled);
              }}
            >
              {bgmEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
          <div className="bgm-panel-row">
            <label className="bgm-panel-label" htmlFor="bgm-volume">
              音量
            </label>
            <input
              id="bgm-volume"
              type="range"
              min={0}
              max={100}
              step={1}
              value={volumePct}
              disabled={!bgmEnabled}
              onChange={(e) => {
                unlockAudio();
                setBgmVolume(Number(e.target.value) / 100);
              }}
            />
            <span className="bgm-volume-value">{volumePct}</span>
          </div>
        </div>
      )}
    </div>
  );
}
