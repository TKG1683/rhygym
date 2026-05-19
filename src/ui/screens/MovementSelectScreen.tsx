import { useEffect, useMemo, useState } from 'react';
import { ETUDES, type EtudeWithMovementMeta } from '../../core/score/etudes';
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
function movementMedal(stages: readonly EtudeWithMovementMeta[], bests: Record<string, BestRecord>): Medal | null {
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

interface MovementGroup {
  movement: number;
  themeColor: string;
  stages: readonly EtudeWithMovementMeta[];
}

export function StageSelectScreen() {
  const goto = useAppStore((s) => s.goto);
  const selectEtude = useAppStore((s) => s.selectEtude);
  const loadedEtudes = useAppStore((s) => s.loadedEtudes);
  const etudesLoadState = useAppStore((s) => s.etudesLoadState);
  const initialMovement = useAppStore((s) => s.selectInitialMovement);
  const setInitialMovement = useAppStore((s) => s.setSelectInitialMovement);

  // Prefer the network-loaded roster once it's ready, otherwise fall
  // back to the bundled placeholder ETUDES so a missing public/stages/
  // (e.g. local dev before content lands) doesn't blank the screen.
  const stages: readonly EtudeWithMovementMeta[] = loadedEtudes ?? ETUDES;
  const usingFallback = etudesLoadState === 'error';

  // Snapshot all bests on mount. Result writes back via setBest, but
  // this screen only re-reads on navigation back, which is fine — the
  // newly-set value will show up next time the player visits.
  const bests = useMemo<Record<string, BestRecord>>(() => getAllBests(), []);

  // Group stages by their level number, sorted ascending. Stages
  // within a group keep their original (manifest / hardcoded) order.
  const levelGroups = useMemo<MovementGroup[]>(() => {
    const byLevel = new Map<number, EtudeWithMovementMeta[]>();
    for (const stage of stages) {
      const list = byLevel.get(stage.movement) ?? [];
      list.push(stage);
      byLevel.set(stage.movement, list);
    }
    return Array.from(byLevel.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([movement, groupStages]) => ({
        movement,
        themeColor: groupStages[0]!.themeColor,
        stages: groupStages,
      }));
  }, [stages]);

  // Pull the requested initial level from the store (set by Result's
  // "ステージ選択へ"). Snapshot once at mount; clear the store value
  // so the next entry from Title defaults back to the Level list.
  const [openMovement, setOpenMovement] = useState<number | null>(initialMovement);
  useEffect(() => {
    if (initialMovement !== null) setInitialMovement(null);
    // We only want this on mount — the snapshot above is what counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = (id: string) => {
    selectEtude(id);
    goto('game');
  };

  if (openMovement !== null) {
    const group = levelGroups.find((g) => g.movement === openMovement);
    if (!group) {
      // Level disappeared (shouldn't happen, but guard anyway).
      setOpenMovement(null);
      return null;
    }
    return (
      <EtudeListView
        group={group}
        bests={bests}
        onStart={start}
        onBack={() => setOpenMovement(null)}
      />
    );
  }

  return (
    <MovementListView
      groups={levelGroups}
      bests={bests}
      loadingHint={etudesLoadState === 'loading' ? '譜面を読み込み中…' : null}
      fallbackHint={usingFallback ? '※ 譜面ファイル未配置のためデモ譜面で代替中' : null}
      onOpenMovement={setOpenMovement}
      onBack={() => goto('title')}
    />
  );
}

/* ================================================================== */
/*  Level list (top of the 2-tier hierarchy)                          */
/* ================================================================== */

interface MovementListProps {
  groups: readonly MovementGroup[];
  bests: Record<string, BestRecord>;
  loadingHint: string | null;
  fallbackHint: string | null;
  onOpenMovement: (movement: number) => void;
  onBack: () => void;
}

function MovementListView({ groups, bests, loadingHint, fallbackHint, onOpenMovement, onBack }: MovementListProps) {
  return (
    <main className="screen screen-select">
      <h1 className="select-title">Movement を選ぶ</h1>
      {loadingHint && <p className="muted select-hint">{loadingHint}</p>}
      {fallbackHint && <p className="muted select-hint">{fallbackHint}</p>}
      <ul className="etude-list">
        {groups.map((group) => {
          const cleared = group.stages.filter((s) =>
            CLEAR_RANKS.has(bests[s.id]?.rank ?? 'D'),
          ).length;
          return (
            <li key={group.movement}>
              <MovementCard
                group={group}
                medal={movementMedal(group.stages, bests)}
                cleared={cleared}
                total={group.stages.length}
                onOpen={onOpenMovement}
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

interface MovementCardProps {
  group: MovementGroup;
  medal: Medal | null;
  cleared: number;
  total: number;
  onOpen: (movement: number) => void;
}

function MovementCard({ group, medal, cleared, total, onOpen }: MovementCardProps) {
  return (
    <button
      className="etude-card"
      onClick={() => onOpen(group.movement)}
      style={{ borderColor: group.themeColor }}
    >
      <span className="etude-card-stripe" style={{ background: group.themeColor }} />
      <span className="etude-card-glyph" aria-hidden="true">{movementGlyph(group.movement)}</span>
      <div className="etude-card-body">
        <div className="etude-card-head">
          <span className="etude-card-name">Movement {group.movement}</span>
        </div>
        <div className="etude-card-desc">
          {cleared}/{total} クリア (A以上)
        </div>
        <div className="etude-card-meta">
          <span className="etude-card-bpm">▶ 開く</span>
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
/*  Etude list (drilled into a level)                                 */
/* ================================================================== */

interface EtudeListProps {
  group: MovementGroup;
  bests: Record<string, BestRecord>;
  onStart: (id: string) => void;
  onBack: () => void;
}

function EtudeListView({ group, bests, onStart, onBack }: EtudeListProps) {
  return (
    <main className="screen screen-select">
      <button className="secondary select-back" onClick={onBack}>
        ← Movement 一覧へ
      </button>
      <h1 className="select-title">Movement {group.movement}</h1>
      <ul className="etude-list">
        {group.stages.map((stage) => (
          <li key={stage.id}>
            <EtudeCard stage={stage} best={bests[stage.id]} onStart={onStart} />
          </li>
        ))}
      </ul>
    </main>
  );
}

interface EtudeCardProps {
  stage: EtudeWithMovementMeta;
  best: BestRecord | undefined;
  onStart: (id: string) => void;
}

function EtudeCard({ stage, best, onStart }: EtudeCardProps) {
  return (
    <button
      className="etude-card"
      onClick={() => onStart(stage.id)}
      style={{ borderColor: stage.themeColor }}
    >
      <span className="etude-card-stripe" style={{ background: stage.themeColor }} />
      <span className="etude-card-glyph" aria-hidden="true">{etudeGlyph(stage)}</span>
      <div className="etude-card-body">
        <div className="etude-card-head">
          <span className="etude-card-name">{stage.name}</span>
        </div>
        <div className="etude-card-desc">{stage.description}</div>
        <div className="etude-card-meta">
          <span className="etude-card-ts">{etudeTimeSig(stage)}</span>
          <span className="etude-card-bpm">
            {isAsymmetricEtude(stage) ? '♪' : '♩'}{isCompoundEtude(stage) && <span className="bpm-dot">.</span>} = {stage.bpm}
          </span>
          {best && (
            <span className="etude-card-best">
              <RankMedal rank={best.rank} />
              <span className="etude-card-score">{best.score}</span>
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
function movementGlyph(movement: number): string {
  switch (movement) {
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

function etudeGlyph(stage: EtudeWithMovementMeta): string {
  if (stage.isFinal) return '★';
  return movementGlyph(stage.movement);
}

/** Display the piece's opening time signature on the Etude card. */
function etudeTimeSig(stage: EtudeWithMovementMeta): string {
  const ts = stage.score.timeSigs[0];
  if (!ts) return '4/4';
  return `${ts.numerator}/${ts.denominator}`;
}

/**
 * True for compound primary meters (6/8 / 9/8 / 12/8) where the bpm
 * value is the dotted-quarter pulse and we render "♩." instead of "♩".
 */
function isCompoundEtude(stage: EtudeWithMovementMeta): boolean {
  const ts = stage.score.timeSigs[0];
  return ts != null && ts.denominator === 8 && ts.numerator % 3 === 0;
}

/**
 * True for asymmetric primary meters (5/8 / 7/8) where the bpm value
 * is counted in eighths and we render "♪" instead of "♩".
 */
function isAsymmetricEtude(stage: EtudeWithMovementMeta): boolean {
  const ts = stage.score.timeSigs[0];
  return ts != null && ts.denominator === 8 && (ts.numerator === 5 || ts.numerator === 7);
}
