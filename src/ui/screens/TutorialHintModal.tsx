/**
 * TutorialHintModal — dimming-backdrop instruction card used by the
 * tutorial walkthrough (#26 v2). One modal at a time; advancing fires
 * `onNext`. Step indicator (`1 / total`) sits at the top so players
 * can see how far along they are without a separate progress bar.
 *
 * The backdrop intercepts pointer events so the underlying game UI
 * can't accept taps while a hint is showing — keeps the player on
 * the rails through the scripted sequence.
 *
 * Rendered via a React portal into document.body so the dim layer
 * covers the WHOLE viewport, not just the .screen container. Without
 * the portal, the .screen's animated transform creates a containing
 * block that clips `position: fixed` to the screen's 720px max-width,
 * leaving visible body-yellow stripes on either side of the dim
 * area.
 */

import { createPortal } from 'react-dom';

interface Props {
  /** 1-based current step. */
  step: number;
  total: number;
  title: string;
  body: string;
  nextLabel?: string;
  onNext: () => void;
  /**
   * Optional secondary action — when both `secondaryLabel` and
   * `onSecondary` are supplied, the modal renders a second button
   * (styled as a less-emphasised secondary action) above the primary
   * one. Used by the outro for a "もう一回" retry alongside "タイト
   * ルへ戻る" when the player's run flopped.
   */
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function TutorialHintModal({
  step,
  total,
  title,
  body,
  nextLabel = '次へ →',
  onNext,
  secondaryLabel,
  onSecondary,
}: Props) {
  const hasSecondary = secondaryLabel != null && onSecondary != null;
  // SSR-safety: bail on the portal target during initial render on
  // servers where `document` doesn't exist. The tutorial only mounts
  // client-side so this is belt-and-braces.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="tutorial-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="tutorial-modal-title">
      <div className="tutorial-modal-card">
        <p className="tutorial-modal-step" aria-label={`ステップ ${step} / ${total}`}>
          {step} / {total}
        </p>
        <h2 id="tutorial-modal-title" className="tutorial-modal-title">{title}</h2>
        <p className="tutorial-modal-body">{body}</p>
        {hasSecondary && (
          <button
            type="button"
            className="secondary tutorial-modal-secondary"
            onClick={onSecondary}
          >
            {secondaryLabel}
          </button>
        )}
        <button type="button" className="primary tutorial-modal-next" onClick={onNext}>
          {nextLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
