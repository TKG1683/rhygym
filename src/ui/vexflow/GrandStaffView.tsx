/**
 * GrandStaffView — two-stave score render for two-hand mode (#83).
 *
 * Thin React wrapper around `renderGrandStaff`, the same pattern
 * `ScoreView` uses for the single-voice renderer: a ResizeObserver
 * re-runs the draw on viewport changes so the staff wraps correctly
 * across portrait/landscape rotations.
 *
 * Callbacks (onRender / onMeasureBounds / onNoteElements) are passed
 * through with the combined per-lane data; the lane is encoded in the
 * note id so callers can split judgement state by lane downstream.
 */

import { useEffect, useRef } from 'react';
import type { Score } from '../../core/model';
import {
  renderGrandStaff,
  type MeasureBounds,
  type NoteCoords,
} from './ScoreRenderer';

interface Props {
  score: Score;
  onRender?: (coords: Map<string, NoteCoords>) => void;
  onNoteElements?: (elements: Map<string, SVGElement>) => void;
  onMeasureBounds?: (bounds: readonly MeasureBounds[]) => void;
  measuresPerLine?: number;
  measureWidths?: readonly number[];
  maxHeightVh?: number;
}

export function GrandStaffView({
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
        const result = renderGrandStaff(score, {
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
        console.error('[GrandStaffView] render failed', err);
      }
    };
    render();

    const observer = new ResizeObserver(render);
    observer.observe(container);
    const onWindowResize = () => {
      if (maxHeightVh != null) applyMaxHeightScale(container, maxHeightVh);
    };
    window.addEventListener('resize', onWindowResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onWindowResize);
    };
  }, [score, measuresPerLine, measureWidths, maxHeightVh]);

  return <div ref={containerRef} className="score-view grand-staff" />;
}

/**
 * Same viewBox-driven uniform scale that ScoreView uses — kept in
 * sync intentionally so single-hand and grand-staff render behave
 * identically when given the same maxHeightVh budget. Inline rather
 * than imported because exporting from ScoreView would couple two
 * components that should stay structurally independent.
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
  const containerWidth = container.clientWidth;
  const widthScale = svgW * scale > containerWidth ? containerWidth / svgW : scale;
  const finalScale = Math.min(scale, widthScale);
  svg.style.width = `${Math.round(svgW * finalScale)}px`;
  svg.style.height = `${Math.round(svgH * finalScale)}px`;
  svg.style.display = 'block';
}
