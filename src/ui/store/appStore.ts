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
  goto: (screen: Screen) => void;
  selectStage: (id: string) => void;
  setAudioContext: (ctx: AudioContext) => void;
  setLastResult: (result: GameResult) => void;
}

export const useAppStore = create<AppState>((set) => ({
  screen: 'title',
  selectedStageId: null,
  audioContext: null,
  lastResult: null,
  goto: (screen) => set({ screen }),
  selectStage: (id) => set({ selectedStageId: id }),
  setAudioContext: (ctx) => set({ audioContext: ctx }),
  setLastResult: (result) => set({ lastResult: result }),
}));
