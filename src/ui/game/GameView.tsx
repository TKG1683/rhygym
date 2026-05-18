/**
 * GameView — orchestrates everything during a single stage play.
 *
 * State machine:
 *   waiting → playing → done → (auto-navigates to Result)
 *
 *   waiting:  FreeMetronome runs, staff is shown, "♪ Tap to start" prompt.
 *             The first tap stops the FreeMetronome, starts the scheduler
 *             with that tap timestamp as beat 1, and is itself fed to
 *             judgeTap in case the score's first note lands on beat 1.
 *   playing:  Each tap goes through judgeTap; a RAF loop expires any
 *             un-tapped note past the GOOD window into a MISS.
 *   done:     Triggered when every non-rest note has a verdict;
 *             computeResult is stored to appStore and the app navigates
 *             to the Result screen.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { FreeMetronome } from '../../core/audio/freeMetronome';
import { GameScheduler } from '../../core/audio/scheduler';
import {
  computeResult,
  findExpiredNotes,
  judgeTap,
  type Judgement,
  type JudgementRecord,
  type NoteCandidate,
} from '../../core/judgement';
import type { Score, Stage } from '../../core/model';
import { TickTimeConverter } from '../../core/timing/tickTime';
import type { NoteCoords } from '../vexflow/ScoreRenderer';
import { useAppStore } from '../store/appStore';
import { ScoreView } from '../vexflow/ScoreView';
import { JudgementLayer } from './JudgementLayer';
import { PlayheadLayer } from './PlayheadLayer';
import { TapArea } from './TapArea';
import { startGameLoop } from './gameLoop';

type Phase = 'waiting' | 'playing' | 'done';

const BPM_MIN_MULTIPLIER = 0.5;
const BPM_MAX_MULTIPLIER = 1.5;
const BPM_STEP = 0.05;

interface Props {
  stage: Stage;
}

export function GameView({ stage }: Props) {
  const audioContext = useAppStore((s) => s.audioContext);
  const setLastResult = useAppStore((s) => s.setLastResult);
  const setLastStage = useAppStore((s) => s.setLastStage);
  const setLastRecords = useAppStore((s) => s.setLastRecords);
  const calibrationOffsetSec = useAppStore((s) => s.calibrationOffsetSec);
  const goto = useAppStore((s) => s.goto);
  /**
   * BPM scaling factor the player can dial in while waiting. 1.0 = play
   * at the stage's authored BPM; 0.5 = half speed; 1.5 = 1.5× speed.
   * Stored in appStore so the value survives Game→Result→Retry — local
   * useState would reset to 1.0 every time the player came back.
   */
  const bpmMultiplier = useAppStore((s) => s.bpmMultiplier);
  const setBpmMultiplier = useAppStore((s) => s.setBpmMultiplier);

  const [phase, setPhase] = useState<Phase>('waiting');
  const [verdict, setVerdict] = useState<Judgement | null>(null);
  const [triggerId, setTriggerId] = useState(0);
  const effectiveBpm = Math.round(stage.bpm * bpmMultiplier);
  /** Debug: draw a moving playhead over the staff so we can eyeball timing. */
  const [showPlayhead, setShowPlayhead] = useState(false);
  const [noteCoords, setNoteCoords] = useState<Map<string, NoteCoords> | null>(null);

  const adjustedScore: Score = useMemo(
    () => ({
      ...stage.score,
      tempos: stage.score.tempos.map((t) => ({ ...t, bpm: t.bpm * bpmMultiplier })),
    }),
    [stage, bpmMultiplier],
  );
  const converter = useMemo(
    () => new TickTimeConverter(adjustedScore.tempos),
    [adjustedScore],
  );
  const candidates = useMemo<NoteCandidate[]>(
    () =>
      adjustedScore.notes
        .filter((n) => !n.isRest)
        .map((n) => ({ id: n.id, sec: converter.tickToSec(n.tick) })),
    [adjustedScore, converter],
  );

  const schedulerRef = useRef<GameScheduler | null>(null);
  const freeMetronomeRef = useRef<FreeMetronome | null>(null);
  const judgedIdsRef = useRef<Set<string>>(new Set());
  const verdictsRef = useRef<JudgementRecord[]>([]);
  /**
   * AudioContext.currentTime at the moment of the very first tap.
   * Acts as the song's t=0 in audio-time space. Tap-to-song-sec
   * conversion is just `tapAudioTime - startAudioTimeRef.current`.
   */
  const startAudioTimeRef = useRef(0);

  // Build/tear down the audio machinery for this stage. Re-runs when the
  // player changes BPM in waiting state so the metronome restarts at the
  // new tempo.
  useEffect(() => {
    if (!audioContext) return;
    judgedIdsRef.current = new Set();
    verdictsRef.current = [];
    setPhase('waiting');

    const ts = adjustedScore.timeSigs[0] ?? { tick: 0, numerator: 4, denominator: 4 };
    const fm = new FreeMetronome(audioContext, {
      bpm: effectiveBpm,
      beatsPerMeasure: ts.numerator,
    });
    // Push beat 1 100 ms into the future so the audio thread has time
    // to fully warm up before it has to render the first real click.
    // Without this lead time, the first metronome tick on a freshly
    // mounted GameScreen comes out noticeably quieter than the rest.
    const WARMUP_LEAD_SEC = 0.1;
    fm.start(audioContext.currentTime + WARMUP_LEAD_SEC);
    freeMetronomeRef.current = fm;

    // Scheduler's own metronome is disabled — FreeMetronome owns the
    // pulse end-to-end so the click never jitters when we hand off into
    // playing state. Scheduler only drives the note timeline and the
    // onComplete signal.
    const sch = new GameScheduler({
      score: adjustedScore,
      audioContext,
      metronomeEnabled: false,
    });
    schedulerRef.current = sch;

    return () => {
      fm.stop();
      sch.dispose();
      freeMetronomeRef.current = null;
      schedulerRef.current = null;
    };
  }, [audioContext, adjustedScore, effectiveBpm]);

  const showVerdict = (v: Judgement) => {
    setVerdict(v);
    setTriggerId((t) => t + 1);
  };

  /**
   * Resolve a tap (in song-time seconds) against the remaining notes.
   * A hit lands PERFECT/GOOD; a tap with no note within reach is logged
   * as MISS so wild taps actually cost the player score instead of
   * being silently ignored.
   *
   * Both branches push a full JudgementRecord (not just the verdict
   * string) so the Result screen has every diff it needs to draw the
   * timing plot.
   */
  const judgeAndApply = (tapSec: number) => {
    const remaining = candidates.filter((c) => !judgedIdsRef.current.has(c.id));
    const result = judgeTap(tapSec, remaining);
    if (result) {
      judgedIdsRef.current.add(result.noteId);
      const note = candidates.find((c) => c.id === result.noteId);
      verdictsRef.current.push({
        noteId: result.noteId,
        noteSec: note?.sec ?? null,
        tapSec,
        diffSec: result.diffSec,
        judgement: result.judgement,
      });
      showVerdict(result.judgement);
    } else {
      // Stray tap — no candidate within the GOOD window.
      verdictsRef.current.push({
        noteId: null,
        noteSec: null,
        tapSec,
        diffSec: null,
        judgement: 'MISS',
      });
      showVerdict('MISS');
    }
  };

  /**
   * Drop everything back to the `waiting` state without re-mounting.
   * Used by the "リトライ" button in the header so the player can bail
   * on a bad run mid-song and restart instantly. Doesn't touch the BPM
   * multiplier — the whole point of restarting is to try the same
   * settings again. The recorded verdicts so far are dropped, so the
   * abandoned run never reaches the result screen and won't pollute
   * any best-score tracking added in #10.
   */
  const resetGame = () => {
    const ctx = audioContext;
    if (!ctx) return;
    judgedIdsRef.current = new Set();
    verdictsRef.current = [];
    setVerdict(null);
    schedulerRef.current?.stop();
    const fm = freeMetronomeRef.current;
    if (fm) {
      fm.stop();
      // Same 100 ms warm-up lead the initial start uses so the very
      // first click after a restart isn't quieter than the rest.
      fm.start(ctx.currentTime + 0.1);
    }
    setPhase('waiting');
  };

  const handleTap = (tapAudioTime: number) => {
    if (phase === 'waiting') {
      // Anchor the song to the metronome click the player was AIMING
      // for — the *nearest* beat to their tap, whichever side they
      // landed on. This is the fix for #28: the song's beat 1 is the
      // metronome's beat (so the click grid stays the truth), and the
      // first tap is still judged against that beat 1 so a note at
      // tick=0 can actually be hit by this tap.
      const fm = freeMetronomeRef.current;
      if (!fm) return;
      const beatSec = 60 / effectiveBpm;
      const fmStart = fm.startTimeAt;
      const sinceFmStart = tapAudioTime - fmStart;
      const nearestBeatIndex = Math.max(0, Math.round(sinceFmStart / beatSec));
      const nearestBeatTime = fmStart + nearestBeatIndex * beatSec;
      startAudioTimeRef.current = nearestBeatTime;
      void schedulerRef.current?.play(0, { atAudioTime: nearestBeatTime });
      setPhase('playing');
      // First tap counts as a tap on whatever lives at tick=0.
      // Its diff is (tap − nearestBeat) with the personal offset
      // subtracted, exactly like every later tap.
      const tapSec = tapAudioTime - nearestBeatTime - calibrationOffsetSec;
      judgeAndApply(tapSec);
      return;
    }
    if (phase === 'playing') {
      // Subtract the per-device calibration offset so PERFECT means
      // "on the beat as the player perceives it" rather than "on the
      // beat assuming zero touch latency".
      const tapSec =
        tapAudioTime - startAudioTimeRef.current - calibrationOffsetSec;
      judgeAndApply(tapSec);
    }
  };

  // Expire un-tapped notes and detect end-of-game.
  useEffect(() => {
    if (phase !== 'playing') return;
    const ctx = audioContext;
    if (!ctx) return;
    return startGameLoop({
      getAudioSec: () => ctx.currentTime - startAudioTimeRef.current,
      onFrame: (audioSec) => {
        const remaining = candidates.filter((c) => !judgedIdsRef.current.has(c.id));
        const expired = findExpiredNotes(audioSec, remaining);
        for (const e of expired) {
          judgedIdsRef.current.add(e.id);
          verdictsRef.current.push({
            noteId: e.id,
            noteSec: e.sec,
            tapSec: null,
            diffSec: null,
            judgement: 'MISS',
          });
          showVerdict('MISS');
        }
        if (judgedIdsRef.current.size >= candidates.length) {
          schedulerRef.current?.stop();
          freeMetronomeRef.current?.stop();
          const finalRecords = [...verdictsRef.current];
          setLastResult(computeResult(finalRecords));
          setLastStage(stage);
          setLastRecords(finalRecords);
          setPhase('done');
          // Hold for a beat so the last judgement effect and final
          // metronome click can register before we cut to Result.
          setTimeout(() => goto('result'), 1000);
        }
      },
    });
  }, [phase, candidates, audioContext, setLastResult, goto]);

  if (!audioContext) {
    return (
      <main className="screen">
        <h1>{stage.name}</h1>
        <p className="muted">音声未初期化です。タイトルから Start を押してください。</p>
        <button className="secondary" onClick={() => goto('title')}>
          タイトルへ
        </button>
      </main>
    );
  }

  const status =
    phase === 'waiting' ? '♪ Tap anywhere to start' :
    phase === 'playing' ? '♪ Playing…' :
    '';

  return (
    <TapArea ctx={audioContext} onTap={handleTap} className="screen screen-game">
      <div className="game-header no-tap">
        <div>
          <h1 className="game-title">{stage.name}</h1>
          <p className="muted">BPM {effectiveBpm}</p>
        </div>
        <div className="row">
          <button className="secondary" onClick={resetGame}>
            リトライ
          </button>
          <button
            className="secondary"
            onClick={() => {
              schedulerRef.current?.stop();
              freeMetronomeRef.current?.stop();
              goto('select');
            }}
          >
            中断
          </button>
        </div>
      </div>
      <div className="score-view-wrapper">
        <ScoreView
          score={adjustedScore}
          onRender={setNoteCoords}
          measuresPerLine={2}
        />
        {showPlayhead && noteCoords && (
          <PlayheadLayer
            score={adjustedScore}
            converter={converter}
            noteCoords={noteCoords}
            getSongSec={() => {
              const ctx = audioContext;
              if (!ctx) return 0;
              if (phase !== 'playing') return -1;
              return ctx.currentTime - startAudioTimeRef.current;
            }}
          />
        )}
      </div>
      <label className="debug-toggle no-tap">
        <input
          type="checkbox"
          checked={showPlayhead}
          onChange={(e) => setShowPlayhead(e.target.checked)}
        />
        debug: プレイヘッド表示
      </label>
      <div className="bpm-control no-tap">
        <label htmlFor="bpm-slider" className="bpm-label">
          Tempo: <span className="bpm-value">{effectiveBpm}</span>
          {bpmMultiplier !== 1 && (
            <span className="bpm-multiplier">
              ({bpmMultiplier.toFixed(2)}× of {stage.bpm})
            </span>
          )}
        </label>
        <input
          id="bpm-slider"
          type="range"
          min={BPM_MIN_MULTIPLIER}
          max={BPM_MAX_MULTIPLIER}
          step={BPM_STEP}
          value={bpmMultiplier}
          disabled={phase !== 'waiting'}
          onChange={(e) => setBpmMultiplier(Number(e.target.value))}
        />
      </div>
      <p className="status-text">{status}</p>
      <JudgementLayer verdict={verdict} triggerId={triggerId} />
    </TapArea>
  );
}
