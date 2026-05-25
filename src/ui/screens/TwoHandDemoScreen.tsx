/**
 * Two-hand mode (#83) debug screen — playable as of Phase B.
 *
 * Mounts the demo etude inside a TwoHandGameView so the friend-
 * playtest loop can start with the smallest possible navigation
 * surface (URL flag → straight into the game). Phase D moves the
 * entry point onto a proper ModeSelectScreen + per-mode etude list.
 *
 * URL direct entry (?demo=two-hand) bypasses TitleScreen, so the
 * shared AudioContext might not exist yet — Web Audio's autoplay
 * policy requires a user gesture to create one. We render a small
 * "音声を有効にして始める" gate first; the click on that button is
 * the user gesture that creates the context. Subsequent retries
 * skip the gate because the store already has a live context.
 */

import { useState } from 'react';
import { createAudioContext } from '../../core/audio/audioContext';
import { TWO_HAND_DEMO_ETUDE } from '../../core/score/twoHandDemoEtude';
import { TwoHandGameView } from '../game/TwoHandGameView';
import { useAppStore } from '../store/appStore';

export function TwoHandDemoScreen() {
  const goto = useAppStore((s) => s.goto);
  const audioContext = useAppStore((s) => s.audioContext);
  const setAudioContext = useAppStore((s) => s.setAudioContext);
  // runKey bump remounts TwoHandGameView so a retry rebuilds the audio
  // graph + judgement state cleanly instead of trying to reset in place.
  const [runKey, setRunKey] = useState(0);

  const enableAudio = () => {
    if (audioContext) return;
    const ctx = createAudioContext();
    setAudioContext(ctx);
    void ctx.resume();
  };

  return (
    <main className="screen screen-two-hand-demo">
      <header className="two-hand-demo-header">
        <h1>{TWO_HAND_DEMO_ETUDE.name}</h1>
        <p className="muted">{TWO_HAND_DEMO_ETUDE.description}</p>
        <div className="two-hand-demo-actions">
          {audioContext && (
            <button className="secondary no-tap" onClick={() => setRunKey((k) => k + 1)}>
              リトライ
            </button>
          )}
          <button className="secondary no-tap" onClick={() => goto('title')}>
            タイトルへ
          </button>
        </div>
      </header>
      {audioContext ? (
        <TwoHandGameView key={runKey} stage={TWO_HAND_DEMO_ETUDE} />
      ) : (
        <div className="two-hand-audio-gate">
          <p className="muted">
            URL 直接アクセス時は音声初期化のためにワンタップ必要。
          </p>
          <button className="primary" onClick={enableAudio}>
            音声を有効にして始める
          </button>
        </div>
      )}
    </main>
  );
}
