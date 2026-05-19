import { useEffect, useState } from 'react';
import type { Judgement } from '../../core/judgement';

interface Props {
  /**
   * Latest judgement to display. The same value can fire multiple times
   * in a row; the `key` prop is the disambiguator — callers should bump
   * it on every tap so React remounts the effect and re-runs the
   * animation even when the verdict didn't change.
   */
  verdict: Judgement | null;
  /** Bumped by the caller every tap so identical verdicts retrigger the animation. */
  triggerId: number;
}

const FADE_OUT_MS = 320;

const COLORS: Record<Judgement, string> = {
  PERFECT: '#FFD24A', // brand yellow
  GOOD: '#3a8dde',    // calm blue
  MISS: '#E8612E',    // accent orange (same as dumbbell weight)
};

/**
 * Center-screen verdict label that fades out over ~320 ms. Intentionally
 * decoupled from the staff position: showing PERFECT/GOOD/MISS at the
 * notehead would amount to a visual hint about which note was struck,
 * which defeats the read-the-score practice goal. The Result screen has
 * the breakdown anyway.
 */
export function JudgementLayer({ verdict, triggerId }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (verdict === null) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [verdict, triggerId]);

  // Always render the reserved band so the surrounding layout doesn't
  // jump when a verdict appears/disappears. The inner label is what
  // actually fades in/out — keeping the band height-stable is the whole
  // point of issue #67's "dedicated verdict zone" fix.
  return (
    <div className="judgement-band no-tap" aria-live="polite" aria-atomic="true">
      {visible && verdict !== null && (
        <span
          key={triggerId}
          className="judgement-effect"
          style={{ color: COLORS[verdict] }}
        >
          {verdict}
        </span>
      )}
    </div>
  );
}
