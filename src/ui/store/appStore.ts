import { create } from 'zustand';
import type { GameResult, JudgementRecord } from '../../core/judgement';
import type { Stage } from '../../core/model';
import type { StageWithMeta } from '../../core/score/stages';
import { getCalibration } from '../../core/storage/localStore';

export type StagesLoadState = 'idle' | 'loading' | 'ready' | 'error';

export type Screen = 'title' | 'select' | 'game' | 'result' | 'calibration';

interface AppState {
  screen: Screen;
  selectedStageId: string | null;
  /**
   * Shared AudioContext. Created lazily by the Title screen's Start
   * button so it inherits a real user-gesture grant (required on iOS
   * Safari and Android Chrome).
   */
  audioContext: AudioContext | null;
  /** Result of the most recent play; consumed by ResultScreen. */
  lastResult: GameResult | null;
  /** Stage that produced lastResult — for displaying name/BPM and looking up the best-score key. */
  lastStage: Stage | null;
  /** Full per-tap audit trail behind lastResult — drives the timing plot and timing stats. */
  lastRecords: readonly JudgementRecord[] | null;
  /**
   * Tempo scaling factor (1 = stage's authored BPM). Lives in the store
   * so the player's chosen tempo survives the Game→Result→Retry round-
   * trip — without this, hitting "リトライ" would silently reset the
   * BPM slider to 1.0 every time.
   */
  bpmMultiplier: number;
  /**
   * Per-device tap latency offset in seconds, measured by the
   * CalibrationScreen. Subtracted from every tapSec before judgement
   * so PERFECT means "on the beat as the player feels it" rather than
   * "on the beat assuming zero touch latency". Defaults to 0 — an
   * un-calibrated player still has a usable game.
   */
  calibrationOffsetSec: number;
  /** Roster loaded over the network (null until ready or on fallback). */
  loadedStages: readonly StageWithMeta[] | null;
  /** Lifecycle of the initial roster fetch. */
  stagesLoadState: StagesLoadState;
  /** Last error message from a failed manifest / stage load. */
  stagesLoadError: string | null;
  /**
   * Navigate to a screen AND push that destination onto the browser
   * history. This is what UI buttons should call — it keeps the OS
   * back button in sync with in-app navigation.
   */
  goto: (screen: Screen) => void;
  /**
   * Set the screen without touching history. Used by the popstate
   * handler so back/forward don't double-push.
   */
  setScreen: (screen: Screen) => void;
  selectStage: (id: string) => void;
  setAudioContext: (ctx: AudioContext) => void;
  setLastResult: (result: GameResult) => void;
  setLastStage: (stage: Stage) => void;
  setLastRecords: (records: readonly JudgementRecord[]) => void;
  setBpmMultiplier: (multiplier: number) => void;
  setCalibrationOffsetSec: (sec: number) => void;
  setLoadedStages: (stages: readonly StageWithMeta[] | null) => void;
  setStagesLoadState: (state: StagesLoadState) => void;
  setStagesLoadError: (error: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  screen: 'title',
  selectedStageId: null,
  audioContext: null,
  lastResult: null,
  lastStage: null,
  lastRecords: null,
  bpmMultiplier: 1,
  // Eagerly seed from localStorage so the first play after a reload
  // uses the saved calibration without anyone having to remember to
  // re-load it manually.
  calibrationOffsetSec: getCalibration()?.offsetSec ?? 0,
  loadedStages: null,
  stagesLoadState: 'idle',
  stagesLoadError: null,
  goto: (screen) => {
    // Push the destination so the OS back button steps backwards
    // through the app rather than leaving it.
    if (typeof history !== 'undefined') {
      history.pushState({ screen }, '');
    }
    set({ screen });
  },
  setScreen: (screen) => set({ screen }),
  selectStage: (id) => set({ selectedStageId: id }),
  setAudioContext: (ctx) => set({ audioContext: ctx }),
  setLastResult: (result) => set({ lastResult: result }),
  setLastStage: (stage) => set({ lastStage: stage }),
  setLastRecords: (records) => set({ lastRecords: records }),
  setBpmMultiplier: (multiplier) => set({ bpmMultiplier: multiplier }),
  setCalibrationOffsetSec: (sec) => set({ calibrationOffsetSec: sec }),
  setLoadedStages: (stages) => set({ loadedStages: stages }),
  setStagesLoadState: (state) => set({ stagesLoadState: state }),
  setStagesLoadError: (error) => set({ stagesLoadError: error }),
}));
