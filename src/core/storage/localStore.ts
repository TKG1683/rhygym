/**
 * Persistent best-score store backed by window.localStorage.
 *
 * Schema lives behind a versioned key (`rhygym:best:v2`). On first read
 * after a bump, a one-shot migrator translates legacy v1 data (keyed by
 * old `level-N-M` / `level-N-exam` stageIds) into the new `etudeId`
 * shape (`movement-N-etude-M` / `movement-N-final`) and removes the v1
 * key so subsequent reads only see v2.
 *
 * All accessors are defensive: a missing / corrupted / disabled
 * localStorage just looks like "no records yet" to the caller, not an
 * exception.
 */

import { DEFAULT_DIFFICULTY, type Difficulty } from '../model/types';
import type { Rank } from '../judgement/score';

const DIFFICULTY_KEY = 'rhygym:difficulty:v1';

const VALID_DIFFICULTIES: ReadonlySet<Difficulty> = new Set(['BEGINNER', 'NORMAL']);

/**
 * Player's last-selected difficulty (#20). Read at app boot so the
 * setting survives reloads; missing / corrupt storage falls back to
 * NORMAL (the original Rhygym mode) so a fresh player gets the
 * default sight-reading-focused experience rather than the assisted
 * BEGINNER one.
 */
export function getDifficulty(): Difficulty {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_DIFFICULTY;
    const raw = localStorage.getItem(DIFFICULTY_KEY);
    if (!raw) return DEFAULT_DIFFICULTY;
    if (VALID_DIFFICULTIES.has(raw as Difficulty)) return raw as Difficulty;
    return DEFAULT_DIFFICULTY;
  } catch {
    return DEFAULT_DIFFICULTY;
  }
}

export function setDifficulty(value: Difficulty): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(DIFFICULTY_KEY, value);
  } catch {
    // storage unavailable — selection just won't persist this session
  }
}

const STORAGE_KEY_V1 = 'rhygym:best:v1';
const STORAGE_KEY_V2 = 'rhygym:best:v2';
const STORAGE_KEY = 'rhygym:best:v3';
const CALIB_KEY = 'rhygym:calibration:v1';
const CALIB_SUGGEST_DISMISSED_KEY = 'rhygym:calibSuggestDismissed:v1';
const METRONOME_ACCENTS_KEY = 'rhygym:metronomeAccents:v1';

export interface BestRecord {
  etudeId: string;
  /**
   * Which difficulty this record was earned under (#20). Stored on
   * the record so the v3 schema can keep one BEGINNER and one NORMAL
   * best independently for the same étude.
   */
  difficulty: Difficulty;
  score: number;
  rank: Rank;
  /** ISO timestamp of when this score was set. */
  achievedAt: string;
}

/**
 * v3 storage shape: per-étude map of per-difficulty best records.
 * Either slot may be missing if the player hasn't played that
 * difficulty yet. Migrated from v2 (flat, NORMAL-only) by wrapping
 * each legacy entry as `{ NORMAL: { ...entry, difficulty: 'NORMAL' } }`.
 */
export type BestsByDifficulty = Partial<Record<Difficulty, BestRecord>>;
export type BestsByEtude = Record<string, BestsByDifficulty>;

/** v2 (legacy) — flat per-étude record without a difficulty field. */
interface BestRecordV2 {
  etudeId: string;
  score: number;
  rank: Rank;
  achievedAt: string;
}

/**
 * Legacy v1 record shape. Carried here so the migrator can read v1
 * payloads without `any` casts. The only schema change vs v2 is the
 * `stageId` field renaming to `etudeId` and the id-prefix swap
 * (level-N-M → movement-N-etude-M, level-N-exam → movement-N-final).
 */
interface LegacyBestRecordV1 {
  stageId: string;
  score: number;
  rank: Rank;
  achievedAt: string;
}

/**
 * Translate an old v1 stageId into the new v2 etudeId.
 *  - `level-N-M`    → `movement-N-etude-M`
 *  - `level-N-exam` → `movement-N-final`
 *  - anything else is returned untouched (forward-compat / unknown ids
 *    pass through so a partially-corrupt v1 still surfaces what we can).
 */
function translateStageIdToEtudeId(stageId: string): string {
  const examMatch = /^level-(\d+)-exam$/.exec(stageId);
  if (examMatch) return `movement-${examMatch[1]}-final`;
  const gradedMatch = /^level-(\d+)-(\d+)$/.exec(stageId);
  if (gradedMatch) return `movement-${gradedMatch[1]}-etude-${gradedMatch[2]}`;
  return stageId;
}

/**
 * One-shot v1 → v2 migrator. Runs at most once: after a successful
 * write to v2 the v1 key is removed, so subsequent calls observe v2
 * and short-circuit. Idempotent — translating an already-translated
 * id is a no-op because the regexes only match the old prefix.
 *
 * If v2 already exists we leave v1 alone (the bump is one-way and v2
 * is the source of truth from that point on). If v1 is missing or
 * malformed we silently do nothing — caller gets `{}` as if the
 * player had no records, which matches the "defensive read" contract.
 */
function migrateV1ToV2IfNeeded(): void {
  if (typeof localStorage === 'undefined') return;
  // v3 OR v2 already populated — never re-touch v1. Skipping when
  // v3 exists keeps the "v3 wins, v1 untouched" invariant the unit
  // test verifies (otherwise a stray v1 would still get clobbered).
  if (localStorage.getItem(STORAGE_KEY) !== null) return;
  if (localStorage.getItem(STORAGE_KEY_V2) !== null) return;
  const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
  if (rawV1 === null) return;
  try {
    const parsed = JSON.parse(rawV1);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      // malformed v1 — drop it so we don't keep retrying every read.
      localStorage.removeItem(STORAGE_KEY_V1);
      return;
    }
    const migrated: Record<string, BestRecordV2> = {};
    for (const [, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const v1 = value as Partial<LegacyBestRecordV1>;
      if (
        typeof v1.stageId !== 'string' ||
        typeof v1.score !== 'number' ||
        typeof v1.rank !== 'string' ||
        typeof v1.achievedAt !== 'string'
      ) {
        continue;
      }
      const etudeId = translateStageIdToEtudeId(v1.stageId);
      migrated[etudeId] = {
        etudeId,
        score: v1.score,
        rank: v1.rank as Rank,
        achievedAt: v1.achievedAt,
      };
    }
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(migrated));
    localStorage.removeItem(STORAGE_KEY_V1);
  } catch {
    // v1 was garbage — clear it so we don't loop forever.
    try {
      localStorage.removeItem(STORAGE_KEY_V1);
    } catch {
      // ignore
    }
  }
}

/**
 * One-shot v2 → v3 migrator (#20). v2 had a flat
 * `Record<etudeId, BestRecord>` shape (no difficulty notion); v3
 * nests by difficulty so BEGINNER and NORMAL plays each keep their
 * own best. Every v2 entry is treated as a NORMAL record (the only
 * mode that existed pre-#20) and wrapped under `{ NORMAL: ... }`.
 *
 * Idempotent: if v3 already exists v2 is left alone (the bump is
 * one-way). Malformed v2 is dropped silently — defensive reads
 * elsewhere already treat missing storage as "no records yet".
 */
function migrateV2ToV3IfNeeded(): void {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(STORAGE_KEY) !== null) return;
  const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
  if (rawV2 === null) return;
  try {
    const parsed = JSON.parse(rawV2);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      localStorage.removeItem(STORAGE_KEY_V2);
      return;
    }
    const migrated: BestsByEtude = {};
    for (const [etudeId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const v2 = value as Partial<BestRecordV2>;
      if (
        typeof v2.etudeId !== 'string' ||
        typeof v2.score !== 'number' ||
        typeof v2.rank !== 'string' ||
        typeof v2.achievedAt !== 'string'
      ) {
        continue;
      }
      migrated[etudeId] = {
        NORMAL: {
          etudeId,
          difficulty: 'NORMAL',
          score: v2.score,
          rank: v2.rank as Rank,
          achievedAt: v2.achievedAt,
        },
      };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    localStorage.removeItem(STORAGE_KEY_V2);
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY_V2);
    } catch {
      // ignore
    }
  }
}

/**
 * Read the full v3 store. Runs v1→v2 and v2→v3 migrations on first
 * call so legacy storage transparently upgrades. Returns an empty
 * object on any read failure so callers can blindly index.
 */
export function getAllBests(): BestsByEtude {
  try {
    migrateV1ToV2IfNeeded();
    migrateV2ToV3IfNeeded();
    const raw = readStorage();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as BestsByEtude;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Project the v3 store into the flat per-étude shape that
 * progression and Movement-medal logic want: one record per étude,
 * picking the BEST rank across all difficulties (and the higher
 * score on tie). Lets a BEGINNER S clear count toward Movement
 * unlock just like a NORMAL S — without this BEGINNER players
 * couldn't progress without switching modes.
 */
export function getBestPerEtude(): Record<string, BestRecord> {
  const nested = getAllBests();
  const out: Record<string, BestRecord> = {};
  for (const [etudeId, byDiff] of Object.entries(nested)) {
    const list = Object.values(byDiff).filter((r): r is BestRecord => r != null);
    if (list.length === 0) continue;
    out[etudeId] = list.reduce((best, cur) =>
      compareBest(cur, best) > 0 ? cur : best,
    );
  }
  return out;
}

/** Rank order; higher = better. Matches the project-wide RANK_ORDER. */
const RANK_RANK: Record<Rank, number> = { D: 0, C: 1, B: 2, A: 3, S: 4 };
function compareBest(a: BestRecord, b: BestRecord): number {
  const r = RANK_RANK[a.rank] - RANK_RANK[b.rank];
  if (r !== 0) return r;
  return a.score - b.score;
}

export function getBest(etudeId: string, difficulty: Difficulty): BestRecord | null {
  return getAllBests()[etudeId]?.[difficulty] ?? null;
}

/**
 * Write `record` as the new best for its étude/difficulty slot.
 * Caller decides "best" — this is unconditional. Failure to write
 * (storage disabled / quota exceeded) is swallowed so a play in
 * private browsing still works. Only the slot matching
 * `record.difficulty` is overwritten; the other difficulty's
 * record (if any) is preserved.
 */
export function setBest(record: BestRecord): void {
  try {
    const all = getAllBests();
    const existing = all[record.etudeId] ?? {};
    existing[record.difficulty] = record;
    all[record.etudeId] = existing;
    writeStorage(JSON.stringify(all));
  } catch {
    // localStorage unavailable — accept silently; in-memory result is
    // unaffected, the player just won't see the new BEST next time.
  }
}

/**
 * Returns true if `candidate.score` would beat the existing best for
 * the (étude, difficulty) slot — or there is no existing best for
 * that slot yet. Lets callers decide whether to write + flash
 * "NEW BEST!".
 */
export function isNewBest(candidate: {
  etudeId: string;
  difficulty: Difficulty;
  score: number;
}): boolean {
  const existing = getBest(candidate.etudeId, candidate.difficulty);
  if (!existing) return true;
  return candidate.score > existing.score;
}

/* ------------------------------------------------------------------ */
/*  Skip-test Final tracking (#31 follow-up)                          */
/* ------------------------------------------------------------------ */
/*
 * Set of Final stage IDs whose CURRENT best record was earned via a
 * skip-test (locked-Movement 飛び級 sub-button) and not yet superseded
 * by a normal-mode B+ clear. evaluateProgression uses this to gate
 * the "Final B+ → next Movement unlocks" rule: a skip-test S grants
 * etude access to the tested Movement but doesn't auto-progress past
 * it. Only a normal-mode Final clear (post 3-etude-A+ unlock) opens
 * the next Movement.
 *
 * Stored as a JSON array of etude IDs under SKIPTEST_KEY. Reads
 * default to an empty set on any error (corrupt data, private mode,
 * etc.); writes are best-effort.
 */

const SKIPTEST_KEY = 'rhygym.skipTestFinals';
const LESSONS_COMPLETED_KEY = 'rhygym:lessonsCompleted:v1';
const FAIL_STREAK_KEY = 'rhygym:failStreak:v1';

export function getSkipTestFinals(): Set<string> {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(SKIPTEST_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((x) => typeof x === 'string'));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

function writeSkipTestFinals(set: ReadonlySet<string>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SKIPTEST_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export function addSkipTestFinal(etudeId: string): void {
  const set = getSkipTestFinals();
  if (set.has(etudeId)) return;
  set.add(etudeId);
  writeSkipTestFinals(set);
}

export function removeSkipTestFinal(etudeId: string): void {
  const set = getSkipTestFinals();
  if (!set.has(etudeId)) return;
  set.delete(etudeId);
  writeSkipTestFinals(set);
}

/* ------------------------------------------------------------------ */
/*  Lesson completion tracking (#53)                                  */
/* ------------------------------------------------------------------ */
/*
 * Set of Etude IDs the player has either played to completion or
 * explicitly skipped from the Etude list. Used by MovementSelect to
 * stamp a "✓ 完了" check on lesson cards so the optional onboarding
 * step disappears as a visible TODO once it's been acknowledged.
 *
 * Stored as a JSON array under LESSONS_COMPLETED_KEY. Defensive reads
 * mirror the rest of this module — missing / corrupt / disabled
 * localStorage returns an empty set rather than throwing.
 */

export function getLessonsCompleted(): Set<string> {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(LESSONS_COMPLETED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((x): x is string => typeof x === 'string'));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

export function markLessonCompleted(etudeId: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const set = getLessonsCompleted();
    if (set.has(etudeId)) return;
    set.add(etudeId);
    localStorage.setItem(LESSONS_COMPLETED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // storage unavailable — completion just won't persist this session
  }
}

function readStorage(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY);
}

function writeStorage(value: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, value);
}

/* ------------------------------------------------------------------ */
/*  Calibration: per-device tap latency offset                        */
/* ------------------------------------------------------------------ */

export interface CalibrationRecord {
  /** Average (tap − beat) in seconds. Positive = the player taps late. */
  offsetSec: number;
  /** Number of samples that produced the offset (UI shows this for trust). */
  sampleCount: number;
  /** ISO timestamp the calibration was captured. */
  measuredAt: string;
}

export function getCalibration(): CalibrationRecord | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CALIB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.offsetSec === 'number' &&
      typeof parsed.sampleCount === 'number' &&
      typeof parsed.measuredAt === 'string'
    ) {
      return parsed as CalibrationRecord;
    }
    return null;
  } catch {
    return null;
  }
}

export function setCalibration(record: CalibrationRecord): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CALIB_KEY, JSON.stringify(record));
  } catch {
    // storage unavailable — silently accept
  }
}

export function clearCalibration(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(CALIB_KEY);
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/*  First-run calibration suggestion: dismissal flag                  */
/* ------------------------------------------------------------------ */

/**
 * Whether the player has explicitly closed the Title-screen "try
 * calibration first" banner. JSON-encoded boolean to stay consistent
 * with the rest of this module's storage schema (and so a future
 * format bump can lift the value into a richer object without a
 * compatibility break).
 */
export function isCalibSuggestDismissed(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(CALIB_SUGGEST_DISMISSED_KEY);
    if (!raw) return false;
    return JSON.parse(raw) === true;
  } catch {
    return false;
  }
}

export function setCalibSuggestDismissed(dismissed: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CALIB_SUGGEST_DISMISSED_KEY, JSON.stringify(dismissed));
  } catch {
    // storage unavailable — banner will just reappear next visit
  }
}

/* ------------------------------------------------------------------ */
/*  Metronome accent overrides per time signature                     */
/* ------------------------------------------------------------------ */

/**
 * Per-time-sig accent override map. Key is "<numerator>/<denominator>"
 * (e.g. "6/8"); value is a boolean[] of length numerator where true =
 * accent (loud click), false = soft (ghost click). When a time
 * signature isn't in the map, the metronome falls back to its built-in
 * defaults (compound = group head, 5/8 = 3+2, 7/8 = 2+2+3,
 * everything else = all accented).
 */
export type MetronomeAccents = Record<string, boolean[]>;

export function getMetronomeAccents(): MetronomeAccents {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(METRONOME_ACCENTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: MetronomeAccents = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v) && v.every((x) => typeof x === 'boolean')) {
        out[k] = v as boolean[];
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function setMetronomeAccents(value: MetronomeAccents): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(METRONOME_ACCENTS_KEY, JSON.stringify(value));
  } catch {
    // storage unavailable — settings just won't persist this session
  }
}

/* ------------------------------------------------------------------ */
/*  Consecutive-fail streak per etude (#55 — assist mode trigger)     */
/* ------------------------------------------------------------------ */

/*
 * Per-etude counter of "B 以下 (= 不合格)" runs in a row. ResultScreen
 * increments this on a sub-pass-rank run and resets it on an A+ clear;
 * once it crosses an assist-mode threshold (currently 3) the Result
 * surfaces an "アシストを試す" CTA so the player can switch to the
 * scaffolded mode instead of grinding the same wall. Below-pass-
 * threshold runs (player picked a sub-stage-BPM tempo) and runs in
 * assist mode itself are excluded by the caller — they don't represent
 * "the player can't pass the étude" the way a real fail does.
 *
 * Stored as a JSON object keyed by etudeId. Reads default to {} on any
 * error (corrupt data, private mode, etc.); writes are best-effort.
 */

function readFailStreaks(): Record<string, number> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(FAIL_STREAK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      // Guard against stale / corrupted entries — non-integers and
      // negatives are dropped silently rather than thrown about.
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        out[k] = Math.floor(v);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeFailStreaks(value: Record<string, number>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(FAIL_STREAK_KEY, JSON.stringify(value));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export function getFailStreak(etudeId: string): number {
  return readFailStreaks()[etudeId] ?? 0;
}

export function incrementFailStreak(etudeId: string): number {
  const all = readFailStreaks();
  const next = (all[etudeId] ?? 0) + 1;
  all[etudeId] = next;
  writeFailStreaks(all);
  return next;
}

export function resetFailStreak(etudeId: string): void {
  const all = readFailStreaks();
  if (!(etudeId in all)) return;
  delete all[etudeId];
  writeFailStreaks(all);
}

