# Rhygym 実装計画書

> 本書は `overview.md` の概要を元に、ゼロから初版リリースまでを段階的に進めるための実装計画。
> リポジトリ作成 → 開発環境構築 → コア実装 → リリースまでをフェーズで区切る。
> 参考実装: `../mimic-groove`（VexFlow 描画・AudioContext スケジューラの設計を多く流用）。

---

## 0. 全体方針

### 0.1 技術選定（確定事項）

| 項目 | 採用技術 | 補足 |
|------|---------|------|
| 言語 | TypeScript 5.6+ | strict 有効、`noUncheckedIndexedAccess` も推奨 |
| フレームワーク | React 18 | 画面遷移とメニュー系の状態管理 |
| ビルド | Vite 5 | 開発サーバ・本番ビルド・GitHub Pages 用 base path 対応 |
| 楽譜描画 | VexFlow 5.0 | `mimic-groove` の `scoreToVex.ts` パターンを流用 |
| 状態管理 | Zustand 4 | 軽量・imperative subscribe 可（リズム判定で React 再描画を回避するため必須） |
| 音声 | Web Audio API（生） | メトロノーム・カウントイン・効果音はすべて `AudioContext` ベース |
| テスト | Vitest | 純粋ロジック（判定・tick変換）中心 |
| 保存 | `localStorage` | 自己ベストのみ |
| ホスティング | GitHub Pages（`gh-pages` ブランチ or Actions） | 静的のみ |
| CI/CD | GitHub Actions | `main` 更新で typecheck → test → build → Pages デプロイ |

### 0.2 設計の核となる方針

`mimic-groove` の知見から、Rhygym の実装は以下を踏襲する：

1. **時間軸は tick 基準（PPQ=480）**
   - すべての音符・判定・描画を tick で持ち、`TickTimeConverter` で sec に変換
   - BPM 変更・拍子変更にも将来的に対応しやすい
2. **AudioContext のサンプル粒度でスケジュール**
   - `setInterval`（25ms 周期）+ 100ms 先読みで「次の音」を `audioTime` 指定で予約
   - メトロノームは Oscillator（downbeat=1000Hz, offbeat=800Hz）
3. **判定とアニメーションは React の描画サイクルから分離**
   - ゲームループは `requestAnimationFrame`、判定は `AudioContext.currentTime`
   - Zustand で状態を持ち、React は「UI のメニュー周り」だけ再描画
4. **視覚プレイヘッドは音より少し先行（~60ms）**
   - スピーカー→耳と画面表示の遅延を吸収するための固定リード

### 0.3 スコープの線引き（再確認）

初版に**含める**：
- タイトル / 級選択 / ゲーム / リザルトの 4 画面
- 級別ステージ（最低 5 級程度）
- VexFlow による楽譜表示
- タップ判定（PERFECT / GOOD / MISS）
- メトロノーム + カウントイン
- localStorage 自己ベスト
- スマホブラウザ対応（タッチ操作・縦画面）

初版に**含めない**：
- オンラインランキング / アカウント
- 譜面エディタ
- マイク入力判定
- 楽曲音源との同期

---

## 1. フェーズ構成

```
Phase 1: リポジトリ・開発環境構築           （半日〜1日）
Phase 2: プロジェクト初期化・骨組み         （1日）
Phase 3: 譜面データモデル + VexFlow 描画    （2〜3日）
Phase 4: タイミング基盤（時間軸 + スケジューラ）（2日）
Phase 5: ゲームループ + タップ判定           （2〜3日）
Phase 6: 4画面の UI 実装                     （2〜3日）
Phase 7: 譜面コンテンツ作成（級別ステージ）   （2日）
Phase 8: localStorage / リザルト / ランク     （1日）
Phase 9: モバイル最適化 + 仕上げ              （1〜2日）
Phase 10: GitHub Pages デプロイ              （半日）
```

総工数目安: 約 2〜3 週間（個人開発ペース）。

---

## Phase 1: リポジトリ・開発環境構築

### 1.1 GitHub リポジトリ作成

- リポジトリ名: `rhygym`（小文字推奨：GitHub Pages の URL を `https://<user>.github.io/rhygym/` にする）
- Public / MIT License 推奨（`overview.md` にライセンス記載がないので確認用に AskUser 想定だが、デフォルトは MIT）
- `.gitignore` は Node テンプレート + `dist/`

### 1.2 ローカル初期化

```bash
# このディレクトリ (C:\Users\azuca\Documents\repo\Rhygym) で実行
git init
git branch -M main
git remote add origin git@github.com:<user>/rhygym.git
```

`overview.md` と `plan.md` を初回コミットに含める。

### 1.3 開発ツール前提

| ツール | バージョン |
|--------|-----------|
| Node.js | v20+ |
| npm | v10+ |

---

## Phase 2: プロジェクト初期化・骨組み

### 2.1 Vite + React + TS のスキャフォールド

```bash
npm create vite@latest . -- --template react-ts
npm install
npm install vexflow@^5.0.0 zustand@^4.5.5
npm install -D vitest @types/node
```

### 2.2 ディレクトリ構成（目標形）

```
src/
├── main.tsx
├── App.tsx
├── core/                 # 純粋ロジック（React 非依存）
│   ├── model/
│   │   ├── types.ts         # Note, Score, Stage, JudgeResult 等
│   │   └── constants.ts     # PPQ=480, 音価 tick 定義
│   ├── timing/
│   │   └── tickTime.ts      # TickTimeConverter（mimic-groove 流用）
│   ├── score/
│   │   ├── stages.ts        # 級別ステージ定義
│   │   └── scoreBuilder.ts  # 譜面組み立てヘルパ
│   ├── audio/
│   │   ├── metronome.ts     # メトロノーム生成
│   │   ├── countIn.ts       # カウントイン
│   │   └── scheduler.ts     # 先読みスケジューラ
│   ├── judgement/
│   │   ├── timing.ts        # タップ→判定変換
│   │   └── score.ts         # スコア・ランク集計
│   └── storage/
│       └── localStore.ts    # ベストスコア永続化
├── ui/
│   ├── vexflow/
│   │   ├── scoreToVex.ts    # Score → VexFlow IR
│   │   └── ScoreRenderer.ts # 命令的描画（React コンポーネントの中で使う）
│   ├── game/
│   │   ├── GameView.tsx     # 楽譜 + 判定ライン + タップ受け
│   │   ├── JudgementLayer.tsx  # PERFECT/GOOD/MISS 表示
│   │   └── gameLoop.ts      # RAF ループ
│   ├── screens/
│   │   ├── TitleScreen.tsx
│   │   ├── StageSelectScreen.tsx
│   │   ├── GameScreen.tsx
│   │   └── ResultScreen.tsx
│   └── store/
│       └── appStore.ts      # 画面遷移・選択中の級など
├── styles/
│   └── global.css
└── assets/
```

### 2.3 設定ファイル

- **`vite.config.ts`**:
  - `base: '/rhygym/'`（GitHub Pages 用。ローカル開発でも問題ない）
  - Vitest 設定（`test.environment: 'jsdom'`）
- **`tsconfig.json`**: strict、`noUncheckedIndexedAccess: true`
- **`package.json` scripts**:
  ```json
  {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc -b --noEmit"
  }
  ```

### 2.4 「Hello Rhygym」確認

- `App.tsx` に画面 4 種の placeholder と Zustand による画面遷移だけ実装
- `npm run dev` で `http://localhost:5173/rhygym/` が開けること

---

## Phase 3: 譜面データモデル + VexFlow 描画

### 3.1 データモデル定義（`core/model/types.ts`）

```ts
export const PPQ = 480;

// 拍子・テンポイベント
export interface TempoEvent { tick: number; bpm: number; }
export interface TimeSignatureEvent { tick: number; numerator: number; denominator: number; }

// リズムノート（音高は持たない。叩くタイミングだけ）
export interface RhythmNote {
  id: string;
  tick: number;       // 開始位置
  durationTicks: number;  // 音価
  isRest: boolean;    // 休符か否か
}

export interface Score {
  tempos: TempoEvent[];        // [{tick:0, bpm:120}]
  timeSigs: TimeSignatureEvent[]; // [{tick:0, num:4, den:4}]
  notes: RhythmNote[];         // 全ノート（休符含む）
  totalTicks: number;
}

// 級
export interface Stage {
  id: string;          // "kyu-10", "kyu-1" 等
  name: string;        // 表示用
  description: string;
  bpm: number;
  score: Score;
}
```

### 3.2 音価定数（`core/model/constants.ts`）

`mimic-groove/src/core/notes/musicalDurationTicks.ts` を参考に：

```ts
export const WHOLE_NOTE_TICKS    = PPQ * 4;  // 1920
export const HALF_NOTE_TICKS     = PPQ * 2;  // 960
export const QUARTER_NOTE_TICKS  = PPQ;      // 480
export const EIGHTH_NOTE_TICKS   = PPQ / 2;  // 240
export const SIXTEENTH_NOTE_TICKS = PPQ / 4; // 120
// dotted, triplet も同様
```

### 3.3 `TickTimeConverter`（`core/timing/tickTime.ts`）

`mimic-groove` の同名クラスを**ほぼそのまま流用**（テンポセグメントから tick↔sec を二分探索）。

### 3.4 VexFlow 描画レイヤ

#### 設計方針

- **譜面は完全に静的描画**（VexFlow で一度描いたら触らない）
- **譜表の選択（確定）**：**1線譜（パーカッション譜）** を採用
  - リズム譜にはピッチ情報が無いため、楽典的に最も正しい表記
  - 実装: 5線譜のまま `setConfigForLines` で中央線のみ可視化（VexFlow の位置計算・barline高さが自然に効く）
  - ノートの `keys` は `['b/4']` で中央線上に配置
  - 「リズムに集中」感が強く、Rhygym のコンセプトに合致
- **動くプレイヘッド（判定線）は採用しない**（読譜特訓のため、視覚補助なし）
  - 練習者は「メトロノーム音」と「譜面」だけを頼りにタップする
  - これにより読譜力が本当に鍛えられる（プレイヘッドありだと「線を見て叩く」になる）
  - 将来拡張: 難易度設定で「BEGINNER モード = プレイヘッドあり」を選べるようにする（Phase 12 参照）

#### 実装

- `scoreToVex.ts`: `Score` → `VexNoteEvent[]` への変換（`mimic-groove` を参考に簡略化版を作る）
  - 同 tick 同 voice はまとめる必要は無い（リズム譜は単声）
  - `decomposeTicks()`（tick を音価へ分解）は流用
- `ScoreRenderer.ts`: `Stave`, `StaveNote`, `Voice`, `Formatter`, `Beam` を使って SVG 描画
  - 小節幅は固定、折り返しは横幅から計算
  - 描画完了後に「各ノートの SVG 上の x 座標」をマップで返す（将来のプレイヘッドモード追加時に再利用）

### 3.5 検証

- ハードコードした `Score`（4分音符4つ）を画面に出して目視確認

---

## Phase 4: タイミング基盤（時間軸 + スケジューラ）

### 4.1 オーディオスケジューラ（`core/audio/scheduler.ts`）

`mimic-groove/src/audio/scheduler.ts` の **メトロノーム部分のみ抜粋した軽量版**を作る。

主要パラメータ：

```ts
const SCHEDULER_LOOK_AHEAD_SEC = 0.1;       // 100ms 先まで予約
const SCHEDULER_TICK_INTERVAL_MS = 25;      // 25ms ごとに schedule() 呼出
const VISUAL_PLAYHEAD_LEAD_SEC = 0.06;      // 視覚プレイヘッド先行
```

公開 API:

```ts
class GameScheduler {
  constructor(score: Score, opts: { onTick(tick: number): void });
  async play(fromTick?: number): Promise<void>;
  stop(): void;
  get currentTick(): number;  // 視覚プレイヘッド先行込み
  get audioCurrentTick(): number; // 判定用（先行なし）
  setMetronome(enabled: boolean, volume?: number): void;
}
```

### 4.2 メトロノーム（`core/audio/metronome.ts`）

- Oscillator + Gain envelope（50ms クリック）
- downbeat 1000Hz / offbeat 800Hz
- 拍子に応じて 1 拍目を強調

### 4.3 メトロノーム継続再生 + Tap to Start方式（カウントイン代わり）

洗足オンラインスクール式のゲーム開始フローを採用：

1. GameScreen 入った瞬間からメトロノームを**ずっと鳴らす**（譜面のBPMで）
2. 譜面は最初から見える、プレイヤーは自由な時間を取ってリズムを掴める
3. 「♪ Tap to start」ボタンが表示される
4. プレイヤーが「準備OK」と思った瞬間にタップ
5. そのタップ瞬間を**1拍目として演奏開始**
6. 以降のメトロノームはそのまま継続（テンポ同じなので段差なし）
7. 表示が「♪ Playing...」に変わり、以降のタップは判定対象

`countIn.ts` は使わず、`scheduler.play(fromTick=0)` をプレイヤータップ時に呼ぶシンプル構成にする。
（`countIn.ts` 自体は将来の難易度設定 BEGINNER モード等で再利用可能性あり）

### 4.4 テスト

- `TickTimeConverter` の往復変換テスト
- スケジューラは E2E では検証しづらいので、メトロノーム発火タイミングを `audioTime` ベースで unit test
  - `AudioContext` をモック（`fake-indexeddb` のように小規模なスタブ）

---

## Phase 5: ゲームループ + タップ判定

### 5.1 ゲーム状態

3つのフェーズで動作：

| state | 表示 | メトロノーム | タップの扱い |
|-------|------|------------|------------|
| `waiting` | 譜面 + 「♪ Tap to start」 | ずっと鳴る | 1回目で `playing` 遷移 |
| `playing` | 譜面 + 「♪ Playing...」 | 鳴り続ける | `judgeTap()` 対象 |
| `done` | （自動で Result 画面へ遷移） | 停止 | – |

### 5.2 タップ受け

- ゲーム画面全体を巨大なタップターゲットに（スマホ：画面下半分など）
- `pointerdown` イベントで `AudioContext.currentTime` を即記録
- React の合成イベントだとレイテンシが乗るため、ref + `addEventListener` で生の DOM に張る
- `waiting` 状態の最初のタップ → `scheduler.play(0)` 呼出 + 状態を `playing` に遷移
- `playing` 状態のタップ → `judgeTap(tapSec, candidates)` に投入

### 5.3 判定アルゴリズム（`core/judgement/timing.ts`）

```ts
export type Judgement = 'PERFECT' | 'GOOD' | 'MISS';

const PERFECT_WINDOW_MS = 50;  // ±50ms
const GOOD_WINDOW_MS = 120;    // ±120ms

export function judgeTap(
  tapAudioTime: number,
  candidateNotes: RhythmNote[],
  converter: TickTimeConverter,
): { note: RhythmNote; judgement: Judgement } | null {
  // 直近の未判定ノートとの差分でジャッジ
  // 休符はタップ対象から除外
}
```

- 「タップしなかった」MISS は、ノート時刻 + GOOD_WINDOW を過ぎても未判定なら自動で MISS にする
- 1 タップ = 1 ノート消費（先頭から）

### 5.4 ゲームループ（`ui/game/gameLoop.ts`）

```ts
function loop() {
  const audioTick = scheduler.audioCurrentTick;
  // 未判定で過去になったノートを MISS に
  expireUnjudgedNotes(audioTick);
  requestAnimationFrame(loop);
}
```

プレイヘッドが無いので、ループの責務は「未タップノートの自動MISS化」だけ。

### 5.5 判定エフェクト

- **画面中央に固定表示**で「PERFECT」「GOOD」「MISS」テキストを 300ms 程度 fade-out
- 色: PERFECT=金 (#FFD24A 系)、GOOD=青、MISS=赤
- 譜面上には何も描画しない（読譜特訓の純度を保つ）

---

## Phase 6: 4画面の UI 実装

### 6.1 画面遷移ステート（`ui/store/appStore.ts`）

```ts
type Screen = 'title' | 'select' | 'game' | 'result';
interface AppState {
  screen: Screen;
  selectedStageId: string | null;
  lastResult: GameResult | null;
  goto(screen: Screen): void;
}
```

### 6.2 各画面

| 画面 | 主な要素 |
|------|---------|
| Title | ロゴ、「Start」ボタン |
| StageSelect | 級リスト（カード形式、自己ベスト・ランク表示） |
| Game | カウントイン → 楽譜描画 + 判定線 + タップ領域 + リアルタイムスコア |
| Result | ランク（S/A/B/C/D）、スコア、PERFECT/GOOD/MISS 内訳、「もう一度」「級選択へ」 |

### 6.3 スタイル

- CSS は素の CSS + CSS Modules（軽量重視）
- レスポンシブ: モバイル縦画面ベース（幅 360px〜）、PC は中央寄せ
- フォント: システムフォント（ロード時間ゼロ重視）

---

## Phase 7: 譜面コンテンツ作成（級別ステージ）

### 7.1 カリキュラム構成

10段階構成 (Level 1=易 → Level 10=難)。最新の確定版は `src/core/score/stages.ts` を参照。
ざっくり：

- Level 1–4: 基礎（四分・二分・全音符、休符、八分、付点、6/8拍子入門）
- Level 5–7: 中級（十六分、シンコペーション、タイで小節跨ぎ、三連符、9/8）
- Level 8–10: 上級（五連符・七連符、5/4・7/8 などの変則拍子、ヘミオラ、混合拍子・拍子切替・テンポチェンジ）

Level 10 はソルフェージュ系の上級ディクテーション相当の負荷感を目安にする。

### 7.2 譜面の持ち方（MIDI + JSON 方式）

**配置:**
```
public/stages/
├── manifest.json                # ["level-1", "level-2", ...]
├── level-1/
│   ├── stage.json               # { id, name, description, bpm, level, themeColor }
│   └── score.mid                # 譜面MIDI
...
```

- 譜面は **MIDI** で持つ — 業界標準フォーマット、将来 MuseScore 等で手書きしたものも投入可
- メタデータは **JSON** — 級番号・説明・BPM・テーマカラー等
- マニフェストで全 stage を列挙、アプリは fetch + 非同期ロード

**生成（初版）:** TS スクリプトで MIDI 出力する方針。
- `scripts/generate-stages.ts` で 各 stage の譜面パターンを TS DSL で記述
- `@tonejs/midi` で `.mid` バイナリを書き出し
- `npm run gen:stages` でまとめて `public/stages/` 配下に生成
- TS DSL ↔ MIDI なので、変更履歴は git で追える + バージョン管理しやすい

**読込:** アプリ起動時に manifest fetch → 各 stage.json + score.mid をロード → `Score` 型へ変換。

```ts
// 想定 API（実装は別Issue）
const stages = await loadAllStages();
// stages: StageWithMeta[]
```

将来 MuseScore で手書きした `.mid` を `public/stages/<id>/` に置けば、TS DSL なしで譜面追加できる。

### 7.3 検証

- 全 Level を一度はプレイして「クリア可能か / 適切な難度か」を確認
- BPM スライダーを 0.5x で試して、各 Level の読譜難度感が出ているか確認

### 7.4 関連 Issue

- 譜面ロード基盤（MIDIパーサ + stage loader）と譜面ジェネレータは独立 Issue で着手
- 初版の 10 Level 譜面コンテンツが #9 のスコープ
- 譜面生成 subagent (#34) は譜面追加が頻繁になるフェーズで後着手

---

## Phase 8: localStorage / リザルト / ランク

### 8.1 ランク算出

```ts
// 正確率（PERFECT=1.0, GOOD=0.5, MISS=0）×総ノート数 で score
const rate = (perfect + good * 0.5) / total;
const rank =
  rate >= 0.95 ? 'S' :
  rate >= 0.85 ? 'A' :
  rate >= 0.70 ? 'B' :
  rate >= 0.50 ? 'C' : 'D';
```

### 8.2 永続化（`core/storage/localStore.ts`）

```ts
interface BestRecord {
  stageId: string;
  score: number;
  rank: Rank;
  achievedAt: string; // ISO
}
```

- キー: `rhygym:best:v1`
- 値: `Record<stageId, BestRecord>`
- 例外時は黙って空オブジェクトを返す（localStorage 不可環境のため）

### 8.3 リザルト画面

- ランク・スコア・判定内訳
- 自己ベスト更新時は「NEW BEST!」表示
- 「もう一度」「級選択へ」ボタン

---

## Phase 9: モバイル最適化 + 仕上げ

### 9.1 モバイル対応

- `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">`
- `touch-action: manipulation` でダブルタップズーム抑制
- iOS Safari: `AudioContext` はユーザー操作後でないと開始できないので Title 画面の「Start」タップで初期化
- 画面の向き: 縦固定推奨（CSS で警告）

### 9.2 オーディオ初期化のタイミング

- アプリ起動時には作らない
- 初回タップ（Title の Start ボタン）で `new AudioContext()`
- メトロノーム音などはこの時点で事前ロード

### 9.3 パフォーマンス

- VexFlow 描画は重いので、ステージ開始時に **一度だけ**描く
- 判定線レイヤと判定エフェクトレイヤは別 SVG／Canvas で軽く保つ
- React の再描画は「画面遷移時」「スコア更新時」だけに留める（タップ毎の再描画は避ける）

### 9.4 アクセシビリティ

- ボタンに `aria-label`
- 色だけに依存しない判定表示（テキスト併記）

---

## Phase 10: GitHub Pages デプロイ

### 10.1 GitHub Actions（`.github/workflows/deploy.yml`）

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment
```

### 10.2 リポジトリ設定

- Settings → Pages → Build and deployment → Source: **GitHub Actions**
- `vite.config.ts` の `base: '/rhygym/'` を再確認

### 10.3 動作確認

- `https://<user>.github.io/rhygym/` で初版が動くこと
- スマホ実機で iOS Safari / Android Chrome 両方確認

---

## 11. リスクと対策

| リスク | 対策 |
|--------|------|
| iOS Safari の `AudioContext` 起動制約 | Title 画面の Start ボタンで明示的に `resume()` |
| `setInterval` のジッタによるメトロノームのズレ | mimic-groove 流の look-ahead スケジューリングで吸収 |
| タップイベントの遅延（React 合成イベント経由） | 生の `pointerdown` を ref で受ける |
| VexFlow バンドルサイズ（~300KB+） | 初版は許容、後で必要なら code-split |
| スマホ画面の幅で譜面が読みづらい | 小節幅・五線サイズ・折り返し計算を実機で詰める |
| 視覚と音のズレ（端末依存） | `VISUAL_PLAYHEAD_LEAD_SEC` を Settings で調整可能にする（後日） |

---

## 12. 将来拡張（初版以降）

`overview.md` 9 章にある通り：

- Firebase 等を併用したオンラインランキング
- 譜面の JSON 外部化 + エディタ
- 「タン・タタ」音節表記併記
- 左右レーン制
- 楽曲音源との同期演奏

### 追加（設計判断由来）

- **難易度設定（BEGINNER / NORMAL）**: BEGINNER モードで「動くプレイヘッド」を譜面上に重ねて表示する。初心者向けの視覚補助。NORMAL は本来の特訓モード（プレイヘッドなし）。
  - `ScoreRenderer` が返す `noteCoords` map をそのまま使えるので実装コストは低い
  - 級ごとに「推奨難易度」を設定可能

---

## 13. 直近のアクション（このフェーズで最初にやること）

1. **このプランをユーザーが承認**
2. リポジトリ名 / ライセンス / ユーザー名（GitHub Pages URL）を確定
3. Phase 1（リポジトリ作成）に進む
