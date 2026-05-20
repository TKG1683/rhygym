/**
 * GameView — orchestrates everything during a single stage play.
 *
 * State machine:
 *   waiting → playing → done → (auto-navigates to Result)
 *
 *   waiting:  FreeMetronome runs, staff is shown, "♪ お好きな…" prompt.
 *             The first tap stops the FreeMetronome, starts the scheduler
 *             with that tap timestamp as beat 1, and is itself fed to
 *             judgeTap in case the score's first note lands on beat 1.
 *   playing:  Each tap goes through judgeTap; a RAF loop expires any
 *             un-tapped note past the GOOD window into a MISS.
 *   done:     Triggered when every non-rest note has a verdict;
 *             computeResult is stored to appStore and the app navigates
 *             to the Result screen.
 *
 * Layout (post-#79/#80):
 *   - Header: name + ♩=N + warning chip + gear + リトライ + 中断
 *   - ScoreView wrapper (max ~45vh, manual scroll)
 *   - TapArea fills the rest. The JudgementLayer + prompt sit centred
 *     in the lower half so the entire lower portion of the viewport
 *     reads as one big tap zone.
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
import { JudgementLayer } from './JudgementLayer';
import { TapArea } from './TapArea';
import { GameSettingsPopover } from './GameSettingsPopover';
import { startGameLoop } from './gameLoop';

type Phase = 'waiting' | 'playing' | 'done';

// Absolute BPM range exposed by the slider. 40 covers slow-practice
// territory; 240 caps where the click grid starts becoming a buzz at
// 4/4 quarter-pulse. Step 1 is fine — finer than that and the slider
// just nudges the same audible tempo.
const BPM_MIN = 40;
const BPM_MAX = 240;
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
  /**
   * Player-chosen absolute BPM. `null` = "never set" — we fall back to
   * the stage's authored BPM so the first run on a brand-new install
   * still has a working tempo. The setter mirrors to localStorage so
   * the choice survives reload and follows the player across stages.
   */
  const userBpm = useAppStore((s) => s.userBpm);
  const setUserBpm = useAppStore((s) => s.setUserBpm);
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

  // userBpm `null` (never set) → fall back to stage.bpm so we always
  // have a real number to feed the audio graph. Clamp once at the
  // boundary so a corrupted store value (e.g. negative) can't crash
  // the scheduler.
  const effectiveBpm = useMemo(() => {
    const chosen = userBpm ?? stage.bpm;
    return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(chosen)));
  }, [userBpm, stage.bpm]);
  // Scaling factor that pulls the stage's authored score into the
  // player's chosen tempo. `1` when they pick exactly the authored BPM,
  // `0.85` when 15% slower, etc. — exactly the semantics the old
  // bpmMultiplier carried, just derived from absolute BPM now.
  const tempoScale = effectiveBpm / stage.bpm;

  // BPM symbol — depends on what unit the bpm value represents:
  //  - simple 4/ → ♩=N (quarter per minute, MIDI default)
  //  - compound 8/ (6/8/9/8/12/8) → ♩.=N (dotted-quarter pulse)
  //  - asymmetric 8/ (5/8/7/8) → ♪=N (eighth pulse — that's how
  //    these meters are typically counted)
  const tsFirst = stage.score.timeSigs[0];
  const isCompoundPiece =
    tsFirst != null && tsFirst.denominator === 8 && tsFirst.numerator % 3 === 0;
  const isAsymmetricPiece =
    tsFirst != null && tsFirst.denominator === 8 && (tsFirst.numerator === 5 || tsFirst.numerator === 7);

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
   * AudioContext.currentTime at the moment of the very first tap.
   * Acts as the song's t=0 in audio-time space. Tap-to-song-sec
   * conversion is just `tapAudioTime - startAudioTimeRef.current`.
   */
  const startAudioTimeRef = useRef(0);

  // Push accent-pattern changes into the running FreeMetronome without
  // tearing the audio graph down — toggling a beat shouldn't cause a
  // click drop-out. Only the primary time-sig is relevant since
  // FreeMetronome runs at the piece's opening meter (mid-piece meter
  // changes for the click grid are a separate issue).
  useEffect(() => {
    const fm = freeMetronomeRef.current;
    if (!fm) return;
    const ts = adjustedScore.timeSigs[0] ?? { tick: 0, numerator: 4, denominator: 4 };
    fm.setAccentPattern(metronomeAccents[tsKey(ts.numerator, ts.denominator)]);
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
   * on a bad run mid-song and restart instantly. Doesn't touch userBpm
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
          // threshold even if the player nudges userBpm afterwards.
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

  // Prompt the player only in waiting state — once they tap to start,
  // the band stays clean (the verdict pop-ups are signal enough that
  // they're already in the right zone).
  // 文言は要レビュー — 実装時に議論ペンディング
  const status = phase === 'waiting' ? '♪ お好きなタイミングでタップ → そこが1拍目' : '';

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
            className="secondary game-gear-btn no-tap"
            aria-label="設定"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙
          </button>
          <button className="secondary no-tap" onClick={resetGame}>
            リトライ
          </button>
          <button className="secondary no-tap" onClick={goEtudeList}>
            中断
          </button>
        </div>
      </div>
      {/* TapArea wraps BOTH the staff and the lower verdict band so
       * tapping anywhere below the header counts as a rhythm tap. The
       * staff wrapper inside opts back into vertical pan so the player
       * can still scroll a tall staff even though the parent has
       * touch-action: none. */}
      <TapArea ctx={audioContext} onTap={handleTap} className="game-tap-zone">
        <div className="score-view-wrapper game-score-wrapper">
          <ScoreView score={adjustedScore} measuresPerLine={2} />
        </div>
        <div className="game-tap-lower">
          <JudgementLayer verdict={verdict} triggerId={triggerId} prompt={status} />
        </div>
      </TapArea>
      <GameSettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        effectiveBpm={effectiveBpm}
        stageBpm={stage.bpm}
        bpmMin={BPM_MIN}
        bpmMax={BPM_MAX}
        bpmStep={BPM_STEP}
        bpmDisabled={phase !== 'waiting'}
        onBpmChange={setUserBpm}
        uniqueTimeSigs={uniqueTimeSigs}
        metronomeAccents={metronomeAccents}
        accentPatternFor={accentPatternFor}
        onToggleAccent={toggleAccent}
        onResetAccent={resetMetronomeAccentForTs}
      />
    </main>
  );
}
