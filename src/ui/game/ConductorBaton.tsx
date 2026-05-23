/**
 * ConductorBaton — animated conductor's baton + beat count that runs
 * for the entire stage (issue #81 follow-up).
 *
 * Trajectory: quadratic Bezier between consecutive ictuses with the
 * control point pulled *inward* (toward the SVG origin), so each
 * stroke curves concave-toward-center the way a real wrist motion does.
 *
 * Velocity profile: ease-in-quint per segment. The baton holds at the
 * ictus (the "tame" pause right after landing), slowly starts moving,
 * then accelerates, arriving at the next ictus at max velocity — the
 * snap-into-place feel of a real wrist stroke. Each segment boundary
 * (= each click moment) is the LANDING: tip is at the ictus, velocity
 * drops to zero, brief pause, then the next stroke builds.
 *
 * Continues running during playback so etudes opening on a rest still
 * have a felt-pulse reference. As the score's TS changes mid-piece,
 * the ictus pattern swaps and the count resets to 1 on the next
 * downbeat.
 *
 * Layout: a wrapper div holds the count digit (rendered as plain HTML
 * so no SVG-clipping surprises) above the baton SVG. The earlier
 * SVG-embedded text version got clipped by the tap-zone flex
 * constraints on small phones; HTML + tabular-nums lets the digit
 * render at its natural CSS font-size regardless of SVG sizing.
 */

import { useEffect, useRef, useState } from 'react';
import type { FreeMetronome } from '../../core/audio/freeMetronome';
import type { Judgement } from '../../core/judgement';
import type { Score, TimeSignatureEvent } from '../../core/model';
import { PPQ } from '../../core/model';
import type { TickTimeConverter } from '../../core/timing/tickTime';

interface Props {
  audioContext: AudioContext;
  fmRef: { current: FreeMetronome | null };
  startTimeRef: { current: number };
  phase: 'waiting' | 'playing' | 'done';
  score: Score;
  converter: TickTimeConverter;
  /**
   * Latest PERFECT / GOOD / MISS verdict to flash in the centre
   * overlay during playback. Owned by GameView so taps + expirations
   * stay co-located with the judgement state.
   */
  verdict: Judgement | null;
  /**
   * Bumped on every tap so identical verdicts (e.g. two PERFECTs in
   * a row) re-trigger the fade animation by remounting the element.
   */
  triggerId: number;
  /**
   * Tutorial-only flag (#26 v2). When true, the count digit grows an
   * adjacent "↓ TAP" hint on every *tappable* "1" — i.e. starting
   * from the second downbeat onwards, matching GameView's "skip the
   * first downbeat" tap-acceptance rule. Production stages stay
   * clean of this guide.
   */
  tutorialMode?: boolean;
}

const VERDICT_FADE_MS = 320;
const VERDICT_COLORS: Record<Judgement, string> = {
  PERFECT: '#FFD24A', // brand yellow
  GOOD:    '#3a8dde', // calm blue
  MISS:    '#E8612E', // accent orange
};

interface Point {
  x: number;
  y: number;
}

function getIctusPoints(numerator: number, denominator: number): Point[] {
  switch (numerator) {
    case 1:
      return [{ x: 0, y: 100 }];
    case 2:
      return [
        { x:   0, y:  100 },
        { x:   0, y: -100 },
      ];
    case 3:
      return [
        { x:   0, y:  100 },
        { x:  95, y:    0 },
        { x:   0, y: -100 },
      ];
    case 4:
      return [
        { x:   0, y:  100 },
        { x: -90, y:   30 },
        { x:  90, y:   30 },
        { x:   0, y: -100 },
      ];
    case 5:
      return [
        { x:   0, y:  100 },
        { x: -70, y:   40 },
        { x: -90, y:  -30 },
        { x:  60, y:   30 },
        { x:   0, y: -100 },
      ];
    case 6:
      if (denominator === 8) {
        return [
          { x:   0, y:  100 },
          { x: -55, y:   60 },
          { x: -85, y:    0 },
          { x:  30, y:   80 },
          { x:  85, y:    0 },
          { x:   0, y: -100 },
        ];
      }
      return [
        { x:   0, y:  100 },
        { x: -75, y:   55 },
        { x: -95, y:    0 },
        { x:  95, y:    0 },
        { x:  75, y:   55 },
        { x:   0, y: -100 },
      ];
    case 7:
      return [
        { x:   0, y:  100 },
        { x: -55, y:   55 },
        { x: -90, y:    0 },
        { x:  55, y:   55 },
        { x:  90, y:    0 },
        { x:  35, y:  -40 },
        { x:   0, y: -100 },
      ];
    default: {
      const pts: Point[] = [];
      for (let i = 0; i < numerator; i++) {
        const t = i / numerator;
        const angle = Math.PI / 2 - t * 2 * Math.PI;
        pts.push({ x: 95 * Math.cos(angle), y: 95 * Math.sin(angle) });
      }
      return pts;
    }
  }
}

/**
 * Ease-in-quint: very long pause at the start (= just after the ictus
 * landing), then quick acceleration into the next ictus.
 *
 * p(t) = t^5     ⇒    p'(t) = 5·t^4
 *   p(0) = 0,    p'(0) = 0   ← extended hold at the apex
 *   p(0.5) = 0.031              (only 3% of the way at half time)
 *   p(0.75) = 0.237             (24% at three-quarters)
 *   p(1) = 1,    p'(1) = 5   ← snap into the next ictus
 *
 * Combined with the segment boundary discontinuity (velocity drops to
 * 0 at the next ictus) you get LAND-PAUSE-CREEP-SNAP-LAND per beat,
 * which reads as a deliberate conducting gesture.
 */
function easeInQuint(t: number): number {
  return t * t * t * t * t;
}

const INWARD_PULL = 0.35;

function inwardCP(p0: Point, p1: Point): Point {
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  return { x: mx * (1 - INWARD_PULL), y: my * (1 - INWARD_PULL) };
}

function quadraticBezier(p0: Point, cp: Point, p1: Point, t: number): Point {
  const omt = 1 - t;
  return {
    x: omt * omt * p0.x + 2 * omt * t * cp.x + t * t * p1.x,
    y: omt * omt * p0.y + 2 * omt * t * cp.y + t * t * p1.y,
  };
}

function findActiveTs(timeSigs: TimeSignatureEvent[], tick: number): TimeSignatureEvent {
  const opening = timeSigs[0];
  if (!opening) {
    return { tick: 0, numerator: 4, denominator: 4 };
  }
  if (tick < opening.tick) return opening;
  let active = opening;
  for (const ts of timeSigs) {
    if (ts.tick <= tick) active = ts;
    else break;
  }
  return active;
}

interface FrameState {
  numerator: number;
  denominator: number;
  beat: number;
  pos: Point;
}

export function ConductorBaton({
  audioContext,
  fmRef,
  startTimeRef,
  phase,
  score,
  converter,
  verdict,
  triggerId,
  tutorialMode = false,
}: Props) {
  const tipRef = useRef<SVGCircleElement>(null);
  const trailRef = useRef<SVGCircleElement>(null);
  // Tracks which FM-measure cycle we're in during `waiting` so the
  // tutorial TAP hint only shows on tappable "1"s (the very first
  // downbeat is intentionally skipped by GameView's handleTap).
  const [fmMeasureIndex, setFmMeasureIndex] = useState(0);

  // Verdict visibility (formerly the standalone JudgementLayer). The
  // verdict text now occupies the same centre slot as the count digit
  // so the player's eye stays put across the waiting → playing
  // transition instead of jumping between two different positions.
  const [verdictVisible, setVerdictVisible] = useState(false);
  useEffect(() => {
    if (verdict === null) return;
    setVerdictVisible(true);
    const t = setTimeout(() => setVerdictVisible(false), VERDICT_FADE_MS);
    return () => clearTimeout(t);
  }, [verdict, triggerId]);

  const [pattern, setPattern] = useState(() => {
    const opening = score.timeSigs[0] ?? { tick: 0, numerator: 4, denominator: 4 };
    return {
      ictuses: getIctusPoints(opening.numerator, opening.denominator),
      numerator: opening.numerator,
      denominator: opening.denominator,
    };
  });
  const [beat, setBeat] = useState(1);

  const beat1 = pattern.ictuses[0] ?? { x: 0, y: 100 };

  const cacheRef = useRef(new Map<string, Point[]>());
  const getCached = (num: number, den: number) => {
    const key = `${num}/${den}`;
    const existing = cacheRef.current.get(key);
    if (existing) return existing;
    const ictuses = getIctusPoints(num, den);
    cacheRef.current.set(key, ictuses);
    return ictuses;
  };

  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      const fm = fmRef.current;
      let state: FrameState | null = null;
      let activeIctuses: Point[] | null = null;

      if (phase === 'waiting') {
        if (!fm) {
          rafId = requestAnimationFrame(tick);
          return;
        }
        const opening = score.timeSigs[0] ?? { tick: 0, numerator: 4, denominator: 4 };
        const ictuses = getCached(opening.numerator, opening.denominator);
        const beatSec = (60 / (score.tempos[0]?.bpm ?? 120)) * (4 / opening.denominator);
        const measureSec = beatSec * opening.numerator;
        const sinceStart = audioContext.currentTime - fm.startTimeAt;
        const n = ictuses.length;
        let pos: Point = ictuses[0] ?? { x: 0, y: 100 };
        let curBeat = 1;
        let liveMeasureIndex = 0;
        if (sinceStart >= 0 && n > 0) {
          liveMeasureIndex = Math.floor(sinceStart / measureSec);
          const measureProgress = ((sinceStart % measureSec) + measureSec) % measureSec / measureSec;
          const ictusProgress = measureProgress * n;
          const currentIctus = Math.floor(ictusProgress) % n;
          const intoIctus = ictusProgress - Math.floor(ictusProgress);
          const eased = easeInQuint(intoIctus);
          if (n === 1) {
            pos = ictuses[0]!;
          } else {
            const from = ictuses[currentIctus]!;
            const to = ictuses[(currentIctus + 1) % n]!;
            const cp = inwardCP(from, to);
            pos = quadraticBezier(from, cp, to, eased);
          }
          curBeat = currentIctus + 1;
        }
        if (liveMeasureIndex !== fmMeasureIndex) {
          setFmMeasureIndex(liveMeasureIndex);
        }
        activeIctuses = ictuses;
        state = {
          numerator: opening.numerator,
          denominator: opening.denominator,
          beat: curBeat,
          pos,
        };
      } else if (phase === 'playing') {
        const songSec = audioContext.currentTime - startTimeRef.current;
        const songTick = Math.max(0, converter.secToTick(songSec));
        const activeTs = findActiveTs(score.timeSigs, songTick);
        const ictuses = getCached(activeTs.numerator, activeTs.denominator);
        const ticksPerBeat = (4 / activeTs.denominator) * PPQ;
        const measureTicks = ticksPerBeat * activeTs.numerator;
        const ticksSinceTsStart = songTick - activeTs.tick;
        const measureIndex = Math.floor(ticksSinceTsStart / measureTicks);
        const measureStartTick = activeTs.tick + measureIndex * measureTicks;
        const measureStartSec = converter.tickToSec(measureStartTick);
        const measureEndSec = converter.tickToSec(measureStartTick + measureTicks);
        const measureSec = measureEndSec - measureStartSec;
        const elapsedInMeasure = songSec - measureStartSec;
        const n = ictuses.length;
        let pos: Point = ictuses[0] ?? { x: 0, y: 100 };
        let curBeat = 1;
        if (n > 0 && measureSec > 0) {
          const measureProgress = Math.max(0, Math.min(1, elapsedInMeasure / measureSec));
          const ictusProgress = measureProgress * n;
          const currentIctus = Math.min(n - 1, Math.floor(ictusProgress));
          const intoIctus = ictusProgress - Math.floor(ictusProgress);
          const eased = easeInQuint(intoIctus);
          if (n === 1) {
            pos = ictuses[0]!;
          } else {
            const from = ictuses[currentIctus]!;
            const to = ictuses[(currentIctus + 1) % n]!;
            const cp = inwardCP(from, to);
            pos = quadraticBezier(from, cp, to, eased);
          }
          curBeat = currentIctus + 1;
        }
        activeIctuses = ictuses;
        state = {
          numerator: activeTs.numerator,
          denominator: activeTs.denominator,
          beat: curBeat,
          pos,
        };
      }

      if (state && activeIctuses) {
        if (
          state.numerator !== pattern.numerator ||
          state.denominator !== pattern.denominator
        ) {
          setPattern({
            ictuses: activeIctuses,
            numerator: state.numerator,
            denominator: state.denominator,
          });
        }
        if (state.beat !== beat) {
          setBeat(state.beat);
        }
        const tip = tipRef.current;
        const trail = trailRef.current;
        if (tip) {
          tip.setAttribute('cx', String(state.pos.x));
          tip.setAttribute('cy', String(state.pos.y));
        }
        if (trail) {
          trail.setAttribute('cx', String(state.pos.x));
          trail.setAttribute('cy', String(state.pos.y));
        }
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [audioContext, fmRef, startTimeRef, phase, score, converter, pattern, beat, fmMeasureIndex]);

  return (
    <div
      className="conductor-wrap"
      aria-label={`指揮棒 — ${pattern.numerator}/${pattern.denominator} 拍子 ・ 拍 ${beat}`}
    >
      <svg viewBox="-130 -130 260 260" className="conductor-baton" role="img" aria-hidden="true">
        {/* Ictus markers — uniform dim yellow (no green tap target
         * dot at the player's request). */}
        {pattern.ictuses.map((p, i) => (
          <circle
            key={`${pattern.numerator}-${pattern.denominator}-${i}`}
            cx={p.x}
            cy={p.y}
            r={5}
            fill="rgba(255, 210, 74, 0.28)"
          />
        ))}
        {/* Soft trail dot — placed behind the tip for a hint of motion blur. */}
        <circle ref={trailRef} cx={beat1.x} cy={beat1.y} r={24} fill="rgba(255, 210, 74, 0.2)" />
        {/* The live baton tip — flat brand yellow with a white outline. */}
        <circle
          ref={tipRef}
          cx={beat1.x}
          cy={beat1.y}
          r={18}
          fill="#FFD24A"
          stroke="#fff"
          strokeWidth={3}
        />
      </svg>
      {/* Beat-count digit overlaid at the upper-centre of the baton
       * pattern. Plain HTML (not SVG <text>) because earlier
       * SVG-embedded versions stayed mysteriously invisible — pure
       * HTML with inline styles side-steps any cascade weirdness.
       *
       * Only shown during `waiting` — once playback starts, the
       * digit would tell the player which beat they're on, which
       * defeats the read-the-score practice goal. The baton tip
       * keeps tracing the gesture for rhythmic feel; the count
       * vanishes so reading the staff is the only way to know the
       * beat position. */}
      {/* Count + TAP overlay structure. The COUNT digit only renders
       * during waiting (in any mode) — once the song starts, telling
       * the player which beat they're on defeats the read-the-score
       * goal. The TAP slot is tutorial-only and renders in both
       * waiting (with a hint on tappable "1"s) and playing (with the
       * audio-clock-aligned TAP pulse on each downbeat). The count
       * slot stays mounted at fixed height even when the digit is
       * hidden, so the TAP below sits at a stable Y coordinate
       * regardless of phase. */}
      {(phase === 'waiting' || (phase === 'playing' && tutorialMode)) && (
        <div className="conductor-count-overlay" aria-hidden="true">
          <div className="conductor-count-slot">
            {phase === 'waiting' && (
              <div
                key={beat}
                className="conductor-count"
                style={{
                  fontSize: '88px',
                  fontWeight: 900,
                  color: '#FFD24A',
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                  textShadow:
                    '0 0 12px rgba(0,0,0,0.85), 0 2px 6px rgba(0,0,0,0.6), -1px -1px 0 rgba(0,0,0,0.55), 1px 1px 0 rgba(0,0,0,0.55)',
                }}
              >
                {beat}
              </div>
            )}
          </div>
          {tutorialMode && (
            <div className="conductor-tap-slot">
              {phase === 'waiting' && beat === 1 && fmMeasureIndex >= 1 && (
                <div
                  key={`tap-wait-${fmMeasureIndex}`}
                  className="conductor-tap-hint"
                  aria-label="ここでタップ"
                >
                  TAP
                </div>
              )}
              {/* TAP-play renders even while a verdict is showing — the
               * tutorial guide shouldn't blink out every time the player
               * hits a note. The verdict's higher z-index lets it sit
               * over the TAP visually; the TAP keeps ticking underneath. */}
              {phase === 'playing' && (
                <ConductorTapPlay
                  audioContext={audioContext}
                  songStartTime={startTimeRef.current}
                  score={score}
                />
              )}
            </div>
          )}
        </div>
      )}
      {/* Verdict overlay — re-uses the same .conductor-count-overlay
       * slot as the count so PERFECT/GOOD/MISS flashes appear right
       * where the count was, keeping the player's focal point stable
       * across the waiting → playing handoff. Layered above the count
       * via z-index so a stray late verdict during waiting (shouldn't
       * happen but be defensive) still reads correctly. */}
      {verdictVisible && verdict !== null && (
        <div className="conductor-verdict-overlay" aria-live="polite" aria-atomic="true">
          <span
            key={triggerId}
            className="judgement-effect"
            style={{ color: VERDICT_COLORS[verdict] }}
          >
            {verdict}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Decoupled TAP-pulse renderer for tutorial play mode. Runs as a
 * continuous (`animation-iteration-count: infinite`) CSS animation
 * with `animation-duration` = one beat and `animation-delay` set to
 * a negative offset that places the animation's "0%" frame (the BAM)
 * directly on top of the next audio beat.
 *
 * Why a separate component: the alignment math is captured ONCE at
 * mount via useState's lazy initialiser, so re-renders of the parent
 * don't re-snap the phase. The animation then runs on the GPU
 * compositor without involving React's render cycle — none of the
 * 30–60 ms React-commit lag the previous "remount-per-beat" version
 * inherited. When verdict animation hides us, this unmounts; on
 * re-show the fresh mount re-aligns against the current audio clock.
 *
 * `beatSec` is derived from the score's opening tempo + time-sig.
 * Tutorial etudes don't change tempo mid-piece so this stays valid
 * for the whole run.
 */
function ConductorTapPlay({
  audioContext,
  songStartTime,
  score,
}: {
  audioContext: AudioContext;
  songStartTime: number;
  score: Score;
}) {
  // Animation cycles ONCE per BEAT — TAP flashes on every tappable
  // beat (which, for the tutorial etude's all-quarters pattern, is
  // every note onset). The keyframes hold TAP visible for the first
  // ~60% of each beat, then fade before the next BAM lands.
  //
  // VISUAL_LAG_COMPENSATION_SEC pushes the BAM slightly AFTER the
  // metronome click — without it the eye saw "TAP" arrive a touch
  // before the ear heard the audible beat, because Web Audio output
  // sits ~30–80 ms behind AudioContext.currentTime depending on the
  // device / driver buffer. 80 ms covers the common case; if the
  // player has run calibration we'll have it more precisely later.
  const VISUAL_LAG_COMPENSATION_SEC = 0.08;
  const [{ beatSec, animationDelaySec }] = useState(() => {
    const ts = score.timeSigs[0] ?? { tick: 0, numerator: 4, denominator: 4 };
    const bpm = score.tempos[0]?.bpm ?? 120;
    const beat = (60 / bpm) * (4 / ts.denominator);
    const songSec = audioContext.currentTime - songStartTime;
    const elapsedInBeat = ((songSec % beat) + beat) % beat;
    return {
      beatSec: beat,
      animationDelaySec: -elapsedInBeat + VISUAL_LAG_COMPENSATION_SEC,
    };
  });
  return (
    <div
      className="conductor-tap-play"
      aria-label="ここでタップ"
      style={{
        animationDuration: `${beatSec}s`,
        animationDelay: `${animationDelaySec}s`,
      }}
    >
      TAP
    </div>
  );
}
