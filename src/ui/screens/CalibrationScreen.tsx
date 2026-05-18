/**
 * CalibrationScreen — measures the player's tap latency (touch lag +
 * Bluetooth lag + reaction time bias) so judgement can subtract it.
 *
 * Flow:
 *  1. Start a steady metronome at a fixed comfortable BPM.
 *  2. Ask the player to tap along with the clicks.
 *  3. For each tap, find the nearest beat in the click grid and record
 *     (tap − beat) in seconds. Drop samples wildly far from any beat
 *     so a stray finger or a missed beat doesn't poison the average.
 *  4. After N good samples, freeze and show the result.
 *  5. Save to localStorage on confirm; the rest of the app picks it up
 *     via the appStore.
 */

import { useEffect, useRef, useState } from 'react';
import { scheduleClick } from '../../core/audio/metronome';
import { setCalibration } from '../../core/storage/localStore';
import { TapArea } from '../game/TapArea';
import { useAppStore } from '../store/appStore';

const CALIB_BPM = 100;
const TARGET_SAMPLES = 8;
const PRE_ROLL_BEATS = 2; // play 2 beats before starting to accept taps
const TOTAL_BEATS_TO_SCHEDULE = 32; // enough to capture all target samples plus slack
const MAX_TAP_DEVIATION_SEC = 0.3; // anything more than 300 ms from any beat → drop

export function CalibrationScreen() {
  const goto = useAppStore((s) => s.goto);
  const audioContext = useAppStore((s) => s.audioContext);
  const setCalibrationOffsetSec = useAppStore((s) => s.setCalibrationOffsetSec);
  const currentOffset = useAppStore((s) => s.calibrationOffsetSec);
  const returnScreen = useAppStore((s) => s.calibrationReturnScreen);
  const setReturnScreen = useAppStore((s) => s.setCalibrationReturnScreen);

  // Common exit: honor the caller's return target (set by ResultScreen
  // when funneling from there), then clear it so subsequent entries
  // default back to Title.
  const exit = () => {
    const target = returnScreen ?? 'title';
    setReturnScreen(null);
    goto(target);
  };

  const [phase, setPhase] = useState<'measuring' | 'done'>('measuring');
  const [samples, setSamples] = useState<number[]>([]);
  const beatTimesRef = useRef<number[]>([]);
  const acceptFromTimeRef = useRef(0);
  const scheduledOscsRef = useRef<OscillatorNode[]>([]);

  // Spin up the click grid on mount and tear it down on unmount.
  useEffect(() => {
    if (!audioContext) return;
    const ctx = audioContext;
    const beatSec = 60 / CALIB_BPM;
    const start = ctx.currentTime + 0.4; // brief lead so the player isn't startled by an instant click
    const times: number[] = [];
    const oscs: OscillatorNode[] = [];
    for (let i = 0; i < TOTAL_BEATS_TO_SCHEDULE; i++) {
      const t = start + i * beatSec;
      times.push(t);
      const osc = scheduleClick(ctx, t, false, 0.7);
      oscs.push(osc);
    }
    beatTimesRef.current = times;
    // Ignore the first PRE_ROLL_BEATS clicks so the player has a chance
    // to lock onto the pulse before we start counting samples.
    acceptFromTimeRef.current = start + PRE_ROLL_BEATS * beatSec;
    scheduledOscsRef.current = oscs;

    return () => {
      // Silence anything still pending in the audio graph.
      for (const osc of oscs) {
        try {
          osc.disconnect();
        } catch {
          // already disconnected
        }
      }
      scheduledOscsRef.current = [];
    };
  }, [audioContext]);

  const handleTap = (tapAudioTime: number) => {
    if (phase !== 'measuring') return;
    if (tapAudioTime < acceptFromTimeRef.current) {
      // Pre-roll — still teaching the player the tempo, don't count it.
      return;
    }
    const beats = beatTimesRef.current;
    if (beats.length === 0) return;
    // Pick the nearest scheduled beat to the tap.
    let nearest = beats[0]!;
    let nearestDiff = Math.abs(tapAudioTime - nearest);
    for (let i = 1; i < beats.length; i++) {
      const b = beats[i]!;
      const d = Math.abs(tapAudioTime - b);
      if (d < nearestDiff) {
        nearestDiff = d;
        nearest = b;
      }
      if (b > tapAudioTime + 1) break;
    }
    if (nearestDiff > MAX_TAP_DEVIATION_SEC) return;
    const sample = tapAudioTime - nearest;
    setSamples((prev) => {
      const next = [...prev, sample];
      if (next.length >= TARGET_SAMPLES) {
        setPhase('done');
      }
      return next;
    });
  };

  const reset = () => {
    setSamples([]);
    setPhase('measuring');
  };

  const offsetSec =
    samples.length > 0
      ? samples.reduce((a, b) => a + b, 0) / samples.length
      : 0;
  const offsetMs = Math.round(offsetSec * 1000);

  const save = () => {
    setCalibration({
      offsetSec,
      sampleCount: samples.length,
      measuredAt: new Date().toISOString(),
    });
    setCalibrationOffsetSec(offsetSec);
    exit();
  };

  if (!audioContext) {
    return (
      <main className="screen">
        <h1>キャリブレーション</h1>
        <p className="muted">先にタイトルから Start を押して音声を初期化してください。</p>
        <button className="secondary" onClick={exit}>戻る</button>
      </main>
    );
  }

  return (
    <TapArea ctx={audioContext} onTap={handleTap} className="screen screen-calibration">
      <div className="no-tap">
        <h1>キャリブレーション</h1>
        <p className="muted">クリックに合わせてタップしてください</p>
      </div>

      {phase === 'measuring' ? (
        <>
          {/* Pulsing ring around the progress counter signals "tap to
           * begin" — first-timers don't know the entire screen is a
           * TapArea until something visually invites the tap. */}
          <div className="calib-tap-cue no-tap" aria-hidden="true">
            <p className="calib-progress" style={{ margin: 0 }}>
              {samples.length} / {TARGET_SAMPLES}
            </p>
          </div>
          <p className="muted no-tap">
            画面のどこをタップしても OK
          </p>
        </>
      ) : (
        <div className="no-tap calib-result">
          <p className="calib-offset-label">あなたのオフセット</p>
          <p className="calib-offset-value">
            {offsetMs >= 0 ? `+${offsetMs}` : offsetMs} ms
          </p>
          <p className="muted calib-offset-bias">
            {offsetMs > 10
              ? '(やや遅め)'
              : offsetMs < -10
                ? '(やや早め)'
                : '(ほぼ ±0)'}
          </p>
          <div className="row">
            <button className="primary" onClick={save}>
              保存
            </button>
            <button className="secondary" onClick={reset}>
              やり直し
            </button>
            <button className="secondary" onClick={exit}>
              戻る
            </button>
          </div>
        </div>
      )}

      <p className="muted calib-current no-tap">
        現在の設定値: {Math.round(currentOffset * 1000)} ms
      </p>
    </TapArea>
  );
}
