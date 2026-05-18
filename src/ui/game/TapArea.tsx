import { useEffect, useRef } from 'react';

interface Props {
  /** Live AudioContext. The tap time is read from ctx.currentTime so it lines up with the scheduler clock. */
  ctx: AudioContext | null;
  /** Fired on every pointerdown with the AudioContext time of the tap. */
  onTap: (audioTime: number) => void;
  /**
   * CSS selector for elements that should NOT count as a tap (e.g.
   * buttons, sliders, debug toggles). When the event target matches
   * `.closest(excludeSelector)`, onTap is skipped and propagation isn't
   * preventDefault'd either — so the underlying control receives its
   * normal click. Defaults to `'.no-tap'`.
   */
  excludeSelector?: string;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Full-area pointer target that captures taps with minimum latency.
 *
 * React's synthetic event pipeline adds a few ms of jitter that matters
 * for ±50 ms PERFECT windows. We attach a raw pointerdown listener
 * directly to the DOM node via ref so the timestamp is read on the same
 * tick the browser delivers the event.
 *
 * Elements inside the TapArea that should remain interactive (buttons,
 * sliders, the "中断" control, etc.) opt out by adding the class named
 * by `excludeSelector` — taps on them are ignored by the rhythm judge
 * and bubble up to React event handlers as normal clicks.
 *
 * pointerdown alone covers both mouse and touch on every browser we
 * target (Pixel 7a Chrome, desktop Chrome, iOS Safari). An earlier
 * version also attached touchstart as a fallback, but that double-
 * fired on mobile — every tap counted twice (4 taps finished the
 * 8-sample calibration).
 */
export function TapArea({ ctx, onTap, excludeSelector = '.no-tap', children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const ctxRef = useRef(ctx);
  const onTapRef = useRef(onTap);
  const excludeRef = useRef(excludeSelector);

  useEffect(() => {
    ctxRef.current = ctx;
  });
  useEffect(() => {
    onTapRef.current = onTap;
  });
  useEffect(() => {
    excludeRef.current = excludeSelector;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handle = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest(excludeRef.current)) {
        // Don't swallow events meant for an interactive control.
        return;
      }
      e.preventDefault();
      const c = ctxRef.current;
      if (!c) return;
      onTapRef.current(c.currentTime);
    };
    el.addEventListener('pointerdown', handle);
    return () => {
      el.removeEventListener('pointerdown', handle);
    };
  }, []);

  return (
    <div ref={ref} className={className ?? 'tap-area'}>
      {children}
    </div>
  );
}
