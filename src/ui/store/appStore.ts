import { create } from 'zustand';
import type { GameResult } from '../../core/judgement';

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
  setBpmMultiplier: (multiplier: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  screen: 'title',
  selectedStageId: null,
  audioContext: null,
  lastResult: null,
  bpmMultiplier: 1,
  goto: (screen) => set({ screen }),
  selectStage: (id) => set({ selectedStageId: id }),
  setAudioContext: (ctx) => set({ audioContext: ctx }),
  setLastResult: (result) => set({ lastResult: result }),
  setBpmMultiplier: (multiplier) => set({ bpmMultiplier: multiplier }),
}));
