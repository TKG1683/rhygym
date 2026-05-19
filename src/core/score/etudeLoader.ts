/**
 * Etude loader — pulls `public/etudes/<id>/{etude.json, score.mid}`
 * over HTTP and parses them into the in-memory EtudeWithMovementMeta
 * shape that MovementSelect and GameView consume.
 *
 * Layout assumed under `public/etudes/`:
 *   manifest.json                # { version: 1, etudes: ['movement-1-etude-1', ...] }
 *   <id>/etude.json              # EtudeJson (metadata)
 *   <id>/score.mid               # MIDI bytes
 *
 * Bundled (offline) fallback is the caller's responsibility — this
 * module just throws on missing / malformed resources so the caller
 * can decide whether to fall back to the hardcoded ETUDES roster.
 */

import { Midi } from '@tonejs/midi';
import { midiToScore } from '../midi/midiToScore';
import type { EtudeWithMovementMeta } from './etudes';

export interface EtudeManifest {
  version: number;
  etudes: string[];
}

interface EtudeJson {
  id: string;
  name: string;
  description: string;
  bpm: number;
  movement: number;
  themeColor: string;
  indexInMovement?: number;
  isFinal?: boolean;
}

/** Build a URL relative to Vite's BASE_URL so GitHub Pages's /rhygym/ prefix is honored. */
function etudesUrl(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  // BASE_URL always has a trailing slash per Vite contract.
  return `${base}etudes/${path}`;
}

export async function loadManifest(): Promise<EtudeManifest> {
  const res = await fetch(etudesUrl('manifest.json'));
  if (!res.ok) throw new Error(`manifest.json HTTP ${res.status}`);
  const data = (await res.json()) as Partial<EtudeManifest>;
  if (!Array.isArray(data.etudes)) {
    throw new Error('manifest.json is missing an etudes array');
  }
  return { version: data.version ?? 1, etudes: data.etudes };
}

export async function loadEtude(id: string): Promise<EtudeWithMovementMeta> {
  const [metaRes, midiRes] = await Promise.all([
    fetch(etudesUrl(`${id}/etude.json`)),
    fetch(etudesUrl(`${id}/score.mid`)),
  ]);
  if (!metaRes.ok) throw new Error(`${id}/etude.json HTTP ${metaRes.status}`);
  if (!midiRes.ok) throw new Error(`${id}/score.mid HTTP ${midiRes.status}`);

  const meta = (await metaRes.json()) as EtudeJson;
  const midiBuffer = await midiRes.arrayBuffer();
  const midi = new Midi(midiBuffer);
  const score = midiToScore(midi);

  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    bpm: meta.bpm,
    movement: meta.movement,
    themeColor: meta.themeColor,
    indexInMovement: meta.indexInMovement,
    isFinal: meta.isFinal,
    score,
  };
}

/**
 * Load every étude referenced by the manifest in parallel. Order in
 * the returned array matches the manifest's `etudes` list.
 *
 * Throws if the manifest itself is unreachable or malformed. Throws
 * if ANY listed étude fails to load — partial loads are unsupported
 * by design (a half-loaded roster would confuse MovementSelect's
 * Movement grouping). Callers wrap this in try/catch and decide
 * whether to fall back to a hardcoded roster.
 */
export async function loadAllEtudes(): Promise<EtudeWithMovementMeta[]> {
  const manifest = await loadManifest();
  return Promise.all(manifest.etudes.map((id) => loadEtude(id)));
}
