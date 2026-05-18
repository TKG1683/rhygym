import { create } from 'zustand';
import type { GameResult, JudgementRecord } from '../../core/judgement';
import type { Stage } from '../../core/model';

export type Screen = 'title' | 'select' | 'game' | 'result';

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
  goto: (screen: Screen) => void;
  selectStage: (id: string) => void;
  setAudioContext: (ctx: AudioContext) => void;
  setLastResult: (result: GameResult) => void;
  setLastStage: (stage: Stage) => void;
  setLastRecords: (records: readonly JudgementRecord[]) => void;
  setBpmMultiplier: (multiplier: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  screen: 'title',
  selectedStageId: null,
  audioContext: null,
  lastResult: null,
  lastStage: null,
  lastRecords: null,
  bpmMultiplier: 1,
  goto: (screen) => set({ screen }),
  selectStage: (id) => set({ selectedStageId: id }),
  setAudioContext: (ctx) => set({ audioContext: ctx }),
  setLastResult: (result) => set({ lastResult: result }),
  setLastStage: (stage) => set({ lastStage: stage }),
  setLastRecords: (records) => set({ lastRecords: records }),
  setBpmMultiplier: (multiplier) => set({ bpmMultiplier: multiplier }),
}));
