import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ETUDES, type EtudeWithMovementMeta } from '../../core/score/etudes';
import { evaluateProgression, FINAL_UNLOCK_THRESHOLD } from '../../core/progress/progression';
import { getAllBests, getSkipTestFinals, type BestRecord } from '../../core/storage/localStore';
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
  // Same snapshot pattern for the skip-test markers — tracks which
  // Finals have a current best earned via skip-test only (no normal
  // clear yet). evaluateProgression uses it to gate M+1 unlocks.
  const skipTestFinals = useMemo(() => getSkipTestFinals(), []);

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

  // Progression state is derived from bests on every render — cheap
  // (linear over ~60 stages) and avoids a separate persisted unlock
  // store that could drift out of sync with scores. Bundles both the
  // Movement-level cap and the per-Movement Final unlock set.
  const progression = useMemo(
    () => evaluateProgression(bests, levelGroups, { skipTestFinals }),
    [bests, levelGroups, skipTestFinals],
  );
  const maxUnlocked = progression.maxMovementUnlocked;
  const finalsUnlocked = progression.finalsUnlocked;

  // Auto-Mode debug aid: dump progression state + every recorded best
  // to the console so the user can diagnose "I cleared 3 etudes but
  // Final isn't unlocked" without me guessing. Only fires when Auto
  // Mode is on so production sessions aren't polluted.
  const autoMode = useAppStore((s) => s.autoMode);
  useEffect(() => {
    if (!autoMode) return;
    const rankByStage: Record<string, string> = {};
    for (const g of levelGroups) {
      for (const s of g.stages) {
        const r = bests[s.id]?.rank;
        if (r) rankByStage[s.id] = r;
      }
    }
    // eslint-disable-next-line no-console
    console.log('[Rhygym Auto] progression', {
      maxMovementUnlocked: maxUnlocked,
      finalsUnlocked: Array.from(finalsUnlocked),
      bests: rankByStage,
    });
  }, [autoMode, levelGroups, bests, maxUnlocked, finalsUnlocked]);

  const setViaSkipTest = useAppStore((s) => s.setViaSkipTest);
  const start = (id: string) => {
    setViaSkipTest(false);
    selectEtude(id);
    goto('game');
  };
  // Skip-test entry — start the Final stage of `movement` directly,
  // bypassing the (locked) etude list. The movement might still be
  // locked at this moment; once the player earns S on the Final the
  // progression logic will reflect that on the next render. The
  // viaSkipTest flag tells ResultScreen to swap "Etude 一覧へ" for
  // "Movement 一覧へ" — the player came in from the level list, not
  // the etude list, so returning to a (possibly still-locked) etude
  // list would feel wrong.
  const startSkipTest = (movement: number) => {
    const group = levelGroups.find((g) => g.movement === movement);
    const final = group?.stages.find((s) => s.isFinal);
    if (!final) return;
    setViaSkipTest(true);
    selectEtude(final.id);
    goto('game');
  };

  if (openMovement !== null) {
    const group = levelGroups.find((g) => g.movement === openMovement);
    // Locked movements shouldn't be openable in the first place, but if
    // a stale state pointed at one (e.g. progression rule change), bail
    // back to the level list rather than rendering a half-broken view.
    if (!group || openMovement > maxUnlocked) {
      setOpenMovement(null);
      return null;
    }
    return (
      <EtudeListView
        group={group}
        bests={bests}
        finalUnlocked={finalsUnlocked.has(group.movement)}
        onStart={start}
        onBack={() => setOpenMovement(null)}
      />
    );
  }

  return (
    <MovementListView
      groups={levelGroups}
      bests={bests}
      maxUnlocked={maxUnlocked}
      loadingHint={etudesLoadState === 'loading' ? '譜面を読み込み中…' : null}
      fallbackHint={usingFallback ? '※ 譜面ファイル未配置のためデモ譜面で代替中' : null}
      onOpenMovement={setOpenMovement}
      onSkipTest={startSkipTest}
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
  maxUnlocked: number;
  loadingHint: string | null;
  fallbackHint: string | null;
  onOpenMovement: (movement: number) => void;
  onSkipTest: (movement: number) => void;
  onBack: () => void;
}

function MovementListView({
  groups,
  bests,
  maxUnlocked,
  loadingHint,
  fallbackHint,
  onOpenMovement,
  onSkipTest,
  onBack,
}: MovementListProps) {
  const [showUnlockHelp, setShowUnlockHelp] = useState(false);
  const hasLocked = groups.some((g) => g.movement > maxUnlocked);
  return (
    <main className="screen screen-select">
      <div className="select-title-row">
        <h1 className="select-title">Movement を選ぶ</h1>
        {/* Show the help affordance only when there's at least one
         * locked Movement on screen — there's nothing to explain
         * otherwise. */}
        {hasLocked && (
          <button
            type="button"
            className="select-help-btn"
            aria-label="解放条件のヘルプを開く"
            onClick={() => setShowUnlockHelp(true)}
          >
            ❓ 解放条件
          </button>
        )}
      </div>
      {loadingHint && <p className="muted select-hint">{loadingHint}</p>}
      {fallbackHint && <p className="muted select-hint">{fallbackHint}</p>}
      {showUnlockHelp && <UnlockHelpModal onClose={() => setShowUnlockHelp(false)} />}
      <ul className="etude-list">
        {groups.map((group) => {
          const cleared = group.stages.filter((s) =>
            CLEAR_RANKS.has(bests[s.id]?.rank ?? 'D'),
          ).length;
          const locked = group.movement > maxUnlocked;
          return (
            <li key={group.movement}>
              <MovementCard
                group={group}
                medal={movementMedal(group.stages, bests)}
                cleared={cleared}
                total={group.stages.length}
                locked={locked}
                onOpen={onOpenMovement}
                onSkipTest={onSkipTest}
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
  locked: boolean;
  onOpen: (movement: number) => void;
  onSkipTest: (movement: number) => void;
}

function MovementCard({
  group,
  medal,
  cleared,
  total,
  locked,
  onOpen,
  onSkipTest,
}: MovementCardProps) {
  if (locked) {
    return (
      <div
        className="etude-card etude-card-locked"
        style={{ borderColor: group.themeColor }}
        aria-label={`Movement ${group.movement} (ロック中)`}
      >
        <span className="etude-card-stripe" style={{ background: group.themeColor }} />
        <span className="etude-card-glyph etude-card-glyph-locked" aria-hidden="true">
          🔒
        </span>
        <div className="etude-card-body">
          <div className="etude-card-head">
            <span className="etude-card-name">Movement {group.movement}</span>
          </div>
          <div className="etude-card-desc movement-unlock-desc">
            ロック中
          </div>
          <div className="etude-card-meta">
            <button
              type="button"
              className="movement-skip-test"
              onClick={() => onSkipTest(group.movement)}
            >
              飛び級試験 →
            </button>
          </div>
        </div>
      </div>
    );
  }
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

/**
 * Help modal explaining the two paths to unlock a Movement. Rendered
 * via React Portal into document.body so the dim backdrop covers the
 * whole viewport (the screen's transform animation otherwise creates
 * a containing block that clips `position: fixed`). One modal serves
 * every locked card on the screen — repeating the conditions inside
 * each card was cluttering the level list.
 */
function UnlockHelpModal({ onClose }: { onClose: () => void }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="select-help-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlock-help-title"
      onClick={onClose}
    >
      <div className="select-help-card" onClick={(e) => e.stopPropagation()}>
        <h2 id="unlock-help-title" className="select-help-title">
          解放のしくみ
        </h2>
        <p className="select-help-body">
          各 Movement は Etude 5 つと Final 1 つで構成。 Final が次の Movement への扉になっています。
        </p>
        <ul className="select-help-list">
          <li>
            🎯 Movement 内の Etude を <strong>3 つ以上 A ランク以上</strong> でクリアすると、 その Movement の <strong>Final</strong> が解放
          </li>
          <li>
            🚪 <strong>Final をクリア (B ランク以上)</strong> すると、 次の Movement の Etude が解放
          </li>
          <li>
            ⭐ ロックされた Movement の <strong>飛び級試験で S</strong> を取得すると、 <strong>その Movement の Etude が解放</strong>
            。 間に飛び越した Movement は Final ごとクリア扱い
          </li>
        </ul>
        <p className="select-help-note">
          ※ 飛び級成功した Movement 自体の Final は、 通常通り Etude 3 つ A 以上でクリアしてから挑戦してください。 そこを Final クリアすると次の Movement が解放されます。
        </p>
        <p className="select-help-note">
          ※ 飛び級試験は、 ロックされた Movement のカードからいつでも挑戦できます。 S 未満では何も解放されません。
        </p>
        <button type="button" className="primary select-help-close" onClick={onClose}>
          OK
        </button>
      </div>
    </div>,
    document.body,
  );
}

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
  /**
   * Whether this Movement's Final is currently unlocked for normal
   * play (= 3+ etudes A+, or a prior skip-test S already cleared it).
   * Etudes 1-5 are always playable when the Movement itself is open;
   * the Final is the only thing that can be greyed out here.
   */
  finalUnlocked: boolean;
  onStart: (id: string) => void;
  onBack: () => void;
}

function EtudeListView({ group, bests, finalUnlocked, onStart, onBack }: EtudeListProps) {
  return (
    <main className="screen screen-select">
      <button className="secondary select-back" onClick={onBack}>
        ← Movement 一覧へ
      </button>
      <h1 className="select-title">Movement {group.movement}</h1>
      <ul className="etude-list">
        {group.stages.map((stage) => {
          const locked = stage.isFinal === true && !finalUnlocked;
          return (
            <li key={stage.id}>
              <EtudeCard
                stage={stage}
                best={bests[stage.id]}
                locked={locked}
                onStart={onStart}
              />
            </li>
          );
        })}
      </ul>
    </main>
  );
}

interface EtudeCardProps {
  stage: EtudeWithMovementMeta;
  best: BestRecord | undefined;
  locked: boolean;
  onStart: (id: string) => void;
}

function EtudeCard({ stage, best, locked, onStart }: EtudeCardProps) {
  if (locked) {
    // Locked Final variant — etude list shows it greyed with the
    // unlock condition so the player isn't left guessing why ★ is
    // missing from the lineup. No play handler attached.
    return (
      <div
        className="etude-card etude-card-locked etude-card-final-locked"
        style={{ borderColor: stage.themeColor }}
        aria-label={`${stage.name} (ロック中)`}
      >
        <span className="etude-card-stripe" style={{ background: stage.themeColor }} />
        <span className="etude-card-glyph etude-card-glyph-locked" aria-hidden="true">
          🔒
        </span>
        <div className="etude-card-body">
          <div className="etude-card-head">
            <span className="etude-card-name">{stage.name}</span>
          </div>
          <div className="etude-card-desc">
            Etude を {FINAL_UNLOCK_THRESHOLD} つ以上 A ランク以上 でクリアすると解放
          </div>
        </div>
      </div>
    );
  }
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
          {/* The card's BPM doubles as the pass threshold — running slower
           * than this is allowed (good for practice) but won't count as a
           * best-score entry. Label it as such so it doesn't read as
           * "this is THE tempo to play at". */}
          <span className="etude-card-bpm" title="合格ライン (これ以上の BPM で完走すると記録対象)">
            <span className="etude-card-bpm-label">合格ライン</span>
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
