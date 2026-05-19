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
  /**
   * Optional placeholder text shown in the band whenever a verdict
   * isn't currently visible. Used by GameView to put "♪ ここをタップ…"
   * inside the band so the band doubles as the tap zone.
   */
  prompt?: string;
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
export function JudgementLayer({ verdict, triggerId, prompt }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (verdict === null) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [verdict, triggerId]);

  // Always render the reserved band so the surrounding layout doesn't
  // jump when a verdict appears/disappears. When no verdict is showing
  // the band falls back to a prompt (caller-supplied), so the same
  // band reads as "tap here" outside of a hit and as PERFECT/GOOD/MISS
  // during one.
  const showingVerdict = visible && verdict !== null;
  return (
    <div className="judgement-band" aria-live="polite" aria-atomic="true">
      {showingVerdict ? (
        <span
          key={triggerId}
          className="judgement-effect"
          style={{ color: COLORS[verdict] }}
        >
          {verdict}
        </span>
      ) : (
        prompt && <span className="judgement-prompt">{prompt}</span>
      )}
    </div>
  );
}
