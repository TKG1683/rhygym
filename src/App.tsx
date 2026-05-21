import { useEffect } from 'react';
import { loadAllEtudes } from './core/score/etudeLoader';
import { useAppStore, type Screen } from './ui/store/appStore';
import { TitleScreen } from './ui/screens/TitleScreen';
import { StageSelectScreen } from './ui/screens/MovementSelectScreen';
import { GameScreen } from './ui/screens/GameScreen';
import { ResultScreen } from './ui/screens/ResultScreen';
import { CalibrationScreen } from './ui/screens/CalibrationScreen';
import { HelpScreen } from './ui/screens/HelpScreen';

const VALID_SCREENS: readonly Screen[] = ['title', 'select', 'game', 'result', 'calibration', 'help'];

export default function App() {
  const screen = useAppStore((s) => s.screen);
  const setScreen = useAppStore((s) => s.setScreen);
  const setLoadedEtudes = useAppStore((s) => s.setLoadedEtudes);
  const setEtudesLoadState = useAppStore((s) => s.setEtudesLoadState);
  const setEtudesLoadError = useAppStore((s) => s.setEtudesLoadError);

  // Pull the real étude roster from public/etudes/ once on mount.
  // While this is running (and on failure) MovementSelect falls back
  // to the hardcoded placeholder ETUDES so the app stays playable even
  // before any MIDI files exist on disk.
  useEffect(() => {
    let cancelled = false;
    setEtudesLoadState('loading');
    setEtudesLoadError(null);
    loadAllEtudes().then(
      (etudes) => {
        if (cancelled) return;
        setLoadedEtudes(etudes);
        setEtudesLoadState('ready');
      },
      (err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setEtudesLoadError(message);
        setEtudesLoadState('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [setLoadedEtudes, setEtudesLoadState, setEtudesLoadError]);

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
    case 'help':
      return <HelpScreen />;
  }
}
