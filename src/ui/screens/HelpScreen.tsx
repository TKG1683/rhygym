/**
 * HelpScreen — first-run tutorial / persistent reference for Rhygym's
 * playing model (issue #26).
 *
 * Content focuses on the bits players consistently get wrong without
 * being told:
 *   - 1 note = 1 tap. Long notes are NOT long-press; the whole game is
 *     onset-only.
 *   - The conductor's baton + beat count tell you WHEN to tap on the
 *     downbeat to start a piece — there's no "any time" tap-to-start
 *     fallback any more (issue #81).
 *   - The beat count vanishes once playback starts, so reading the
 *     staff is the only way to know which beat you're on.
 *
 * Layout is a scrollable column of small sections; each section opens
 * with a coloured chip-style heading so the page reads as a list of
 * topics on mobile rather than a wall of text.
 */

import { useAppStore } from '../store/appStore';

export function HelpScreen() {
  const goto = useAppStore((s) => s.goto);
  const back = () => goto('title');

  return (
    <main className="screen screen-help">
      <header className="help-header">
        <button type="button" className="secondary help-back" onClick={back}>
          ← 戻る
        </button>
        <h1 className="help-title">遊び方</h1>
      </header>

      <div className="help-content">
        <section className="help-section">
          <h2 className="help-section-title">🎵 基本ルール</h2>
          <p>
            画面下半分のタップゾーンを <strong>音符のタイミングで叩く</strong> ゲーム。
            譜面を読んで、流れてくるクリック音に合わせて指を落とす。
          </p>
          <div className="help-callout help-callout-warn">
            <strong>1 ノート = 1 タップ。</strong> 二分音符や全音符も「長押し」 ではなく、
            <strong>音符の頭で 1 回ポンと叩くだけ</strong>。 長さは譜面が見せてくれる。
          </div>
        </section>

        <section className="help-section">
          <h2 className="help-section-title">🎼 ゲームの始め方</h2>
          <ol className="help-steps">
            <li>級を選ぶと、譜面と <strong>指揮棒</strong> (動く黄色い丸) が表示される。</li>
            <li>
              指揮棒は拍に合わせて軌道を描く。 <strong>頂点 (下)</strong> が 1 拍目の場所。
              中央には今が何拍目かの <strong>カウント数字</strong> が出る。
            </li>
            <li>
              指揮棒が <strong>下に来た瞬間にタップ</strong> すると、
              そこが曲の 1 拍目になり再生スタート。
            </li>
            <li>
              再生中はカウント数字が消える ─ 譜面を読んで自力で拍を追う。
              指揮棒だけは振り続けるので、 拍の感覚は維持できる。
            </li>
          </ol>
        </section>

        <section className="help-section">
          <h2 className="help-section-title">🎯 判定の見方</h2>
          <p>タップごとに指揮棒の中央上に判定が出る。</p>
          <div className="help-judge-table">
            <div className="help-judge-row">
              <span className="help-judge-label help-judge-perfect">PERFECT</span>
              <span className="help-judge-desc">±50ms 以内 ─ 完璧</span>
            </div>
            <div className="help-judge-row">
              <span className="help-judge-label help-judge-good">GOOD</span>
              <span className="help-judge-desc">±120ms 以内 ─ 少しズレ</span>
            </div>
            <div className="help-judge-row">
              <span className="help-judge-label help-judge-miss">MISS</span>
              <span className="help-judge-desc">大きくズレた / 叩かなかった / 余計に叩いた</span>
            </div>
          </div>
        </section>

        <section className="help-section">
          <h2 className="help-section-title">🥁 拍を感じる</h2>
          <p>
            手がかりは 2 つ。 <strong>メトロノーム音</strong> と <strong>指揮棒の軌道</strong>。
            目と耳の両方で同じ拍を捉えると安定する。
          </p>
          <p>
            頭が休符で始まる譜面でも、 指揮棒はずっと振られているので
            「次の 1 拍目はいつか」 を見失わない。
          </p>
        </section>

        <section className="help-section">
          <h2 className="help-section-title">⚙ テンポと設定</h2>
          <p>
            画面右上の <strong>設定アイコン</strong> から、 待機中だけ BPM スライダーで
            テンポ調整 OK。 各拍子のアクセントパターンもここでカスタムできる。
          </p>
          <div className="help-callout">
            合格判定はその譜面の規定 BPM 以上で出る ─ 遅くして練習するのは自由。
            ヘッダーに <strong>⚠ 合格判定が出ません</strong> が出てたら下げすぎ。
          </div>
        </section>

        <section className="help-section">
          <h2 className="help-section-title">💡 コツ</h2>
          <ul className="help-tips">
            <li>譜面は <strong>読む</strong> もの。 暗記じゃなく、毎回拍頭をたどる練習。</li>
            <li>初プレイ前に <strong>キャリブレーション</strong> をやると、 端末の入力遅延が補正されて PERFECT 圏が広がる。</li>
            <li>失敗しても <strong>リトライ</strong> ですぐ再挑戦。 諦めず叩き続けるのが上達への道。</li>
          </ul>
        </section>

        <div className="help-footer">
          <button type="button" className="primary help-back-bottom" onClick={back}>
            タイトルへ戻る
          </button>
        </div>
      </div>
    </main>
  );
}
