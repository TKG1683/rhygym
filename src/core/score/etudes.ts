/**
 * Offline fallback étude roster.
 *
 * Real per-étude scores ship as MIDI under public/etudes/<id>/ and are
 * pulled at runtime by etudeLoader. This module is the fallback used
 * when that fetch fails (offline, dev server hiccup, etc.) — it carries
 * the full 60-étude metadata table so MovementSelect can still render
 * the Movement grid, and a thin placeholder Score so the game loop
 * doesn't crash if a player taps Play on an étude without a loaded
 * score.
 *
 * Movements run 1 (easiest) → 10 (hardest); within each Movement there
 * are five graded études (`movement-N-etude-1` … `movement-N-etude-5`)
 * plus one Final (`movement-N-final`) that previews the next Movement's
 * signature element.
 */

import type { Etude } from '../model';
import { DEMO_ETUDE } from './demoEtude';

interface EtudeMeta {
  id: string;
  name: string;
  description: string;
  bpm: number;
  /** Difficulty rank, 1 = easiest, 10 = hardest. */
  movement: number;
  /** Accent color used on the card. Difficulty rises → hue shifts warmer/darker. */
  themeColor: string;
  /** 1-based position within a Level's stage list. */
  indexInMovement: number;
  /** True for the Level's skip-test stage. */
  isFinal?: boolean;
}

// Same palette as scripts/generate-etudes.ts so the fallback and the
// authored etude.json files agree on Movement coloring.
const COLOR: Record<number, string> = {
  1: '#9bd4a2',
  2: '#7cc8b3',
  3: '#5fbbc4',
  4: '#5ba8d9',
  5: '#7d8edf',
  6: '#a079d6',
  7: '#c46cbf',
  8: '#d96098',
  9: '#e2785a',
  10: '#E8612E',
};

// Per-Level BPM target — the headline tempo for that Movement's
// curriculum. Graded slowdown: Lv1 keeps the original tempo, each
// subsequent Movement multiplies by a factor that bottoms out at
// 0.75 by Lv10. Keeps the climb upward while easing the high-level
// pieces that previously felt sprinted.
const MOVEMENT_BPM: Record<number, number> = {
  1: 80, 2: 87, 3: 90, 4: 92, 5: 98,
  6: 103, 7: 108, 8: 113, 9: 118, 10: 126,
};

// One-line description for each Movement's 5 graded études + Final.
// Authored so the MovementSelect cards have something more specific
// than "Movement N — k".
const ETUDE_DESCRIPTIONS: Record<string, string> = {
  // Movement 1 — quarter / half / whole
  'movement-1-etude-1': '4分音符を歩く',
  'movement-1-etude-2': '2分音符の伸びを感じる',
  'movement-1-etude-3': '全音符と2分音符の対話',
  'movement-1-etude-4': '4分と2分のリレー',
  'movement-1-etude-5': '基本値の総まとめ',
  'movement-1-final': '次レベルへ向け、休符を一足先に',
  // Movement 2 — + quarter rest, 3/4
  'movement-2-etude-1': '4分休符の間合い',
  'movement-2-etude-2': '休符でひと呼吸',
  'movement-2-etude-3': '3/4 ワルツに入門',
  'movement-2-etude-4': '3/4 + 4分休符',
  'movement-2-etude-5': '4/4 と 3/4 を弾むように',
  'movement-2-final': '次レベルへ向け、8分の予告',
  // Movement 3 — + eighth note / rest
  'movement-3-etude-1': '8分音符を刻む',
  'movement-3-etude-2': '8分休符の合いの手',
  'movement-3-etude-3': '裏拍を踏みしめる',
  'movement-3-etude-4': '3/4 拍子で8分音符',
  'movement-3-etude-5': '8分の連続と休符の織り交ぜ',
  'movement-3-final': '次レベルへ向け、付点4分の予告',
  // Movement 4 — + dotted quarter / eighth, 6/8 intro
  'movement-4-etude-1': '付点4分音符の躍動',
  'movement-4-etude-2': '付点8分 + 16分のスキップ',
  'movement-4-etude-3': '6/8 拍子に入門',
  'movement-4-etude-4': '6/8 + 付点4分の流れ',
  'movement-4-etude-5': '4/4 と付点の総合演習',
  'movement-4-final': '次レベルへ向け、16分音符の予告',
  // Movement 5 — + sixteenths / sixteenth rest
  'movement-5-etude-1': '16分音符を均等に',
  'movement-5-etude-2': '16分休符でリズムを刻む',
  'movement-5-etude-3': '6/8 で16分を散りばめる',
  'movement-5-etude-4': '裏裏のリズムを掴む',
  'movement-5-etude-5': '16分の総合演習',
  'movement-5-final': '次レベルへ向け、シンコペーションの予告',
  // Movement 6 — + syncopation, ties across barlines
  'movement-6-etude-1': 'シンコペーション入門',
  'movement-6-etude-2': '小節を跨ぐタイ',
  'movement-6-etude-3': 'シンコペとタイの混合',
  'movement-6-etude-4': 'アンチシペーションで先取り',
  'movement-6-etude-5': '裏拍とタイで踊る',
  'movement-6-final': '次レベルへ向け、3連符の予告',
  // Movement 7 — + triplets / sextuplets / 9/8
  'movement-7-etude-1': '3連符を流暢に',
  'movement-7-etude-2': '4 連 vs 3 連の対比',
  'movement-7-etude-3': '6連符の旋回',
  'movement-7-etude-4': '9/8 拍子に親しむ',
  'movement-7-etude-5': '3連 + タイの華麗な技巧',
  'movement-7-final': '次レベルへ向け、5連符の予告',
  // Movement 8 — + quintuplets / septuplets / 5/8 / 7/8
  'movement-8-etude-1': '5連符を四拍の中に',
  'movement-8-etude-2': '7連符の挑戦',
  'movement-8-etude-3': '5/8 拍子に飛び込む',
  'movement-8-etude-4': '7/8 のうねり',
  'movement-8-etude-5': '異拍子の総合演習',
  'movement-8-final': '次レベルへ向け、5/4 拍子の予告',
  // Movement 9 — + irregular meter / hemiola / compound regroup
  'movement-9-etude-1': '5/4 拍子で歩を進める',
  'movement-9-etude-2': '7/8 拍子の躍動',
  'movement-9-etude-3': 'ヘミオラ — 3 を 2 に組替',
  'movement-9-etude-4': '複合拍子の組替え (9/8 ⇄ 6/8)',
  'movement-9-etude-5': '変則拍子の総合演習',
  'movement-9-final': '次レベルへ向け、拍子切替の予告',
  // Movement 10 — meter change / cross-rhythm / tempo change
  'movement-10-etude-1': '拍子切替に慣れる',
  'movement-10-etude-2': 'テンポチェンジを乗りこなす',
  'movement-10-etude-3': 'クロスリズム 3 against 2',
  'movement-10-etude-4': '混合拍子の連結',
  'movement-10-etude-5': '全要素の総決算',
  'movement-10-final': '卒業試験 — Rhygym の最終形',
};

function buildMovementMetas(movement: number): EtudeMeta[] {
  const bpm = MOVEMENT_BPM[movement]!;
  const color = COLOR[movement]!;
  const indices: Array<{
    idSuffix: string;
    indexInMovement: number;
    isFinal?: boolean;
    minor: string;
  }> = [
    { idSuffix: 'etude-1', indexInMovement: 1, minor: '1' },
    { idSuffix: 'etude-2', indexInMovement: 2, minor: '2' },
    { idSuffix: 'etude-3', indexInMovement: 3, minor: '3' },
    { idSuffix: 'etude-4', indexInMovement: 4, minor: '4' },
    { idSuffix: 'etude-5', indexInMovement: 5, minor: '5' },
    { idSuffix: 'final', indexInMovement: 6, isFinal: true, minor: 'F' },
  ];
  return indices.map((it) => {
    const id = `movement-${movement}-${it.idSuffix}`;
    // Final is no longer an étude — it's the Movement's Final, so it
    // gets its own label rather than an "Etude N-F" suffix. Hyphen
    // separators across the board for visual consistency.
    const name = it.isFinal
      ? `Movement ${movement}-Final`
      : `Etude ${movement}-${it.minor}`;
    const meta: EtudeMeta = {
      id,
      name,
      description: ETUDE_DESCRIPTIONS[id] ?? name,
      bpm,
      movement,
      themeColor: color,
      indexInMovement: it.indexInMovement,
    };
    if (it.isFinal) meta.isFinal = true;
    return meta;
  });
}

const ETUDE_METAS: readonly EtudeMeta[] = Array.from({ length: 10 }, (_, i) =>
  buildMovementMetas(i + 1),
).flat();

// Kept as a re-export for callers that imported the old EtudeWithMovementMeta
// type; structurally identical to Etude now that indexInMovement/isFinal +
// level/themeColor live on the base type / are added here.
export interface EtudeWithMovementMeta extends Etude {
  movement: number;
  themeColor: string;
}

export const ETUDES: readonly EtudeWithMovementMeta[] = ETUDE_METAS.map((m) => {
  const stage: EtudeWithMovementMeta = {
    id: m.id,
    name: m.name,
    description: m.description,
    bpm: m.bpm,
    movement: m.movement,
    themeColor: m.themeColor,
    indexInMovement: m.indexInMovement,
    // Offline fallback uses DEMO_ETUDE's note pattern but overrides the
    // tempo with this Movement's authored BPM so metronome and playhead
    // stay in sync. Real per-étude scores load from public/etudes/.
    score: {
      ...DEMO_ETUDE.score,
      tempos: [{ tick: 0, bpm: m.bpm }],
    },
  };
  if (m.isFinal) stage.isFinal = true;
  return stage;
});

export function getEtudeById(id: string): EtudeWithMovementMeta | null {
  return ETUDES.find((s) => s.id === id) ?? null;
}

export function getEtudeMovement(id: string): number | null {
  const meta = ETUDE_METAS.find((m) => m.id === id);
  return meta?.movement ?? null;
}
