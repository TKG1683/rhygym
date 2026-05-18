import { DEMO_STAGE } from '../../core/score/demoStage';
import { getStageById } from '../../core/score/stages';
import { GameView } from '../game/GameView';
import { useAppStore } from '../store/appStore';

export function GameScreen() {
  const selectedStageId = useAppStore((s) => s.selectedStageId);
  // Fall back to DEMO_STAGE if nothing was selected (e.g. direct nav,
  // or before StageSelect runs in tests).
  const stage =
    (selectedStageId ? getStageById(selectedStageId) : null) ?? DEMO_STAGE;
  return <GameView stage={stage} />;
}
