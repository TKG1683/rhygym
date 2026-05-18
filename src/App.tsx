import { useEffect } from 'react';
import { loadAllStages } from './core/score/stageLoader';
import { useAppStore, type Screen } from './ui/store/appStore';
import { TitleScreen } from './ui/screens/TitleScreen';
import { StageSelectScreen } from './ui/screens/StageSelectScreen';
import { GameScreen } from './ui/screens/GameScreen';
import { ResultScreen } from './ui/screens/ResultScreen';
import { CalibrationScreen } from './ui/screens/CalibrationScreen';

const VALID_SCREENS: readonly Screen[] = ['title', 'select', 'game', 'result', 'calibration'];

export default function App() {
  const screen = useAppStore((s) => s.screen);
  const setScreen = useAppStore((s) => s.setScreen);
  const setLoadedStages = useAppStore((s) => s.setLoadedStages);
  const setStagesLoadState = useAppStore((s) => s.setStagesLoadState);
  const setStagesLoadError = useAppStore((s) => s.setStagesLoadError);

  // Pull the real stage roster from public/stages/ once on mount.
  // While this is running (and on failure) StageSelect falls back to
  // the hardcoded placeholder STAGES so the app stays playable even
  // before any MIDI files exist on disk.
  useEffect(() => {
    let cancelled = false;
    setStagesLoadState('loading');
    setStagesLoadError(null);
    loadAllStages().then(
      (stages) => {
        if (cancelled) return;
        setLoadedStages(stages);
        setStagesLoadState('ready');
      },
      (err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setStagesLoadError(message);
        setStagesLoadState('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [setLoadedStages, setStagesLoadState, setStagesLoadError]);

  // Hook the in-app screen switch into the browser's history stack.
  // Without this, the OS back button always exits the site even after
  // the player has navigated Title → Select → Game → Result.
  useEffect(() => {
    // Seed the entry the user is sitting on right now. replaceState
    // (not pushState) so we don't create a phantom forward entry on
    // first load.
    if (typeof history !== 'undefined' && history.state?.screen == null) {
      history.replaceState({ screen: useAppStore.getState().screen }, '');
    }
    const handlePop = (e: PopStateEvent) => {
      const target = e.state?.screen;
      if (typeof target === 'string' && (VALID_SCREENS as readonly string[]).includes(target)) {
        setScreen(target as Screen);
      } else {
        // No state on this entry → we've walked off our own history.
        // Drop back to Title rather than rendering a blank screen.
        setScreen('title');
      }
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, [setScreen]);

  switch (screen) {
    case 'title':
      return <TitleScreen />;
    case 'select':
      return <StageSelectScreen />;
    case 'game':
      return <GameScreen />;
    case 'result':
      return <ResultScreen />;
    case 'calibration':
      return <CalibrationScreen />;
  }
}
