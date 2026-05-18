import { create } from 'zustand';
import type { GameResult, JudgementRecord } from '../../core/judgement';
import type { Stage } from '../../core/model';
import { getCalibration } from '../../core/storage/localStore';

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
  goto: (screen: Screen) => void;
  selectStage: (id: string) => void;
  setAudioContext: (ctx: AudioContext) => void;
  setLastResult: (result: GameResult) => void;
  setLastStage: (stage: Stage) => void;
  setLastRecords: (records: readonly JudgementRecord[]) => void;
  setBpmMultiplier: (multiplier: number) => void;
  setCalibrationOffsetSec: (sec: number) => void;
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
  goto: (screen) => set({ screen }),
  selectStage: (id) => set({ selectedStageId: id }),
  setAudioContext: (ctx) => set({ audioContext: ctx }),
  setLastResult: (result) => set({ lastResult: result }),
  setLastStage: (stage) => set({ lastStage: stage }),
  setLastRecords: (records) => set({ lastRecords: records }),
  setBpmMultiplier: (multiplier) => set({ bpmMultiplier: multiplier }),
  setCalibrationOffsetSec: (sec) => set({ calibrationOffsetSec: sec }),
}));
