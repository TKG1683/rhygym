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

import type { Rank } from '../judgement/score';

const STORAGE_KEY_V1 = 'rhygym:best:v1';
const STORAGE_KEY = 'rhygym:best:v2';
const CALIB_KEY = 'rhygym:calibration:v1';
const CALIB_SUGGEST_DISMISSED_KEY = 'rhygym:calibSuggestDismissed:v1';
const METRONOME_ACCENTS_KEY = 'rhygym:metronomeAccents:v1';

export interface BestRecord {
  etudeId: string;
  score: number;
  rank: Rank;
  /** ISO timestamp of when this score was set. */
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
  // v2 already populated — never re-touch v1.
  if (localStorage.getItem(STORAGE_KEY) !== null) return;
  const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
  if (rawV1 === null) return;
  try {
    const parsed = JSON.parse(rawV1);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      // malformed v1 — drop it so we don't keep retrying every read.
      localStorage.removeItem(STORAGE_KEY_V1);
      return;
    }
    const migrated: Record<string, BestRecord> = {};
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
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

export function getAllBests(): Record<string, BestRecord> {
  try {
    migrateV1ToV2IfNeeded();
    const raw = readStorage();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, BestRecord>;
    }
    return {};
  } catch {
    return {};
  }
}

export function getBest(etudeId: string): BestRecord | null {
  return getAllBests()[etudeId] ?? null;
}

/**
 * Write `record` as the new best for its étude. Caller decides "best" —
 * this is unconditional. Failure to write (storage disabled / quota
 * exceeded) is swallowed so a play in private browsing still works.
 */
export function setBest(record: BestRecord): void {
  try {
    const all = getAllBests();
    all[record.etudeId] = record;
    writeStorage(JSON.stringify(all));
  } catch {
    // localStorage unavailable — accept silently; in-memory result is
    // unaffected, the player just won't see the new BEST next time.
  }
}

/**
 * Returns true if `candidate.score` would beat the existing best for
 * the étude (or there is no existing best). Lets callers decide whether
 * to write + flash a "NEW BEST!" badge.
 */
export function isNewBest(candidate: { etudeId: string; score: number }): boolean {
  const existing = getBest(candidate.etudeId);
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

