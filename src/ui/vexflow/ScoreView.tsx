import { useEffect, useRef } from 'react';
import type { Score } from '../../core/model';
import { renderScore, type MeasureBounds, type NoteCoords } from './ScoreRenderer';

interface Props {
  score: Score;
  onRender?: (coords: Map<string, NoteCoords>) => void;
  /**
   * Called with the per-note SVG group elements after every render.
   * Lets callers toggle CSS classes on individual notes without going
   * through React (the assist-mode flash in #55 needs sub-frame
   * latency). Re-fires on every re-render so the caller can re-attach
   * to the new DOM nodes after a viewport resize.
   */
  onNoteElements?: (elements: Map<string, SVGElement>) => void;
  /**
   * Called with the per-measure geometric bounds after every render.
   * Lets overlays (lesson-intro playhead, future judge-line) compute
   * tick→pixel mapping at the *measure* level — constant-speed within
   * each bar regardless of how VexFlow packed individual notes.
   */
  onMeasureBounds?: (bounds: readonly MeasureBounds[]) => void;
  /**
   * Pin layout to a specific measures-per-line target. Passed through to
   * the renderer so the layout doesn't drift across viewport widths
   * (e.g. always render 4-measure scores as 2 rows of 2 on mobile).
   */
  measuresPerLine?: number;
  /**
   * Per-measure widths in px. When supplied, every bar takes its width
   * from this array (entry `i` → measure `i`), and the staff renders at
   * that natural size. Used by Result so note-dense bars get room and
   * sparse bars don't waste it; combine with a horizontal-scroll wrapper
   * since the total can exceed the viewport.
   */
  measureWidths?: readonly number[];
  /**
   * Maximum height as a fraction of window.innerHeight. When set, the
   * SVG is rescaled (uniform, via the viewBox) so its rendered pixel
   * height never exceeds `window.innerHeight * maxHeightVh / 100`.
   * Use this on the Game screen so the staff always fits the upper
   * half of the viewport without overflow / scroll / clipping.
   */
  maxHeightVh?: number;
}

/**
 * React wrapper around the imperative VexFlow renderer. The render runs
 * inside a ResizeObserver so the staff re-wraps as the container width
 * changes (orientation change, browser resize, etc.).
 */
export function ScoreView({
  score,
  onRender,
  onNoteElements,
  onMeasureBounds,
  measuresPerLine,
  measureWidths,
  maxHeightVh,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onRenderRef = useRef(onRender);
  const onNoteElementsRef = useRef(onNoteElements);
  const onMeasureBoundsRef = useRef(onMeasureBounds);

  useEffect(() => {
    onRenderRef.current = onRender;
    onNoteElementsRef.current = onNoteElements;
    onMeasureBoundsRef.current = onMeasureBounds;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const render = () => {
      const width = container.clientWidth;
      if (width === 0) return;
      try {
        const result = renderScore(score, {
          container,
          viewportWidth: width,
          measuresPerLine,
          measureWidths,
          responsiveScaling: maxHeightVh != null,
        });
        onRenderRef.current?.(result.noteCoords);
        onNoteElementsRef.current?.(result.noteElements);
        onMeasureBoundsRef.current?.(result.measureBounds);
        if (maxHeightVh != null) {
          applyMaxHeightScale(container, maxHeightVh);
        }
      } catch (err) {
        console.error('VexFlow render failed:', err);
      }
    };

    render();
    const observer = new ResizeObserver(() => render());
    observer.observe(container);
    // Re-scale on window resize too — clientHeight-based scaling is
    // pegged to window.innerHeight, which a viewport resize changes
    // independently of the container's own width-driven re-render.
    const onWindowResize = () => {
      if (maxHeightVh != null) applyMaxHeightScale(container, maxHeightVh);
    };
    window.addEventListener('resize', onWindowResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onWindowResize);
    };
  }, [score, measuresPerLine, measureWidths, maxHeightVh]);

  return <div ref={containerRef} className="score-view" />;
}

/**
 * Forces a vh-based max height on the rendered SVG by writing pixel
 * dimensions into its inline style. Done in JS rather than via CSS
 * because pure CSS max-height + viewBox on an SVG with no intrinsic
 * width/height is interpreted inconsistently across browsers (Safari
 * in particular ignores it and renders at the viewBox's pixel size).
 */
function applyMaxHeightScale(container: HTMLDivElement, maxHeightVh: number): void {
  const svg = container.querySelector('svg');
  if (!svg) return;
  const viewBox = svg.getAttribute('viewBox');
  if (!viewBox) return;
  const parts = viewBox.split(/\s+/).map((s) => parseFloat(s));
  const svgW = parts[2];
  const svgH = parts[3];
  if (svgW == null || svgH == null || !Number.isFinite(svgW) || !Number.isFinite(svgH)) return;
  const targetMaxPx = window.innerHeight * (maxHeightVh / 100);
  const scale = svgH > targetMaxPx ? targetMaxPx / svgH : 1;
  // Cap the rendered width to the container so the staff never spills
  // sideways either (a narrow viewport with a wide score would still
  // need clamping even at scale=1).
  const containerWidth = container.clientWidth;
  const widthScale = svgW * scale > containerWidth ? containerWidth / svgW : scale;
  const finalScale = Math.min(scale, widthScale);
  svg.style.width = `${Math.round(svgW * finalScale)}px`;
  svg.style.height = `${Math.round(svgH * finalScale)}px`;
  svg.style.display = 'block';
}
