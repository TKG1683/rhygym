/**
 * Offline fallback stage roster.
 *
 * Real per-stage scores ship as MIDI under public/stages/<id>/ and are
 * pulled at runtime by stageLoader. This module is the fallback used
 * when that fetch fails (offline, dev server hiccup, etc.) — it carries
 * the full 60-stage metadata table so StageSelect can still render the
 * Level grid, and a thin placeholder Score so the game loop doesn't
 * crash if a player taps Play on a stage without a loaded score.
 *
 * Levels run 1 (easiest) → 10 (hardest); within each Level there are
 * five graded stages (`level-N-1` … `level-N-5`) plus one skip-test
 * (`level-N-exam`) that previews the next Level's signature element.
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

// Same palette as scripts/generate-stages.ts so the fallback and the
// authored stage.json files agree on Level coloring.
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

// One-line description for each Level's 5 graded stages + exam. Authored
// so the StageSelect cards have something more specific than "Level N — k".
const ETUDE_DESCRIPTIONS: Record<string, string> = {
  // Level 1 — quarter / half / whole
  'level-1-1': '4分音符を歩く',
  'level-1-2': '2分音符の伸びを感じる',
  'level-1-3': '全音符と2分音符の対話',
  'level-1-4': '4分と2分のリレー',
  'level-1-5': '基本値の総まとめ',
  'level-1-exam': '次レベルへ向け、休符を一足先に',
  // Level 2 — + quarter rest, 3/4
  'level-2-1': '4分休符の間合い',
  'level-2-2': '休符でひと呼吸',
  'level-2-3': '3/4 ワルツに入門',
  'level-2-4': '3/4 + 4分休符',
  'level-2-5': '4/4 と 3/4 を弾むように',
  'level-2-exam': '次レベルへ向け、8分の予告',
  // Level 3 — + eighth note / rest
  'level-3-1': '8分音符を刻む',
  'level-3-2': '8分休符の合いの手',
  'level-3-3': '裏拍を踏みしめる',
  'level-3-4': '3/4 拍子で8分音符',
  'level-3-5': '8分の連続と休符の織り交ぜ',
  'level-3-exam': '次レベルへ向け、付点4分の予告',
  // Level 4 — + dotted quarter / eighth, 6/8 intro
  'level-4-1': '付点4分音符の躍動',
  'level-4-2': '付点8分 + 16分のスキップ',
  'level-4-3': '6/8 拍子に入門',
  'level-4-4': '6/8 + 付点4分の流れ',
  'level-4-5': '4/4 と付点の総合演習',
  'level-4-exam': '次レベルへ向け、16分音符の予告',
  // Level 5 — + sixteenths / sixteenth rest
  'level-5-1': '16分音符を均等に',
  'level-5-2': '16分休符でリズムを刻む',
  'level-5-3': '6/8 で16分を散りばめる',
  'level-5-4': '裏裏のリズムを掴む',
  'level-5-5': '16分の総合演習',
  'level-5-exam': '次レベルへ向け、シンコペーションの予告',
  // Level 6 — + syncopation, ties across barlines
  'level-6-1': 'シンコペーション入門',
  'level-6-2': '小節を跨ぐタイ',
  'level-6-3': 'シンコペとタイの混合',
  'level-6-4': 'アンチシペーションで先取り',
  'level-6-5': '裏拍とタイで踊る',
  'level-6-exam': '次レベルへ向け、3連符の予告',
  // Level 7 — + triplets / sextuplets / 9/8
  'level-7-1': '3連符を流暢に',
  'level-7-2': '4 連 vs 3 連の対比',
  'level-7-3': '6連符の旋回',
  'level-7-4': '9/8 拍子に親しむ',
  'level-7-5': '3連 + タイの華麗な技巧',
  'level-7-exam': '次レベルへ向け、5連符の予告',
  // Level 8 — + quintuplets / septuplets / 5/8 / 7/8
  'level-8-1': '5連符を四拍の中に',
  'level-8-2': '7連符の挑戦',
  'level-8-3': '5/8 拍子に飛び込む',
  'level-8-4': '7/8 のうねり',
  'level-8-5': '異拍子の総合演習',
  'level-8-exam': '次レベルへ向け、5/4 拍子の予告',
  // Level 9 — + irregular meter / hemiola / compound regroup
  'level-9-1': '5/4 拍子で歩を進める',
  'level-9-2': '7/8 拍子の躍動',
  'level-9-3': 'ヘミオラ — 3 を 2 に組替',
  'level-9-4': '複合拍子の組替え (9/8 ⇄ 6/8)',
  'level-9-5': '変則拍子の総合演習',
  'level-9-exam': '次レベルへ向け、拍子切替の予告',
  // Level 10 — meter change / cross-rhythm / tempo change
  'level-10-1': '拍子切替に慣れる',
  'level-10-2': 'テンポチェンジを乗りこなす',
  'level-10-3': 'クロスリズム 3 against 2',
  'level-10-4': '混合拍子の連結',
  'level-10-5': '全要素の総決算',
  'level-10-exam': '卒業試験 — Rhygym の最終形',
};

function buildMovementMetas(movement: number): EtudeMeta[] {
  const bpm = MOVEMENT_BPM[movement]!;
  const color = COLOR[movement]!;
  const indices: Array<{ key: string; indexInMovement: number; isFinal?: boolean; minor: string }> = [
    { key: '1', indexInMovement: 1, minor: '1' },
    { key: '2', indexInMovement: 2, minor: '2' },
    { key: '3', indexInMovement: 3, minor: '3' },
    { key: '4', indexInMovement: 4, minor: '4' },
    { key: '5', indexInMovement: 5, minor: '5' },
    { key: 'exam', indexInMovement: 6, isFinal: true, minor: 'F' },
  ];
  return indices.map((it) => {
    const id = `level-${movement}-${it.key}`;
    // Exam is no longer an étude — it's the Movement's Final, so it
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
    // tempo with this Level's authored BPM so metronome and playhead
    // stay in sync. Real per-stage scores load from public/stages/.
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
