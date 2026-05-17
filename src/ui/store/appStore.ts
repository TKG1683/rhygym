import { create } from 'zustand';

export type Screen = 'title' | 'select' | 'game' | 'result';

interface AppState {
  screen: Screen;
  selectedStageId: string | null;
  goto: (screen: Screen) => void;
  selectStage: (id: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  screen: 'title',
  selectedStageId: null,
  goto: (screen) => set({ screen }),
  selectStage: (id) => set({ selectedStageId: id }),
}));
