import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createAudioContext } from '../../core/audio/audioContext';
import { playTitleStinger } from '../../core/audio/titleStinger';
import { SHARE_URL } from '../../core/shareUrl';
import {
  getAllBests,
  isCalibSuggestDismissed,
  setCalibSuggestDismissed,
} from '../../core/storage/localStore';
import { useAppStore } from '../store/appStore';

/** Copy/post text — kept to the app name + tagline so it reads fine
 * standalone in a tweet, LINE message, or pasted chat link. */
const SHARE_TEXT = 'Rhygym — 楽譜を読み、タップでリズムを叩け。';

/**
 * Shared gate for "should we bug this player about calibration right
 * now?" — true only for someone who hasn't calibrated, hasn't already
 * waved the suggestion off, and hasn't finished a single run yet (once
 * they have a best score, they've clearly played fine without it).
 * Backs both the passive Title banner and the Start-button prompt so
 * the two surfaces agree on who counts as "hasn't tried calibration".
 */
function shouldSuggestCalibration(calibrated: boolean): boolean {
  return !calibrated && !isCalibSuggestDismissed() && Object.keys(getAllBests()).length === 0;
}

// How long the logo's "lit" glow rides after the reveal sting fires.
// Roughly the sting's own ring-out so light and sound decay together.
const LOGO_LIT_MS = 900;

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
  const bgmEnabled = useAppStore((s) => s.bgmEnabled);
  const setBgmEnabled = useAppStore((s) => s.setBgmEnabled);
  const calibrationOffsetSec = useAppStore((s) => s.calibrationOffsetSec);
  const autoMode = useAppStore((s) => s.autoMode);
  const setAutoMode = useAppStore((s) => s.setAutoMode);
  const resetPlayData = useAppStore((s) => s.resetPlayData);
  const calibrated = calibrationOffsetSec !== 0;

  // Destructive — confirm before wiping every best score / unlock /
  // saved preference. Two-step (open the confirm card, then a second
  // tap to actually commit) so a stray tap near the link can't nuke a
  // player's progress.
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  const shareRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sharePanelOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (shareRootRef.current && !shareRootRef.current.contains(e.target as Node)) {
        setSharePanelOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSharePanelOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [sharePanelOpen]);

  // Reveal sting — the moment menu audio becomes available (the first
  // gesture spins up the AudioContext; navigating back from a menu it's
  // already live) fire a short bell arpeggio and flash the logo, so the
  // music arrives with a punch synced to the wordmark instead of fading
  // up out of silence. Guarded to once per title visit; the ref resets
  // naturally because this component remounts on every screen change.
  const [logoLit, setLogoLit] = useState(false);
  const stingFiredRef = useRef(false);
  useEffect(() => {
    const ctx = audioContext;
    if (!ctx || !bgmEnabled || stingFiredRef.current) return;
    stingFiredRef.current = true;
    // The gesture that created ctx resumes it, but the state flip is
    // async — resume() again defensively; scheduling on a resuming
    // context is fine since notes are queued against its clock.
    if (ctx.state === 'suspended') void ctx.resume();
    playTitleStinger(ctx);
    setLogoLit(true);
    const id = window.setTimeout(() => setLogoLit(false), LOGO_LIT_MS);
    return () => window.clearTimeout(id);
  }, [audioContext, bgmEnabled]);

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
  const [suggestVisible, setSuggestVisible] = useState(() => shouldSuggestCalibration(calibrated));
  const dismissSuggest = () => {
    setCalibSuggestDismissed(true);
    setSuggestVisible(false);
  };

  // Start-button intercept: same gate as the passive banner above, but
  // checked live at click time (not snapshotted) so calibrating and
  // coming straight back to Title clears it immediately. Cancellable —
  // "このまま始める" just runs the normal Start flow below.
  const [calibPromptOpen, setCalibPromptOpen] = useState(false);

  // The actual "go play" flow, split out of handleStart so both a
  // direct Start tap (already calibrated / already dismissed) and the
  // calibration prompt's "このまま始める" button can trigger it.
  const proceedToStart = () => {
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

  const handleStart = () => {
    if (shouldSuggestCalibration(calibrated)) {
      setCalibPromptOpen(true);
      return;
    }
    proceedToStart();
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

  // Intentional opt-in for menu music. BGM ships OFF so the app never
  // makes noise in a public place unasked; this button is the one place
  // a first-time player deliberately turns it on. The tap doubles as the
  // audio-unlock gesture, so music (+ the reveal sting, via the effect
  // above) starts on this very press. It's a toggle, not a one-way switch:
  // turn it on by mistake and the same button flips straight back to OFF
  // so it can be silenced instantly (no hunting for the corner 🔊). Both
  // read the same store flag so they never disagree.
  const toggleBgm = () => {
    let ctx = audioContext;
    if (!ctx) {
      ctx = createAudioContext();
      setAudioContext(ctx);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    setBgmEnabled(!bgmEnabled);
  };

  // "Introduce Rhygym" — on a touch device with the Web Share API
  // available, hand off to the OS share sheet directly: it already
  // offers copy-link + every installed SNS app, so there's nothing
  // useful our own UI could add. Desktop (and any browser without
  // navigator.share) falls back to a small panel with the two
  // explicit affordances that were actually asked for: copy the
  // link, or post to X.
  const handleShareClick = async () => {
    const isTouchDevice =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0);
    if (isTouchDevice && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Rhygym', text: SHARE_TEXT, url: SHARE_URL });
        return;
      } catch (err) {
        // User cancelled the system share sheet → bail silently rather
        // than also popping our own panel on top of it.
        if ((err as Error)?.name === 'AbortError') return;
        // Any other failure (unsupported data, etc.) falls through to
        // the manual panel so sharing still works somehow.
      }
    }
    setSharePanelOpen((open) => !open);
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(`${SHARE_TEXT}\n${SHARE_URL}`);
      setToast('リンクをコピーしました');
    } catch {
      setToast('コピーに失敗しました');
    }
    setSharePanelOpen(false);
  };

  const shareToX = () => {
    const intent = new URL('https://x.com/intent/post');
    intent.searchParams.set('text', SHARE_TEXT);
    intent.searchParams.set('url', SHARE_URL);
    intent.searchParams.set('hashtags', 'Rhygym');
    window.open(intent.toString(), '_blank', 'noopener,noreferrer');
    setSharePanelOpen(false);
  };

  const shareToLine = () => {
    const intent = new URL('https://social-plugins.line.me/lineit/share');
    intent.searchParams.set('url', SHARE_URL);
    intent.searchParams.set('text', SHARE_TEXT);
    window.open(intent.toString(), '_blank', 'noopener,noreferrer');
    setSharePanelOpen(false);
  };

  return (
    <main className="screen screen-title">
      <div className={`title-logo${logoLit ? ' title-logo-lit' : ''}`} aria-label="Rhygym">
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
      <button
        type="button"
        className={`title-bgm-cta${bgmEnabled ? ' is-on' : ''}`}
        aria-pressed={bgmEnabled}
        onClick={toggleBgm}
      >
        <span className="title-bgm-cta-icon" aria-hidden="true">{bgmEnabled ? '🔇' : '🎵'}</span>
        {bgmEnabled ? 'BGMをオフにする' : 'BGMをオンにする'}
      </button>
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
      <div className="share-control" ref={shareRootRef}>
        <button
          type="button"
          className="secondary"
          aria-haspopup="dialog"
          aria-expanded={sharePanelOpen}
          onClick={handleShareClick}
        >
          📣 Rhygymを紹介する
        </button>
        {sharePanelOpen && (
          <div className="share-panel" role="dialog" aria-label="Rhygymを紹介する">
            <button type="button" className="share-panel-btn" onClick={copyShareLink}>
              🔗 リンクをコピー
            </button>
            <button type="button" className="share-panel-btn" onClick={shareToX}>
              𝕏 でポストする
            </button>
            <button type="button" className="share-panel-btn" onClick={shareToLine}>
              LINEで送る
            </button>
          </div>
        )}
      </div>
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
      <button
        type="button"
        className="title-reset-link"
        onClick={() => setResetConfirmOpen(true)}
      >
        プレイデータを初期化する
      </button>
      {resetConfirmOpen && (
        <ResetConfirmModal
          onCancel={() => setResetConfirmOpen(false)}
          onConfirm={resetPlayData}
        />
      )}
      {calibPromptOpen && (
        <CalibrationPromptModal
          onCalibrate={() => {
            setCalibPromptOpen(false);
            goCalibrate();
          }}
          onSkip={() => {
            setCalibPromptOpen(false);
            proceedToStart();
          }}
        />
      )}
    </main>
  );
}

/**
 * Start-button intercept for an uncalibrated first-time player.
 * Portal'd to document.body (mirrors TutorialHintModal / ResetConfirmModal)
 * so the dim backdrop covers the full viewport. Not a hard gate — "この
 * まま始める" runs the normal Start flow, since a player who genuinely
 * doesn't want to calibrate shouldn't be blocked from playing at all.
 */
function CalibrationPromptModal({
  onCalibrate,
  onSkip,
}: {
  onCalibrate: () => void;
  onSkip: () => void;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="tutorial-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="calib-prompt-title"
    >
      <div className="tutorial-modal-card">
        <h2 id="calib-prompt-title" className="tutorial-modal-title">
          キャリブレーションしますか？
        </h2>
        <p className="tutorial-modal-body">
          端末によりタップのタイミングが実際のリズムのタイミングとズレて判定されることがあります
        </p>
        <button type="button" className="secondary tutorial-modal-secondary" onClick={onSkip}>
          このまま始める
        </button>
        <button type="button" className="primary tutorial-modal-next" onClick={onCalibrate}>
          キャリブレーションする
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Confirmation card for the destructive "プレイデータを初期化する"
 * action. Portal'd to document.body (mirrors TutorialHintModal) so the
 * dim backdrop covers the full viewport rather than clipping to the
 * screen's max-width container.
 */
function ResetConfirmModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="tutorial-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-confirm-title"
    >
      <div className="tutorial-modal-card">
        <h2 id="reset-confirm-title" className="tutorial-modal-title">
          プレイデータを初期化しますか？
        </h2>
        <p className="tutorial-modal-body">
          ベストスコア・解放状況・キャリブレーション・各種設定がすべて消え、元に戻せません。
        </p>
        <button type="button" className="secondary tutorial-modal-secondary" onClick={onCancel}>
          キャンセル
        </button>
        <button type="button" className="danger tutorial-modal-next" onClick={onConfirm}>
          初期化する
        </button>
      </div>
    </div>,
    document.body,
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
