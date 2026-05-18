/**
 * Convert a parsed @tonejs/midi `Midi` instance into Rhygym's internal
 * Score type. Rhythm-only — pitches and velocities are discarded.
 *
 * Tick handling:
 * - Rhygym's internal timebase is PPQ=480. If the source MIDI uses a
 *   different ppq we rescale every tick value so downstream code can
 *   trust the constant.
 * - durationTicks for very short MIDI notes can rescale to 0; clamp to
 *   at least 1 tick so the note still has a positive length.
 */

import type { Midi } from '@tonejs/midi';
import {
  PPQ,
  type RhythmNote,
  type Score,
  type TempoEvent,
  type TimeSignatureEvent,
} from '../model';

const DEFAULT_TEMPO_BPM = 120;
const DEFAULT_TIMESIG: TimeSignatureEvent = { tick: 0, numerator: 4, denominator: 4 };

export function midiToScore(midi: Midi): Score {
  const sourcePpq = midi.header.ppq;
  // Rescale every source tick into Rhygym's PPQ=480 frame. If the
  // source already runs at 480 the multiplier is just 1.
  const scaleTick = (t: number) => Math.round((t * PPQ) / sourcePpq);

  const tempos: TempoEvent[] = midi.header.tempos.map((t) => ({
    tick: scaleTick(t.ticks),
    bpm: t.bpm,
  }));

  const timeSigs: TimeSignatureEvent[] = midi.header.timeSignatures.map((ts) => ({
    tick: scaleTick(ts.ticks),
    numerator: ts.timeSignature[0]!,
    denominator: ts.timeSignature[1]!,
  }));

  // Rhythm scores are typically single-track but flatten anyway so a
  // multi-track export (e.g. from MuseScore) still works.
  const allMidiNotes = midi.tracks.flatMap((t) => t.notes);
  allMidiNotes.sort((a, b) => a.ticks - b.ticks);

  const notes: RhythmNote[] = allMidiNotes.map((n, i) => ({
    id: `n${i}`,
    tick: scaleTick(n.ticks),
    durationTicks: Math.max(1, scaleTick(n.durationTicks)),
    isRest: false,
  }));

  // totalTicks: end of the last note. If the file is empty (no notes
  // and no tempo info) leave it at 0; the rest of the app handles
  // empty scores already.
  let totalTicks = 0;
  for (const n of notes) {
    const end = n.tick + n.durationTicks;
    if (end > totalTicks) totalTicks = end;
  }

  return {
    tempos: tempos.length > 0 ? tempos : [{ tick: 0, bpm: DEFAULT_TEMPO_BPM }],
    timeSigs: timeSigs.length > 0 ? timeSigs : [DEFAULT_TIMESIG],
    notes,
    totalTicks,
  };
}
