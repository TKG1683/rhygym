/**
 * Endless mode (#77) — Phase B debug / playtest screen.
 *
 * Builds a procedural Etude via `buildEndlessStage` and hands it to
 * the regular single-hand GameView, so the entire audio + judgement
 * + render pipeline runs unmodified against generated content. This
 * is the smallest possible footprint for proving the generator is
 * playable end-to-end before Phase C adds the HUD (distance / MISS
 * counter / combo / tier) and Phase D adds the difficulty picker.
 *
 * URL-direct entry (?demo=endless) bypasses TitleScreen, so the
 * shared AudioContext might not exist yet — same audio-init gate
 * the two-hand demo uses (Web Audio's autoplay policy requires a
 * user gesture before creating one).
 */

import { useMemo, useState } from 'react';
import { createAudioContext } from '../../core/audio/audioContext';
import {
  ALL_ENDLESS_DIFFICULTIES,
  DEFAULT_ENDLESS_DIFFICULTY,
  ENDLESS_DIFFICULTY_BPM,
  type EndlessDifficulty,
} from '../../core/model';
import { buildEndlessStage } from '../../core/score/endlessStage';
import { GameView } from '../game/GameView';
import { useAppStore } from '../store/appStore';

export function EndlessDemoScreen() {
  const goto = useAppStore((s) => s.goto);
  const audioContext = useAppStore((s) => s.audioContext);
  const setAudioContext = useAppStore((s) => s.setAudioContext);
  const [difficulty, setDifficulty] = useState<EndlessDifficulty>(DEFAULT_ENDLESS_DIFFICULTY);
  // Seed is part of the stage id, so a fresh seed gives a fresh
  // procedural song. The retry button bumps both seed (to roll new
  // bars) and runKey (to remount GameView with the new stage).
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [runKey, setRunKey] = useState(0);

  const stage = useMemo(
    () => buildEndlessStage({ difficulty, seed, barCount: 32 }),
    [difficulty, seed],
  );

  const enableAudio = () => {
    if (audioContext) return;
    const ctx = createAudioContext();
    setAudioContext(ctx);
    void ctx.resume();
  };

  const newRun = () => {
    setSeed(Math.floor(Math.random() * 1e9));
    setRunKey((k) => k + 1);
  };

  return (
    <main className="screen screen-endless-demo">
      <header className="endless-demo-header">
        <h1>{stage.name}</h1>
        <p className="muted">{stage.description}</p>
        <div className="endless-demo-actions">
          <div className="endless-difficulty-picker" role="tablist" aria-label="難易度">
            {ALL_ENDLESS_DIFFICULTIES.map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={d === difficulty}
                className={`endless-difficulty-pick no-tap ${d === difficulty ? 'is-selected' : ''}`}
                onClick={() => {
                  setDifficulty(d);
                  setRunKey((k) => k + 1);
                }}
              >
                {labelFor(d)}
                <span className="endless-difficulty-bpm">♩={ENDLESS_DIFFICULTY_BPM[d]}</span>
              </button>
            ))}
          </div>
          {audioContext && (
            <button className="secondary no-tap" onClick={newRun}>
              新しいラン (シード変更)
            </button>
          )}
          <button className="secondary no-tap" onClick={() => goto('title')}>
            タイトルへ
          </button>
        </div>
      </header>
      {audioContext ? (
        <GameView key={runKey} stage={stage} />
      ) : (
        <div className="endless-audio-gate">
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

function labelFor(d: EndlessDifficulty): string {
  switch (d) {
    case 'andante':
      return 'Andante';
    case 'moderato':
      return 'Moderato';
    case 'allegro':
      return 'Allegro';
    case 'presto':
      return 'Presto';
  }
}
