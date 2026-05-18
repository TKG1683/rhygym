import { useState } from 'react';
import {
  getAllBests,
  isCalibSuggestDismissed,
  setCalibSuggestDismissed,
} from '../../core/storage/localStore';
import { useAppStore } from '../store/appStore';

export function TitleScreen() {
  const goto = useAppStore((s) => s.goto);
  const audioContext = useAppStore((s) => s.audioContext);
  const setAudioContext = useAppStore((s) => s.setAudioContext);
  const calibrationOffsetSec = useAppStore((s) => s.calibrationOffsetSec);
  const calibrated = calibrationOffsetSec !== 0;

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

  const handleStart = async () => {
    // Create (or reuse) the AudioContext while we are still inside the
    // user-gesture handler — iOS Safari and Android Chrome both refuse
    // to start audio that wasn't initiated by a tap/click.
    let ctx = audioContext;
    if (!ctx) {
      ctx = new AudioContext();
      setAudioContext(ctx);
    }
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    // Warm-up: play an inaudible 50 ms buffer so the audio pipeline is
    // fully spun up by the time GameScreen mounts. Without this, the
    // first few metronome clicks come out quieter than the rest because
    // the audio thread is still ramping up its first real output.
    warmUpAudio(ctx);
    goto('select');
  };

  const goCalibrate = async () => {
    // Calibration also needs a live AudioContext; reuse the same
    // user-gesture handling as Start.
    let ctx = audioContext;
    if (!ctx) {
      ctx = new AudioContext();
      setAudioContext(ctx);
    }
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    warmUpAudio(ctx);
    goto('calibration');
  };

  return (
    <main className="screen">
      <div className="title-logo" aria-label="Rhygym">
        <span className="title-logo-icon title-logo-icon-left" aria-hidden="true">
          ♪♬
        </span>
        <span className="title-logo-center">
          <span className="title-logo-name">Rhygym</span>
          <span className="title-logo-sub">リジム</span>
        </span>
        <span className="title-logo-icon title-logo-icon-right" aria-hidden="true">
          🏋
        </span>
      </div>
      <p className="tagline">楽譜を読み、タップでリズムを叩け。</p>
      <button className="primary" onClick={handleStart}>
        Start
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
