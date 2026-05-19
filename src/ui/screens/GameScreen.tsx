import { DEMO_ETUDE } from '../../core/score/demoEtude';
import { ETUDES } from '../../core/score/etudes';
import { GameView } from '../game/GameView';
import { useAppStore } from '../store/appStore';

export function GameScreen() {
  const selectedEtudeId = useAppStore((s) => s.selectedEtudeId);
  const loadedEtudes = useAppStore((s) => s.loadedEtudes);

  // Prefer the network-loaded roster; fall back to the bundled
  // placeholder ETUDES if the loader hasn't completed (or failed).
  // Final fallback is DEMO_ETUDE so a stray navigation never blanks
  // the screen.
  const roster = loadedEtudes ?? ETUDES;
  const stage =
    (selectedEtudeId ? roster.find((s) => s.id === selectedEtudeId) : null) ??
    DEMO_ETUDE;
  return <GameView stage={stage} />;
}
