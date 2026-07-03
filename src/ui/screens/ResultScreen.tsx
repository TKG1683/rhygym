import { useEffect, useMemo, useRef, useState } from 'react';
import { computeTimingStats } from '../../core/judgement';
import {
  CALIBRATION_SUGGEST_THRESHOLD_MS,
  PASS_RANK_THRESHOLD,
} from '../../core/judgement/score';
import { PPQ } from '../../core/model';
import {
  evaluateMaxUnlocked,
  evaluateProgression,
  type MovementForProgression,
} from '../../core/progress/progression';
import { ETUDES, type EtudeWithMovementMeta } from '../../core/score/etudes';
import {
  addSkipTestFinal,
  getAllBests,
  getBest,
  getFailStreak,
  getSkipTestFinals,
  incrementFailStreak,
  isNewBest,
  markLessonCompleted,
  removeSkipTestFinal,
  resetFailStreak,
  setBest,
  type BestRecord,
  type BestsByEtude,
} from '../../core/storage/localStore';
import { TickTimeConverter } from '../../core/timing/tickTime';
import { TimingPlot } from '../game/TimingPlot';
import { ScoreView } from '../vexflow/ScoreView';
import { useAppStore } from '../store/appStore';

import type { Difficulty } from '../../core/model';

/** Rank ordering for "is this rank at least PASS_RANK_THRESHOLD?". */
const RANK_ORDER = ['D', 'C', 'B', 'A', 'S'] as const;

/** Display label per difficulty for the Result chip / breadcrumbs. */
const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  DOLCE: '🎀 Dolce',
  ESPRESSIVO: '♩ Espressivo',
  BRAVURA: '🔥 Bravura',
};

/** One-phrase hint for the Result difficulty chip. */
const DIFFICULTY_RESULT_HINTS: Record<Difficulty, string> = {
  DOLCE: '判定ゆるめ + プレイヘッド',
  ESPRESSIVO: '判定タイト・標準',
  BRAVURA: 'クリック前奏のみ・内部リズム',
};

/**
 * Project a v3 nested bests store down to one BestRecord per étude,
 * picking the highest rank across difficulties (and the higher score
 * on tie). Used both at mount snapshot time and inside the unlock
 * simulation so progression / Movement-medal logic continues to see
 * a flat `Record<etudeId, BestRecord>` even though the underlying
 * store now keeps BEGINNER and NORMAL slots separately (#20).
 */
function projectBestPerEtude(nested: BestsByEtude): Record<string, BestRecord> {
  const out: Record<string, BestRecord> = {};
  for (const [etudeId, byDiff] of Object.entries(nested)) {
    const list = Object.values(byDiff).filter((r): r is BestRecord => r != null);
    if (list.length === 0) continue;
    out[etudeId] = list.reduce((best, cur) => {
      const rDiff = RANK_ORDER.indexOf(cur.rank) - RANK_ORDER.indexOf(best.rank);
      if (rDiff > 0) return cur;
      if (rDiff < 0) return best;
      return cur.score > best.score ? cur : best;
    });
  }
  return out;
}

/**
 * Sub-pass-rank runs in a row that trigger the "アシストを試す" banner
 * (#55). Three is the smallest count that's clearly "the player is
 * stuck" rather than "the player had a bad day" — two failed runs is
 * normal grinding, four felt long enough that some players gave up
 * before the offer appeared.
 */
const ASSIST_OFFER_THRESHOLD = 3;

/**
 * Production URL for the share intent. Hard-coded rather than read
 * from `location.origin` so a share from a local dev session still
 * links to the live app — sharing "http://localhost:5173/rhygym/"
 * would be useless to whoever clicks the link.
 */
const SHARE_URL = 'https://tkg1683.github.io/rhygym/';
function rankAtLeast(rank: string, min: string): boolean {
  return RANK_ORDER.indexOf(rank as (typeof RANK_ORDER)[number]) >=
    RANK_ORDER.indexOf(min as (typeof RANK_ORDER)[number]);
}

/**
 * Pick the "next stage" relative to `current` from the loaded roster.
 *  1. Same level, indexInMovement + 1 (or — if neither carries an index —
 *     the next entry in the roster that shares the same level).
 *  2. Otherwise, the first stage of the next-higher level.
 *  3. Otherwise (current is the last stage of the highest level), null.
 *
 * Exam stages count as the end of their level, so "next" from an exam
 * is the next level's stage 1.
 */
function findNextEtude(
  roster: readonly EtudeWithMovementMeta[],
  current: EtudeWithMovementMeta,
): EtudeWithMovementMeta | null {
  if (current.isFinal) {
    return firstEtudeOfMovement(roster, current.movement + 1);
  }
  if (current.indexInMovement != null) {
    // Lessons live at indexInMovement = 0; +1 lands on etude-1 of
    // the same Movement, which is exactly the "okay, lesson done,
    // go play the real thing" jump the player expects.
    const sameLevelNext = roster.find(
      (s) => s.movement === current.movement && s.indexInMovement === current.indexInMovement! + 1,
    );
    if (sameLevelNext) return sameLevelNext;
  } else {
    // Roster doesn't carry per-stage indices (placeholder ETUDES): use
    // roster order within the level.
    const sameLevel = roster.filter((s) => s.movement === current.movement);
    const idx = sameLevel.findIndex((s) => s.id === current.id);
    if (idx >= 0 && idx + 1 < sameLevel.length) return sameLevel[idx + 1]!;
  }
  return firstEtudeOfMovement(roster, current.movement + 1);
}

function firstEtudeOfMovement(
  roster: readonly EtudeWithMovementMeta[],
  movement: number,
): EtudeWithMovementMeta | null {
  const inLevel = roster.filter((s) => s.movement === movement);
  if (inLevel.length === 0) return null;
  // Skip lessons (indexInMovement = 0) when asked for the "first
  // playable etude of Movement M+1" — the next-Movement landing
  // should drop the player onto a graded etude, not the lesson.
  const withIndex = inLevel.find((s) => !s.isLesson && s.indexInMovement === 1);
  return withIndex ?? inLevel.find((s) => !s.isLesson) ?? inLevel[0] ?? null;
}

export function ResultScreen() {
  const goto = useAppStore((s) => s.goto);
  const selectEtude = useAppStore((s) => s.selectEtude);
  const result = useAppStore((s) => s.lastResult);
  const stage = useAppStore((s) => s.lastEtude);
  const records = useAppStore((s) => s.lastRecords);
  const lastPlayedBpm = useAppStore((s) => s.lastPlayedBpm);
  const calibrationOffsetSec = useAppStore((s) => s.calibrationOffsetSec);
  const loadedEtudes = useAppStore((s) => s.loadedEtudes);
  const setCalibrationReturnScreen = useAppStore((s) => s.setCalibrationReturnScreen);
  const setSelectInitialMovement = useAppStore((s) => s.setSelectInitialMovement);
  const viaSkipTest = useAppStore((s) => s.viaSkipTest);
  const setAssistMode = useAppStore((s) => s.setAssistMode);
  const assistMode = useAppStore((s) => s.assistMode);
  const lastWasAssist = useAppStore((s) => s.lastWasAssist);
  const difficulty = useAppStore((s) => s.difficulty);
  const calibrated = calibrationOffsetSec !== 0;

  // Mark this screen as the return target so calibration can bring the
  // player back here (with their same result still on display) rather
  // than dropping them on Title.
  const goCalibration = () => {
    setCalibrationReturnScreen('result');
    goto('calibration');
  };

  // "ステージ選択へ" — drop the player back into the stage list for the
  // level they just played, not the top-level Level list. Looks up the
  // stage's level from the roster (network or fallback) and asks
  // StageSelect to open it on mount.
  const goEtudeSelect = () => {
    if (stage) {
      const roster = loadedEtudes ?? ETUDES;
      const meta = roster.find((s) => s.id === stage.id);
      if (meta) setSelectInitialMovement(meta.movement);
    }
    goto('select');
  };
  // Skip-test variant — go straight to the top-level Movement list
  // (don't pre-open the played stage's etude list). The player came
  // in from the locked card on the level list, so this returns them
  // to that same surface so they can see the new unlock state.
  const goMovementList = () => {
    setSelectInitialMovement(null);
    goto('select');
  };

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [wrapperWidth, setWrapperWidth] = useState(0);

  // Track the wrapper width so the timing plot sits at exactly the
  // same pixel width as the ScoreView above it; the plot's internal
  // x-axis is then mapped from song time onto that width.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => setWrapperWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Force the staff onto one row so every note has an unambiguous x
  // position; the plot beneath uses those same coordinates.
  const totalMeasures = useMemo(() => {
    if (!stage) return 1;
    const ts = stage.score.timeSigs[0] ?? { tick: 0, numerator: 4, denominator: 4 };
    const ticksPerMeasure = (PPQ * 4 * ts.numerator) / ts.denominator;
    return Math.max(1, Math.ceil(stage.score.totalTicks / ticksPerMeasure));
  }, [stage]);

  // Every measure gets the same generous width so notes always have
  // room to breathe — sparse bars don't waste space, dense bars don't
  // get squeezed. The horizontal scroll wrapper lets long pieces
  // overflow the viewport. This uniform spacing also means the staff
  // and the time-axis TimingPlot beneath stay in approximate visual
  // alignment (an even bar = an even slice of total time).
  const FIXED_MEASURE_WIDTH = 240;
  const measureWidths = useMemo<number[]>(() => {
    if (!stage) return [];
    return new Array(totalMeasures).fill(FIXED_MEASURE_WIDTH);
  }, [stage, totalMeasures]);
  const scoreMinWidth = useMemo(
    () => measureWidths.reduce((s, w) => s + w, 0) + 40,
    [measureWidths],
  );

  // Total song duration in seconds — drives the TimingPlot's x axis
  // so a given ms drift always renders at the same visual distance,
  // regardless of which measure the note lives in.
  const totalScoreSec = useMemo(() => {
    if (!stage) return 0;
    const converter = new TickTimeConverter(stage.score.tempos);
    return converter.tickToSec(stage.score.totalTicks);
  }, [stage]);

  const stats = useMemo(
    () => (records ? computeTimingStats(records) : null),
    [records],
  );

  const strayCount = useMemo(
    () =>
      records
        ? records.filter((r) => !r.noteId && r.tapSec !== null).length
        : 0,
    [records],
  );

  const prevBest = useMemo(
    () => (stage ? getBest(stage.id, difficulty) : null),
    // Re-snapshot every time a new result comes in so retries can
    // compare against the not-yet-overwritten best. Per-difficulty
    // lookup so BEGINNER and NORMAL plays each see their own
    // prior best in the prevBest line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stage, result, difficulty],
  );

  // A run is "below threshold" when the player chose a tempo slower
  // than the stage's authored BPM. Authored BPM is the *minimum to
  // pass*: the player can still play below it (useful for practice)
  // but the run won't count as a best-score entry. lastPlayedBpm is
  // pinned at run completion so a later slider nudge can't retro-
  // actively unlock a record.
  const belowPassThreshold =
    stage != null &&
    lastPlayedBpm != null &&
    lastPlayedBpm < stage.bpm;

  // Lessons (#53) are optional onboarding — they intentionally don't
  // produce best records, so the "NEW BEST!" badge / setBest writes
  // / unlock simulation all branch on this and skip lesson plays.
  const isLessonPlay = stage?.isLesson === true;

  const newBest =
    stage && result && !belowPassThreshold && !isLessonPlay && !lastWasAssist
      ? isNewBest({ etudeId: stage.id, difficulty, score: result.score })
      : false;

  // Movement unlock notification (#31 follow-up). Snapshot the bests
  // store at mount, simulate "what would unlock after this run", and
  // compare to the pre-run unlock state. If the player just bumped
  // their max-unlocked Movement, we render a celebratory banner so
  // the unlock is visible at the moment the player earns it instead
  // of only being discoverable on the next StageSelect visit.
  //
  // bestsAtMount is captured once so the comparison is stable across
  // re-renders — the setBest useEffect below mutates localStorage,
  // but the in-React snapshot lets us reason about "before vs after"
  // without re-querying mid-render.
  const bestsAtMount = useMemo<BestsByEtude>(() => getAllBests(), []);
  // Project the nested-by-difficulty v3 store down to one BestRecord
  // per étude (the highest rank across difficulties) so progression
  // / Movement-unlock logic still works the same way — a BEGINNER S
  // counts as a clear just like a NORMAL S.
  const flatBestsAtMount = useMemo<Record<string, BestRecord>>(() => {
    return projectBestPerEtude(bestsAtMount);
  }, [bestsAtMount]);
  // Snapshot the skip-test markers at mount too so the unlock-banner
  // simulation reasons about the same data the StageSelect will see
  // when we navigate back. We mutate the underlying localStorage in
  // the setBest useEffect below; this snapshot is the pre-mutation
  // view used for "before vs after" diff.
  const skipTestFinalsAtMount = useMemo(() => getSkipTestFinals(), []);
  const movementGroupsForUnlock = useMemo<MovementForProgression[]>(() => {
    const roster = loadedEtudes ?? ETUDES;
    const byLevel = new Map<number, MovementForProgression>();
    for (const s of roster) {
      const entry =
        byLevel.get(s.movement) ?? { movement: s.movement, stages: [] as MovementForProgression['stages'] };
      // Forward isLesson so progression's countClearedEtudes can
      // exclude lessons from the 3-of-5 Final-unlock gate. Without
      // this, a stray lesson best (shouldn't happen — we skip
      // setBest on lessons — but defensive) could quietly satisfy
      // the threshold and shift unlocks.
      (entry.stages as Array<{ id: string; isFinal?: boolean; isLesson?: boolean }>).push({
        id: s.id,
        isFinal: s.isFinal,
        isLesson: s.isLesson,
      });
      byLevel.set(s.movement, entry);
    }
    return Array.from(byLevel.values()).sort((a, b) => a.movement - b.movement);
  }, [loadedEtudes]);
  const simulatedBests = useMemo<Record<string, BestRecord> | null>(() => {
    if (!stage || !result || belowPassThreshold) return null;
    // Lessons don't write bests (see setBest useEffect below), so
    // they can't affect the unlock projection either — bail early.
    if (isLessonPlay) return null;
    // Assist-mode plays don't write bests either — same projection bail.
    if (lastWasAssist) return null;
    // Apply the would-be write to a nested copy of the v3 store,
    // then re-project to the flat per-étude shape progression needs.
    // The unlock banner fires only if THAT flat best changes — so a
    // NORMAL A play with an existing BEGINNER S leaves unlock state
    // untouched (BEGINNER S is still the etude's best across modes).
    const nested: BestsByEtude = { ...bestsAtMount };
    const slots = { ...(nested[stage.id] ?? {}) };
    const sameSlotExisting = slots[difficulty];
    const promoted =
      !sameSlotExisting ||
      result.score > sameSlotExisting.score ||
      (rankAtLeast(result.rank, 'A') && !rankAtLeast(sameSlotExisting.rank, 'A'));
    if (!promoted) return null;
    slots[difficulty] = {
      etudeId: stage.id,
      difficulty,
      score: result.score,
      rank: result.rank,
      achievedAt: new Date().toISOString(),
    };
    nested[stage.id] = slots;
    return projectBestPerEtude(nested);
  }, [stage, result, belowPassThreshold, isLessonPlay, lastWasAssist, bestsAtMount, difficulty]);

  // Project the post-run skip-test marker set. This run mutates the
  // markers exactly the same way `setBest` does in the useEffect
  // below — keep them in lockstep so the simulated "after" state
  // reflects what StageSelect will see on the next visit.
  const simulatedSkipTestFinals = useMemo<ReadonlySet<string>>(() => {
    if (!stage || !result) return skipTestFinalsAtMount;
    if (!stage.isFinal) return skipTestFinalsAtMount;
    // Assist-mode plays don't progress the skip-test marker set —
    // unlock state should reflect only true-skill clears (#55).
    if (lastWasAssist) return skipTestFinalsAtMount;
    if (viaSkipTest && result.rank === 'S') {
      const next = new Set(skipTestFinalsAtMount);
      next.add(stage.id);
      return next;
    }
    if (!viaSkipTest && rankAtLeast(result.rank, 'B')) {
      if (!skipTestFinalsAtMount.has(stage.id)) return skipTestFinalsAtMount;
      const next = new Set(skipTestFinalsAtMount);
      next.delete(stage.id);
      return next;
    }
    return skipTestFinalsAtMount;
  }, [stage, result, viaSkipTest, lastWasAssist, skipTestFinalsAtMount]);

  const unlockChange = useMemo(() => {
    if (!simulatedBests) return null;
    const before = evaluateMaxUnlocked(flatBestsAtMount, movementGroupsForUnlock, {
      skipTestFinals: skipTestFinalsAtMount,
    });
    const after = evaluateMaxUnlocked(simulatedBests, movementGroupsForUnlock, {
      skipTestFinals: simulatedSkipTestFinals,
    });
    if (after <= before) return null;
    return { from: before, to: after };
  }, [
    simulatedBests,
    flatBestsAtMount,
    movementGroupsForUnlock,
    skipTestFinalsAtMount,
    simulatedSkipTestFinals,
  ]);

  // Final-unlock banner — fires when this run was the etude clear that
  // pushed the Movement past the 3-etude-A+ threshold (or, after a
  // skip-test, finished the etude grind that exposes M's own Final
  // for the first time). Guards with `stage.isFinal` so a Final play
  // doesn't trigger its own "Final unlocked" banner.
  const finalUnlockChange = useMemo(() => {
    if (!simulatedBests || !stage || stage.isFinal) return null;
    const beforeState = evaluateProgression(flatBestsAtMount, movementGroupsForUnlock, {
      skipTestFinals: skipTestFinalsAtMount,
    });
    const afterState = evaluateProgression(simulatedBests, movementGroupsForUnlock, {
      skipTestFinals: simulatedSkipTestFinals,
    });
    const roster = loadedEtudes ?? ETUDES;
    const movement = roster.find((s) => s.id === stage.id)?.movement;
    if (movement == null) return null;
    if (beforeState.finalsUnlocked.has(movement)) return null;
    if (!afterState.finalsUnlocked.has(movement)) return null;
    return { movement };
  }, [
    simulatedBests,
    stage,
    flatBestsAtMount,
    movementGroupsForUnlock,
    loadedEtudes,
    skipTestFinalsAtMount,
    simulatedSkipTestFinals,
  ]);

  useEffect(() => {
    if (!stage || !result || !newBest) return;
    // Defensive — newBest is already gated on belowPassThreshold +
    // isLessonPlay + lastWasAssist above, but spelling the guards out
    // here makes the "don't promote a below-threshold / lesson /
    // assisted run" rules readable next to the actual setBest call.
    if (belowPassThreshold) return;
    if (isLessonPlay) return;
    if (lastWasAssist) return;
    setBest({
      etudeId: stage.id,
      difficulty,
      score: result.score,
      rank: result.rank,
      achievedAt: new Date().toISOString(),
    });
  }, [stage, result, newBest, belowPassThreshold, isLessonPlay, lastWasAssist, difficulty]);

  // Mark a lesson as completed the moment its Result loads (#53) —
  // regardless of rank. The lesson is "an exercise the player did",
  // not a graded clear, so reaching the Result screen is enough to
  // stamp the ✓ on the etude list next time.
  useEffect(() => {
    if (!stage || !result) return;
    if (!isLessonPlay) return;
    markLessonCompleted(stage.id);
  }, [stage, result, isLessonPlay]);

  // Sync the skip-test marker set whenever this run was a Final play.
  // Independent of `newBest` — a normal-mode B+ replay that scores
  // lower than the existing skip-test S best still "consumes" the
  // skip-test marker (the player has now demonstrated the normal
  // path), so M+1 should unlock even though `best` didn't change.
  useEffect(() => {
    if (!stage || !result) return;
    if (!stage.isFinal) return;
    if (belowPassThreshold) return; // sub-pass plays don't count for unlocks
    if (lastWasAssist) return; // assist plays don't count for unlocks (#55)
    if (viaSkipTest && result.rank === 'S') {
      addSkipTestFinal(stage.id);
    } else if (!viaSkipTest && rankAtLeast(result.rank, 'B')) {
      removeSkipTestFinal(stage.id);
    }
  }, [stage, result, viaSkipTest, belowPassThreshold, lastWasAssist]);

  // Per-etude consecutive-fail streak (#55). Lives in localStorage so a
  // page reload doesn't reset the counter and let the player avoid the
  // assist offer by refreshing. We update *once* per mount via the
  // failStreakUpdatedRef guard: a re-render must not re-increment, or a
  // single B-rank run would balloon the counter on every state change.
  const failStreakUpdatedRef = useRef(false);
  const [failStreak, setFailStreak] = useState<number>(0);

  useEffect(() => {
    if (!stage || !result) return;
    if (failStreakUpdatedRef.current) return;
    failStreakUpdatedRef.current = true;
    // Below-pass-threshold runs aren't "the player can't pass the étude"
    // — they're "the player picked a slower BPM on purpose". Don't move
    // the counter either direction so the assist offer is gated on
    // genuine ranked attempts.
    // Assist-mode plays similarly don't represent the un-aided ability,
    // and lesson plays are an optional onboarding stage (not a fail
    // attempt) — both are excluded from both increment and reset paths.
    if (belowPassThreshold || lastWasAssist || isLessonPlay) {
      setFailStreak(getFailStreak(stage.id));
      return;
    }
    if (rankAtLeast(result.rank, PASS_RANK_THRESHOLD)) {
      // A+ clear — the wall is broken, drop the counter back to zero
      // so future fails on this étude start the assist clock fresh.
      resetFailStreak(stage.id);
      setFailStreak(0);
    } else {
      // B or lower → bump the streak and show the offer once it
      // crosses ASSIST_OFFER_THRESHOLD.
      const next = incrementFailStreak(stage.id);
      setFailStreak(next);
    }
  }, [stage, result, belowPassThreshold, lastWasAssist, isLessonPlay]);

  // Assist banner gating — only offer when:
  //  - the just-finished run was NOT itself an assist play
  //  - the player has hit ASSIST_OFFER_THRESHOLD consecutive sub-pass runs
  //  - the player hasn't actually cleared (defensive — failStreak already
  //    captures this, but the rank guard reads explicitly)
  //  - this wasn't a lesson play (lessons aren't a fail context)
  const offerAssist =
    !lastWasAssist &&
    !isLessonPlay &&
    failStreak >= ASSIST_OFFER_THRESHOLD &&
    !rankAtLeast(result?.rank ?? 'D', PASS_RANK_THRESHOLD);

  // "アシストを試す" CTA — flip the global flag on, kick the player
  // straight back into the Game screen with the same Etude. The Result
  // useEffect above has already settled the failStreak / best-score
  // accounting for the run that brought us here, so navigating away
  // here is safe.
  const goAssistRun = () => {
    setAssistMode(true);
    goto('game');
  };
  // "通常モードに戻る" CTA — turn assist off; the player either retries
  // unaided or backs out of the Etude entirely. We do NOT toggle assist
  // mode off automatically on an A+ assist clear: the player should be
  // the one to decide they're ready to drop the training wheels.
  //
  // The banner below reads `assistMode` (not `lastWasAssist`) so it
  // swaps to a "戻りました" confirmation the instant this fires —
  // otherwise the button click produced no visible change and the
  // player couldn't tell whether they'd actually left assist (#55 bug).
  const exitAssist = () => {
    setAssistMode(false);
  };
  // Undo for the exit above — lets a player who tapped "通常モードに戻る"
  // by mistake flip straight back so their next リトライ is assisted
  // again. Reversibility is what makes the toggle safe to surface.
  const reenterAssist = () => {
    setAssistMode(true);
  };

  // Drift large enough to suggest (re-)calibration. Reuses the same
  // mean-signed-error already computed for the timing-stats line so we
  // don't re-walk the audit trail.
  const driftSuggestion = useMemo(() => {
    if (!stats || stats.hitCount === 0) return null;
    if (Math.abs(stats.meanDiffMs) < CALIBRATION_SUGGEST_THRESHOLD_MS) return null;
    return Math.round(stats.meanDiffMs);
  }, [stats]);

  // "Next stage" lookup — relevant once we know the player cleared
  // (rank A or higher), OR if this was a lesson (which doesn't gate
  // on rank — reaching the end is the win condition). Resolved
  // against the loaded roster (with the bundled ETUDES as a fallback
  // for the same reasons GameScreen does).
  const nextEtude = useMemo<EtudeWithMovementMeta | null>(() => {
    if (!stage || !result) return null;
    if (!isLessonPlay && !rankAtLeast(result.rank, PASS_RANK_THRESHOLD)) return null;
    const roster = loadedEtudes ?? ETUDES;
    const currentMeta = roster.find((s) => s.id === stage.id);
    if (!currentMeta) return null;
    return findNextEtude(roster, currentMeta);
  }, [stage, result, loadedEtudes, isLessonPlay]);

  // For routing-button purposes: lessons always "pass" (reaching the
  // Result screen is the completion criterion); graded plays still
  // need rank A+ to flip the "next etude" CTA over the retry one.
  const passed =
    (result != null && rankAtLeast(result.rank, PASS_RANK_THRESHOLD)) || isLessonPlay;
  // If the player cleared the very last stage there's no "next" to go
  // to — the level-list itself becomes the celebration target.
  const endOfRoster = passed && nextEtude === null;

  const goNext = () => {
    if (!nextEtude) return;
    selectEtude(nextEtude.id);
    goto('game');
  };

  // Share the run. Path picked by environment:
  //  - Touch device (mobile / tablet) → Web Share API with a 1080×1080
  //    image attached. The system share sheet is the native UX there
  //    and lets the player pick X / IG / Discord / wherever.
  //  - Desktop → X's post-intent URL in a new tab. The OS share sheet
  //    on desktop feels intrusive vs the expected "open X" flow, and
  //    most desktop browsers can't share files to X anyway. Text only.
  const shareToX = async () => {
    if (!stage || !result) return;
    const text = `Rhygym「${stage.name}」で ${result.rank} ランク達成！ (スコア ${result.score})`;
    const isTouchDevice =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0);

    if (isTouchDevice) {
      try {
        const blob = await generateResultImage(stage.name, result);
        if (blob) {
          const file = new File([blob], 'rhygym-result.png', { type: 'image/png' });
          if (
            typeof navigator.canShare === 'function' &&
            navigator.canShare({ files: [file] })
          ) {
            await navigator.share({
              text: `${text} #Rhygym`,
              url: SHARE_URL,
              files: [file],
            });
            return;
          }
        }
      } catch (err) {
        // User cancelled the system share sheet → bail silently.
        if ((err as Error)?.name === 'AbortError') return;
        // Other failures fall through to the intent URL so the
        // player still has a working share path.
      }
    }

    // Desktop / fallback: open X's post-intent in a new tab.
    const intent = new URL('https://x.com/intent/post');
    intent.searchParams.set('text', text);
    intent.searchParams.set('url', SHARE_URL);
    intent.searchParams.set('hashtags', 'Rhygym');
    window.open(intent.toString(), '_blank', 'noopener,noreferrer');
  };

  if (!result || !stage) {
    return (
      <main className="screen">
        <h1>リザルト</h1>
        <p className="muted">直前のプレイ結果が見つかりません。</p>
        <button className="primary" onClick={() => goto('select')}>
          Movement 一覧へ
        </button>
      </main>
    );
  }

  return (
    <main className="screen screen-result">
      <section className="result-plot-section">
        <h2 className="result-section-title">タイミング</h2>
        <div className="result-score-scroll">
          <div
            ref={wrapperRef}
            className="score-with-timing"
            style={{ minWidth: scoreMinWidth }}
          >
            <ScoreView
              score={stage.score}
              measuresPerLine={totalMeasures}
              measureWidths={measureWidths}
            />
            {records && wrapperWidth > 0 && totalScoreSec > 0 && (
              <TimingPlot
                records={records}
                width={wrapperWidth}
                totalSec={totalScoreSec}
              />
            )}
          </div>
        </div>
        {stats && stats.hitCount > 0 && (
          <p className="timing-stats">
            <span>平均 {formatBiasMs(stats.meanDiffMs)}</span>
            <span className="dot-sep">·</span>
            <span>バラつき ±{Math.round(stats.stdDiffMs)}ms</span>
            {strayCount > 0 && (
              <>
                <span className="dot-sep">·</span>
                <span>余計に {strayCount} 回タップ</span>
              </>
            )}
          </p>
        )}
      </section>

      {/* Lesson plays get a completely different chrome: no rank chip,
       *  no score number, no NEW BEST / unlock / belowPassThreshold —
       *  none of those concepts apply to an exploratory practice run.
       *  Just an acknowledgment + raw PERFECT/GOOD/MISS counts so the
       *  player can self-assess without the graded-test framing. */}
      {isLessonPlay ? (
        <section className="lesson-result-header">
          <div className="lesson-result-tag">📖 レッスン完了！</div>
          <p className="lesson-result-stage-name">{stage.name}</p>
          <p className="lesson-result-message">
            リズムの感覚をつかむのが目的。 スコアには残らないから、 軽くタイミングを確認して次の Etude に進もう。
          </p>
          <div className="lesson-result-breakdown">
            <span className="r-perfect">タイミング◎ {result.perfect}</span>
            <span className="r-good">タイミング○ {result.good}</span>
            <span className="r-miss">タップ漏れ {result.miss}</span>
          </div>
        </section>
      ) : (
        <>
          {belowPassThreshold && (
            <div className="bpm-threshold-banner" role="status">
              <p className="bpm-threshold-text">
                このBPM ({lastPlayedBpm}) は合格基準 ({stage.bpm}) 未満のため、記録は残りません。
              </p>
            </div>
          )}
          {newBest && <p className="new-best-badge">NEW BEST!</p>}
          <div
            className={`result-rank-chip rank-${result.rank}`}
            aria-label={`ランク ${result.rank}`}
          >
            <h1 className="result-rank">{result.rank}</h1>
          </div>
          <p className="result-score">{result.score}</p>
          <p className="result-accuracy">正確率 {(result.accuracy * 100).toFixed(1)}%</p>
          <p className="result-difficulty-chip">
            {DIFFICULTY_LABELS[difficulty]}{' '}
            <span className="result-difficulty-hint">
              ({DIFFICULTY_RESULT_HINTS[difficulty]} ・ ベストは難易度別)
            </span>
          </p>
          {prevBest && !newBest && (
            <p className="muted">
              {difficulty} 自己ベスト: {prevBest.score} ({prevBest.rank})
            </p>
          )}
          <div className="result-breakdown">
            <span className="r-perfect">PERFECT {result.perfect}</span>
            <span className="r-good">GOOD {result.good}</span>
            <span className="r-miss">MISS {result.miss}</span>
          </div>
          {unlockChange && (
            <div className="unlock-banner" role="status">
              <span className="unlock-banner-icon" aria-hidden="true">🎉</span>
              <span className="unlock-banner-text">
                {unlockChange.to === unlockChange.from + 1
                  ? `Movement ${unlockChange.to} が解放されました！`
                  : `Movement ${unlockChange.from + 1}–${unlockChange.to} が解放されました！`}
              </span>
            </div>
          )}
          {finalUnlockChange && (
            <div className="unlock-banner" role="status">
              <span className="unlock-banner-icon" aria-hidden="true">🚪</span>
              <span className="unlock-banner-text">
                Movement {finalUnlockChange.movement} の Final が解放されました！
              </span>
            </div>
          )}
        </>
      )}
      {/* Assist ("トレーニング") status banner. Gated on lastWasAssist —
       *  "this finished run was assisted" — but the two *states* switch
       *  on the live `assistMode` flag so tapping either button visibly
       *  swaps the banner right away. Without that swap the exit button
       *  looked dead (#55 UX bug). aria-live announces the swap for SR. */}
      {lastWasAssist && !isLessonPlay && (
        assistMode ? (
          <div className="assist-banner assist-banner-done" role="status" aria-live="polite">
            <span className="assist-banner-icon" aria-hidden="true">💡</span>
            <span className="assist-banner-text">
              アシストプレイ中のため、スコアは記録されません。「通常モードに戻る」を押すと、次のプレイから記録が残ります。
            </span>
            <button type="button" className="primary assist-cta" onClick={exitAssist}>
              通常モードに戻る
            </button>
          </div>
        ) : (
          <div className="assist-banner assist-banner-exited" role="status" aria-live="polite">
            <span className="assist-banner-icon" aria-hidden="true">✅</span>
            <span className="assist-banner-text">
              通常モードに戻りました。次のプレイからスコアが記録されます。
            </span>
            <button type="button" className="secondary assist-cta" onClick={reenterAssist}>
              アシストに戻す
            </button>
          </div>
        )
      )}
      {offerAssist && (
        <div className="assist-banner assist-banner-offer" role="status">
          <span className="assist-banner-icon" aria-hidden="true">💡</span>
          <span className="assist-banner-text">
            連続 {failStreak} 回不合格。アシストで「正解のリズム」を聴きながら練習してみる？
          </span>
          <button type="button" className="primary assist-cta" onClick={goAssistRun}>
            アシストを試す
          </button>
        </div>
      )}
      {driftSuggestion !== null && (
        <div className="calib-suggest-banner">
          <p className="calib-suggest-text">
            {calibrated
              ? `端末を変えた？再キャリブレーションがおすすめです。(現在の傾向: ${formatSignedMs(driftSuggestion)})`
              : `全体的に ${formatSignedMs(driftSuggestion)} ${driftSuggestion > 0 ? '遅め' : '早め'}傾向です。キャリブレーションで精度が上がる可能性があります。`}
          </p>
          <button className="primary calib-suggest-cta" onClick={goCalibration}>
            キャリブレーションする
          </button>
        </div>
      )}

      {isLessonPlay ? (
        // Lesson variant — no "次の Etude へ" or rank-based branching.
        // Primary CTA frames the next step as "go play the real thing"
        // (etude-1 of this Movement); secondary actions let the player
        // replay the lesson or back out to the etude list. No share
        // button — sharing a "lesson result" wouldn't be meaningful
        // when the run is intentionally un-scored.
        <>
          {nextEtude ? (
            <button className="primary next-etude-cta" onClick={goNext}>
              {nextEtude.name} に挑戦する →
            </button>
          ) : (
            <button className="primary next-etude-cta" onClick={goEtudeSelect}>
              Etude 一覧へ
            </button>
          )}
          <div className="row result-secondary-row">
            <button className="secondary result-secondary-btn" onClick={() => goto('game')}>
              もう一度レッスン
            </button>
            {nextEtude && (
              <button className="secondary result-secondary-btn" onClick={goEtudeSelect}>
                Etude 一覧へ
              </button>
            )}
          </div>
        </>
      ) : viaSkipTest ? (
        // Skip-test (飛び級) variant — neither the etude list nor the
        // "次の Etude" framing makes sense here (the player came in
        // from a locked Movement card, not an etude list). Offer
        // retry + return to Movement list only.
        passed ? (
          <>
            <button className="primary next-etude-cta" onClick={goMovementList}>
              Movement 一覧へ
            </button>
            <div className="row result-secondary-row">
              <button className="secondary result-secondary-btn" onClick={() => goto('game')}>
                リトライ
              </button>
            </div>
            <div className="row result-share-row">
              <ShareToXButton onClick={shareToX} />
            </div>
          </>
        ) : (
          <>
            <div className="row">
              <button className="primary" onClick={() => goto('game')}>
                リトライ
              </button>
              <button className="secondary" onClick={goMovementList}>
                Movement 一覧へ
              </button>
            </div>
            <div className="row result-share-row">
              <ShareToXButton onClick={shareToX} />
            </div>
          </>
        )
      ) : passed ? (
        <>
          {nextEtude ? (
            <button className="primary next-etude-cta" onClick={goNext}>
              次の Etude へ →
            </button>
          ) : (
            <button className="primary next-etude-cta" onClick={goEtudeSelect}>
              Movement 一覧へ
            </button>
          )}
          <div className="row result-secondary-row">
            <button className="secondary result-secondary-btn" onClick={() => goto('game')}>
              リトライ
            </button>
            {!endOfRoster && (
              <button className="secondary result-secondary-btn" onClick={goEtudeSelect}>
                Etude 一覧へ
              </button>
            )}
          </div>
          <div className="row result-share-row">
            <ShareToXButton onClick={shareToX} />
          </div>
        </>
      ) : (
        <>
          <div className="row">
            <button className="primary" onClick={() => goto('game')}>
              リトライ
            </button>
            <button className="secondary" onClick={goEtudeSelect}>
              Etude 一覧へ
            </button>
          </div>
          <div className="row result-share-row">
            <ShareToXButton onClick={shareToX} />
          </div>
        </>
      )}
      {/* When the drift banner is up it already carries a calibration
       * CTA, so the permanent funnel button would just be redundant. */}
      {driftSuggestion === null && (
        <div className="row">
          <button className="secondary calib-funnel-btn" onClick={goCalibration}>
            {calibrated
              ? `再キャリブレーションする (現在 ${formatSignedMs(Math.round(calibrationOffsetSec * 1000))})`
              : 'キャリブレーションする'}
          </button>
        </div>
      )}
    </main>
  );
}

function formatSignedMs(ms: number): string {
  if (ms > 0) return `+${ms}ms`;
  return `${ms}ms`;
}

function formatBiasMs(ms: number): string {
  const rounded = Math.round(ms);
  if (rounded === 0) return '±0ms';
  if (rounded > 0) return `+${rounded}ms (やや遅め)`;
  return `${rounded}ms (やや早め)`;
}

/**
 * X (formerly Twitter) brand-style share button. Inline SVG for the
 * 𝕏 mark — keeps it crisp at any size and avoids a network fetch for
 * a logo. Spelled-out label tells the player WHAT will be shared
 * (the score), since "シェア" alone left some users unsure whether
 * it'd post their result or just the app link.
 */
function ShareToXButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="secondary result-share-btn"
      onClick={onClick}
      aria-label="X (旧 Twitter) にスコアを共有する"
    >
      <svg className="result-share-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"
        />
      </svg>
      <span>スコアを共有する</span>
    </button>
  );
}

/**
 * Build a 1080×1080 PNG of the run's headline numbers — stage name,
 * rank in a tier-colored slab, score, accuracy and breakdown — so the
 * X post carries a visual hook instead of just a sentence. Pure
 * Canvas, no DOM dependency, so generation runs the same in any
 * browser. Returns null if the canvas context can't be created (jsdom
 * tests, ancient browsers) — caller falls back to text-only share.
 */
const RANK_FILL: Record<string, string> = {
  S: '#d4a017',
  A: '#3a8dde',
  B: '#6aa84f',
  C: '#b58c50',
  D: '#8a6b4a',
};

async function generateResultImage(
  stageName: string,
  result: { rank: string; score: number; accuracy: number; perfect: number; good: number; miss: number },
): Promise<Blob | null> {
  const SIZE = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Brand-yellow background + accent stripe across the top so the
  // card reads as "Rhygym" at a glance even thumbnailed in a feed.
  ctx.fillStyle = '#FFD24A';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#E8612E';
  ctx.fillRect(0, 0, SIZE, 16);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2A1B06';

  // Wordmark
  ctx.font = '800 96px "Poppins", "Noto Sans JP", sans-serif';
  ctx.fillText('♪ Rhygym 🏋', SIZE / 2, 150);

  // Stage name
  ctx.font = '500 56px "Noto Sans JP", sans-serif';
  ctx.fillStyle = 'rgba(42, 27, 6, 0.85)';
  ctx.fillText(stageName, SIZE / 2, 250);

  // Rank chip — same brand badge as the on-screen ResultScreen: tier
  // base colour + sheen gradient + inset highlight/shadow stack +
  // drop shadow, with the letter floating on top with a soft drop
  // shadow of its own. Centred horizontally; vertical anchor places
  // the chip in the headline slot between the stage name and score.
  const CHIP_SIZE = 380;
  const CHIP_X = (SIZE - CHIP_SIZE) / 2;
  const CHIP_Y = 360;
  drawRankChip(ctx, CHIP_X, CHIP_Y, CHIP_SIZE, result.rank);

  // Score (big) — sits below the chip with a clear visual gap.
  ctx.fillStyle = '#2A1B06';
  ctx.font = '800 120px "Poppins", sans-serif';
  ctx.fillText(String(result.score), SIZE / 2, 830);

  // Accuracy
  ctx.font = '500 44px "Noto Sans JP", sans-serif';
  ctx.fillStyle = 'rgba(42, 27, 6, 0.7)';
  ctx.fillText(`正確率 ${(result.accuracy * 100).toFixed(1)}%`, SIZE / 2, 910);

  // Breakdown row (PERFECT / GOOD / MISS)
  ctx.font = '600 40px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#2A1B06';
  ctx.fillText(
    `PERFECT ${result.perfect}   GOOD ${result.good}   MISS ${result.miss}`,
    SIZE / 2,
    975,
  );

  // Footer / URL
  ctx.font = '500 32px "Noto Sans JP", sans-serif';
  ctx.fillStyle = 'rgba(42, 27, 6, 0.55)';
  ctx.fillText('tkg1683.github.io/rhygym', SIZE / 2, 1030);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/**
 * Path helper — rounded rectangle compatible with browsers that ship
 * before the native `roundRect` API (Safari <16 etc.). Defines the
 * path on the context; caller fills / strokes it.
 */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Replicate the on-screen .result-rank-chip badge in canvas: tier
 * colour base + diagonal sheen gradient + inset white-top / dark-
 * bottom highlights + outer drop shadow, with the rank letter
 * floating on top. Mirrors the CSS rule pixel-for-pixel as closely
 * as Canvas allows so the shared image reads as "same badge, just
 * exported".
 */
function drawRankChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rank: string,
): void {
  const radius = Math.round(size * 0.21); // 28/132 ≈ 0.21
  const base = RANK_FILL[rank] ?? '#8a6b4a';

  // 1. Drop shadow + base fill
  ctx.save();
  ctx.shadowOffsetY = 10;
  ctx.shadowBlur = 22;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
  ctx.fillStyle = base;
  roundRectPath(ctx, x, y, size, size, radius);
  ctx.fill();
  ctx.restore();

  // 2. Diagonal sheen gradient — matches the 5-stop CSS gradient.
  const grad = ctx.createLinearGradient(x, y, x + size, y + size);
  grad.addColorStop(0,    'rgba(255, 255, 255, 0.60)');
  grad.addColorStop(0.28, 'rgba(255, 255, 255, 0.10)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.18)');
  grad.addColorStop(0.78, 'rgba(255, 255, 255, 0.22)');
  grad.addColorStop(1,    'rgba(0, 0, 0, 0.30)');
  ctx.fillStyle = grad;
  roundRectPath(ctx, x, y, size, size, radius);
  ctx.fill();

  // 3. Inset edge stroke (subtle dark rim) — matches
  //    `inset 0 0 0 2px rgba(0, 0, 0, 0.18)`.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = 4;
  roundRectPath(ctx, x + 2, y + 2, size - 4, size - 4, radius - 2);
  ctx.stroke();

  // 4. Top highlight — `inset 0 2px 1px rgba(255, 255, 255, 0.85)`.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 3;
  roundRectPath(ctx, x + 3, y + 3, size - 6, size - 6, radius - 3);
  // Only stroke the top edge by clipping; cheaper to draw thinner all
  // around so the bottom inherits a soft glow too.
  ctx.stroke();

  // 5. The rank letter itself — large weight 800, cream fill, soft
  //    drop shadow.
  ctx.save();
  ctx.fillStyle = '#fffaef'; // --text-on-dark
  ctx.font = `800 ${Math.round(size * 0.62)}px "Poppins", "Noto Sans JP", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowOffsetY = 3;
  ctx.shadowBlur = 4;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.fillText(rank, x + size / 2, y + size / 2 + size * 0.02);
  ctx.restore();
}
