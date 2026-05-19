import { describe, expect, it } from 'vitest';
import { LABEL_AREA_X, RIGHT_EDGE_PAD, timeToX } from '../src/ui/game/TimingPlot';

/**
 * The Result-screen TimingPlot maps note-onset time onto a horizontal
 * pixel position. The mapping has to be perceptually consistent (1
 * second of music → the same pixel distance everywhere in the plot)
 * so the player can read drift directly off the dot positions. These
 * tests pin the boundary cases that "any second sits where you'd
 * expect" relies on.
 */
describe('timeToX', () => {
  const WIDTH = 600;
  const innerW = WIDTH - RIGHT_EDGE_PAD - LABEL_AREA_X;

  it('places t=0 at the inner-left edge (just after the label gutter)', () => {
    expect(timeToX(0, 10, WIDTH)).toBe(LABEL_AREA_X);
  });

  it('places t=totalSec at the inner-right edge', () => {
    expect(timeToX(10, 10, WIDTH)).toBe(LABEL_AREA_X + innerW);
  });

  it('is linear: the midpoint sits halfway across the inner width', () => {
    expect(timeToX(5, 10, WIDTH)).toBeCloseTo(LABEL_AREA_X + innerW / 2, 6);
  });

  it('clamps negative onsets to the left edge', () => {
    expect(timeToX(-3, 10, WIDTH)).toBe(LABEL_AREA_X);
  });

  it('clamps overshoot beyond totalSec to the right edge', () => {
    expect(timeToX(99, 10, WIDTH)).toBe(LABEL_AREA_X + innerW);
  });

  it('falls back to the left edge when the song has no duration', () => {
    expect(timeToX(1.2, 0, WIDTH)).toBe(LABEL_AREA_X);
  });

  it('falls back to the left edge when the frame is collapsed', () => {
    // width <= LABEL_AREA_X + RIGHT_EDGE_PAD ⇒ innerW = 0
    expect(timeToX(1.2, 10, LABEL_AREA_X + RIGHT_EDGE_PAD)).toBe(LABEL_AREA_X);
  });

  it('keeps perceptual distance constant: same Δsec → same Δx everywhere', () => {
    // The whole point of the time axis: a 1-second gap near the start
    // and a 1-second gap near the end render at identical widths.
    const early = timeToX(1, 10, WIDTH) - timeToX(0, 10, WIDTH);
    const late = timeToX(10, 10, WIDTH) - timeToX(9, 10, WIDTH);
    expect(early).toBeCloseTo(late, 6);
  });
});
