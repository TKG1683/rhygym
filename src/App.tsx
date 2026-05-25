import { useEffect } from 'react';
import { loadAllEtudes } from './core/score/etudeLoader';
import { useAppStore, type Screen } from './ui/store/appStore';
import { TitleScreen } from './ui/screens/TitleScreen';
import { StageSelectScreen } from './ui/screens/MovementSelectScreen';
import { GameScreen } from './ui/screens/GameScreen';
import { ResultScreen } from './ui/screens/ResultScreen';
import { CalibrationScreen } from './ui/screens/CalibrationScreen';
import { TutorialScreen } from './ui/screens/TutorialScreen';
import { LessonIntroScreen } from './ui/screens/LessonIntroScreen';
import { TwoHandDemoScreen } from './ui/screens/TwoHandDemoScreen';
import { EndlessDemoScreen } from './ui/screens/EndlessDemoScreen';

const VALID_SCREENS: readonly Screen[] = [
  'title',
  'select',
  'game',
  'result',
  'calibration',
  'tutorial',
  'lesson-intro',
  'two-hand-demo',
  'endless-demo',
];

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

  // Debug entry points for the in-progress extension modes. Honored
  // once at startup so a reload returns to Title instead of looping
  // back into the demo. ?demo=two-hand → #83, ?demo=endless → #77.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('demo');
    const target: Screen | null =
      flag === 'two-hand' ? 'two-hand-demo' : flag === 'endless' ? 'endless-demo' : null;
    if (target) {
      useAppStore.getState().setScreen(target);
      params.delete('demo');
      const qs = params.toString();
      const newUrl = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
      window.history.replaceState({ screen: target }, '', newUrl);
    }
  }, []);

  // Reset window scroll on every screen change (#98). Without this, a
  // player who scrolled the MovementSelect list down and tapped a
  // lesson would land inside LessonIntroScreen scrolled past the
  // header. Browsers also restore scroll on bfcache restore, so flip
  // scrollRestoration to manual so back/forward doesn't fight us.
  useEffect(() => {
    if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo(0, 0);
  }, [screen]);

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
    case 'tutorial':
      return <TutorialScreen />;
    case 'lesson-intro':
      return <LessonIntroScreen />;
    case 'two-hand-demo':
      return <TwoHandDemoScreen />;
    case 'endless-demo':
      return <EndlessDemoScreen />;
  }
}
