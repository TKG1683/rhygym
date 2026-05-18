/**
 * Stage loader — pulls `public/stages/<id>/{stage.json, score.mid}`
 * over HTTP and parses them into the in-memory StageWithMeta shape
 * that StageSelect and GameView consume.
 *
 * Layout assumed under `public/stages/`:
 *   manifest.json                # { version: 1, stages: ['level-1', ...] }
 *   <id>/stage.json              # StageJson (metadata)
 *   <id>/score.mid               # MIDI bytes
 *
 * Bundled (offline) fallback is the caller's responsibility — this
 * module just throws on missing / malformed resources so the caller
 * can decide whether to fall back to the hardcoded STAGES roster.
 */

import { Midi } from '@tonejs/midi';
import { midiToScore } from '../midi/midiToScore';
import type { StageWithMeta } from './stages';

export interface StageManifest {
  version: number;
  stages: string[];
}

interface StageJson {
  id: string;
  name: string;
  description: string;
  bpm: number;
  level: number;
  themeColor: string;
  indexInLevel?: number;
  isExam?: boolean;
}

/** Build a URL relative to Vite's BASE_URL so GitHub Pages's /rhygym/ prefix is honored. */
function stagesUrl(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  // BASE_URL always has a trailing slash per Vite contract.
  return `${base}stages/${path}`;
}

export async function loadManifest(): Promise<StageManifest> {
  const res = await fetch(stagesUrl('manifest.json'));
  if (!res.ok) throw new Error(`manifest.json HTTP ${res.status}`);
  const data = (await res.json()) as Partial<StageManifest>;
  if (!Array.isArray(data.stages)) {
    throw new Error('manifest.json is missing a stages array');
  }
  return { version: data.version ?? 1, stages: data.stages };
}

export async function loadStage(id: string): Promise<StageWithMeta> {
  const [metaRes, midiRes] = await Promise.all([
    fetch(stagesUrl(`${id}/stage.json`)),
    fetch(stagesUrl(`${id}/score.mid`)),
  ]);
  if (!metaRes.ok) throw new Error(`${id}/stage.json HTTP ${metaRes.status}`);
  if (!midiRes.ok) throw new Error(`${id}/score.mid HTTP ${midiRes.status}`);

  const meta = (await metaRes.json()) as StageJson;
  const midiBuffer = await midiRes.arrayBuffer();
  const midi = new Midi(midiBuffer);
  const score = midiToScore(midi);

  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    bpm: meta.bpm,
    level: meta.level,
    themeColor: meta.themeColor,
    indexInLevel: meta.indexInLevel,
    isExam: meta.isExam,
    score,
  };
}

/**
 * Load every stage referenced by the manifest in parallel. Order in
 * the returned array matches the manifest's `stages` list.
 *
 * Throws if the manifest itself is unreachable or malformed. Throws
 * if ANY listed stage fails to load — partial loads are unsupported
 * by design (a half-loaded roster would confuse StageSelect's level
 * grouping later in #31). Callers wrap this in try/catch and decide
 * whether to fall back to a hardcoded roster.
 */
export async function loadAllStages(): Promise<StageWithMeta[]> {
  const manifest = await loadManifest();
  return Promise.all(manifest.stages.map((id) => loadStage(id)));
}
