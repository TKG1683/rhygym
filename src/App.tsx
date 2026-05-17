import { useAppStore } from './ui/store/appStore';
import { TitleScreen } from './ui/screens/TitleScreen';
import { StageSelectScreen } from './ui/screens/StageSelectScreen';
import { GameScreen } from './ui/screens/GameScreen';
import { ResultScreen } from './ui/screens/ResultScreen';

export default function App() {
  const screen = useAppStore((s) => s.screen);
  switch (screen) {
    case 'title':
      return <TitleScreen />;
    case 'select':
      return <StageSelectScreen />;
    case 'game':
      return <GameScreen />;
    case 'result':
      return <ResultScreen />;
  }
}
