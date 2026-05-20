import { useEffect, useRef } from 'react';
import type { MetronomeAccents } from '../../core/storage/localStore';

interface TimeSigEntry {
  numerator: number;
  denominator: number;
  key: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Current effective BPM (numeric value shown in the slider label). */
  effectiveBpm: number;
  /** Authored stage BPM — used as the "pass threshold" warning bound. */
  stageBpm: number;
  /** Min/max + step the absolute-BPM slider exposes. */
  bpmMin: number;
  bpmMax: number;
  bpmStep: number;
  /** Disable BPM editing once the run is underway. */
  bpmDisabled: boolean;
  onBpmChange: (bpm: number) => void;

  /** Unique time-sigs in score order — one accent row per entry. */
  uniqueTimeSigs: readonly TimeSigEntry[];
  metronomeAccents: MetronomeAccents;
  /** Resolve the current pattern (custom override OR defaults). */
  accentPatternFor: (numerator: number, denominator: number) => boolean[];
  onToggleAccent: (
    key: string,
    numerator: number,
    denominator: number,
    beat: number,
  ) => void;
  onResetAccent: (key: string) => void;
}

/**
 * Full-screen settings overlay invoked from the in-game gear icon.
 *
 * Holds the BPM slider and the per-time-sig metronome accent editor —
 * the two settings that used to live directly below the tap zone on the
 * old GameView. Moving them into a modal frees the bottom half of the
 * screen for a much larger tap target (issue #79) while keeping the
 * settings one tap away.
 *
 * The whole overlay carries the `.no-tap` class so the TapArea below
 * never sees a tap that was actually a setting change.
 */
export function GameSettingsPopover({
  open,
  onClose,
  effectiveBpm,
  stageBpm,
  bpmMin,
  bpmMax,
  bpmStep,
  bpmDisabled,
  onBpmChange,
  uniqueTimeSigs,
  metronomeAccents,
  accentPatternFor,
  onToggleAccent,
  onResetAccent,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape — standard modal affordance and keeps the keyboard
  // path usable for desktop play.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const belowThreshold = effectiveBpm < stageBpm;

  // Backdrop click dismisses; dialog click does not.
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="game-settings-backdrop no-tap"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="ゲーム設定"
    >
      <div
        ref={dialogRef}
        className="game-settings-dialog"
        // Belt-and-braces: even though .no-tap is on the backdrop and
        // the TapArea uses .closest(), make sure the click that opened
        // a child control doesn't bubble out to anything that might.
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="game-settings-close"
          aria-label="閉じる"
          onClick={onClose}
        >
          ×
        </button>

        <h2 className="game-settings-title">設定</h2>

        <section className="game-settings-section">
          <div className="bpm-control">
            <label htmlFor="bpm-slider" className="bpm-label">
              Tempo: <span className="bpm-value">{effectiveBpm}</span>
            </label>
            <input
              id="bpm-slider"
              type="range"
              min={bpmMin}
              max={bpmMax}
              step={bpmStep}
              value={effectiveBpm}
              disabled={bpmDisabled}
              onChange={(e) => onBpmChange(Number(e.target.value))}
            />
            {bpmDisabled && (
              <p className="bpm-hint muted">
                プレイ中はテンポを変更できません。
              </p>
            )}
            {belowThreshold && (
              <p className="bpm-warning" role="status">
                ⚠ このBPMだと合格判定が出ません (最低 BPM: {stageBpm})
              </p>
            )}
          </div>
        </section>

        <section className="game-settings-section">
          <h3 className="game-settings-subtitle">メトロノーム アクセント</h3>
          <div className="metronome-config-body game-settings-accents">
            {uniqueTimeSigs.map((ts) => {
              const pattern = accentPatternFor(ts.numerator, ts.denominator);
              const isCustom = ts.key in metronomeAccents;
              return (
                <div className="metronome-config-row" key={ts.key}>
                  <span className="metronome-config-ts">{ts.key}</span>
                  <div className="metronome-config-beats">
                    {pattern.map((accent, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`metronome-beat ${accent ? 'is-accent' : 'is-soft'}`}
                        onClick={() =>
                          onToggleAccent(ts.key, ts.numerator, ts.denominator, i)
                        }
                        aria-label={`${ts.key} の ${i + 1} 拍目を${accent ? 'アクセント無し' : 'アクセント'}に切替`}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="metronome-reset"
                    onClick={() => onResetAccent(ts.key)}
                    disabled={!isCustom}
                  >
                    リセット
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
