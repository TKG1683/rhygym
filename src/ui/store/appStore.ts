import { create } from 'zustand';
import type { GameResult, JudgementRecord } from '../../core/judgement';
import type { Etude } from '../../core/model';
import type { EtudeWithMovementMeta } from '../../core/score/etudes';
import {
  getCalibration,
  getMetronomeAccents,
  setMetronomeAccents,
  type MetronomeAccents,
} from '../../core/storage/localStore';

export type EtudesLoadState = 'idle' | 'loading' | 'ready' | 'error';

export type Screen = 'title' | 'select' | 'game' | 'result' | 'calibration' | 'tutorial';

interface AppState {
  screen: Screen;
  selectedEtudeId: string | null;
  /**
   * Shared AudioContext. Created lazily by the Title screen's Start
   * button so it inherits a real user-gesture grant (required on iOS
   * Safari and Android Chrome).
   */
  audioContext: AudioContext | null;
  /** Result of the most recent play; consumed by ResultScreen. */
  lastResult: GameResult | null;
  /** Etude that produced lastResult — for displaying name/BPM and looking up the best-score key. */
  lastEtude: Etude | null;
  /** Full per-tap audit trail behind lastResult — drives the timing plot and timing stats. */
  lastRecords: readonly JudgementRecord[] | null;
  /**
   * Last BPM the player explicitly dialled in, scoped to *one* Etude.
   * Survives Game → Result → リトライ so a player who picked 100 BPM
   * and failed doesn't get bumped back to the authored 80 on retry,
   * but switching to a different Etude resets to its own authored
   * (= pass-line) value. Pair of `lastChosenBpm` + `lastChosenBpmEtudeId`
   * — the etudeId is the cross-mount key, the bpm is the value.
   */
  lastChosenBpm: number | null;
  lastChosenBpmEtudeId: string | null;
  /**
   * BPM the *most recent* run was actually played at. Pinned at run
   * completion (alongside lastResult) so ResultScreen can decide whether
   * to suppress the best-score write and show the "below-threshold"
   * warning, even if the player's slider is in some other position.
   */
  lastPlayedBpm: number | null;
  /**
   * Per-device tap latency offset in seconds, measured by the
   * CalibrationScreen. Subtracted from every tapSec before judgement
   * so PERFECT means "on the beat as the player feels it" rather than
   * "on the beat assuming zero touch latency". Defaults to 0 — an
   * un-calibrated player still has a usable game.
   */
  calibrationOffsetSec: number;
  /** Roster loaded over the network (null until ready or on fallback). */
  loadedEtudes: readonly EtudeWithMovementMeta[] | null;
  /** Lifecycle of the initial roster fetch. */
  etudesLoadState: EtudesLoadState;
  /** Last error message from a failed manifest / stage load. */
  etudesLoadError: string | null;
  /**
   * Where to send the player after they finish (or back out of) the
   * CalibrationScreen. Lets Result → Calib → return land them back
   * on Result instead of dumping them on Title. Cleared on calibration
   * exit so the next entry defaults to Title.
   */
  calibrationReturnScreen: Screen | null;
  /**
   * Level to open by default the next time StageSelect mounts. Set by
   * Result's "ステージ選択へ" so the player lands back inside the
   * level they just played instead of the top-level Level list.
   * Cleared on StageSelect mount.
   */
  selectInitialMovement: number | null;
  /**
   * Per-time-sig accent overrides for the metronome. Loaded from
   * localStorage on init; updates propagate back to storage so the
   * player's preferences survive reload. Missing keys fall back to the
   * built-in defaults from defaultAccentPattern().
   */
  metronomeAccents: MetronomeAccents;
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
  selectEtude: (id: string) => void;
  setAudioContext: (ctx: AudioContext) => void;
  setLastResult: (result: GameResult) => void;
  setLastEtude: (stage: Etude) => void;
  setLastRecords: (records: readonly JudgementRecord[]) => void;
  setLastChosenBpm: (bpm: number, etudeId: string) => void;
  setLastPlayedBpm: (bpm: number | null) => void;
  setCalibrationOffsetSec: (sec: number) => void;
  setLoadedEtudes: (stages: readonly EtudeWithMovementMeta[] | null) => void;
  setEtudesLoadState: (state: EtudesLoadState) => void;
  setEtudesLoadError: (error: string | null) => void;
  setCalibrationReturnScreen: (screen: Screen | null) => void;
  setSelectInitialMovement: (movement: number | null) => void;
  setMetronomeAccentForTs: (tsKey: string, pattern: boolean[]) => void;
  resetMetronomeAccentForTs: (tsKey: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  screen: 'title',
  selectedEtudeId: null,
  audioContext: null,
  lastResult: null,
  lastEtude: null,
  lastRecords: null,
  lastChosenBpm: null,
  lastChosenBpmEtudeId: null,
  lastPlayedBpm: null,
  // Eagerly seed from localStorage so the first play after a reload
  // uses the saved calibration without anyone having to remember to
  // re-load it manually.
  calibrationOffsetSec: getCalibration()?.offsetSec ?? 0,
  loadedEtudes: null,
  etudesLoadState: 'idle',
  etudesLoadError: null,
  calibrationReturnScreen: null,
  selectInitialMovement: null,
  metronomeAccents: getMetronomeAccents(),
  goto: (screen) => {
    // Push the destination so the OS back button steps backwards
    // through the app rather than leaving it.
    if (typeof history !== 'undefined') {
      history.pushState({ screen }, '');
    }
    set({ screen });
  },
  setScreen: (screen) => set({ screen }),
  selectEtude: (id) => set({ selectedEtudeId: id }),
  setAudioContext: (ctx) => set({ audioContext: ctx }),
  setLastResult: (result) => set({ lastResult: result }),
  setLastEtude: (stage) => set({ lastEtude: stage }),
  setLastRecords: (records) => set({ lastRecords: records }),
  setLastChosenBpm: (bpm, etudeId) =>
    set({ lastChosenBpm: bpm, lastChosenBpmEtudeId: etudeId }),
  setLastPlayedBpm: (bpm) => set({ lastPlayedBpm: bpm }),
  setCalibrationOffsetSec: (sec) => set({ calibrationOffsetSec: sec }),
  setLoadedEtudes: (stages) => set({ loadedEtudes: stages }),
  setEtudesLoadState: (state) => set({ etudesLoadState: state }),
  setEtudesLoadError: (error) => set({ etudesLoadError: error }),
  setCalibrationReturnScreen: (screen) => set({ calibrationReturnScreen: screen }),
  setSelectInitialMovement: (level) => set({ selectInitialMovement: level }),
  setMetronomeAccentForTs: (tsKey, pattern) =>
    set((state) => {
      const next = { ...state.metronomeAccents, [tsKey]: pattern };
      setMetronomeAccents(next);
      return { metronomeAccents: next };
    }),
  resetMetronomeAccentForTs: (tsKey) =>
    set((state) => {
      if (!(tsKey in state.metronomeAccents)) return {};
      const next = { ...state.metronomeAccents };
      delete next[tsKey];
      setMetronomeAccents(next);
      return { metronomeAccents: next };
    }),
}));
