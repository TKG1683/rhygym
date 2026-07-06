/**
 * The two menu loops, authored as note data (see bgm.ts for the synth
 * that renders them).
 *
 *   TITLE_FUNK  — a bright I–IV–V funk vamp in E: popping bass, off-beat
 *                 chord "chanks", a steady hat and a short turnaround
 *                 lick. Upbeat, "press Start" energy.
 *   SELECT_LOFI — a laid-back ii–V–I–vi loop in F: a warm pad bed,
 *                 electric-piano comping, a simple root/fifth bass and a
 *                 sparse bell melody. Calm browsing music.
 *
 * Times are in beats from the top of the loop; the player wraps the loop
 * seamlessly, so bar 4 is written to lead the ear back into bar 1.
 */

import type { BgmEvent, BgmTrack, VoiceName } from './bgm';

/** Scientific-pitch note name (e.g. "E2", "G#4", "Bb3") → MIDI number. */
function n(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(name);
  if (!m) throw new Error(`bad note name: ${name}`);
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const octave = Number(m[3]);
  return 12 * (octave + 1) + base[m[1]!]! + accidental;
}

/** One same-voice chord/note hit → one BgmEvent per pitch. */
function hit(voice: VoiceName, t: number, d: number, g: number, names: string[]): BgmEvent[] {
  return names.map((name) => ({ t, d, note: n(name), voice, g }));
}

const BEATS_PER_BAR = 4;
/** Beat offset of bar `b` (0-indexed). */
const bar = (b: number): number => b * BEATS_PER_BAR;

/* ------------------------------------------------------------------ */
/*  TITLE — cheerful funk (I–IV–V in E), 106 BPM                       */
/* ------------------------------------------------------------------ */

// Chord roots per bar: E, E, A, B (I I IV V).
const FUNK_ROOTS = ['E2', 'E2', 'A2', 'B2'];
// Upper-structure "chank" voicings (9th chords) that ride over each root.
const FUNK_STAB: Record<string, string[]> = {
  E2: ['G#3', 'B3', 'D4', 'F#4'],
  A2: ['C#4', 'E4', 'G4', 'B4'],
  B2: ['D#4', 'F#4', 'A4', 'C#5'],
};

function funkBass(b: number, root: string): BgmEvent[] {
  // A syncopated octave-pop riff, transposed to each bar's root.
  const r = n(root);
  const notes: Array<[number, number, number, number]> = [
    // [beat, dur, semitone offset from root, gain]
    [0.0, 0.35, 0, 1.0],
    [0.75, 0.2, 0, 0.85],
    [1.5, 0.2, 12, 0.8],
    [2.0, 0.35, 0, 0.95],
    [2.5, 0.2, 7, 0.8],
    [3.0, 0.2, 0, 0.85],
    [3.5, 0.2, 10, 0.75],
  ];
  return notes.map(([beat, d, semi, g]) => ({
    t: bar(b) + beat,
    d,
    note: r + semi,
    voice: 'bass' as const,
    g,
  }));
}

function funkBar(b: number): BgmEvent[] {
  const root = FUNK_ROOTS[b]!;
  const stab = FUNK_STAB[root]!;
  const events: BgmEvent[] = [];
  events.push(...funkBass(b, root));
  // Off-beat chord chanks — short and bright, on the syncopated slots.
  for (const beat of [0.5, 1.5, 2.5, 3.75]) {
    events.push(...hit('stab', bar(b) + beat, 0.14, 0.9, stab));
  }
  // Eighth-note hats, funk-accented on the "and" of each beat.
  for (let i = 0; i < 8; i++) {
    const beat = i * 0.5;
    const onBeat = i % 2 === 0;
    events.push({ t: bar(b) + beat, d: 0.12, note: 0, voice: 'hat', g: onBeat ? 0.4 : 0.7 });
  }
  return events;
}

const FUNK_EVENTS: BgmEvent[] = [
  ...funkBar(0),
  ...funkBar(1),
  ...funkBar(2),
  ...funkBar(3),
  // Turnaround lick in bar 4 that spills back into the top of the loop.
  ...hit('lead', bar(3) + 3.0, 0.25, 0.55, ['B4']),
  ...hit('lead', bar(3) + 3.5, 0.25, 0.55, ['A4']),
  ...hit('lead', bar(3) + 3.75, 0.25, 0.6, ['G#4']),
];

export const TITLE_FUNK: BgmTrack = {
  bpm: 106,
  bars: 4,
  beatsPerBar: BEATS_PER_BAR,
  gain: 0.5,
  events: FUNK_EVENTS,
};

/* ------------------------------------------------------------------ */
/*  SELECT — lo-fi chill (ii–V–I–vi in F), 72 BPM                      */
/* ------------------------------------------------------------------ */

// Gm7 → C7 → Fmaj7 → Dm7, voiced tight in the 53–65 range for smooth
// voice-leading between bars.
const LOFI_CHORDS: string[][] = [
  ['G3', 'Bb3', 'D4', 'F4'], // Gm7
  ['G3', 'Bb3', 'C4', 'E4'], // C7 (rootless-ish)
  ['F3', 'A3', 'C4', 'E4'], // Fmaj7
  ['F3', 'A3', 'C4', 'D4'], // Dm7
];
// [root, fifth] bass per bar.
const LOFI_BASS: Array<[string, string]> = [
  ['G2', 'D3'],
  ['C3', 'G2'],
  ['F2', 'C3'],
  ['D3', 'A2'],
];

function lofiBar(b: number): BgmEvent[] {
  const chord = LOFI_CHORDS[b]!;
  const [root, fifth] = LOFI_BASS[b]!;
  const events: BgmEvent[] = [];
  // Warm sustained pad under the whole bar (root/third/fifth only, so it
  // doesn't muddy the ep comping on top).
  events.push(...hit('pad', bar(b), 3.9, 0.5, [chord[0]!, chord[1]!, chord[2]!]));
  // Electric-piano comp: a downbeat hit and a laid-back "and of 3" push.
  events.push(...hit('ep', bar(b) + 0.0, 1.6, 0.8, chord));
  events.push(...hit('ep', bar(b) + 2.5, 1.2, 0.6, chord));
  // Simple root/fifth bass.
  events.push({ t: bar(b) + 0.0, d: 1.6, note: n(root), voice: 'bass', g: 0.85 });
  events.push({ t: bar(b) + 2.0, d: 1.2, note: n(fifth), voice: 'bass', g: 0.7 });
  // Soft backbeat hats on 2 and 4 for a gentle pulse.
  events.push({ t: bar(b) + 1.0, d: 0.1, note: 0, voice: 'hat', g: 0.3 });
  events.push({ t: bar(b) + 3.0, d: 0.1, note: 0, voice: 'hat', g: 0.3 });
  return events;
}

const LOFI_EVENTS: BgmEvent[] = [
  ...lofiBar(0),
  ...lofiBar(1),
  ...lofiBar(2),
  ...lofiBar(3),
  // Sparse bell melody across the back half so the loop has a hook
  // without crowding the calm.
  ...hit('ep', bar(2) + 0.0, 1.0, 0.5, ['C5']),
  ...hit('ep', bar(2) + 2.0, 1.0, 0.5, ['A4']),
  ...hit('ep', bar(3) + 1.5, 2.0, 0.45, ['G4']),
];

export const SELECT_LOFI: BgmTrack = {
  bpm: 72,
  bars: 4,
  beatsPerBar: BEATS_PER_BAR,
  gain: 0.42,
  events: LOFI_EVENTS,
};

/* ------------------------------------------------------------------ */
/*  ETUDE LIST — bouncy upbeat groove (I–vi–IV–V in G), 98 BPM        */
/* ------------------------------------------------------------------ */

// A brighter, faster cousin of the two menu loops: once you're actually
// picking an étude the mood lifts into a driving pop-funk groove.
// Gmaj7 → Em7 → Cmaj7 → D7, distinct from the title's heavy E funk by
// key, register and its light electric-piano comp.
const GROOVE_ROOTS = ['G2', 'E2', 'C2', 'D2'];
const GROOVE_CHORD: Record<string, string[]> = {
  G2: ['G3', 'B3', 'D4', 'F#4'], // Gmaj7
  E2: ['E3', 'G3', 'B3', 'D4'], // Em7
  C2: ['G3', 'B3', 'C4', 'E4'], // Cmaj7
  D2: ['F#3', 'A3', 'C4', 'D4'], // D7
};

function grooveBass(b: number, root: string): BgmEvent[] {
  // Disco octave bass: root/octave bounce on the eighths with a fifth
  // lift on beat 3. Staccato so it drives without booming.
  const r = n(root);
  const steps: Array<[number, number]> = [
    // [beat, semitone offset from root]
    [0.0, 0],
    [0.5, 12],
    [1.0, 0],
    [1.5, 12],
    [2.0, 0],
    [2.5, 12],
    [3.0, 7],
    [3.5, 12],
  ];
  return steps.map(([beat, semi]) => ({
    t: bar(b) + beat,
    d: 0.22,
    note: r + semi,
    voice: 'bass' as const,
    g: 0.9,
  }));
}

function grooveBar(b: number): BgmEvent[] {
  const root = GROOVE_ROOTS[b]!;
  const chord = GROOVE_CHORD[root]!;
  const events: BgmEvent[] = [];
  events.push(...grooveBass(b, root));
  // Electric-piano comp: a downbeat chord plus syncopated "and" pushes
  // for the pop bounce.
  events.push(...hit('ep', bar(b) + 0.0, 0.4, 0.7, chord));
  events.push(...hit('ep', bar(b) + 1.5, 0.3, 0.6, chord));
  events.push(...hit('ep', bar(b) + 2.5, 0.3, 0.6, chord));
  events.push(...hit('ep', bar(b) + 3.5, 0.3, 0.55, chord));
  // Straight eighth hats, lightly accented on the off-beats.
  for (let i = 0; i < 8; i++) {
    const onBeat = i % 2 === 0;
    events.push({ t: bar(b) + i * 0.5, d: 0.11, note: 0, voice: 'hat', g: onBeat ? 0.35 : 0.6 });
  }
  return events;
}

// Catchy lead hook that arcs across the four bars and picks the ear back
// up into bar 1.
const GROOVE_LEAD: Array<[number, number, number, string]> = [
  // [bar, beat, dur, note]
  [0, 0.0, 0.5, 'G4'],
  [0, 1.5, 0.5, 'B4'],
  [0, 2.5, 1.0, 'D5'],
  [1, 0.0, 0.5, 'B4'],
  [1, 1.5, 0.5, 'A4'],
  [1, 2.5, 1.0, 'G4'],
  [2, 0.0, 0.5, 'E4'],
  [2, 1.5, 0.5, 'G4'],
  [2, 2.5, 1.0, 'C5'],
  [3, 0.0, 0.5, 'D4'],
  [3, 1.5, 0.5, 'F#4'],
  [3, 2.5, 0.5, 'A4'],
  [3, 3.5, 0.5, 'B4'],
];

const GROOVE_EVENTS: BgmEvent[] = [
  ...grooveBar(0),
  ...grooveBar(1),
  ...grooveBar(2),
  ...grooveBar(3),
  ...GROOVE_LEAD.map(([b, beat, d, name]) => ({
    t: bar(b) + beat,
    d,
    note: n(name),
    voice: 'lead' as const,
    g: 0.5,
  })),
];

export const ETUDE_GROOVE: BgmTrack = {
  bpm: 98,
  bars: 4,
  beatsPerBar: BEATS_PER_BAR,
  gain: 0.46,
  events: GROOVE_EVENTS,
};
