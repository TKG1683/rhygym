import { useEffect, useMemo, useState } from 'react';
import { STAGES, type StageWithMeta } from '../../core/score/stages';
import { getAllBests, type BestRecord } from '../../core/storage/localStore';
import type { Rank } from '../../core/judgement';
import { useAppStore } from '../store/appStore';

const CLEAR_RANKS: ReadonlySet<Rank> = new Set(['S', 'A']);

type Medal = 'gold' | 'silver' | 'bronze';

/**
 * Tier earned for a level based on best scores across its stages.
 *  - gold:   every stage cleared with rank S
 *  - silver: every stage cleared (A or S)
 *  - bronze: at least half of the stages cleared (A or S)
 *  - null:   below the bronze threshold
 *
 * Threshold for bronze is "half cleared" so a player who's worked
 * through some of a level (but not finished it) still gets visible
 * progress.
 */
function levelMedal(stages: readonly StageWithMeta[], bests: Record<string, BestRecord>): Medal | null {
  const total = stages.length;
  if (total === 0) return null;
  let cleared = 0;
  let sCount = 0;
  for (const s of stages) {
    const b = bests[s.id];
    if (!b) continue;
    if (CLEAR_RANKS.has(b.rank)) cleared++;
    if (b.rank === 'S') sCount++;
  }
  if (sCount === total) return 'gold';
  if (cleared === total) return 'silver';
  if (cleared >= Math.ceil(total / 2)) return 'bronze';
  return null;
}

interface LevelGroup {
  level: number;
  themeColor: string;
  stages: readonly StageWithMeta[];
}

export function StageSelectScreen() {
  const goto = useAppStore((s) => s.goto);
  const selectStage = useAppStore((s) => s.selectStage);
  const loadedStages = useAppStore((s) => s.loadedStages);
  const stagesLoadState = useAppStore((s) => s.stagesLoadState);
  const initialLevel = useAppStore((s) => s.selectInitialLevel);
  const setInitialLevel = useAppStore((s) => s.setSelectInitialLevel);

  // Prefer the network-loaded roster once it's ready, otherwise fall
  // back to the bundled placeholder STAGES so a missing public/stages/
  // (e.g. local dev before content lands) doesn't blank the screen.
  const stages: readonly StageWithMeta[] = loadedStages ?? STAGES;
  const usingFallback = stagesLoadState === 'error';

  // Snapshot all bests on mount. Result writes back via setBest, but
  // this screen only re-reads on navigation back, which is fine — the
  // newly-set value will show up next time the player visits.
  const bests = useMemo<Record<string, BestRecord>>(() => getAllBests(), []);

  // Group stages by their level number, sorted ascending. Stages
  // within a group keep their original (manifest / hardcoded) order.
  const levelGroups = useMemo<LevelGroup[]>(() => {
    const byLevel = new Map<number, StageWithMeta[]>();
    for (const stage of stages) {
      const list = byLevel.get(stage.level) ?? [];
      list.push(stage);
      byLevel.set(stage.level, list);
    }
    return Array.from(byLevel.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([level, groupStages]) => ({
        level,
        themeColor: groupStages[0]!.themeColor,
        stages: groupStages,
      }));
  }, [stages]);

  // Pull the requested initial level from the store (set by Result's
  // "ステージ選択へ"). Snapshot once at mount; clear the store value
  // so the next entry from Title defaults back to the Level list.
  const [openLevel, setOpenLevel] = useState<number | null>(initialLevel);
  useEffect(() => {
    if (initialLevel !== null) setInitialLevel(null);
    // We only want this on mount — the snapshot above is what counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = (id: string) => {
    selectStage(id);
    goto('game');
  };

  if (openLevel !== null) {
    const group = levelGroups.find((g) => g.level === openLevel);
    if (!group) {
      // Level disappeared (shouldn't happen, but guard anyway).
      setOpenLevel(null);
      return null;
    }
    return (
      <StageListView
        group={group}
        bests={bests}
        onStart={start}
        onBack={() => setOpenLevel(null)}
      />
    );
  }

  return (
    <LevelListView
      groups={levelGroups}
      bests={bests}
      loadingHint={stagesLoadState === 'loading' ? '譜面を読み込み中…' : null}
      fallbackHint={usingFallback ? '※ 譜面ファイル未配置のためデモ譜面で代替中' : null}
      onOpenLevel={setOpenLevel}
      onBack={() => goto('title')}
    />
  );
}

/* ================================================================== */
/*  Level list (top of the 2-tier hierarchy)                          */
/* ================================================================== */

interface LevelListProps {
  groups: readonly LevelGroup[];
  bests: Record<string, BestRecord>;
  loadingHint: string | null;
  fallbackHint: string | null;
  onOpenLevel: (level: number) => void;
  onBack: () => void;
}

function LevelListView({ groups, bests, loadingHint, fallbackHint, onOpenLevel, onBack }: LevelListProps) {
  return (
    <main className="screen screen-select">
      <h1 className="select-title">Movement を選ぶ</h1>
      {loadingHint && <p className="muted select-hint">{loadingHint}</p>}
      {fallbackHint && <p className="muted select-hint">{fallbackHint}</p>}
      <ul className="stage-list">
        {groups.map((group) => {
          const cleared = group.stages.filter((s) =>
            CLEAR_RANKS.has(bests[s.id]?.rank ?? 'D'),
          ).length;
          return (
            <li key={group.level}>
              <LevelCard
                group={group}
                medal={levelMedal(group.stages, bests)}
                cleared={cleared}
                total={group.stages.length}
                onOpen={onOpenLevel}
              />
            </li>
          );
        })}
      </ul>
      <button className="secondary" onClick={onBack}>
        タイトルへ
      </button>
    </main>
  );
}

interface LevelCardProps {
  group: LevelGroup;
  medal: Medal | null;
  cleared: number;
  total: number;
  onOpen: (level: number) => void;
}

function LevelCard({ group, medal, cleared, total, onOpen }: LevelCardProps) {
  return (
    <button
      className="stage-card"
      onClick={() => onOpen(group.level)}
      style={{ borderColor: group.themeColor }}
    >
      <span className="stage-card-stripe" style={{ background: group.themeColor }} />
      <span className="stage-card-glyph" aria-hidden="true">{levelGlyph(group.level)}</span>
      <div className="stage-card-body">
        <div className="stage-card-head">
          <span className="stage-card-name">Movement {group.level}</span>
        </div>
        <div className="stage-card-desc">
          {cleared}/{total} クリア (A以上)
        </div>
        <div className="stage-card-meta">
          <span className="stage-card-bpm">▶ 開く</span>
          {medal && <MedalChip medal={medal} />}
        </div>
      </div>
    </button>
  );
}

const MEDAL_LABEL: Record<Medal, string> = {
  gold: '金',
  silver: '銀',
  bronze: '銅',
};

function MedalChip({ medal }: { medal: Medal }) {
  return (
    <span
      className={`medal-disc medal-disc-${medal}`}
      aria-label={`${MEDAL_LABEL[medal]}メダル`}
    >
      <span className="medal-disc-icon" aria-hidden="true">★</span>
    </span>
  );
}

/* ================================================================== */
/*  Stage list (drilled into a level)                                 */
/* ================================================================== */

interface StageListProps {
  group: LevelGroup;
  bests: Record<string, BestRecord>;
  onStart: (id: string) => void;
  onBack: () => void;
}

function StageListView({ group, bests, onStart, onBack }: StageListProps) {
  return (
    <main className="screen screen-select">
      <button className="secondary select-back" onClick={onBack}>
        ← Movement 一覧へ
      </button>
      <h1 className="select-title">Movement {group.level}</h1>
      <ul className="stage-list">
        {group.stages.map((stage) => (
          <li key={stage.id}>
            <StageCard stage={stage} best={bests[stage.id]} onStart={onStart} />
          </li>
        ))}
      </ul>
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
      <span className="stage-card-stripe" style={{ background: stage.themeColor }} />
      <span className="stage-card-glyph" aria-hidden="true">{stageGlyph(stage)}</span>
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

/* ================================================================== */
/*  Shared bits                                                       */
/* ================================================================== */

function RankMedal({ rank }: { rank: Rank }) {
  return <span className={`rank-medal rank-${rank}`}>{rank}</span>;
}

/**
 * Glyph for each level (1-10). Reads as a small "you're climbing the
 * music notation tree" indicator on top of the theme color.
 */
function levelGlyph(level: number): string {
  switch (level) {
    case 1:  return '♩';
    case 2:  return '♪';
    case 3:  return '♫';
    case 4:  return '♬';
    case 5:  return '𝄐';
    case 6:  return '𝄆';
    case 7:  return '𝄋';
    case 8:  return '𝄎';
    case 9:  return '𝄢';
    case 10: return '𝄞';
    default: return '♩';
  }
}

function stageGlyph(stage: StageWithMeta): string {
  if (stage.isExam) return '★';
  return levelGlyph(stage.level);
}
