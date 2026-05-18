/**
 * Score → @tonejs/midi Midi. Inverse of src/core/midi/midiToScore.ts,
 * lives on the script side so we can write the result to disk during
 * `npm run gen:stages`.
 *
 * Notes:
 * - PPQ is hardcoded to Rhygym's 480 (matches @tonejs/midi's default).
 * - Pitches are written as middle C — Rhygym ignores pitch anyway,
 *   but MIDI files need a number.
 * - Rests aren't a real MIDI concept; we simply skip them so the gap
 *   between the previous note's end and the next note's onset
 *   represents the rest.
 */

import { createRequire } from 'node:module';
import type { Score } from '../../src/core/model';

// @tonejs/midi publishes a CommonJS entry point and no `exports`
// field, so a plain ESM `import { Midi }` fails under tsx/Node ESM.
// createRequire is the standard escape hatch for this case.
const require = createRequire(import.meta.url);
const { Midi } = require('@tonejs/midi') as typeof import('@tonejs/midi');
type Midi = InstanceType<typeof Midi>;

const MIDDLE_C = 60;
const DEFAULT_VELOCITY = 0.8;

export function scoreToMidi(score: Score): Midi {
  const m = new Midi();

  // setTempo without explicit ticks defaults to tick=0; for any later
  // tempo changes we push to header.tempos directly.
  for (let i = 0; i < score.tempos.length; i++) {
    const t = score.tempos[i]!;
    if (i === 0 && t.tick === 0) {
      m.header.setTempo(t.bpm);
    } else {
      m.header.tempos.push({
        ticks: t.tick,
        bpm: t.bpm,
        time: 0, // recomputed by tonejs/midi when needed
      });
    }
  }

  for (const ts of score.timeSigs) {
    m.header.timeSignatures.push({
      ticks: ts.tick,
      timeSignature: [ts.numerator, ts.denominator],
      measures: 0,
    });
  }

  const track = m.addTrack();
  for (const n of score.notes) {
    if (n.isRest) continue;
    track.addNote({
      midi: MIDDLE_C,
      ticks: n.tick,
      durationTicks: n.durationTicks,
      velocity: DEFAULT_VELOCITY,
    });
  }

  return m;
}
