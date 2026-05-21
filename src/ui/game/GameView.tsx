/**
 * GameView — orchestrates everything during a single stage play.
 *
 * State machine:
 *   waiting → playing → done → (auto-navigates to Result)
 *
 *   waiting:  FreeMetronome runs the click grid; a ConductorBaton SVG
 *             draws the gesture for the stage's opening meter so the
 *             player can see where beat 1 lands (issue #81 follow-up).
 *             Any tap snaps to the nearest FM downbeat — that snapped
 *             time becomes the song's beat 1 and is also judged against
 *             the first note in case it lives at tick=0.
 *   playing:  Scheduler takes over from the downbeat. Each tap goes
 *             through judgeTap; a RAF loop expires any un-tapped note
 *             past the GOOD window into a MISS.
 *   done:     Triggered when every non-rest note has a verdict;
 *             computeResult is stored to appStore and the app navigates
 *             to the Result screen.
 *
 * Layout (post-#81):
 *   - Header: name + ♩=N + warning chip + gear + リトライ + 中断
 *   - ScoreView wrapper (max ~45vh, manual scroll)
 *   - TapArea fills the rest. ConductorBaton sits centred in the
 *     upper portion and owns the beat-count digit (waiting) and
 *     verdict flash (playing) in the same overlay slot so the
 *     player's focal point doesn't jump across phases.
 *   - Gear button opens GameSettingsPopover (BPM slider + accents).
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
import type { Score, Etude } from '../../core/model';
import { ETUDES } from '../../core/score/etudes';
import { TickTimeConverter } from '../../core/timing/tickTime';
import { defaultAccentPattern, tsKey } from '../../core/audio/metronome';
import { useAppStore } from '../store/appStore';
import { ScoreView } from '../vexflow/ScoreView';
import { ConductorBaton } from './ConductorBaton';
import { TapArea } from './TapArea';
import { GameSettingsPopover } from './GameSettingsPopover';
import { startGameLoop } from './gameLoop';

type Phase = 'waiting' | 'playing' | 'done';

// Slider range, expressed in canonical eighth-notes-per-minute and
// divided by each stage's eighths-per-pulse at render time. Keeping
// the *musical* range constant (rather than the displayed number)
// means the slider exposes roughly the same span of wall-clock
// speeds in every meter:
//   ♩= : 40 – 240  (eighth 80 – 480)
//   ♪= : 80 – 480  (eighth 80 – 480)
//   ♩.= : 27 – 160 (eighth 81 – 480)
// 80 eighth/min is slow practice territory, 480 is about as fast as
// a click grid stays useful before it blurs into a buzz.
const EIGHTH_BPM_MIN = 80;
const EIGHTH_BPM_MAX = 480;
const BPM_STEP = 1;

interface Props {
  stage: Etude;
}

export function GameView({ stage }: Props) {
  const audioContext = useAppStore((s) => s.audioContext);
  const setLastResult = useAppStore((s) => s.setLastResult);
  const setLastEtude = useAppStore((s) => s.setLastEtude);
  const setLastRecords = useAppStore((s) => s.setLastRecords);
  const setLastPlayedBpm = useAppStore((s) => s.setLastPlayedBpm);
  const calibrationOffsetSec = useAppStore((s) => s.calibrationOffsetSec);
  const goto = useAppStore((s) => s.goto);
  const loadedEtudes = useAppStore((s) => s.loadedEtudes);
  const setSelectInitialMovement = useAppStore((s) => s.setSelectInitialMovement);
  const metronomeAccents = useAppStore((s) => s.metronomeAccents);
  const setMetronomeAccentForTs = useAppStore((s) => s.setMetronomeAccentForTs);
  const resetMetronomeAccentForTs = useAppStore((s) => s.resetMetronomeAccentForTs);

  // Abort the run and drop the player back into the Movement's Etude
  // list (NOT the top-level Movement grid). Same idea as Result's
  // "Etude 一覧へ" — leaving in the middle should still leave them
  // inside the level they just abandoned so retrying is one tap.
  const goEtudeList = () => {
    const roster = loadedEtudes ?? ETUDES;
    const meta = roster.find((s) => s.id === stage.id);
    if (meta) setSelectInitialMovement(meta.movement);
    schedulerRef.current?.stop();
    freeMetronomeRef.current?.stop();
    goto('select');
  };

  const [phase, setPhase] = useState<Phase>('waiting');
  const [verdict, setVerdict] = useState<Judgement | null>(null);
  const [triggerId, setTriggerId] = useState(0);
  // Open/close state for the gear-icon settings popover. Pure React
  // state — no need to put it in zustand since nothing outside this
  // screen cares whether the popover is showing.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // BPM symbol — depends on what unit the stage's bpm value represents:
  //  - simple 4/ → ♩=N (quarter per minute, MIDI default)
  //  - compound 8/ (6/8/9/8/12/8) → ♩.=N (dotted-quarter pulse)
  //  - asymmetric 8/ (5/8/7/8) → ♪=N (eighth pulse)
  const tsFirst = stage.score.timeSigs[0];
  const isCompoundPiece =
    tsFirst != null && tsFirst.denominator === 8 && tsFirst.numerator % 3 === 0;
  const isAsymmetricPiece =
    tsFirst != null && tsFirst.denominator === 8 && (tsFirst.numerator === 5 || tsFirst.numerator === 7);
  // Eighths per *displayed* pulse — drives the slider's BPM range so
  // that "240 ♩= ≠ 240 ♪= ≠ 240 ♩.=" can't happen: each unit caps at
  // the same musical speed (EIGHTH_BPM_MAX).
  const eighthsPerPulse = isCompoundPiece ? 3 : isAsymmetricPiece ? 1 : 2;
  const bpmMin = Math.ceil(EIGHTH_BPM_MIN / eighthsPerPulse);
  const bpmMax = Math.floor(EIGHTH_BPM_MAX / eighthsPerPulse);

  // Slider BPM, scoped to a single Etude. The store carries the value
  // across Game → Result → リトライ (which remounts GameView) so a
  // failed run doesn't lose the player's tempo choice on retry. The
  // etudeId pairing is what makes "different Etude resets to authored"
  // work: when the stored etudeId doesn't match this stage, we treat
  // the stored bpm as belonging to a different stage and ignore it.
  const lastChosenBpm = useAppStore((s) => s.lastChosenBpm);
  const lastChosenBpmEtudeId = useAppStore((s) => s.lastChosenBpmEtudeId);
  const setLastChosenBpm = useAppStore((s) => s.setLastChosenBpm);
  const effectiveBpm = useMemo(() => {
    const carry = lastChosenBpmEtudeId === stage.id && lastChosenBpm != null;
    const raw = carry ? lastChosenBpm : stage.bpm;
    return Math.min(bpmMax, Math.max(bpmMin, Math.round(raw)));
  }, [lastChosenBpm, lastChosenBpmEtudeId, stage.id, stage.bpm, bpmMin, bpmMax]);
  const tempoScale = effectiveBpm / stage.bpm;
  const handleBpmChange = (newBpm: number) => {
    const clamped = Math.min(bpmMax, Math.max(bpmMin, Math.round(newBpm)));
    setLastChosenBpm(clamped, stage.id);
  };

  // Unique time signatures the piece visits, in score order. Drives
  // the accent-config UI — one row per distinct meter, in the order
  // the player encounters them.
  const uniqueTimeSigs = useMemo(() => {
    const seen = new Set<string>();
    const out: { numerator: number; denominator: number; key: string }[] = [];
    for (const ts of stage.score.timeSigs) {
      const key = tsKey(ts.numerator, ts.denominator);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ numerator: ts.numerator, denominator: ts.denominator, key });
    }
    return out;
  }, [stage]);

  const accentPatternFor = (numerator: number, denominator: number): boolean[] => {
    const key = tsKey(numerator, denominator);
    const stored = metronomeAccents[key];
    if (stored && stored.length === numerator) return stored;
    return defaultAccentPattern(numerator, denominator);
  };
  const toggleAccent = (key: string, numerator: number, denominator: number, beat: number) => {
    const current = accentPatternFor(numerator, denominator);
    const next = current.map((b, i) => (i === beat ? !b : b));
    setMetronomeAccentForTs(key, next);
  };

  const adjustedScore: Score = useMemo(
    () => ({
      ...stage.score,
      tempos: stage.score.tempos.map((t) => ({ ...t, bpm: t.bpm * tempoScale })),
    }),
    [stage, tempoScale],
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
   * AudioContext.currentTime at the moment the song's beat 1 lands —
   * always a FreeMetronome downbeat, never the player's raw tap time.
   * Tap-to-song-sec conversion is just
   * `tapAudioTime - startAudioTimeRef.current`.
   */
  const startAudioTimeRef = useRef(0);

  // Push accent-pattern changes into both audio drivers without tearing
  // the graph down — toggling a beat shouldn't cause a click drop-out.
  // FreeMetronome only sees the opening meter (it's the waiting-state
  // driver, fixed-ts by design); the GameScheduler owns the playing-
  // state pulse and follows mid-piece meter changes via collectBeats,
  // so it gets the full per-ts override map.
  useEffect(() => {
    const fm = freeMetronomeRef.current;
    const sch = schedulerRef.current;
    const ts = adjustedScore.timeSigs[0] ?? { tick: 0, numerator: 4, denominator: 4 };
    fm?.setAccentPattern(metronomeAccents[tsKey(ts.numerator, ts.denominator)]);
    sch?.setAccentOverrides(metronomeAccents);
  }, [metronomeAccents, adjustedScore]);

  // Build/tear down the audio machinery for this stage. Re-runs when the
  // player changes BPM in waiting state so the metronome restarts at the
  // new tempo.
  useEffect(() => {
    if (!audioContext) return;
    judgedIdsRef.current = new Set();
    verdictsRef.current = [];
    setPhase('waiting');

    const ts = adjustedScore.timeSigs[0] ?? { tick: 0, numerator: 4, denominator: 4 };
    const fmKey = tsKey(ts.numerator, ts.denominator);
    // FreeMetronome needs the *internal* MIDI tempo (quarter per min),
    // not the displayed StageDef.bpm — for compound pieces the latter
    // is ♩.=N and would make the click run at 2/3 speed vs the
    // scheduler. Use the score's tempo head, which buildScore already
    // scaled for compound primaries.
    const internalBpm = adjustedScore.tempos[0]?.bpm ?? effectiveBpm;
    const fm = new FreeMetronome(audioContext, {
      bpm: internalBpm,
      numerator: ts.numerator,
      denominator: ts.denominator,
      accentPattern: metronomeAccents[fmKey],
    });
    // Push beat 1 100 ms into the future so the audio thread has time
    // to fully warm up before it has to render the first real click.
    // Without this lead time, the first metronome tick on a freshly
    // mounted GameScreen comes out noticeably quieter than the rest.
    const WARMUP_LEAD_SEC = 0.1;
    fm.start(audioContext.currentTime + WARMUP_LEAD_SEC);
    freeMetronomeRef.current = fm;

    // Scheduler owns the click during PLAYING. Its collectBeats walks
    // through `score.timeSigs` and applies the per-ts accent pattern
    // at the right tick — that's how mid-piece meter changes (4/4 →
    // 5/8 etc.) get correctly accented. FreeMetronome handles the
    // waiting state with the opening meter only.
    const sch = new GameScheduler({
      score: adjustedScore,
      audioContext,
      metronomeEnabled: true,
      accentOverrides: metronomeAccents,
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
   * Judge the tap that started the song. Same matching as judgeAndApply
   * but a tap that doesn't land near any candidate is *silently
   * absorbed* instead of logged as a stray MISS — start taps that
   * weren't aimed at a first note (e.g. piece opens with a rest)
   * shouldn't penalise the player just for being the start signal.
   */
  const judgeStartTap = (tapSec: number) => {
    const remaining = candidates.filter((c) => !judgedIdsRef.current.has(c.id));
    const result = judgeTap(tapSec, remaining);
    if (!result) return;
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
  };

  /**
   * Drop everything back to the `waiting` state without re-mounting.
   * Used by the "リトライ" button in the header so the player can bail
   * on a bad run mid-song and restart instantly. Doesn't touch effectiveBpm
   * — the whole point of restarting is to try the same settings again.
   * The recorded verdicts so far are dropped, so the abandoned run
   * never reaches the result screen and won't pollute any best-score
   * tracking.
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
      // Snap the tap to the nearest FreeMetronome downbeat — that
      // snapped instant is the song's beat 1. Snapping to *downbeats*
      // (rather than the older nearest-beat snap) keeps variable-meter
      // pieces musically coherent: a tap landing on a weak beat no
      // longer reframes the upcoming time-signature change. See
      // issue #81 / [[feedback_tap_to_downbeat]]. The ConductorBaton
      // is the visual cue for *when* the downbeat is.
      const fm = freeMetronomeRef.current;
      const sch = schedulerRef.current;
      const ctx = audioContext;
      if (!fm || !sch || !ctx) return;
      const ts = adjustedScore.timeSigs[0] ?? { tick: 0, numerator: 4, denominator: 4 };
      const internalBpm = adjustedScore.tempos[0]?.bpm ?? effectiveBpm;
      const beatSec = (60 / internalBpm) * (4 / ts.denominator);
      const measureSec = beatSec * ts.numerator;
      const sinceFmStart = tapAudioTime - fm.startTimeAt;
      // Round to the nearest downbeat index — Math.round, not floor,
      // so a tap anywhere in the second half of a measure snaps
      // forward to the next downbeat instead of back to the previous.
      const measureIndex = Math.max(0, Math.round(sinceFmStart / measureSec));
      const downbeatTime = fm.startTimeAt + measureIndex * measureSec;
      startAudioTimeRef.current = downbeatTime;
      // FM clicks beyond the snap downbeat are disconnect()ed; the
      // scheduler's first click is queued at downbeatTime so the pulse
      // continues unbroken (or starts from the next beat if downbeatTime
      // is already in the past once reaction-time is accounted for).
      fm.stop();
      void sch.play(0, { atAudioTime: downbeatTime });
      setPhase('playing');
      // The start tap doubles as the first input — if a note lives at
      // (or near) tick=0, this tap is its hit. judgeStartTap skips the
      // stray-MISS log when there's nothing close to aim at, so opening
      // on a rest doesn't punish the player for the start signal.
      const tapSec = tapAudioTime - downbeatTime - calibrationOffsetSec;
      judgeStartTap(tapSec);
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
    // Stop half a beat before totalTicks so the FreeMetronome's
    // next-measure click — the one queued by the 100 ms look-ahead —
    // is still tagged "future" at stop() time and gets disconnect()ed
    // before it fires. Half a beat scales with tempo: a fixed 20 ms
    // slack is fine at 100 BPM but eats into the audible part of the
    // final click at 240 BPM. Half-a-beat always lands cleanly
    // between the last real click and the first phantom one.
    const beatSec = 60 / effectiveBpm;
    const endSec = converter.tickToSec(adjustedScore.totalTicks) - beatSec / 2;
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
        // End when the song's last bar has actually played out, not the
        // moment the final note got a verdict. Stopping on the last
        // verdict made stages whose final beat isn't a note (e.g. ends
        // on a rest) cut off mid-measure — both the trailing click and
        // the ending feel got lopped off.
        if (audioSec >= endSec) {
          // Both can stop immediately: FreeMetronome.stop() now only
          // disconnects future-queued clicks and leaves currently-firing
          // ones alone, so the final click rings out naturally while
          // the lookahead's next-measure beat is killed before it ever
          // sounds.
          schedulerRef.current?.stop();
          freeMetronomeRef.current?.stop();

          const finalRecords = [...verdictsRef.current];
          setLastResult(computeResult(finalRecords));
          setLastEtude(stage);
          setLastRecords(finalRecords);
          // Pin the BPM the run was actually played at so ResultScreen
          // can decide whether the run was below the stage's pass
          // threshold even if the player nudges the slider afterwards.
          setLastPlayedBpm(effectiveBpm);
          setPhase('done');
          // 1.5 s breathing room so the last judgement effect, the
          // tail of the final click, and a moment of silence all
          // register before we cut to Result.
          setTimeout(() => goto('result'), 1500);
        }
      },
    });
  }, [phase, candidates, audioContext, setLastResult, setLastEtude, setLastRecords, setLastPlayedBpm, goto, stage, adjustedScore, converter, effectiveBpm]);

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

  const belowPassThreshold = effectiveBpm < stage.bpm;

  return (
    <main className="screen screen-game">
      <div className="game-header">
        <div className="game-header-title">
          <h1 className="game-title">{stage.name}</h1>
          <p className="muted game-bpm-line">
            {isAsymmetricPiece ? '♪' : '♩'}
            {isCompoundPiece && <span className="bpm-dot">.</span>} = {effectiveBpm}
            {belowPassThreshold && (
              <span className="bpm-warning-chip" role="status">
                ⚠ 合格判定が出ません (最低 BPM: {stage.bpm})
              </span>
            )}
          </p>
        </div>
        <div className="row game-header-actions">
          <button
            type="button"
            className="secondary game-settings-btn no-tap"
            aria-label="メトロノーム設定"
            onClick={() => setSettingsOpen(true)}
          >
            <svg
              className="game-settings-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {/* Metronome body — isoceles trapezoid (wider at the base) */}
              <path d="M8 21 L16 21 L14 4 L10 4 Z" />
              {/* Base line — flat foot */}
              <line x1="6" y1="21" x2="18" y2="21" />
              {/* Pendulum needle, tilted right as if mid-swing */}
              <line x1="12" y1="14" x2="15.5" y2="6" />
            </svg>
            <span>設定</span>
          </button>
          <button className="secondary no-tap" onClick={resetGame}>
            リトライ
          </button>
          <button className="secondary no-tap" onClick={goEtudeList}>
            中断
          </button>
        </div>
      </div>
      {/* Staff lives OUTSIDE the TapArea so a swipe-to-scroll on a long
       * etude doesn't fire a stray rhythm tap. The bottom half of the
       * screen is the dedicated tap zone — large enough on its own
       * without needing the staff to double as tap target. */}
      <div className="score-view-wrapper game-score-wrapper">
        <ScoreView score={adjustedScore} measuresPerLine={2} maxHeightVh={48} />
      </div>
      <TapArea ctx={audioContext} onTap={handleTap} className="game-tap-zone">
        {phase !== 'done' && (
          <ConductorBaton
            audioContext={audioContext}
            fmRef={freeMetronomeRef}
            startTimeRef={startAudioTimeRef}
            phase={phase}
            score={adjustedScore}
            converter={converter}
            verdict={verdict}
            triggerId={triggerId}
          />
        )}
      </TapArea>
      <GameSettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        effectiveBpm={effectiveBpm}
        stageBpm={stage.bpm}
        bpmMin={bpmMin}
        bpmMax={bpmMax}
        bpmStep={BPM_STEP}
        bpmDisabled={phase !== 'waiting'}
        onBpmChange={handleBpmChange}
        uniqueTimeSigs={uniqueTimeSigs}
        metronomeAccents={metronomeAccents}
        accentPatternFor={accentPatternFor}
        onToggleAccent={toggleAccent}
        onResetAccent={resetMetronomeAccentForTs}
      />
    </main>
  );
}
