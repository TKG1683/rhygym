import { DEMO_STAGE } from '../../core/score/demoStage';
import { STAGES } from '../../core/score/stages';
import { GameView } from '../game/GameView';
import { useAppStore } from '../store/appStore';

export function GameScreen() {
  const selectedStageId = useAppStore((s) => s.selectedStageId);
  const loadedStages = useAppStore((s) => s.loadedStages);

  // Prefer the network-loaded roster; fall back to the bundled
  // placeholder STAGES if the loader hasn't completed (or failed).
  // Final fallback is DEMO_STAGE so a stray navigation never blanks
  // the screen.
  const roster = loadedStages ?? STAGES;
  const stage =
    (selectedStageId ? roster.find((s) => s.id === selectedStageId) : null) ??
    DEMO_STAGE;
  return <GameView stage={stage} />;
}
