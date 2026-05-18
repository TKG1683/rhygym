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

import type { Stage } from '../model';
import { DEMO_STAGE } from './demoStage';

interface StageMeta {
  id: string;
  name: string;
  description: string;
  bpm: number;
  /** Difficulty rank, 1 = easiest, 10 = hardest. */
  level: number;
  /** Accent color used on the card. Difficulty rises → hue shifts warmer/darker. */
  themeColor: string;
  /** 1-based position within a Level's stage list. */
  indexInLevel: number;
  /** True for the Level's skip-test stage. */
  isExam?: boolean;
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

// Per-Level BPM target — the headline tempo for that Level's curriculum.
const LEVEL_BPM: Record<number, number> = {
  1: 80, 2: 90, 3: 95, 4: 100, 5: 110,
  6: 120, 7: 130, 8: 140, 9: 152, 10: 168,
};

// One-line description for each Level's 5 graded stages + exam. Authored
// so the StageSelect cards have something more specific than "Level N — k".
const STAGE_DESCRIPTIONS: Record<string, string> = {
  // Level 1 — quarter / half / whole
  'level-1-1': '四分音符を歩く',
  'level-1-2': '二分音符の伸びを感じる',
  'level-1-3': '全音符と二分音符の対話',
  'level-1-4': '四分と二分のリレー',
  'level-1-5': '基本値の総まとめ',
  'level-1-exam': '次レベルへ向け、休符を一足先に',
  // Level 2 — + quarter rest, 3/4
  'level-2-1': '四分休符の間合い',
  'level-2-2': '休符でひと呼吸',
  'level-2-3': '3/4 ワルツに入門',
  'level-2-4': '3/4 + 四分休符',
  'level-2-5': '4/4 と 3/4 を弾むように',
  'level-2-exam': '次レベルへ向け、八分の予告',
  // Level 3 — + eighth note / rest
  'level-3-1': '八分音符を刻む',
  'level-3-2': '八分休符の合いの手',
  'level-3-3': '裏拍を踏みしめる',
  'level-3-4': '3/4 拍子で八分音符',
  'level-3-5': '八分の連続と休符の織り交ぜ',
  'level-3-exam': '次レベルへ向け、付点四分の予告',
  // Level 4 — + dotted quarter / eighth, 6/8 intro
  'level-4-1': '付点四分音符の躍動',
  'level-4-2': '付点八分 + 十六分のスキップ',
  'level-4-3': '6/8 拍子に入門',
  'level-4-4': '6/8 + 付点四分の流れ',
  'level-4-5': '4/4 と付点の総合演習',
  'level-4-exam': '次レベルへ向け、十六分音符の予告',
  // Level 5 — + sixteenths / sixteenth rest
  'level-5-1': '十六分音符を均等に',
  'level-5-2': '十六分休符でリズムを刻む',
  'level-5-3': '6/8 で十六分を散りばめる',
  'level-5-4': '裏裏のリズムを掴む',
  'level-5-5': '十六分の総合演習',
  'level-5-exam': '次レベルへ向け、シンコペーションの予告',
  // Level 6 — + syncopation, ties across barlines
  'level-6-1': 'シンコペーション入門',
  'level-6-2': '小節を跨ぐタイ',
  'level-6-3': 'シンコペとタイの混合',
  'level-6-4': 'アンチシペーションで先取り',
  'level-6-5': '裏拍とタイで踊る',
  'level-6-exam': '次レベルへ向け、三連符の予告',
  // Level 7 — + triplets / sextuplets / 9/8
  'level-7-1': '三連符を流暢に',
  'level-7-2': '4 連 vs 3 連の対比',
  'level-7-3': '六連符の旋回',
  'level-7-4': '9/8 拍子に親しむ',
  'level-7-5': '三連 + タイの華麗な技巧',
  'level-7-exam': '次レベルへ向け、五連符の予告',
  // Level 8 — + quintuplets / septuplets / 5/8 / 7/8
  'level-8-1': '五連符を四拍の中に',
  'level-8-2': '七連符の挑戦',
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

function buildLevelMetas(level: number): StageMeta[] {
  const bpm = LEVEL_BPM[level]!;
  const color = COLOR[level]!;
  const indices: Array<{ key: string; indexInLevel: number; isExam?: boolean; suffix: string }> = [
    { key: '1', indexInLevel: 1, suffix: '1' },
    { key: '2', indexInLevel: 2, suffix: '2' },
    { key: '3', indexInLevel: 3, suffix: '3' },
    { key: '4', indexInLevel: 4, suffix: '4' },
    { key: '5', indexInLevel: 5, suffix: '5' },
    { key: 'exam', indexInLevel: 6, isExam: true, suffix: 'Exam' },
  ];
  return indices.map((it) => {
    const id = `level-${level}-${it.key}`;
    const meta: StageMeta = {
      id,
      name: `Level ${level} — ${it.suffix}`,
      description: STAGE_DESCRIPTIONS[id] ?? `Level ${level} stage ${it.indexInLevel}`,
      bpm,
      level,
      themeColor: color,
      indexInLevel: it.indexInLevel,
    };
    if (it.isExam) meta.isExam = true;
    return meta;
  });
}

const STAGE_METAS: readonly StageMeta[] = Array.from({ length: 10 }, (_, i) =>
  buildLevelMetas(i + 1),
).flat();

// Kept as a re-export for callers that imported the old StageWithMeta
// type; structurally identical to Stage now that indexInLevel/isExam +
// level/themeColor live on the base type / are added here.
export interface StageWithMeta extends Stage {
  level: number;
  themeColor: string;
}

export const STAGES: readonly StageWithMeta[] = STAGE_METAS.map((m) => {
  const stage: StageWithMeta = {
    id: m.id,
    name: m.name,
    description: m.description,
    bpm: m.bpm,
    level: m.level,
    themeColor: m.themeColor,
    indexInLevel: m.indexInLevel,
    // Offline fallback uses DEMO_STAGE's note pattern but overrides the
    // tempo with this Level's authored BPM so metronome and playhead
    // stay in sync. Real per-stage scores load from public/stages/.
    score: {
      ...DEMO_STAGE.score,
      tempos: [{ tick: 0, bpm: m.bpm }],
    },
  };
  if (m.isExam) stage.isExam = true;
  return stage;
});

export function getStageById(id: string): StageWithMeta | null {
  return STAGES.find((s) => s.id === id) ?? null;
}

export function getStageLevel(id: string): number | null {
  const meta = STAGE_METAS.find((m) => m.id === id);
  return meta?.level ?? null;
}
