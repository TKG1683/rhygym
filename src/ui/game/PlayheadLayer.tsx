/**
 * BEGINNER-mode playhead cursor (#20). Renders an absolutely-positioned
 * orange bar over the rendered score and animates it via
 * requestAnimationFrame from the audio clock so the bar tracks each
 * note's onset exactly (mimic-groove tickPoint interpolation pattern).
 *
 * Differs from the lesson-intro playhead in that the in-game score
 * uses ScoreView's responsive scaling (`maxHeightVh`) — the SVG's
 * rendered pixel size differs from its viewBox coords. We read the
 * SVG's viewBox + bounding rect each frame to derive a (scaleX,
 * scaleY) pair and convert the tick→viewBox positions into pixel
 * positions before applying the transform.
 */

import { useEffect, useRef } from 'react';
import type { TickTimeConverter } from '../../core/timing/tickTime';
import { findPlayheadPos, type RowPoints } from './playhead';

interface PlayheadLayerProps {
  /**
   * Whether to drive the rAF loop. Pass `phase === 'playing'` from
   * GameView — the bar hides itself when inactive.
   */
  active: boolean;
  audioContextRef: React.RefObject<AudioContext | null>;
  /**
   * AudioContext time when the song's beat 1 lands (= the same
   * `startAudioTimeRef` GameView already maintains for tap-to-sec
   * conversion). Subtract from `ctx.currentTime` to get song
   * elapsed seconds.
   */
  startAudioTimeRef: React.RefObject<number>;
  /** Score-time converter built from the adjusted score's tempos. */
  converter: TickTimeConverter;
  /** Per-row tick→x anchor tables built by buildRowPoints. */
  rowPointsRef: React.RefObject<readonly RowPoints[]>;
  /**
   * Wrapper element containing the score SVG. The PlayheadLayer
   * queries `wrapper.querySelector('svg')` each frame so it picks up
   * re-renders without a restart, and reads the SVG's viewBox vs
   * boundingRect to compute the responsive scale factor.
   */
  scoreWrapperRef: React.RefObject<HTMLElement | null>;
}

/** Unscaled bar dimensions in SVG viewBox units (= ~px before scaling). */
const BAR_WIDTH_VB = 3;
const BAR_HEIGHT_VB = 44;

export function PlayheadLayer({
  active,
  audioContextRef,
  startAudioTimeRef,
  converter,
  rowPointsRef,
  scoreWrapperRef,
}: PlayheadLayerProps) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    if (!active) {
      bar.style.opacity = '0';
      return;
    }
    let rafId: number | null = null;
    const tick = () => {
      const ctx = audioContextRef.current;
      const rows = rowPointsRef.current;
      const wrapper = scoreWrapperRef.current;
      if (!ctx || !rows || rows.length === 0 || !wrapper) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      // Re-query each frame: a ResizeObserver-driven re-render
      // replaces the SVG node, so cached refs go stale. The
      // playhead would freeze without a fresh lookup.
      const svg = wrapper.querySelector('svg');
      let scaleX = 1;
      let scaleY = 1;
      if (svg) {
        const vbAttr = svg.getAttribute('viewBox');
        if (vbAttr) {
          const parts = vbAttr.split(/\s+/).map((s) => parseFloat(s));
          const vbW = parts[2];
          const vbH = parts[3];
          const rect = svg.getBoundingClientRect();
          if (vbW != null && vbW > 0 && rect.width > 0) scaleX = rect.width / vbW;
          if (vbH != null && vbH > 0 && rect.height > 0) scaleY = rect.height / vbH;
        }
      }
      const startAudioTime = startAudioTimeRef.current ?? 0;
      const elapsed = ctx.currentTime - startAudioTime;
      const songTick = elapsed < 0 ? 0 : converter.secToTick(elapsed);
      const pos = findPlayheadPos(songTick, rows);
      if (pos) {
        const px = pos.x * scaleX;
        const py = pos.y * scaleY;
        const halfH = (BAR_HEIGHT_VB * scaleY) / 2;
        bar.style.transform = `translate(${px - BAR_WIDTH_VB / 2}px, ${py - halfH}px)`;
        bar.style.height = `${BAR_HEIGHT_VB * scaleY}px`;
        bar.style.opacity = elapsed < 0 ? '0.4' : '0.85';
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      bar.style.opacity = '0';
    };
  }, [active, audioContextRef, startAudioTimeRef, converter, rowPointsRef, scoreWrapperRef]);

  return <div ref={barRef} className="game-playhead-bar" aria-hidden="true" />;
}
