import { useMemo } from 'react';
import { STAGES, type StageWithMeta } from '../../core/score/stages';
import { getAllBests, type BestRecord } from '../../core/storage/localStore';
import { useAppStore } from '../store/appStore';

export function StageSelectScreen() {
  const goto = useAppStore((s) => s.goto);
  const selectStage = useAppStore((s) => s.selectStage);

  // Snapshot all bests on mount. Result writes back via setBest, but
  // this screen only re-reads on navigation back, which is fine — the
  // newly-set value will show up next time the player visits.
  const bests = useMemo<Record<string, BestRecord>>(() => getAllBests(), []);

  const start = (id: string) => {
    selectStage(id);
    goto('game');
  };

  return (
    <main className="screen screen-select">
      <h1 className="select-title">級を選ぶ</h1>
      <p className="muted select-hint">
        ※ 譜面の中身は #9 で実装予定。今はどの級を選んでも同じデモ譜面が流れます。
      </p>
      <ul className="stage-list">
        {STAGES.map((stage) => (
          <li key={stage.id}>
            <StageCard stage={stage} best={bests[stage.id]} onStart={start} />
          </li>
        ))}
      </ul>
      <button className="secondary" onClick={() => goto('title')}>
        タイトルへ
      </button>
    </main>
  );
}

interface StageCardProps {
  stage: StageWithMeta;
  best: BestRecord | undefined;
  onStart: (id: string) => void;
}

function StageCard({ stage, best, onStart }: StageCardProps) {
  return (
    <button
      className="stage-card"
      onClick={() => onStart(stage.id)}
      style={{ borderColor: stage.themeColor }}
    >
      {/* Decorative accent bar on the left — picks up the theme color. */}
      <span className="stage-card-stripe" style={{ background: stage.themeColor }} />

      {/* Note glyph hovering in the top-right corner as decoration. */}
      <span className="stage-card-glyph" aria-hidden="true">
        {levelGlyph(stage.level)}
      </span>

      <div className="stage-card-body">
        <div className="stage-card-head">
          <span className="stage-card-name">{stage.name}</span>
        </div>
        <div className="stage-card-desc">{stage.description}</div>
        <div className="stage-card-meta">
          <span className="stage-card-bpm">♩ = {stage.bpm}</span>
          {best && (
            <span className="stage-card-best">
              <RankMedal rank={best.rank} />
              <span className="stage-card-score">{best.score}</span>
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function RankMedal({ rank }: { rank: BestRecord['rank'] }) {
  return <span className={`rank-medal rank-${rank}`}>{rank}</span>;
}

/**
 * One distinct music glyph per level — starts with the basic note
 * values that the early curriculum teaches and graduates into
 * notation marks that show up more often at higher levels (fermata,
 * repeats, clefs). Reads as a small "you're climbing the music
 * notation tree" indicator on top of the difficulty color.
 */
function levelGlyph(level: number): string {
  switch (level) {
    case 1:  return '♩';  // quarter note
    case 2:  return '♪';  // single eighth
    case 3:  return '♫';  // beamed eighths
    case 4:  return '♬';  // beamed sixteenths
    case 5:  return '𝄐';  // fermata
    case 6:  return '𝄆';  // repeat sign
    case 7:  return '𝄋';  // segno
    case 8:  return '𝄎';  // coda
    case 9:  return '𝄢';  // bass (F) clef
    case 10: return '𝄞';  // treble (G) clef
    default: return '♩';
  }
}
