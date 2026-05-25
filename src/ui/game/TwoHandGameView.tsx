/**
 * TwoHandGameView — playable two-hand mode game (#83 Phase B).
 *
 * Self-contained game view for the two-hand demo. Splits the score
 * into L / R lanes, runs two independent judgement pipelines, and
 * renders a left/right pair of TapAreas under a grand-staff. Audio
 * (FreeMetronome + GameScheduler) is shared across lanes since the
 * pulse is one piece of music — only the player-facing tap and
 * judgement state are duplicated.
 *
 * Deliberately stripped down vs. the single-hand GameView: no BPM
 * slider, no accent overrides, no assist/auto mode, no calibration
 * suggestion banner. The point of Phase B is end-to-end playability
 * with the smallest possible surface so the friend-playtest /
 * monetization-validation loop ([[project-monetization-strategy]])
 * can start. Polish + parity with GameView lands in Phase C/D.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { FreeMetronome } from '../../core/audio/freeMetronome';
import { defaultAccentPattern, tsKey } from '../../core/audio/metronome';
import { GameScheduler } from '../../core/audio/scheduler';
import {
  computeResult,
  findExpiredNotes,
  judgeTap,
  windowsForDifficulty,
  type GameResult,
  type Judgement,
  type JudgementRecord,
  type NoteCandidate,
} from '../../core/judgement';
import type { Etude, Lane, Score } from '../../core/model';
import { expandToCandidates } from '../../core/score/candidates';
import { filterScoreByLane } from '../../core/score/lanes';
import { TickTimeConverter } from '../../core/timing/tickTime';
import { useAppStore } from '../store/appStore';
import { GrandStaffView } from '../vexflow/GrandStaffView';
import { ConductorBaton } from './ConductorBaton';
import { TapArea } from './TapArea';
import { startGameLoop } from './gameLoop';

type Phase = 'waiting' | 'playing' | 'done';

interface Props {
  stage: Etude;
  /** Called with the combined result + per-lane breakdown when the run ends. */
  onComplete?: (combined: GameResult, perLane: Record<Lane, GameResult>) => void;
}

interface LaneState {
  candidates: NoteCandidate[];
  judgedIds: Set<string>;
  verdicts: JudgementRecord[];
}

export function TwoHandGameView({ stage, onComplete }: Props) {
  const audioContext = useAppStore((s) => s.audioContext);
  const calibrationOffsetSec = useAppStore((s) => s.calibrationOffsetSec);
  const difficulty = useAppStore((s) => s.difficulty);
  const metronomeAccents = useAppStore((s) => s.metronomeAccents);

  const [phase, setPhase] = useState<Phase>('waiting');
  const [combinedResult, setCombinedResult] = useState<GameResult | null>(null);
  const [perLaneResult, setPerLaneResult] = useState<Record<Lane, GameResult> | null>(null);
  // Verdict-flash state per lane. Bumped via a triggerId so duplicate
  // verdicts (e.g. two PERFECTs in a row) still re-animate the flash.
  const [verdictL, setVerdictL] = useState<Judgement | null>(null);
  const [verdictR, setVerdictR] = useState<Judgement | null>(null);
  const [verdictTriggerL, setVerdictTriggerL] = useState(0);
  const [verdictTriggerR, setVerdictTriggerR] = useState(0);

  // Adjusted score — for now no BPM scaling (Phase B keeps the
  // authored tempo). Difficulty windows still apply.
  const adjustedScore: Score = stage.score;
  const converter = useMemo(
    () => new TickTimeConverter(adjustedScore.tempos),
    [adjustedScore],
  );

  // Per-lane candidate pools. expandToCandidates already filters out
  // rests, so each lane's array is exactly "tappable onsets in this hand".
  const candidatesL = useMemo(
    () => expandToCandidates(filterScoreByLane(adjustedScore, 'L').notes, converter),
    [adjustedScore, converter],
  );
  const candidatesR = useMemo(
    () => expandToCandidates(filterScoreByLane(adjustedScore, 'R').notes, converter),
    [adjustedScore, converter],
  );

  const judgementWindows = useMemo(
    () => windowsForDifficulty(difficulty),
    [difficulty],
  );

  // Live per-lane state held in refs because the RAF loop and tap
  // handlers mutate them without needing React re-renders.
  const stateRef = useRef<Record<Lane, LaneState>>({
    L: { candidates: [], judgedIds: new Set(), verdicts: [] },
    R: { candidates: [], judgedIds: new Set(), verdicts: [] },
  });
  // Re-seed on every mount / score change so a retry starts clean.
  useEffect(() => {
    stateRef.current = {
      L: { candidates: candidatesL, judgedIds: new Set(), verdicts: [] },
      R: { candidates: candidatesR, judgedIds: new Set(), verdicts: [] },
    };
  }, [candidatesL, candidatesR]);

  const schedulerRef = useRef<GameScheduler | null>(null);
  const freeMetronomeRef = useRef<FreeMetronome | null>(null);
  const startAudioTimeRef = useRef(0);

  // Set up / tear down the audio machinery — mirrors GameView's pattern.
  useEffect(() => {
    if (!audioContext) return;
    setPhase('waiting');
    setCombinedResult(null);
    setPerLaneResult(null);
    setVerdictL(null);
    setVerdictR(null);

    const ts = adjustedScore.timeSigs[0] ?? { tick: 0, numerator: 4, denominator: 4 };
    const fmKey = tsKey(ts.numerator, ts.denominator);
    const internalBpm = adjustedScore.tempos[0]?.bpm ?? stage.bpm;
    const fm = new FreeMetronome(audioContext, {
      bpm: internalBpm,
      numerator: ts.numerator,
      denominator: ts.denominator,
      accentPattern:
        metronomeAccents[fmKey] ?? defaultAccentPattern(ts.numerator, ts.denominator),
    });
    const WARMUP_LEAD_SEC = 0.1;
    fm.start(audioContext.currentTime + WARMUP_LEAD_SEC);
    freeMetronomeRef.current = fm;

    const sch = new GameScheduler({
      score: adjustedScore,
      audioContext,
      metronomeEnabled: difficulty !== 'BRAVURA',
      accentOverrides: metronomeAccents,
    });
    schedulerRef.current = sch;

    return () => {
      fm.stop();
      sch.dispose();
      freeMetronomeRef.current = null;
      schedulerRef.current = null;
    };
  }, [audioContext, adjustedScore, difficulty, metronomeAccents, stage.bpm]);

  const flashVerdict = (lane: Lane, v: Judgement) => {
    if (lane === 'L') {
      setVerdictL(v);
      setVerdictTriggerL((t) => t + 1);
    } else {
      setVerdictR(v);
      setVerdictTriggerR((t) => t + 1);
    }
  };

  /**
   * Resolve a tap on the given lane against that lane's remaining
   * candidates. Mirrors GameView.judgeAndApply but lane-scoped — a
   * left-hand tap can't accidentally consume a right-hand note.
   */
  const judgeLaneTap = (lane: Lane, tapSec: number, startMode: boolean): void => {
    const ls = stateRef.current[lane];
    const remaining = ls.candidates.filter((c) => !ls.judgedIds.has(c.id));
    const result = judgeTap(tapSec, remaining, judgementWindows);
    if (result) {
      ls.judgedIds.add(result.noteId);
      const note = ls.candidates.find((c) => c.id === result.noteId);
      ls.verdicts.push({
        noteId: result.noteId,
        noteSec: note?.sec ?? null,
        tapSec,
        diffSec: result.diffSec,
        judgement: result.judgement,
      });
      flashVerdict(lane, result.judgement);
    } else if (!startMode) {
      // Stray tap during play counts as MISS for this lane. Start
      // taps that don't aim at a first note are silently absorbed
      // (the start signal isn't always intended as a note).
      ls.verdicts.push({
        noteId: null,
        noteSec: null,
        tapSec,
        diffSec: null,
        judgement: 'MISS',
      });
      flashVerdict(lane, 'MISS');
    }
  };

  const handleTap = (lane: Lane, tapAudioTime: number) => {
    if (phase === 'done') return;
    if (phase === 'waiting') {
      // Reuse GameView's "snap the start tap to the nearest downbeat"
      // logic so a tap on either lane can kick the song off. The
      // tap's own lane gets credit if its lane has a tappable note at
      // tick 0; the other lane just waits for its own first tap (or
      // auto-MISSes if the player ignores it).
      const fm = freeMetronomeRef.current;
      const sch = schedulerRef.current;
      const ctx = audioContext;
      if (!fm || !sch || !ctx) return;
      const ts = adjustedScore.timeSigs[0] ?? { tick: 0, numerator: 4, denominator: 4 };
      const internalBpm = adjustedScore.tempos[0]?.bpm ?? stage.bpm;
      const beatSec = (60 / internalBpm) * (4 / ts.denominator);
      const measureSec = beatSec * ts.numerator;
      const sinceFmStart = tapAudioTime - fm.startTimeAt;
      if (sinceFmStart < 0) return;
      const offsetFromDownbeat =
        ((sinceFmStart % measureSec) + measureSec) % measureSec;
      const ANTICIPATION_SEC = 0.08;
      let downbeatTime: number;
      let targetMeasureIndex: number;
      if (offsetFromDownbeat < beatSec) {
        downbeatTime = tapAudioTime - offsetFromDownbeat;
        targetMeasureIndex = Math.floor(sinceFmStart / measureSec);
      } else if (offsetFromDownbeat > measureSec - ANTICIPATION_SEC) {
        downbeatTime = tapAudioTime + (measureSec - offsetFromDownbeat);
        targetMeasureIndex = Math.floor(sinceFmStart / measureSec) + 1;
      } else {
        return; // Tap not on "1" — ignore (matches single-hand behaviour).
      }
      if (targetMeasureIndex < 1) return;
      startAudioTimeRef.current = downbeatTime;
      fm.stop();
      void sch.play(0, { atAudioTime: downbeatTime });
      setPhase('playing');
      // The start tap doubles as a hit attempt on its own lane.
      const tapSec = tapAudioTime - downbeatTime - calibrationOffsetSec;
      judgeLaneTap(lane, tapSec, true);
      return;
    }
    // Playing — straight lane-scoped judgement.
    const tapSec = tapAudioTime - startAudioTimeRef.current - calibrationOffsetSec;
    judgeLaneTap(lane, tapSec, false);
  };

  // End-of-song detection: expire un-tapped notes per lane, then
  // when both lanes are fully judged AND the audio has played out,
  // emit the result.
  useEffect(() => {
    if (phase !== 'playing') return;
    const ctx = audioContext;
    if (!ctx) return;
    const beatSec = 60 / (adjustedScore.tempos[0]?.bpm ?? stage.bpm);
    const endSec = converter.tickToSec(adjustedScore.totalTicks) - beatSec / 2;
    return startGameLoop({
      getAudioSec: () => ctx.currentTime - startAudioTimeRef.current,
      onFrame: (audioSec) => {
        for (const lane of ['L', 'R'] as const) {
          const ls = stateRef.current[lane];
          const remaining = ls.candidates.filter((c) => !ls.judgedIds.has(c.id));
          const expired = findExpiredNotes(audioSec, remaining, judgementWindows);
          for (const e of expired) {
            ls.judgedIds.add(e.id);
            ls.verdicts.push({
              noteId: e.id,
              noteSec: e.sec,
              tapSec: null,
              diffSec: null,
              judgement: 'MISS',
            });
            flashVerdict(lane, 'MISS');
          }
        }
        if (audioSec >= endSec) {
          schedulerRef.current?.stop();
          freeMetronomeRef.current?.stop();
          const lRecords = [...stateRef.current.L.verdicts];
          const rRecords = [...stateRef.current.R.verdicts];
          const lResult = computeResult(lRecords);
          const rResult = computeResult(rRecords);
          const combined = computeResult([...lRecords, ...rRecords]);
          setPhase('done');
          // 1.2 s settle so the last verdict + final click ring out
          // before the inline result panel takes over.
          setTimeout(() => {
            setCombinedResult(combined);
            setPerLaneResult({ L: lResult, R: rResult });
            onComplete?.(combined, { L: lResult, R: rResult });
          }, 1200);
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, audioContext]);

  if (!audioContext) {
    return (
      <div className="two-hand-game-host">
        <p className="muted">
          音声未初期化。 タイトルから「はじめる」 を押してから再度開いてください。
        </p>
      </div>
    );
  }

  return (
    <div className="two-hand-game-host">
      <GrandStaffView score={adjustedScore} measuresPerLine={2} />
      {/* Conductor sits BETWEEN the staff and the tap zones so the
       *  count digit + gesture stay in the player's central focal
       *  point. Verdict overlay is suppressed (verdict={null}) since
       *  per-lane verdicts already flash inside their own tap zones —
       *  doubling them centrally would be visually noisy. */}
      {phase !== 'done' && (
        <div className="two-hand-conductor-slot">
          <ConductorBaton
            audioContext={audioContext}
            fmRef={freeMetronomeRef}
            startTimeRef={startAudioTimeRef}
            phase={phase}
            score={adjustedScore}
            converter={converter}
            verdict={null}
            triggerId={0}
          />
        </div>
      )}
      <div className="two-hand-status" aria-live="polite">
        {phase === 'waiting' && (
          <p className="muted">どちらかの手を「1」 のタイミングで叩いて開始</p>
        )}
        {phase === 'done' && combinedResult && perLaneResult && (
          <TwoHandResultPanel combined={combinedResult} perLane={perLaneResult} />
        )}
      </div>
      <div className="two-hand-tap-row">
        <TapArea
          ctx={audioContext}
          onTap={(t) => handleTap('L', t)}
          className="two-hand-tap-zone two-hand-tap-l"
        >
          <div className="two-hand-tap-label">左手</div>
          {verdictL && (
            <VerdictBadge
              key={`l-${verdictTriggerL}`}
              verdict={verdictL}
            />
          )}
        </TapArea>
        <TapArea
          ctx={audioContext}
          onTap={(t) => handleTap('R', t)}
          className="two-hand-tap-zone two-hand-tap-r"
        >
          <div className="two-hand-tap-label">右手</div>
          {verdictR && (
            <VerdictBadge
              key={`r-${verdictTriggerR}`}
              verdict={verdictR}
            />
          )}
        </TapArea>
      </div>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: Judgement }) {
  return <div className={`two-hand-verdict verdict-${verdict.toLowerCase()}`}>{verdict}</div>;
}

function TwoHandResultPanel({
  combined,
  perLane,
}: {
  combined: GameResult;
  perLane: Record<Lane, GameResult>;
}) {
  return (
    <div className="two-hand-result">
      <p className="two-hand-result-rank">
        Rank: <strong>{combined.rank}</strong> ({combined.score})
      </p>
      <div className="two-hand-result-grid">
        <LaneResult label="左手" r={perLane.L} />
        <LaneResult label="右手" r={perLane.R} />
      </div>
    </div>
  );
}

function LaneResult({ label, r }: { label: string; r: GameResult }) {
  return (
    <div className="two-hand-lane-result">
      <p className="two-hand-lane-label">{label}</p>
      <p className="two-hand-lane-line">
        <span className="r-perfect">P {r.perfect}</span>
        <span className="r-good">G {r.good}</span>
        <span className="r-miss">M {r.miss}</span>
      </p>
      <p className="two-hand-lane-acc muted">{Math.round(r.accuracy * 100)}%</p>
    </div>
  );
}
