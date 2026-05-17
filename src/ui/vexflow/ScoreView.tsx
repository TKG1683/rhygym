import { useEffect, useRef } from 'react';
import type { Score } from '../../core/model';
import { renderScore, type NoteCoords } from './ScoreRenderer';

interface Props {
  score: Score;
  onRender?: (coords: Map<string, NoteCoords>) => void;
}

/**
 * React wrapper around the imperative VexFlow renderer. The render runs
 * inside a ResizeObserver so the staff re-wraps as the container width
 * changes (orientation change, browser resize, etc.).
 */
export function ScoreView({ score, onRender }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onRenderRef = useRef(onRender);

  useEffect(() => {
    onRenderRef.current = onRender;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const render = () => {
      const width = container.clientWidth;
      if (width === 0) return;
      try {
        const result = renderScore(score, { container, viewportWidth: width });
        onRenderRef.current?.(result.noteCoords);
      } catch (err) {
        console.error('VexFlow render failed:', err);
      }
    };

    render();
    const observer = new ResizeObserver(() => render());
    observer.observe(container);
    return () => observer.disconnect();
  }, [score]);

  return <div ref={containerRef} className="score-view" />;
}
