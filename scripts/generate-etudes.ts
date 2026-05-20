/**
 * Etude build script: writes every étude in ETUDE_DEFS as a
 * `score.mid` + `etude.json` pair under public/etudes/<id>/, and
 * regenerates manifest.json so the loader picks them up.
 *
 * Run via `npm run gen:etudes`.
 *
 * Roster: 10 Movements × 6 études (5 graded + 1 Final) = 60 études.
 * Each Movement introduces ONE new rhythmic concept on top of the
 * previous one. Within a Movement the five graded études climb in
 * density / syncopation / subdivision; the Final étude previews an
 * element from the next Movement so it feels like a bridge.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { buildScore } from './dsl/buildScore';
import {
  eighth,
  eighthDotted,
  eighthRest,
  eighthTriplet,
  fiveTuplet,
  h,
  hd,
  hr,
  q,
  qd,
  qr,
  quarterTriplet,
  septuplet,
  sixteenth,
  sixteenthDotted,
  sixteenthRest,
  sixteenthTriplet,
  sixTuplet,
  tie,
  tsChange,
  w,
} from './dsl/notes';
import { scoreToMidi } from './dsl/scoreToMidi';

interface EtudeDef {
  id: string;
  movement: number;
  name: string;
  description: string;
  bpm: number;
  themeColor: string;
  indexInMovement?: number;
  isFinal?: boolean;
  score: ReturnType<typeof buildScore>;
}

const OUT_DIR = 'public/etudes';

// Per-Movement theme color — same palette as src/core/score/etudes.ts
// so the authored études and the offline fallback agree on Movement
// coloring.
const COLOR = {
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
} as const;

const ETUDE_DEFS: readonly EtudeDef[] = [
  // ============================================================
  // Level 1 — quarter / half / whole notes (4/4)
  // ============================================================
  {
    id: 'movement-1-etude-1',
    movement: 1,
    indexInMovement: 1,
    name: 'Etude 1-1',
    description: '4分音符を歩く',
    bpm: 80,
    themeColor: COLOR[1],
    score: buildScore({ ts: [4, 4], bpm: 80 }, [
      q(), q(), q(), q(),
      q(), q(), q(), q(),
      h(), h(),
      w(),
      q(), q(), q(), q(),
      h(), h(),
      q(), q(), h(),
      w(),
    ]),
  },
  {
    id: 'movement-1-etude-2',
    movement: 1,
    indexInMovement: 2,
    name: 'Etude 1-2',
    description: '2分音符の伸びを感じる',
    bpm: 80,
    themeColor: COLOR[1],
    score: buildScore({ ts: [4, 4], bpm: 80 }, [
      h(), h(),
      q(), q(), h(),
      h(), q(), q(),
      w(),
      h(), h(),
      q(), q(), q(), q(),
      h(), h(),
      w(),
    ]),
  },
  {
    id: 'movement-1-etude-3',
    movement: 1,
    indexInMovement: 3,
    name: 'Etude 1-3',
    description: '全音符と2分音符の対話',
    bpm: 80,
    themeColor: COLOR[1],
    score: buildScore({ ts: [4, 4], bpm: 80 }, [
      w(),
      h(), h(),
      w(),
      q(), q(), h(),
      h(), q(), q(),
      w(),
      h(), q(), q(),
      w(),
    ]),
  },
  {
    id: 'movement-1-etude-4',
    movement: 1,
    indexInMovement: 4,
    name: 'Etude 1-4',
    description: '4分と2分のリレー',
    bpm: 80,
    themeColor: COLOR[1],
    score: buildScore({ ts: [4, 4], bpm: 80 }, [
      q(), q(), q(), q(),
      h(), q(), q(),
      q(), h(), q(),
      h(), h(),
      q(), q(), q(), q(),
      q(), h(), q(),
      h(), h(),
      w(),
    ]),
  },
  {
    id: 'movement-1-etude-5',
    movement: 1,
    indexInMovement: 5,
    name: 'Etude 1-5',
    description: '基本値の総まとめ',
    bpm: 80,
    themeColor: COLOR[1],
    score: buildScore({ ts: [4, 4], bpm: 80 }, [
      q(), q(), h(),
      h(), q(), q(),
      w(),
      q(), q(), q(), q(),
      h(), h(),
      q(), h(), q(),
      h(), q(), q(),
      w(),
    ]),
  },
  {
    id: 'movement-1-final',
    movement: 1,
    indexInMovement: 6,
    isFinal: true,
    name: 'Movement 1-Final',
    description: '次レベルへ向け、休符を一足先に',
    bpm: 80,
    themeColor: COLOR[1],
    // Bridge to Level 2: sneak in a quarter rest.
    score: buildScore({ ts: [4, 4], bpm: 80 }, [
      q(), q(), q(), q(),
      h(), h(),
      q(), qr(), q(), q(),
      w(),
      q(), q(), h(),
      h(), q(), qr(),
      q(), q(), q(), q(),
      w(),
    ]),
  },

  // ============================================================
  // Level 2 — + quarter rest, 3/4 waltz
  // ============================================================
  {
    id: 'movement-2-etude-1',
    movement: 2,
    indexInMovement: 1,
    name: 'Etude 2-1',
    description: '4分休符の間合い',
    bpm: 87,
    themeColor: COLOR[2],
    score: buildScore({ ts: [4, 4], bpm: 87 }, [
      q(), qr(), q(), q(),
      h(), q(), qr(),
      q(), qr(), q(), q(),
      w(),
      q(), q(), qr(), q(),
      h(), q(), qr(),
      q(), qr(), q(), q(),
      w(),
    ]),
  },
  {
    id: 'movement-2-etude-2',
    movement: 2,
    indexInMovement: 2,
    name: 'Etude 2-2',
    description: '休符でひと呼吸',
    bpm: 87,
    themeColor: COLOR[2],
    score: buildScore({ ts: [4, 4], bpm: 87 }, [
      q(), q(), qr(), q(),
      qr(), q(), h(),
      q(), q(), q(), qr(),
      h(), h(),
      q(), qr(), h(),
      q(), q(), q(), qr(),
      h(), q(), qr(),
      w(),
    ]),
  },
  {
    id: 'movement-2-etude-3',
    movement: 2,
    indexInMovement: 3,
    name: 'Etude 2-3',
    description: '3/4 ワルツに入門',
    bpm: 87,
    themeColor: COLOR[2],
    score: buildScore({ ts: [3, 4], bpm: 87 }, [
      q(), q(), q(),
      h(), q(),
      q(), q(), q(),
      hd(),
      q(), q(), q(),
      q(), h(),
      h(), q(),
      hd(),
    ]),
  },
  {
    id: 'movement-2-etude-4',
    movement: 2,
    indexInMovement: 4,
    name: 'Etude 2-4',
    description: '3/4 + 4分休符',
    bpm: 87,
    themeColor: COLOR[2],
    score: buildScore({ ts: [3, 4], bpm: 87 }, [
      q(), qr(), q(),
      h(), q(),
      q(), q(), qr(),
      hd(),
      qr(), q(), q(),
      q(), h(),
      h(), qr(),
      hd(),
    ]),
  },
  {
    id: 'movement-2-etude-5',
    movement: 2,
    indexInMovement: 5,
    name: 'Etude 2-5',
    description: '4/4 と 3/4 を弾むように',
    bpm: 87,
    themeColor: COLOR[2],
    score: buildScore({ ts: [3, 4], bpm: 87 }, [
      q(), q(), q(),
      qr(), h(),
      h(), q(),
      q(), qr(), q(),
      hd(),
      q(), q(), q(),
      h(), qr(),
      hd(),
    ]),
  },
  {
    id: 'movement-2-final',
    movement: 2,
    indexInMovement: 6,
    isFinal: true,
    name: 'Movement 2-Final',
    description: '次レベルへ向け、8分の予告',
    bpm: 87,
    themeColor: COLOR[2],
    // Bridge to Level 3: sneak in eighth notes.
    score: buildScore({ ts: [4, 4], bpm: 87 }, [
      q(), qr(), q(), q(),
      eighth(), eighth(), q(), h(),
      q(), q(), qr(), q(),
      w(),
      h(), eighth(), eighth(), q(),
      q(), qr(), eighth(), eighth(), q(),
      h(), q(), qr(),
      w(),
    ]),
  },

  // ============================================================
  // Level 3 — + eighth note / eighth rest
  // ============================================================
  {
    id: 'movement-3-etude-1',
    movement: 3,
    indexInMovement: 1,
    name: 'Etude 3-1',
    description: '8分音符を刻む',
    bpm: 90,
    themeColor: COLOR[3],
    score: buildScore({ ts: [4, 4], bpm: 90 }, [
      eighth(), eighth(), eighth(), eighth(), q(), q(),
      q(), eighth(), eighth(), h(),
      eighth(), eighth(), q(), eighth(), eighth(), q(),
      w(),
      eighth(), eighth(), eighth(), eighth(), eighth(), eighth(), q(),
      h(), eighth(), eighth(), q(),
      q(), q(), eighth(), eighth(), q(),
      w(),
    ]),
  },
  {
    id: 'movement-3-etude-2',
    movement: 3,
    indexInMovement: 2,
    name: 'Etude 3-2',
    description: '8分休符の合いの手',
    bpm: 90,
    themeColor: COLOR[3],
    score: buildScore({ ts: [4, 4], bpm: 90 }, [
      eighth(), eighthRest(), eighth(), eighth(), q(), q(),
      q(), eighth(), eighthRest(), h(),
      q(), q(), eighth(), eighth(), q(),
      h(), h(),
      eighth(), eighthRest(), eighth(), eighth(), q(), q(),
      eighth(), eighth(), eighthRest(), eighth(), h(),
      q(), eighth(), eighthRest(), q(), q(),
      w(),
    ]),
  },
  {
    id: 'movement-3-etude-3',
    movement: 3,
    indexInMovement: 3,
    name: 'Etude 3-3',
    description: '裏拍を踏みしめる',
    bpm: 90,
    themeColor: COLOR[3],
    score: buildScore({ ts: [4, 4], bpm: 90 }, [
      eighthRest(), eighth(), eighth(), eighth(), q(), q(),
      q(), eighthRest(), eighth(), h(),
      eighthRest(), eighth(), q(), eighth(), eighth(), q(),
      w(),
      q(), eighthRest(), eighth(), eighthRest(), eighth(), q(),
      h(), eighth(), eighth(), eighth(), eighth(),
      eighthRest(), eighth(), eighthRest(), eighth(), h(),
      w(),
    ]),
  },
  {
    id: 'movement-3-etude-4',
    movement: 3,
    indexInMovement: 4,
    name: 'Etude 3-4',
    description: '3/4 拍子で8分音符',
    bpm: 90,
    themeColor: COLOR[3],
    score: buildScore({ ts: [3, 4], bpm: 90 }, [
      q(), eighth(), eighth(), q(),
      eighth(), eighth(), q(), q(),
      eighth(), eighth(), eighth(), eighth(), q(),
      hd(),
      q(), eighth(), eighthRest(), q(),
      eighth(), eighth(), eighth(), eighth(), q(),
      q(), q(), eighth(), eighth(),
      hd(),
    ]),
  },
  {
    id: 'movement-3-etude-5',
    movement: 3,
    indexInMovement: 5,
    name: 'Etude 3-5',
    description: '8分の連続と休符の織り交ぜ',
    bpm: 90,
    themeColor: COLOR[3],
    score: buildScore({ ts: [4, 4], bpm: 90 }, [
      eighth(), eighth(), eighth(), eighth(), eighth(), eighth(), eighth(), eighth(),
      q(), eighth(), eighthRest(), q(), q(),
      eighthRest(), eighth(), eighth(), eighth(), h(),
      eighth(), eighth(), q(), eighth(), eighth(), q(),
      q(), eighthRest(), eighth(), eighthRest(), eighth(), q(),
      eighth(), eighth(), eighth(), eighth(), q(), q(),
      h(), q(), qr(),
      w(),
    ]),
  },
  {
    id: 'movement-3-final',
    movement: 3,
    indexInMovement: 6,
    isFinal: true,
    name: 'Movement 3-Final',
    description: '次レベルへ向け、付点4分の予告',
    bpm: 90,
    themeColor: COLOR[3],
    // Bridge to Level 4: introduce dotted quarter.
    score: buildScore({ ts: [4, 4], bpm: 90 }, [
      eighth(), eighth(), eighth(), eighth(), q(), q(),
      qd(), eighth(), h(),
      q(), eighthRest(), eighth(), eighth(), eighth(), q(),
      w(),
      qd(), eighth(), q(), q(),
      eighth(), eighth(), q(), qd(), eighth(),
      h(), eighth(), eighth(), q(),
      w(),
    ]),
  },

  // ============================================================
  // Level 4 — + dotted quarter / dotted eighth, 6/8 intro
  // ============================================================
  {
    id: 'movement-4-etude-1',
    movement: 4,
    indexInMovement: 1,
    name: 'Etude 4-1',
    description: '付点4分音符の躍動',
    bpm: 92,
    themeColor: COLOR[4],
    score: buildScore({ ts: [4, 4], bpm: 92 }, [
      qd(), eighth(), q(), q(),
      qd(), eighth(), h(),
      q(), qd(), eighth(), q(),
      w(),
      qd(), eighth(), qd(), eighth(),
      h(), qd(), eighth(),
      q(), q(), qd(), eighth(),
      w(),
    ]),
  },
  {
    id: 'movement-4-etude-2',
    movement: 4,
    indexInMovement: 2,
    name: 'Etude 4-2',
    description: '付点8分 + 16分のスキップ',
    bpm: 92,
    themeColor: COLOR[4],
    score: buildScore({ ts: [4, 4], bpm: 92 }, [
      eighthDotted(), sixteenth(), q(), q(), q(),
      eighthDotted(), sixteenth(), eighthDotted(), sixteenth(), h(),
      q(), eighthDotted(), sixteenth(), h(),
      w(),
      eighthDotted(), sixteenth(), eighth(), eighth(), q(), q(),
      qd(), eighth(), eighthDotted(), sixteenth(), q(),
      eighth(), eighth(), eighthDotted(), sixteenth(), h(),
      w(),
    ]),
  },
  {
    id: 'movement-4-etude-3',
    movement: 4,
    indexInMovement: 3,
    name: 'Etude 4-3',
    description: '6/8 拍子に入門',
    bpm: 61,
    themeColor: COLOR[4],
    score: buildScore({ ts: [6, 8], bpm: 61 }, [
      qd(), qd(),
      q(), eighth(), qd(),
      eighth(), eighth(), eighth(), qd(),
      qd(), eighth(), eighth(), eighth(),
      qd(), q(), eighth(),
      eighth(), eighth(), eighth(), eighth(), eighth(), eighth(),
      q(), eighth(), q(), eighth(),
      qd(), qd(),
    ]),
  },
  {
    id: 'movement-4-etude-4',
    movement: 4,
    indexInMovement: 4,
    name: 'Etude 4-4',
    description: '6/8 + 付点4分の流れ',
    bpm: 61,
    themeColor: COLOR[4],
    score: buildScore({ ts: [6, 8], bpm: 61 }, [
      qd(), qd(),
      eighth(), eighth(), eighth(), qd(),
      q(), eighth(), q(), eighth(),
      qd(), eighth(), eighthRest(), eighth(),
      eighth(), eighth(), eighth(), eighth(), eighth(), eighth(),
      qd(), q(), eighth(),
      q(), eighth(), eighth(), eighth(), eighth(),
      qd(), qd(),
    ]),
  },
  {
    id: 'movement-4-etude-5',
    movement: 4,
    indexInMovement: 5,
    name: 'Etude 4-5',
    description: '4/4 と付点の総合演習',
    bpm: 92,
    themeColor: COLOR[4],
    score: buildScore({ ts: [4, 4], bpm: 92 }, [
      qd(), eighth(), eighthDotted(), sixteenth(), q(),
      q(), qd(), eighth(), q(),
      eighthDotted(), sixteenth(), eighth(), eighth(), h(),
      qd(), eighth(), h(),
      q(), q(), eighthDotted(), sixteenth(), q(),
      qd(), eighth(), eighthDotted(), sixteenth(), q(),
      h(), qd(), eighth(),
      w(),
    ]),
  },
  {
    id: 'movement-4-final',
    movement: 4,
    indexInMovement: 6,
    isFinal: true,
    name: 'Movement 4-Final',
    description: '次レベルへ向け、16分音符の予告',
    bpm: 92,
    themeColor: COLOR[4],
    // Bridge to Level 5: heavier sixteenth-note usage.
    score: buildScore({ ts: [4, 4], bpm: 92 }, [
      qd(), eighth(), sixteenth(), sixteenth(), sixteenth(), sixteenth(), q(),
      eighthDotted(), sixteenth(), h(), q(),
      sixteenth(), sixteenth(), sixteenth(), sixteenth(), q(), h(),
      w(),
      q(), sixteenth(), sixteenth(), eighth(), q(), q(),
      eighth(), sixteenth(), sixteenth(), q(), h(),
      qd(), eighth(), h(),
      w(),
    ]),
  },

  // ============================================================
  // Level 5 — + sixteenths and sixteenth rest (4/4 + 6/8)
  // ============================================================
  {
    id: 'movement-5-etude-1',
    movement: 5,
    indexInMovement: 1,
    name: 'Etude 5-1',
    description: '16分音符を均等に',
    bpm: 98,
    themeColor: COLOR[5],
    score: buildScore({ ts: [4, 4], bpm: 98 }, [
      sixteenth(), sixteenth(), sixteenth(), sixteenth(), q(), q(), q(),
      q(), sixteenth(), sixteenth(), sixteenth(), sixteenth(), h(),
      sixteenth(), sixteenth(), sixteenth(), sixteenth(), sixteenth(), sixteenth(), sixteenth(), sixteenth(), h(),
      w(),
      q(), sixteenth(), sixteenth(), sixteenth(), sixteenth(), q(), q(),
      eighth(), sixteenth(), sixteenth(), eighth(), sixteenth(), sixteenth(), h(),
      sixteenth(), sixteenth(), eighth(), q(), h(),
      w(),
    ]),
  },
  {
    id: 'movement-5-etude-2',
    movement: 5,
    indexInMovement: 2,
    name: 'Etude 5-2',
    description: '16分休符でリズムを刻む',
    bpm: 98,
    themeColor: COLOR[5],
    score: buildScore({ ts: [4, 4], bpm: 98 }, [
      sixteenth(), sixteenthRest(), sixteenth(), sixteenth(), q(), h(),
      eighth(), sixteenth(), sixteenthRest(), q(), h(),
      sixteenthRest(), sixteenth(), sixteenth(), sixteenth(), q(), q(), q(),
      w(),
      sixteenth(), sixteenth(), sixteenthRest(), sixteenth(), q(), q(), q(),
      q(), sixteenthRest(), sixteenth(), eighth(), h(),
      eighthDotted(), sixteenth(), sixteenth(), sixteenthRest(), eighth(), q(), q(),
      w(),
    ]),
  },
  {
    id: 'movement-5-etude-3',
    movement: 5,
    indexInMovement: 3,
    name: 'Etude 5-3',
    description: '6/8 で16分を散りばめる',
    bpm: 65,
    themeColor: COLOR[5],
    score: buildScore({ ts: [6, 8], bpm: 65 }, [
      qd(), eighth(), sixteenth(), sixteenth(), eighth(),
      eighth(), sixteenth(), sixteenth(), eighth(), qd(),
      qd(), eighth(), eighth(), eighth(),
      sixteenth(), sixteenth(), eighth(), eighth(), qd(),
      eighth(), eighth(), sixteenth(), sixteenth(), qd(),
      qd(), eighth(), eighth(), sixteenth(), sixteenth(),
      sixteenth(), sixteenth(), eighth(), eighth(), q(), eighth(),
      qd(), qd(),
    ]),
  },
  {
    id: 'movement-5-etude-4',
    movement: 5,
    indexInMovement: 4,
    name: 'Etude 5-4',
    description: '裏裏のリズムを掴む',
    bpm: 98,
    themeColor: COLOR[5],
    score: buildScore({ ts: [4, 4], bpm: 98 }, [
      sixteenth(), sixteenthRest(), sixteenth(), sixteenthRest(), sixteenth(), sixteenthRest(), sixteenth(), sixteenthRest(), h(),
      eighthDotted(), sixteenth(), eighthDotted(), sixteenth(), h(),
      sixteenth(), sixteenth(), sixteenth(), sixteenth(), eighth(), eighth(), h(),
      w(),
      eighth(), sixteenth(), sixteenth(), eighth(), sixteenth(), sixteenth(), h(),
      q(), sixteenth(), sixteenthRest(), sixteenth(), sixteenth(), h(),
      sixteenthRest(), sixteenth(), eighth(), q(), h(),
      w(),
    ]),
  },
  {
    id: 'movement-5-etude-5',
    movement: 5,
    indexInMovement: 5,
    name: 'Etude 5-5',
    description: '16分の総合演習',
    bpm: 98,
    themeColor: COLOR[5],
    score: buildScore({ ts: [4, 4], bpm: 98 }, [
      sixteenth(), sixteenth(), sixteenth(), sixteenth(), eighthDotted(), sixteenth(), q(), q(),
      eighth(), sixteenth(), sixteenth(), q(), eighth(), sixteenth(), sixteenth(), q(),
      sixteenthRest(), sixteenth(), eighth(), q(), eighthDotted(), sixteenth(), q(),
      q(), sixteenth(), sixteenth(), sixteenth(), sixteenth(), q(), q(),
      h(), sixteenth(), sixteenth(), sixteenth(), sixteenth(), q(),
      eighth(), eighth(), sixteenth(), sixteenth(), eighth(), q(), q(),
      sixteenth(), sixteenth(), sixteenth(), sixteenth(), q(), h(),
      w(),
    ]),
  },
  {
    id: 'movement-5-final',
    movement: 5,
    indexInMovement: 6,
    isFinal: true,
    name: 'Movement 5-Final',
    description: '次レベルへ向け、シンコペーションの予告',
    bpm: 98,
    themeColor: COLOR[5],
    // Bridge to Level 6: early syncopation (eighth-quarter-eighth).
    score: buildScore({ ts: [4, 4], bpm: 98 }, [
      eighth(), q(), q(), q(), eighth(),
      sixteenth(), sixteenth(), eighth(), q(), eighth(), q(), eighth(),
      q(), eighth(), q(), eighth(), q(),
      w(),
      eighth(), qd(), q(), q(),
      eighth(), q(), eighth(), eighth(), q(), eighth(),
      sixteenth(), sixteenth(), eighth(), q(), h(),
      w(),
    ]),
  },

  // ============================================================
  // Level 6 — + syncopation, ties across barlines
  // ============================================================
  {
    id: 'movement-6-etude-1',
    movement: 6,
    indexInMovement: 1,
    name: 'Etude 6-1',
    description: 'シンコペーション入門',
    bpm: 103,
    themeColor: COLOR[6],
    score: buildScore({ ts: [4, 4], bpm: 103 }, [
      eighth(), q(), q(), q(), eighth(),
      q(), eighth(), q(), eighth(), q(),
      eighth(), q(), eighth(), eighth(), q(), eighth(),
      w(),
      eighth(), q(), eighth(), eighth(), q(), eighth(),
      q(), eighth(), q(), eighth(), q(),
      h(), eighth(), q(), eighth(),
      w(),
    ]),
  },
  {
    id: 'movement-6-etude-2',
    movement: 6,
    indexInMovement: 2,
    name: 'Etude 6-2',
    description: '小節を跨ぐタイ',
    bpm: 103,
    themeColor: COLOR[6],
    score: buildScore({ ts: [4, 4], bpm: 103 }, [
      // measure 1-2: half + dotted-half-tied-across-the-barline + half (3840 = 2 bars)
      h(), tie(q(), hd()), h(),
      q(), q(), h(),
      w(),
      // measure 5-6: half tied to half (sustained whole across the bar)
      h(), tie(h(), h()), h(),
      eighth(), eighth(), q(), h(),
      tie(q(), h()), q(),
      w(),
    ]),
  },
  {
    id: 'movement-6-etude-3',
    movement: 6,
    indexInMovement: 3,
    name: 'Etude 6-3',
    description: 'シンコペとタイの混合',
    bpm: 103,
    themeColor: COLOR[6],
    score: buildScore({ ts: [4, 4], bpm: 103 }, [
      eighth(), q(), q(), q(), eighth(),
      tie(eighth(), q()), eighth(), eighth(), q(), eighth(),
      q(), eighth(), eighth(), h(),
      w(),
      eighth(), q(), eighth(), eighth(), eighth(), q(),
      tie(q(), eighth()), eighth(), h(),
      q(), eighth(), eighth(), q(), q(),
      w(),
    ]),
  },
  {
    id: 'movement-6-etude-4',
    movement: 6,
    indexInMovement: 4,
    name: 'Etude 6-4',
    description: 'アンチシペーションで先取り',
    bpm: 103,
    themeColor: COLOR[6],
    score: buildScore({ ts: [4, 4], bpm: 103 }, [
      eighth(), q(), eighth(), eighth(), q(), eighth(),
      tie(eighth(), h()), eighth(), q(),
      q(), eighth(), q(), eighth(), q(),
      w(),
      eighth(), q(), q(), q(), eighth(),
      tie(eighth(), q()), tie(eighth(), q()), q(),
      eighth(), q(), eighth(), h(),
      w(),
    ]),
  },
  {
    id: 'movement-6-etude-5',
    movement: 6,
    indexInMovement: 5,
    name: 'Etude 6-5',
    description: '裏拍とタイで踊る',
    bpm: 103,
    themeColor: COLOR[6],
    score: buildScore({ ts: [4, 4], bpm: 103 }, [
      sixteenth(), sixteenth(), eighth(), q(), eighth(), q(), eighth(),
      tie(eighth(), q()), eighth(), eighth(), q(), eighth(),
      q(), tie(eighth(), q()), eighth(), q(),
      w(),
      eighth(), q(), eighth(), eighth(), eighth(), eighth(), eighth(),
      tie(q(), h()), q(),
      eighth(), q(), eighth(), q(), q(),
      w(),
    ]),
  },
  {
    id: 'movement-6-final',
    movement: 6,
    indexInMovement: 6,
    isFinal: true,
    name: 'Movement 6-Final',
    description: '次レベルへ向け、3連符の予告',
    bpm: 103,
    themeColor: COLOR[6],
    // Bridge to Level 7: introduce triplets.
    score: buildScore({ ts: [4, 4], bpm: 103 }, [
      eighthTriplet(), eighthTriplet(), eighthTriplet(), q(), h(),
      eighth(), q(), q(), q(), eighth(),
      eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), h(),
      w(),
      tie(q(), eighth()), eighth(), q(), q(),
      q(), eighthTriplet(), eighthTriplet(), eighthTriplet(), h(),
      eighth(), q(), eighth(), h(),
      w(),
    ]),
  },

  // ============================================================
  // Level 7 — + triplets, sextuplets, 9/8
  // ============================================================
  {
    id: 'movement-7-etude-1',
    movement: 7,
    indexInMovement: 1,
    name: 'Etude 7-1',
    description: '3連符を流暢に',
    bpm: 108,
    themeColor: COLOR[7],
    score: buildScore({ ts: [4, 4], bpm: 108 }, [
      eighthTriplet(), eighthTriplet(), eighthTriplet(), q(), h(),
      eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), h(),
      q(), eighthTriplet(), eighthTriplet(), eighthTriplet(), h(),
      w(),
      eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), q(), q(),
      h(), eighthTriplet(), eighthTriplet(), eighthTriplet(), q(),
      quarterTriplet(), quarterTriplet(), quarterTriplet(), h(),
      w(),
    ]),
  },
  {
    id: 'movement-7-etude-2',
    movement: 7,
    indexInMovement: 2,
    name: 'Etude 7-2',
    description: '4 連 vs 3 連の対比',
    bpm: 108,
    themeColor: COLOR[7],
    score: buildScore({ ts: [4, 4], bpm: 108 }, [
      sixteenth(), sixteenth(), sixteenth(), sixteenth(), eighthTriplet(), eighthTriplet(), eighthTriplet(), h(),
      eighthTriplet(), eighthTriplet(), eighthTriplet(), sixteenth(), sixteenth(), sixteenth(), sixteenth(), h(),
      q(), eighthTriplet(), eighthTriplet(), eighthTriplet(), q(), q(),
      w(),
      sixteenth(), sixteenth(), sixteenth(), sixteenth(), eighthTriplet(), eighthTriplet(), eighthTriplet(), q(), q(),
      quarterTriplet(), quarterTriplet(), quarterTriplet(), h(),
      eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), h(),
      w(),
    ]),
  },
  {
    id: 'movement-7-etude-3',
    movement: 7,
    indexInMovement: 3,
    name: 'Etude 7-3',
    description: '6連符の旋回',
    bpm: 108,
    themeColor: COLOR[7],
    score: buildScore({ ts: [4, 4], bpm: 108 }, [
      sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), q(), h(),
      q(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), h(),
      sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), q(), h(),
      w(),
      eighthTriplet(), eighthTriplet(), eighthTriplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), h(),
      q(), eighthTriplet(), eighthTriplet(), eighthTriplet(), h(),
      sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), q(), h(),
      w(),
    ]),
  },
  {
    id: 'movement-7-etude-4',
    movement: 7,
    indexInMovement: 4,
    name: 'Etude 7-4',
    description: '9/8 拍子に親しむ',
    bpm: 72,
    themeColor: COLOR[7],
    score: buildScore({ ts: [9, 8], bpm: 72 }, [
      qd(), qd(), qd(),
      eighth(), eighth(), eighth(), qd(), qd(),
      qd(), eighth(), eighth(), eighth(), eighth(), eighth(), eighth(),
      qd(), qd(), q(), eighth(),
      eighth(), eighth(), eighth(), eighth(), eighth(), eighth(), eighth(), eighth(), eighth(),
      qd(), q(), eighth(), qd(),
      q(), eighth(), qd(), eighth(), eighth(), eighth(),
      qd(), qd(), qd(),
    ]),
  },
  {
    id: 'movement-7-etude-5',
    movement: 7,
    indexInMovement: 5,
    name: 'Etude 7-5',
    description: '3連 + タイの華麗な技巧',
    bpm: 108,
    themeColor: COLOR[7],
    score: buildScore({ ts: [4, 4], bpm: 108 }, [
      eighthTriplet(), eighthTriplet(), eighthTriplet(), q(), q(), q(),
      tie(eighthTriplet(), quarterTriplet()), eighthTriplet(), eighthTriplet(), eighthTriplet(), h(),
      quarterTriplet(), quarterTriplet(), quarterTriplet(), h(),
      w(),
      eighth(), q(), eighth(), eighthTriplet(), eighthTriplet(), eighthTriplet(), q(),
      sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), q(), q(), q(),
      eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), h(),
      w(),
    ]),
  },
  {
    id: 'movement-7-final',
    movement: 7,
    indexInMovement: 6,
    isFinal: true,
    name: 'Movement 7-Final',
    description: '次レベルへ向け、5連符の予告',
    bpm: 108,
    themeColor: COLOR[7],
    // Bridge to Level 8: introduce quintuplets.
    score: buildScore({ ts: [4, 4], bpm: 108 }, [
      fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), q(), h(),
      eighthTriplet(), eighthTriplet(), eighthTriplet(), q(), h(),
      fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), h(),
      w(),
      q(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), h(),
      eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), h(),
      h(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), q(),
      w(),
    ]),
  },

  // ============================================================
  // Level 8 — + quintuplets, septuplets, 5/8, 7/8
  // ============================================================
  {
    id: 'movement-8-etude-1',
    movement: 8,
    indexInMovement: 1,
    name: 'Etude 8-1',
    description: '5連符を四拍の中に',
    bpm: 113,
    themeColor: COLOR[8],
    score: buildScore({ ts: [4, 4], bpm: 113 }, [
      fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), q(), h(),
      q(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), h(),
      fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), h(),
      w(),
      eighth(), eighth(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), h(),
      q(), q(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), q(),
      h(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), q(),
      w(),
    ]),
  },
  {
    id: 'movement-8-etude-2',
    movement: 8,
    indexInMovement: 2,
    name: 'Etude 8-2',
    description: '7連符の挑戦',
    bpm: 113,
    themeColor: COLOR[8],
    score: buildScore({ ts: [4, 4], bpm: 113 }, [
      ...septuplet(), q(), h(),
      q(), ...septuplet(), h(),
      ...septuplet(), ...septuplet(), h(),
      w(),
      eighth(), eighth(), ...septuplet(), h(),
      h(), ...septuplet(), q(),
      ...septuplet(), q(), h(),
      w(),
    ]),
  },
  {
    id: 'movement-8-etude-3',
    movement: 8,
    indexInMovement: 3,
    name: 'Etude 8-3',
    description: '5/8 拍子に飛び込む',
    bpm: 226,
    themeColor: COLOR[8],
    score: buildScore({ ts: [5, 8], bpm: 226 }, [
      q(), qd(),
      eighth(), eighth(), eighth(), q(),
      qd(), eighth(), eighth(),
      eighth(), eighth(), eighth(), eighth(), eighth(),
      q(), q(), eighth(),
      eighth(), eighth(), eighth(), q(),
      qd(), q(),
      q(), q(), eighthRest(),
    ]),
  },
  {
    id: 'movement-8-etude-4',
    movement: 8,
    indexInMovement: 4,
    name: 'Etude 8-4',
    description: '7/8 のうねり',
    bpm: 226,
    themeColor: COLOR[8],
    score: buildScore({ ts: [7, 8], bpm: 226 }, [
      qd(), q(), q(),
      q(), q(), qd(),
      eighth(), eighth(), eighth(), eighth(), eighth(), eighth(), eighth(),
      qd(), eighth(), eighth(), q(),
      q(), eighth(), eighth(), eighth(), eighth(), eighth(),
      qd(), q(), q(),
      eighth(), eighth(), qd(), q(),
      qd(), qd(), eighth(),
    ]),
  },
  {
    id: 'movement-8-etude-5',
    movement: 8,
    indexInMovement: 5,
    name: 'Etude 8-5',
    description: '異拍子の総合演習',
    bpm: 113,
    themeColor: COLOR[8],
    score: buildScore({ ts: [4, 4], bpm: 113 }, [
      fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), ...septuplet(), h(),
      eighthTriplet(), eighthTriplet(), eighthTriplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), h(),
      ...septuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), h(),
      w(),
      q(), ...septuplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), q(),
      fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), q(), h(),
      quarterTriplet(), quarterTriplet(), quarterTriplet(), h(),
      w(),
    ]),
  },
  {
    id: 'movement-8-final',
    movement: 8,
    indexInMovement: 6,
    isFinal: true,
    name: 'Movement 8-Final',
    description: '次レベルへ向け、5/4 拍子の予告',
    bpm: 113,
    themeColor: COLOR[8],
    // Bridge to Level 9: 5/4 irregular meter.
    score: buildScore({ ts: [5, 4], bpm: 113 }, [
      q(), q(), q(), q(), q(),
      h(), q(), h(),
      eighth(), eighth(), q(), eighth(), eighth(), q(), q(),
      q(), eighthTriplet(), eighthTriplet(), eighthTriplet(), h(), q(),
      h(), q(), q(), q(),
      fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), q(), q(), q(), q(),
      q(), q(), q(), h(),
      w(), q(),
    ]),
  },

  // ============================================================
  // Level 9 — + irregular meter (5/4, 7/8), hemiola, compound regroup
  // ============================================================
  {
    id: 'movement-9-etude-1',
    movement: 9,
    indexInMovement: 1,
    name: 'Etude 9-1',
    description: '5/4 拍子で歩を進める',
    bpm: 118,
    themeColor: COLOR[9],
    score: buildScore({ ts: [5, 4], bpm: 118 }, [
      q(), q(), q(), q(), q(),
      h(), q(), q(), q(),
      q(), h(), eighth(), eighth(), eighth(), eighth(),
      hd(), h(),
      eighth(), eighth(), q(), q(), q(), q(),
      q(), q(), h(), q(),
      h(), eighth(), eighth(), q(), q(),
      w(), q(),
    ]),
  },
  {
    id: 'movement-9-etude-2',
    movement: 9,
    indexInMovement: 2,
    name: 'Etude 9-2',
    description: '7/8 拍子の躍動',
    bpm: 236,
    themeColor: COLOR[9],
    score: buildScore({ ts: [7, 8], bpm: 236 }, [
      qd(), q(), q(),
      q(), qd(), q(),
      q(), q(), qd(),
      eighth(), eighth(), eighth(), eighth(), eighth(), eighth(), eighth(),
      qd(), eighth(), eighth(), eighth(), eighth(),
      eighth(), eighth(), qd(), eighth(), eighth(),
      eighth(), eighth(), eighth(), eighth(), qd(),
      qd(), q(), q(),
    ]),
  },
  {
    id: 'movement-9-etude-3',
    movement: 9,
    indexInMovement: 3,
    name: 'Etude 9-3',
    description: 'ヘミオラ — 3 を 2 に組替',
    bpm: 118,
    themeColor: COLOR[9],
    // 6/4 measures grouped as 3+3 vs 2+2+2 to evoke a hemiola feel.
    score: buildScore({ ts: [6, 4], bpm: 118 }, [
      qd(), qd(), qd(), qd(),
      q(), q(), q(), q(), q(), q(),
      qd(), qd(), q(), q(), q(),
      h(), h(), h(),
      qd(), q(), eighth(), qd(), q(), eighth(),
      q(), q(), q(), qd(), qd(),
      h(), q(), h(), q(),
      hd(), hd(),
    ]),
  },
  {
    id: 'movement-9-etude-4',
    movement: 9,
    indexInMovement: 4,
    name: 'Etude 9-4',
    description: '複合拍子の組替え (9/8 ⇄ 6/8)',
    bpm: 79,
    themeColor: COLOR[9],
    score: buildScore({ ts: [9, 8], bpm: 79 }, [
      qd(), qd(), qd(),
      eighth(), eighth(), eighth(), eighth(), eighth(), eighth(), eighth(), eighth(), eighth(),
      tsChange(6, 8),
      qd(), qd(),
      eighth(), eighth(), eighth(), qd(),
      tsChange(9, 8),
      qd(), q(), eighth(), qd(),
      eighth(), eighth(), eighth(), eighth(), eighth(), eighth(), eighth(), eighth(), eighth(),
      tsChange(6, 8),
      qd(), eighth(), eighth(), eighth(),
      qd(), qd(),
    ]),
  },
  {
    id: 'movement-9-etude-5',
    movement: 9,
    indexInMovement: 5,
    name: 'Etude 9-5',
    description: '変則拍子の総合演習',
    bpm: 118,
    themeColor: COLOR[9],
    score: buildScore({ ts: [5, 4], bpm: 118 }, [
      q(), q(), q(), h(),
      h(), q(), eighth(), eighth(), q(),
      eighthTriplet(), eighthTriplet(), eighthTriplet(), q(), q(), q(), q(),
      tsChange(7, 8),
      qd(), q(), q(),
      eighth(), eighth(), eighth(), qd(), eighth(),
      tsChange(5, 4),
      h(), q(), h(),
      q(), q(), eighth(), eighth(), q(), q(),
      w(), q(),
    ]),
  },
  {
    id: 'movement-9-final',
    movement: 9,
    indexInMovement: 6,
    isFinal: true,
    name: 'Movement 9-Final',
    description: '次レベルへ向け、拍子切替の予告',
    bpm: 118,
    themeColor: COLOR[9],
    // Bridge to Level 10: meter changes mid-piece.
    score: buildScore({ ts: [4, 4], bpm: 118 }, [
      q(), q(), eighth(), eighth(), q(),
      eighthTriplet(), eighthTriplet(), eighthTriplet(), h(), q(),
      tsChange(5, 8),
      qd(), q(),
      eighth(), eighth(), eighth(), eighth(), eighth(),
      tsChange(7, 8),
      qd(), q(), q(),
      eighth(), eighth(), eighth(), eighth(), qd(),
      tsChange(4, 4),
      q(), q(), q(), q(),
      w(),
    ]),
  },

  // ============================================================
  // Level 10 — mixed meter / meter-change / cross-rhythm
  // (NB: no mid-piece tempo changes — Rhygym is a sight-reading game,
  // not a falling-notes rhythm game, so the player can't react to a
  // tempo shift mid-run. BPM is fixed once the run starts.)
  // ============================================================
  {
    id: 'movement-10-etude-1',
    movement: 10,
    indexInMovement: 1,
    name: 'Etude 10-1',
    description: '拍子切替に慣れる',
    bpm: 126,
    themeColor: COLOR[10],
    score: buildScore({ ts: [4, 4], bpm: 126 }, [
      q(), q(), q(), q(),
      h(), eighth(), eighth(), eighth(), eighth(),
      tsChange(3, 4),
      q(), q(), q(),
      h(), q(),
      tsChange(4, 4),
      q(), eighth(), eighth(), q(), q(),
      eighthTriplet(), eighthTriplet(), eighthTriplet(), h(), q(),
      tsChange(6, 8),
      qd(), qd(),
      eighth(), eighth(), eighth(), qd(),
    ]),
  },
  {
    id: 'movement-10-etude-2',
    movement: 10,
    indexInMovement: 2,
    name: 'Etude 10-2',
    description: '4/4 ⇄ 6/8 の揺らぎ',
    bpm: 126,
    themeColor: COLOR[10],
    // Mid-piece meter shifts (4/4 ⇄ 6/8) — fixed tempo throughout
    // since the player can't target a tempo change in a sight-reading
    // game.
    score: buildScore({ ts: [4, 4], bpm: 126 }, [
      // 4/4 opening
      q(), q(), q(), q(),
      h(), q(), q(),
      // Drop into 6/8 — same pulse, different grouping.
      tsChange(6, 8),
      qd(), qd(),
      eighth(), eighth(), eighth(), qd(),
      eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), q(),
      // Snap back to 4/4.
      tsChange(4, 4),
      q(), eighth(), eighth(), q(), q(),
      sixteenth(), sixteenth(), sixteenth(), sixteenth(), q(), h(),
      // Close.
      hd(), q(),
      w(),
    ]),
  },
  {
    id: 'movement-10-etude-3',
    movement: 10,
    indexInMovement: 3,
    name: 'Etude 10-3',
    description: 'クロスリズムを拍子切替で揺さぶる',
    bpm: 126,
    themeColor: COLOR[10],
    // Cross-rhythm theme that also travels across a meter change:
    // quarter-triplet runs straddle the 4/4 → 3/4 → 4/4 shift so the
    // 3-against-2 feel keeps reorienting against a new bar length.
    score: buildScore({ ts: [4, 4], bpm: 126 }, [
      // 4/4: establish the 3-against-2 cross-rhythm.
      quarterTriplet(), quarterTriplet(), quarterTriplet(), h(),
      eighthTriplet(), eighthTriplet(), eighthTriplet(), eighth(), eighth(), h(),
      quarterTriplet(), quarterTriplet(), quarterTriplet(), q(), q(),
      // 3/4: triplets now span the whole bar — hemiola territory.
      tsChange(3, 4),
      quarterTriplet(), quarterTriplet(), quarterTriplet(), q(),
      eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), q(),
      // Back to 4/4 to land the cross-rhythm with sextuplets.
      tsChange(4, 4),
      h(), quarterTriplet(), quarterTriplet(), quarterTriplet(),
      sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), q(), h(),
      w(),
    ]),
  },
  {
    id: 'movement-10-etude-4',
    movement: 10,
    indexInMovement: 4,
    name: 'Etude 10-4',
    description: '混合拍子の連結',
    bpm: 252,
    themeColor: COLOR[10],
    score: buildScore({ ts: [5, 8], bpm: 252 }, [
      qd(), q(),
      eighth(), eighth(), eighth(), q(),
      tsChange(7, 8),
      qd(), q(), q(),
      eighth(), eighth(), qd(), q(),
      tsChange(3, 4),
      q(), q(), q(),
      eighth(), eighth(), eighth(), eighth(), q(),
      tsChange(6, 8),
      qd(), eighth(), eighth(), eighth(),
      eighth(), eighth(), eighth(), eighth(), eighth(), eighth(),
      tsChange(4, 4),
      q(), q(), eighth(), eighth(), q(),
      w(),
    ]),
  },
  {
    id: 'movement-10-etude-5',
    movement: 10,
    indexInMovement: 5,
    name: 'Etude 10-5',
    description: '拍子変化のグランドツアー',
    bpm: 126,
    themeColor: COLOR[10],
    // Meter-change grand finale: 4/4 → 5/8 → 7/8 → 3/4 → 6/8 → 4/4.
    // The journey starts on solid 4/4 ground, lurches into asymmetric
    // 5/8 and 7/8, breathes in a 3/4 waltz with a quarter-triplet
    // hemiola, swings into a 6/8 jig with sixteenth subdivisions, and
    // returns home to 4/4 for a quintuplet flourish and a tied cadence.
    score: buildScore({ ts: [4, 4], bpm: 126 }, [
      // 1. 4/4 — opening statement.
      eighthDotted(), sixteenth(), eighth(), eighth(), q(), q(),
      quarterTriplet(), quarterTriplet(), quarterTriplet(), tie(eighth(), q()), eighth(),
      // 2. 5/8 — asymmetric pulse (2+3 then 3+2).
      tsChange(5, 8),
      qd(), q(),
      eighth(), eighth(), eighth(), q(),
      // 3. 7/8 — extra eighth knocks the bar sideways.
      tsChange(7, 8),
      qd(), q(), q(),
      eighth(), eighth(), qd(), q(),
      // 4. 3/4 — waltz breather, then quarter-triplet hemiola.
      tsChange(3, 4),
      q(), q(), q(),
      quarterTriplet(), quarterTriplet(), quarterTriplet(), q(),
      // 5. 6/8 — compound jig with sixteenth subdivisions.
      tsChange(6, 8),
      qd(), eighth(), eighth(), eighth(),
      sixteenth(), sixteenth(), sixteenth(), sixteenth(), sixteenth(), sixteenth(), sixteenth(), sixteenth(), eighth(), eighth(),
      // 6. 4/4 — homecoming flourish, tied cadence.
      tsChange(4, 4),
      fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), h(), q(),
      tie(h(), q()), q(),
    ]),
  },
  {
    id: 'movement-10-final',
    movement: 10,
    indexInMovement: 6,
    isFinal: true,
    name: 'Movement 10-Final',
    description: '卒業試験 — Rhygym の最終形',
    bpm: 126,
    themeColor: COLOR[10],
    // Level 10 final: there's no Level 11 to preview, so this stage
    // pushes every Level-10 element to its limit — meter changes per
    // measure, cross-rhythms, ties across barlines, and every tuplet
    // family in rotation. Fixed tempo (no mid-piece tempo changes —
    // sight-reading game, not falling-notes).
    score: buildScore({ ts: [4, 4], bpm: 126 }, [
      // 1. statement in 4/4
      eighthDotted(), sixteenth(), eighth(), eighth(), q(), q(),
      quarterTriplet(), quarterTriplet(), quarterTriplet(), h(),
      // 2. into 5/8
      tsChange(5, 8),
      qd(), q(),
      eighth(), eighth(), eighth(), q(),
      // 3. into 7/8
      tsChange(7, 8),
      qd(), q(), q(),
      eighth(), eighth(), qd(), q(),
      // 4. tuplet workout in 4/4
      tsChange(4, 4),
      fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), fiveTuplet(), ...septuplet(), h(),
      sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), sixTuplet(), eighthTriplet(), eighthTriplet(), eighthTriplet(), q(), q(),
      // 5. cross-rhythm + tie into the close
      quarterTriplet(), quarterTriplet(), quarterTriplet(), tie(eighth(), q()), eighth(),
      sixteenth(), sixteenth(), sixteenth(), sixteenth(), eighth(), eighth(), q(), q(),
      // 6. final cadence — sustained
      tie(h(), h()), h(), q(), qr(),
    ]),
  },
];

function ensureDir(filepath: string): void {
  mkdirSync(dirname(filepath), { recursive: true });
}

function writeEtude(etude: EtudeDef): void {
  const midi = scoreToMidi(etude.score);
  const midiPath = join(OUT_DIR, etude.id, 'score.mid');
  ensureDir(midiPath);
  writeFileSync(midiPath, Buffer.from(midi.toArray()));

  const { score: _score, ...meta } = etude;
  const jsonPath = join(OUT_DIR, etude.id, 'etude.json');
  writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
}

function writeManifest(etudes: readonly EtudeDef[]): void {
  const manifest = {
    version: 1,
    etudes: etudes.map((e) => e.id),
  };
  const manifestPath = join(OUT_DIR, 'manifest.json');
  ensureDir(manifestPath);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function main(): void {
  for (const etude of ETUDE_DEFS) {
    writeEtude(etude);
    console.log(`  ✓ ${etude.id}`);
  }
  writeManifest(ETUDE_DEFS);
  console.log(`Generated ${ETUDE_DEFS.length} étude(s) in ${OUT_DIR}/`);
}

main();
