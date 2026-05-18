/**
 * Placeholder stage roster.
 *
 * The metadata (id, name, description, BPM, level) is what StageSelect
 * shows the player. The `score` field on every entry currently re-uses
 * DEMO_STAGE's score — real per-stage notation will land via the MIDI
 * loader in #9, at which point this file shrinks to just the metadata
 * list and the score is fetched from public/stages/.
 *
 * Levels run 1 (easiest) → 10 (hardest) — the level number IS the
 * difficulty.
 */

import type { Stage } from '../model';
import { DEMO_STAGE } from './demoStage';

interface StageMeta {
  id: string;
  name: string;
  description: string;
  bpm: number;
  /** Difficulty rank, 1 = easiest, 10 = hardest. Matches the level number. */
  level: number;
  /** Accent color used on the card. Difficulty rises → hue shifts warmer/darker. */
  themeColor: string;
}

// Curriculum is laid out so each level introduces one new rhythmic
// concept on top of the previous one. Levels 1–4 cover the
// fundamentals an absolute beginner can chew through; mid levels
// (5–7) introduce dotted values, ties, syncopation, and the 6/8
// compound feel; upper levels (8–10) push into irregular meters
// (5/4, 7/8), tuplets beyond triplets, hemiolas, and mixed-meter
// pieces that change time signature mid-phrase. Level 10 should feel
// like a conservatory-level rhythmic dictation challenge.
const STAGE_METAS: readonly StageMeta[] = [
  // --- Fundamentals --------------------------------------------------
  { id: 'level-1',  level:  1, name: 'Level 1',  bpm: 80,  description: '四分・二分・全音符 (4/4)',                          themeColor: '#9bd4a2' },
  { id: 'level-2',  level:  2, name: 'Level 2',  bpm: 90,  description: '+ 四分休符、3/4 ワルツ',                            themeColor: '#7cc8b3' },
  { id: 'level-3',  level:  3, name: 'Level 3',  bpm: 95,  description: '+ 八分音符・八分休符',                              themeColor: '#5fbbc4' },
  { id: 'level-4',  level:  4, name: 'Level 4',  bpm: 100, description: '+ 付点四分音符・付点八分音符、6/8 拍子入門',         themeColor: '#5ba8d9' },
  // --- Intermediate --------------------------------------------------
  { id: 'level-5',  level:  5, name: 'Level 5',  bpm: 110, description: '+ 十六分音符・十六分休符 (4/4・6/8)',                themeColor: '#7d8edf' },
  { id: 'level-6',  level:  6, name: 'Level 6',  bpm: 120, description: '+ シンコペーション、タイで小節を跨ぐ',              themeColor: '#a079d6' },
  { id: 'level-7',  level:  7, name: 'Level 7',  bpm: 130, description: '+ 三連符・六連符、9/8 拍子',                        themeColor: '#c46cbf' },
  // --- Advanced ------------------------------------------------------
  { id: 'level-8',  level:  8, name: 'Level 8',  bpm: 140, description: '+ 五連符・七連符、5/8・7/8 拍子',                    themeColor: '#d96098' },
  { id: 'level-9',  level:  9, name: 'Level 9',  bpm: 152, description: '+ 変則拍子 (5/4・7/8)、ヘミオラ、複合拍子の組替え', themeColor: '#e2785a' },
  { id: 'level-10', level: 10, name: 'Level 10', bpm: 168, description: '混合拍子・拍子切替・クロスリズム・テンポチェンジ',  themeColor: '#E8612E' },
];

export interface StageWithMeta extends Stage {
  level: number;
  themeColor: string;
}

export const STAGES: readonly StageWithMeta[] = STAGE_METAS.map((m) => ({
  id: m.id,
  name: m.name,
  description: m.description,
  bpm: m.bpm,
  level: m.level,
  themeColor: m.themeColor,
  // Re-use DEMO_STAGE's note pattern but override its tempo with this
  // level's authored BPM. Without this override, every stage played at
  // DEMO_STAGE's 100 BPM regardless of stage.bpm — the metronome ran at
  // stage.bpm while the scheduler / playhead ran at DEMO_STAGE's 100,
  // so the two were audibly out of sync on every level except Level 4
  // (which happens to be 100 BPM).
  // TODO(#9): replace with the real per-stage MIDI-loaded score.
  score: {
    ...DEMO_STAGE.score,
    tempos: [{ tick: 0, bpm: m.bpm }],
  },
}));

export function getStageById(id: string): StageWithMeta | null {
  return STAGES.find((s) => s.id === id) ?? null;
}

export function getStageLevel(id: string): number | null {
  const meta = STAGE_METAS.find((m) => m.id === id);
  return meta?.level ?? null;
}
