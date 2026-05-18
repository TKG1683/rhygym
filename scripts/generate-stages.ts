/**
 * Stage build script: writes every stage in STAGE_DEFS as a
 * `score.mid` + `stage.json` pair under public/stages/<id>/, and
 * regenerates manifest.json so the loader picks them up.
 *
 * Run via `npm run gen:stages`.
 *
 * Right now this file only ships two demo stages so #36 can land
 * green — the real 60-stage roster goes in via #9.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { buildScore } from './dsl/buildScore';
import { eighth, eighthRest, h, q, qd, qr, sixteenth, w } from './dsl/notes';
import { scoreToMidi } from './dsl/scoreToMidi';

interface StageDef {
  id: string;
  level: number;
  name: string;
  description: string;
  bpm: number;
  themeColor: string;
  indexInLevel?: number;
  isExam?: boolean;
  score: ReturnType<typeof buildScore>;
}

const OUT_DIR = 'public/stages';

const STAGE_DEFS: readonly StageDef[] = [
  // --- Level 1: 四分・二分・全音符 ---------------------------------
  {
    id: 'level-1-1',
    level: 1,
    indexInLevel: 1,
    name: 'Level 1 — 1',
    description: '四分・二分・全音符の基本',
    bpm: 80,
    themeColor: '#9bd4a2',
    score: buildScore({ ts: [4, 4], bpm: 80 }, [
      q(), q(), q(), q(),
      h(), h(),
      q(), q(), h(),
      w(),
    ]),
  },
  {
    id: 'level-1-2',
    level: 1,
    indexInLevel: 2,
    name: 'Level 1 — 2',
    description: '全音符を挟む応用',
    bpm: 80,
    themeColor: '#9bd4a2',
    score: buildScore({ ts: [4, 4], bpm: 80 }, [
      h(), q(), q(),
      w(),
      q(), q(), q(), q(),
      h(), h(),
    ]),
  },
  // --- Level 2: + 四分休符 ----------------------------------------
  {
    id: 'level-2-1',
    level: 2,
    indexInLevel: 1,
    name: 'Level 2 — 1',
    description: '四分休符の導入',
    bpm: 90,
    themeColor: '#7cc8b3',
    score: buildScore({ ts: [4, 4], bpm: 90 }, [
      q(), qr(), q(), q(),
      h(), q(), qr(),
      q(), qr(), q(), q(),
      w(),
    ]),
  },
  {
    id: 'level-2-2',
    level: 2,
    indexInLevel: 2,
    name: 'Level 2 — 2',
    description: '休符をはさんで弾む',
    bpm: 90,
    themeColor: '#7cc8b3',
    score: buildScore({ ts: [4, 4], bpm: 90 }, [
      q(), q(), qr(), q(),
      qr(), q(), h(),
      q(), q(), q(), qr(),
      h(), h(),
    ]),
  },
  // --- Level 3: + 八分音符・八分休符 -------------------------------
  {
    id: 'level-3-1',
    level: 3,
    indexInLevel: 1,
    name: 'Level 3 — 1',
    description: '八分音符の導入',
    bpm: 95,
    themeColor: '#5fbbc4',
    score: buildScore({ ts: [4, 4], bpm: 95 }, [
      eighth(), eighth(), eighth(), eighth(), q(), q(),
      q(), eighth(), eighth(), h(),
      eighth(), eighth(), q(), eighth(), eighth(), q(),
      w(),
    ]),
  },
  {
    id: 'level-3-2',
    level: 3,
    indexInLevel: 2,
    name: 'Level 3 — 2',
    description: '八分休符の合いの手',
    bpm: 95,
    themeColor: '#5fbbc4',
    score: buildScore({ ts: [4, 4], bpm: 95 }, [
      eighth(), eighthRest(), eighth(), eighth(), q(), q(),
      q(), eighth(), eighthRest(), h(),
      q(), q(), eighth(), eighth(), q(),
      h(), h(),
    ]),
  },
  // --- Level 4: + 付点四分・付点八分・6/8 入門 ---------------------
  {
    id: 'level-4-1',
    level: 4,
    indexInLevel: 1,
    name: 'Level 4 — 1',
    description: '付点四分音符の導入',
    bpm: 100,
    themeColor: '#5ba8d9',
    score: buildScore({ ts: [4, 4], bpm: 100 }, [
      qd(), eighth(), q(), q(),
      qd(), eighth(), h(),
      q(), qd(), eighth(), q(),
      w(),
    ]),
  },
  {
    id: 'level-4-2',
    level: 4,
    indexInLevel: 2,
    name: 'Level 4 — 2',
    description: '十六分音符の予告編',
    bpm: 100,
    themeColor: '#5ba8d9',
    score: buildScore({ ts: [4, 4], bpm: 100 }, [
      q(), sixteenth(), sixteenth(), sixteenth(), sixteenth(), q(), q(),
      h(), q(), q(),
      sixteenth(), sixteenth(), sixteenth(), sixteenth(), q(), h(),
      w(),
    ]),
  },
];

function ensureDir(filepath: string): void {
  mkdirSync(dirname(filepath), { recursive: true });
}

function writeStage(stage: StageDef): void {
  const midi = scoreToMidi(stage.score);
  const midiPath = join(OUT_DIR, stage.id, 'score.mid');
  ensureDir(midiPath);
  writeFileSync(midiPath, Buffer.from(midi.toArray()));

  const { score: _score, ...meta } = stage;
  const jsonPath = join(OUT_DIR, stage.id, 'stage.json');
  writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
}

function writeManifest(stages: readonly StageDef[]): void {
  const manifest = {
    version: 1,
    stages: stages.map((s) => s.id),
  };
  const manifestPath = join(OUT_DIR, 'manifest.json');
  ensureDir(manifestPath);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function main(): void {
  for (const stage of STAGE_DEFS) {
    writeStage(stage);
    console.log(`  ✓ ${stage.id}`);
  }
  writeManifest(STAGE_DEFS);
  console.log(`Generated ${STAGE_DEFS.length} stage(s) in ${OUT_DIR}/`);
}

main();
