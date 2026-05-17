import { DEMO_STAGE } from '../../core/score/demoStage';
import { GameView } from '../game/GameView';

export function GameScreen() {
  // v1 always plays the demo stage until real stages land in #9.
  return <GameView stage={DEMO_STAGE} />;
}
