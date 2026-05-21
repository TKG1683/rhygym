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
}: Props) {
  const tipRef = useRef<SVGCircleElement>(null);
  const trailRef = useRef<SVGCircleElement>(null);

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
        if (sinceStart >= 0 && n > 0) {
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
  }, [audioContext, fmRef, startTimeRef, phase, score, converter, pattern, beat]);

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
      {phase === 'waiting' && (
        <div className="conductor-count-overlay" aria-hidden="true">
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
