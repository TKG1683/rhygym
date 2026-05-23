/**
 * TutorialScreen — play-through walkthrough that teaches the game by
 * actually playing it (#26 v2, replacing the earlier text-only
 * HelpScreen). Two-stage flow:
 *
 *   1. `intro`         modal: welcome + game concept
 *   2. `instruction`   modal: how to start the song (count "1" → tap)
 *   3. `guided-play`   live game with TAP guide on every beat
 *   4. `guided-result` modal: depending on outcome —
 *      - pass: "ガイドなしでやってみよう" → unguided-play
 *      - fail: "もう一回ガイド付きで" → retry guided
 *   5. `unguided-play` live game *without* the TAP guide (the real
 *      gameplay experience)
 *   6. `outro`         modal: encouragement + back to Title
 *
 * Each modal dims the page behind it and blocks pointer events on
 * the underlying game UI. The modal between two plays carries the
 * "graduate from training wheels" pacing — the guided run earns
 * the right to try it cold.
 *
 * Tutorial runs don't pollute the "last result" store — GameView's
 * `onComplete` callback suppresses the normal writes when set.
 */

import { useState } from 'react';
import type { GameResult } from '../../core/judgement';
import { TUTORIAL_ETUDE } from '../../core/score/tutorialEtude';
import { GameView } from '../game/GameView';
import { useAppStore } from '../store/appStore';
import { TutorialHintModal } from './TutorialHintModal';

type Step =
  | 'intro'
  | 'instruction'
  | 'guided-play'
  | 'guided-result'
  | 'unguided-play'
  | 'outro';

const TOTAL_STEPS = 4;

interface HintProps {
  step: number;
  title: string;
  body: string;
  nextLabel?: string;
  onNext: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function TutorialScreen() {
  const goto = useAppStore((s) => s.goto);
  const [step, setStep] = useState<Step>('intro');
  const [guidedResult, setGuidedResult] = useState<GameResult | null>(null);
  const [unguidedResult, setUnguidedResult] = useState<GameResult | null>(null);
  // Bumped on every new game embed (retry or stage transition) so
  // React unmounts the previous GameView and mounts a fresh one —
  // otherwise its internal phase / verdicts / audio handles would
  // carry over.
  const [runKey, setRunKey] = useState(0);

  const backToTitle = () => goto('title');
  const restartRun = () => setRunKey((k) => k + 1);

  const handleGuidedComplete = (result: GameResult) => {
    setGuidedResult(result);
    setStep('guided-result');
  };
  const handleUnguidedComplete = (result: GameResult) => {
    setUnguidedResult(result);
    setStep('outro');
  };
  const retryGuided = () => {
    setGuidedResult(null);
    restartRun();
    setStep('guided-play');
  };
  const startUnguided = () => {
    restartRun();
    setStep('unguided-play');
  };
  const retryUnguided = () => {
    setUnguidedResult(null);
    restartRun();
    setStep('unguided-play');
  };

  // Pass condition reused for both stages. B-or-better = "good enough
  // to advance". The conductor + TAP guide should make the guided
  // stage near-trivial; the unguided one is the real test.
  const passedRanks = new Set<GameResult['rank']>(['S', 'A', 'B']);
  const guidedPassed = guidedResult ? passedRanks.has(guidedResult.rank) : false;
  const unguidedPassed = unguidedResult ? passedRanks.has(unguidedResult.rank) : true;

  // Lookup the hint copy for the current modal step. Returning the
  // same TutorialHintModal node across intro ↔ instruction lets React
  // reconcile props in place (no backdrop flicker between hints).
  const hint: HintProps | null =
    step === 'intro'
      ? {
          step: 1,
          title: 'リズムを叩くゲーム',
          body:
            '画面に表示される譜面を読んで、書かれたリズムどおりに画面をタップする。それだけ。実際にやってみよう。',
          onNext: () => setStep('instruction'),
        }
      : step === 'instruction'
        ? {
            step: 2,
            title: 'カウントが「1」になった瞬間にタップ',
            body:
              '画面中央のカウント (1 → 2 → 3 → 4 と動く数字) が「1」に戻った瞬間にタップすると、譜面の再生がスタート。再生中は「TAP」のガイドが出るので、それに合わせて叩いてみよう。',
            nextLabel: 'やってみる →',
            onNext: () => setStep('guided-play'),
          }
        : step === 'guided-result'
          ? guidedPassed
            ? {
                step: 3,
                title: 'ガイドなしで叩いてみよう',
                body:
                  'いい感じ！ 今度は「TAP」 の表示なしで同じ譜面に挑戦。 ここからが本番。 譜面とメトロノームを頼りに叩いてみよう。',
                nextLabel: 'やってみる →',
                onNext: startUnguided,
              }
            : {
                step: 3,
                title: 'もう一回ガイド付きで',
                body:
                  '焦らなくて大丈夫。 もう一回ゆっくり、 「TAP」 の表示に合わせて叩いてみよう。',
                // Primary action moves to the bottom slot per the
                // modal layout, so we put "もう一回" in the secondary
                // (top) slot since that's where the player's eye
                // lands first and it's the constructive next step
                // out of failure.
                nextLabel: 'タイトルへ戻る',
                onNext: backToTitle,
                secondaryLabel: 'もう一回やってみる',
                onSecondary: retryGuided,
              }
          : step === 'outro'
            ? unguidedPassed
              ? {
                  step: 4,
                  title: 'バッチリ！ 🎉',
                  body:
                    'ガイドなしでも叩けたね。 これで遊び方は OK。 タイトルから好きなステージを選んで、 自分のペースで挑戦してみよう。',
                  nextLabel: 'タイトルへ戻る',
                  onNext: backToTitle,
                }
              : {
                  step: 4,
                  title: 'ちょっと難しかったかな…',
                  body:
                    '焦らなくて大丈夫。 もう一回ゆっくり試してみよう。 メトロノームの音を聴きながら、 譜面に書かれたリズムをそのままなぞるイメージ。',
                  nextLabel: 'タイトルへ戻る',
                  onNext: backToTitle,
                  secondaryLabel: 'もう一回やってみる',
                  onSecondary: retryUnguided,
                }
            : null;

  // GameView is only mounted during the two play steps. The guided
  // stage turns on `tutorialMode` so the conductor draws the TAP
  // guide; the unguided stage runs the same etude with the guide off.
  const playing =
    step === 'guided-play' || step === 'unguided-play' || step === 'guided-result' || step === 'outro';
  const tutorialGuide = step === 'guided-play' || step === 'guided-result';
  const onComplete =
    step === 'guided-play' ? handleGuidedComplete : handleUnguidedComplete;

  return (
    <main className="screen screen-tutorial">
      <div className="tutorial-game-host">
        {playing ? (
          <GameView
            key={runKey}
            stage={TUTORIAL_ETUDE}
            onComplete={onComplete}
            tutorialMode={tutorialGuide}
          />
        ) : (
          <div className="tutorial-game-placeholder" aria-hidden="true" />
        )}
      </div>

      {hint && (
        <TutorialHintModal
          step={hint.step}
          total={TOTAL_STEPS}
          title={hint.title}
          body={hint.body}
          nextLabel={hint.nextLabel}
          onNext={hint.onNext}
          secondaryLabel={hint.secondaryLabel}
          onSecondary={hint.onSecondary}
        />
      )}
    </main>
  );
}
