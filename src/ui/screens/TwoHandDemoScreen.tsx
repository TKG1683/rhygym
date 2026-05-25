/**
 * Two-hand mode (#83) demo / playtest screen — Phase C.
 *
 * Lets the player browse the 5 polyrhythm etudes from the Phase C
 * pack, pick one, and play it. URL-direct entry (?demo=two-hand)
 * keeps the audio-init gate from Phase B (autoplay policy requires
 * a user gesture before creating the AudioContext).
 *
 * Portrait-orientation guide overlays the screen with a "横にして
 * ね" prompt — non-blocking (the player can dismiss it for the
 * session so PC / iPad users who don't have a portrait mode aren't
 * stuck). Once the device rotates landscape the overlay auto-hides;
 * a re-rotate back to portrait shows it again unless the player
 * dismissed it.
 *
 * Phase D moves this entry behind a proper ModeSelectScreen +
 * per-mode etude list — this screen will be retired or repurposed
 * as the actual play screen.
 */

import { useMemo, useState } from 'react';
import { createAudioContext } from '../../core/audio/audioContext';
import { TWO_HAND_ETUDES } from '../../core/score/twoHandEtudes';
import { TwoHandGameView } from '../game/TwoHandGameView';
import { useOrientation } from '../hooks/useOrientation';
import { useAppStore } from '../store/appStore';

export function TwoHandDemoScreen() {
  const goto = useAppStore((s) => s.goto);
  const audioContext = useAppStore((s) => s.audioContext);
  const setAudioContext = useAppStore((s) => s.setAudioContext);
  const [etudeIdx, setEtudeIdx] = useState(0);
  // runKey bumps remount the game view so retry / etude switch starts
  // from a clean audio + judgement state instead of trying to reset
  // in place.
  const [runKey, setRunKey] = useState(0);
  const [orientationGuideDismissed, setOrientationGuideDismissed] = useState(false);
  const orientation = useOrientation();
  const showOrientationGuide = orientation === 'portrait' && !orientationGuideDismissed;

  const etude = useMemo(() => TWO_HAND_ETUDES[etudeIdx]!, [etudeIdx]);

  const enableAudio = () => {
    if (audioContext) return;
    const ctx = createAudioContext();
    setAudioContext(ctx);
    void ctx.resume();
  };

  const selectEtude = (idx: number) => {
    setEtudeIdx(idx);
    // Remount on switch so the new etude's audio graph is built fresh.
    setRunKey((k) => k + 1);
  };

  return (
    <main className="screen screen-two-hand-demo">
      <header className="two-hand-demo-header">
        <h1>{etude.name}</h1>
        <p className="muted">{etude.description}</p>
        <div className="two-hand-etude-picker" role="tablist" aria-label="ポリリズム ステージ">
          {TWO_HAND_ETUDES.map((e, i) => (
            <button
              key={e.id}
              type="button"
              role="tab"
              aria-selected={i === etudeIdx}
              className={`two-hand-etude-pick no-tap ${i === etudeIdx ? 'is-selected' : ''}`}
              onClick={() => selectEtude(i)}
            >
              {e.name.replace(/^Lv\d+\s*/, 'Lv' + (i + 1) + ' ')}
            </button>
          ))}
        </div>
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
        <TwoHandGameView key={runKey} stage={etude} />
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
      {showOrientationGuide && (
        <PortraitGuideOverlay onDismiss={() => setOrientationGuideDismissed(true)} />
      )}
    </main>
  );
}

interface PortraitGuideOverlayProps {
  onDismiss: () => void;
}

/**
 * Translucent full-screen overlay shown while the device is in
 * portrait orientation. Non-blocking — the dismiss button lets PC
 * users (no real orientation) keep playing. Rotation to landscape
 * auto-hides the overlay via the orientation hook; a re-rotate back
 * shows it again unless the player explicitly dismissed it.
 */
function PortraitGuideOverlay({ onDismiss }: PortraitGuideOverlayProps) {
  return (
    <div className="two-hand-portrait-overlay" role="dialog" aria-label="横画面推奨">
      <div className="two-hand-portrait-card">
        <p className="two-hand-portrait-icon" aria-hidden="true">↺</p>
        <h2>横画面でプレイ推奨</h2>
        <p>
          両手モードは端末を横向きにすると左右のタップゾーンが広がって遊びやすい。
        </p>
        <button type="button" className="primary no-tap" onClick={onDismiss}>
          このまま続ける
        </button>
      </div>
    </div>
  );
}
