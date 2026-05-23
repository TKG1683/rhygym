import { useEffect, useRef, useState } from 'react';
import { createAudioContext } from '../../core/audio/audioContext';
import {
  getAllBests,
  isCalibSuggestDismissed,
  setCalibSuggestDismissed,
} from '../../core/storage/localStore';
import { useAppStore } from '../store/appStore';

// Hidden Auto-Mode toggle (debug): N rapid clicks on the muscle icon
// within MUSCLE_TAP_WINDOW_MS toggles autoMode. Keep the count + window
// small enough to be discoverable on purpose but well outside the
// normal range of accidental taps.
const MUSCLE_TAP_COUNT_TO_TOGGLE = 5;
const MUSCLE_TAP_WINDOW_MS = 1500;
// How long the "AUTO モード ON/OFF" feedback toast stays on screen
// after the toggle. Long enough to read, short enough not to linger.
const AUTOMODE_TOAST_MS = 2200;

export function TitleScreen() {
  const goto = useAppStore((s) => s.goto);
  const audioContext = useAppStore((s) => s.audioContext);
  const setAudioContext = useAppStore((s) => s.setAudioContext);
  const calibrationOffsetSec = useAppStore((s) => s.calibrationOffsetSec);
  const autoMode = useAppStore((s) => s.autoMode);
  const setAutoMode = useAppStore((s) => s.setAutoMode);
  const calibrated = calibrationOffsetSec !== 0;

  // Rolling timestamp list — keep only taps within the rolling window
  // so a slow drum-roll over 10 s doesn't accidentally trip the
  // toggle. Cleared on toggle so a subsequent burst starts counting
  // from scratch.
  const muscleTapTimesRef = useRef<number[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), AUTOMODE_TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toast]);

  const handleMuscleTap = () => {
    const now = performance.now();
    const recentTaps = muscleTapTimesRef.current.filter((t) => now - t < MUSCLE_TAP_WINDOW_MS);
    recentTaps.push(now);
    muscleTapTimesRef.current = recentTaps;
    if (recentTaps.length >= MUSCLE_TAP_COUNT_TO_TOGGLE) {
      muscleTapTimesRef.current = [];
      const next = !autoMode;
      setAutoMode(next);
      setToast(next ? '🤖 Auto モード ON' : 'Auto モード OFF');
    }
  };

  // First-run nudge: only for players who haven't calibrated AND
  // haven't played anything yet AND haven't explicitly dismissed it.
  // Snapshotted at mount so dismissing/calibrating doesn't make the
  // banner flicker mid-screen.
  const [suggestVisible, setSuggestVisible] = useState(
    () => !calibrated && !isCalibSuggestDismissed() && Object.keys(getAllBests()).length === 0,
  );
  const dismissSuggest = () => {
    setCalibSuggestDismissed(true);
    setSuggestVisible(false);
  };

  const handleStart = () => {
    // Create (or reuse) the AudioContext while we are still inside the
    // user-gesture handler — iOS Safari and Android Chrome both refuse
    // to start audio that wasn't initiated by a tap/click.
    let ctx = audioContext;
    if (!ctx) {
      ctx = createAudioContext();
      setAudioContext(ctx);
    }
    // Fire-and-forget resume — Safari needs the user-gesture token to
    // still be alive at the moment we call resume(); awaiting yields
    // back to the microtask queue and some Safari versions drop the
    // gesture across that boundary. The warmup and navigation that
    // follow are unaffected by whether resume() has actually resolved
    // (resume returns a promise but it's safe to keep calling other
    // APIs while it's in-flight).
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    // Warm-up: play an inaudible 50 ms buffer so the audio pipeline is
    // fully spun up by the time GameScreen mounts. Without this, the
    // first few metronome clicks come out quieter than the rest because
    // the audio thread is still ramping up its first real output.
    warmUpAudio(ctx);
    goto('select');
  };

  const goCalibrate = () => {
    // Calibration also needs a live AudioContext; reuse the same
    // user-gesture handling as Start.
    let ctx = audioContext;
    if (!ctx) {
      ctx = createAudioContext();
      setAudioContext(ctx);
    }
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    warmUpAudio(ctx);
    goto('calibration');
  };

  // Tutorial needs an AudioContext too (it embeds a real GameView ride).
  // Mirror Start's user-gesture audio init so iOS/Android don't silently
  // refuse to play the metronome on the tutorial's first beat.
  const goTutorial = () => {
    let ctx = audioContext;
    if (!ctx) {
      ctx = createAudioContext();
      setAudioContext(ctx);
    }
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    warmUpAudio(ctx);
    goto('tutorial');
  };

  return (
    <main className="screen screen-title">
      <div className="title-logo" aria-label="Rhygym">
        <span className="title-logo-icon title-logo-icon-left" aria-hidden="true">
          ♪♬
        </span>
        <span className="title-logo-center">
          <span className="title-logo-name">Rhygym</span>
          <span className="title-logo-sub">リジム</span>
        </span>
        <button
          type="button"
          className={`title-logo-icon title-logo-icon-right title-logo-muscle${autoMode ? ' title-logo-muscle-auto' : ''}`}
          aria-label={autoMode ? 'Auto モードを切り替える (現在: ON)' : 'Auto モードを切り替える'}
          onClick={handleMuscleTap}
        >
          🏋
          {autoMode && <span className="title-logo-muscle-badge" aria-hidden="true">AUTO</span>}
        </button>
      </div>
      {toast && (
        <div className="auto-mode-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
      <p className="tagline">楽譜を読み、タップでリズムを叩け。</p>
      <button className="primary" onClick={handleStart}>
        Start
      </button>
      <button className="secondary" onClick={goTutorial}>
        遊び方
      </button>
      <button className="secondary" onClick={goCalibrate}>
        キャリブレーション
        {calibrated && (
          <span className="calib-badge">
            {' '}
            ({Math.round(calibrationOffsetSec * 1000)}ms)
          </span>
        )}
      </button>
      {suggestVisible && (
        <div className="calib-suggest-banner title-calib-suggest">
          <button
            type="button"
            className="calib-suggest-close"
            aria-label="閉じる"
            onClick={dismissSuggest}
          >
            ×
          </button>
          <p className="calib-suggest-text">プレー開始前のキャリブレーションをおすすめします</p>
          <button className="primary calib-suggest-cta" onClick={goCalibrate}>
            キャリブレーションする
          </button>
        </div>
      )}
    </main>
  );
}

function warmUpAudio(ctx: AudioContext): void {
  // Play a 100 ms barely-audible 440 Hz tone (-60 dB) to spin up the
  // audio thread AND give AGC/output normalisation something real to
  // react to. A pure silent buffer wasn't enough — iOS / Android only
  // commit the playback path on the first non-zero sample, and without
  // that the first real metronome click came out quieter than the rest.
  const lengthSamples = Math.ceil(ctx.sampleRate * 0.1);
  const buffer = ctx.createBuffer(1, lengthSamples, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const tinyAmplitude = 0.001;
  for (let i = 0; i < lengthSamples; i++) {
    data[i] = Math.sin((2 * Math.PI * 440 * i) / ctx.sampleRate) * tinyAmplitude;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
}
