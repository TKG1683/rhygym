/**
 * Imperative VexFlow renderer for a 1-line percussion staff.
 *
 * Lays measures out left-to-right, wrapping to a new line when the
 * viewport width is exceeded. Returns a map from RhythmNote.id to the
 * rendered notehead's SVG coordinates so an overlay layer (judge line,
 * hit effects) can align with each note.
 */

import { Barline, Beam, Dot, Formatter, Renderer, Stave, StaveNote, Stem, Voice } from 'vexflow';
import { QUARTER_NOTE_TICKS, type Score } from '../../core/model';
import { scoreToVex, type VexNote } from './scoreToVex';

const BEAMABLE_DURATIONS = new Set(['8', '16', '32']);

export interface NoteCoords {
  noteId: string;
  /** Center x of the notehead in container SVG coordinates. */
  x: number;
  /** Center y of the notehead. */
  y: number;
  measureIdx: number;
  /** 0-based row index after measure wrapping. */
  lineIdx: number;
}

export interface RenderResult {
  noteCoords: Map<string, NoteCoords>;
  /** Total SVG height in pixels. */
  height: number;
}

export interface RenderOptions {
  container: HTMLDivElement;
  viewportWidth: number;
  measureWidth?: number;
  /**
   * Force a specific measures-per-line target. When set, the renderer
   * derives `measureWidth` from `viewportWidth / measuresPerLine` and
   * ignores any `measureWidth` value. Useful for pinning a layout
   * (e.g. "always 2 measures per row on mobile") instead of letting
   * row count drift with viewport size.
   */
  measuresPerLine?: number;
}

const DEFAULT_MEASURE_WIDTH = 220;
const MIN_MEASURE_WIDTH = 100;
const LINE_HEIGHT = 90;
const STAVE_TOP_OFFSET = 30;
const BOTTOM_PADDING = 30;
const FIRST_MEASURE_LEFT_PAD = 5;

export function renderScore(score: Score, opts: RenderOptions): RenderResult {
  opts.container.innerHTML = '';
  const vex = scoreToVex(score);
  // Caller-pinned measures-per-line wins: divide the viewport evenly
  // (clamped to MIN_MEASURE_WIDTH to keep notes readable on tiny screens).
  // Otherwise fall back to whatever fits at the requested measureWidth.
  const measureWidth = opts.measuresPerLine
    ? Math.max(MIN_MEASURE_WIDTH, Math.floor(opts.viewportWidth / opts.measuresPerLine))
    : (opts.measureWidth ?? DEFAULT_MEASURE_WIDTH);
  const measuresPerLine = opts.measuresPerLine
    ?? Math.max(1, Math.floor(opts.viewportWidth / measureWidth));
  const lineCount = Math.max(1, Math.ceil(vex.measures.length / measuresPerLine));
  const height = lineCount * LINE_HEIGHT + BOTTOM_PADDING;

  const renderer = new Renderer(opts.container, Renderer.Backends.SVG);
  renderer.resize(opts.viewportWidth, height);
  const ctx = renderer.getContext();
  const noteCoords = new Map<string, NoteCoords>();

  vex.measures.forEach((m, idx) => {
    const lineIdx = Math.floor(idx / measuresPerLine);
    const colIdx = idx % measuresPerLine;
    const x = colIdx * measureWidth + FIRST_MEASURE_LEFT_PAD;
    const y = lineIdx * LINE_HEIGHT + STAVE_TOP_OFFSET;

    const stave = new Stave(x, y, measureWidth);
    // Trick: keep the underlying 5-line geometry so VexFlow's note position
    // math (b/4 sits on the middle line) and the default barline height stay
    // correct, but hide every line except the middle one. This produces a
    // visually correct 1-line rhythm staff where noteheads sit on the line,
    // the 4/4 glyph straddles it, and barlines span the natural staff height.
    stave.setConfigForLines([
      { visible: false },
      { visible: false },
      { visible: true },
      { visible: false },
      { visible: false },
    ]);
    if (idx === 0) {
      stave.addTimeSignature(`${m.numerator}/${m.denominator}`);
    }
    stave.setEndBarType(Barline.type.SINGLE);
    stave.setContext(ctx).draw();

    const staveNotes = m.notes.map((vNote) => {
      const dotted = vNote.vexBaseDuration.endsWith('d');
      const base = dotted ? vNote.vexBaseDuration.slice(0, -1) : vNote.vexBaseDuration;
      const sn = new StaveNote({
        keys: ['b/4'],
        duration: vNote.isRest ? `${base}r` : base,
        autoStem: false,
      });
      // Force stem up so beams sit above the line consistently.
      sn.setStemDirection(Stem.UP);
      if (dotted) Dot.buildAndAttach([sn]);
      return sn;
    });

    // IMPORTANT: Build Beams BEFORE voice.draw(). `new Beam(notes)` attaches
    // itself to each note, and the per-note flag suppression flag is read
    // during voice.draw(). Creating beams after draw means each note has
    // already painted its flag — and we end up with flag + beam overlap.
    // (Beam.generateBeams() also doesn't suppress flags reliably; manual
    // `new Beam(notes)` is the only path that works.)
    const beams = buildBeams(staveNotes, m.notes);

    const voice = new Voice({ numBeats: m.numerator, beatValue: m.denominator });
    voice.setStrict(false);
    voice.addTickables(staveNotes);

    // Format width must respect the clef/timeSig that this stave already
    // consumed; otherwise the first note collides with the time signature.
    const formatWidth = Math.max(60, stave.getNoteEndX() - stave.getNoteStartX() - 10);
    new Formatter().joinVoices([voice]).format([voice], formatWidth);
    voice.draw(ctx, stave);
    beams.forEach((b) => b.setContext(ctx).draw());

    staveNotes.forEach((sn, i) => {
      const vNote = m.notes[i]!;
      if (vNote.isRest || vNote.originalNoteId === null) return;
      const bbox = sn.getBoundingBox();
      if (!bbox) return;
      noteCoords.set(vNote.originalNoteId, {
        noteId: vNote.originalNoteId,
        x: bbox.getX() + bbox.getW() / 2,
        y: bbox.getY() + bbox.getH() / 2,
        measureIdx: m.index,
        lineIdx,
      });
    });
  });

  return { noteCoords, height };
}

/**
 * Group consecutive 8th/16th/32nd notes within a measure into beam runs,
 * breaking at every quarter-note beat boundary. Returns a Beam per run of
 * 2+ notes; single notes stay un-beamed and render their own flag.
 */
function buildBeams(staveNotes: StaveNote[], vexNotes: VexNote[]): Beam[] {
  const beams: Beam[] = [];
  let run: StaveNote[] = [];
  let runBeat = -1;
  let tickInMeasure = 0;

  const flush = () => {
    if (run.length >= 2) beams.push(new Beam(run));
    run = [];
    runBeat = -1;
  };

  for (let i = 0; i < staveNotes.length; i++) {
    const sn = staveNotes[i]!;
    const vNote = vexNotes[i]!;
    const beamable = !vNote.isRest && BEAMABLE_DURATIONS.has(sn.getDuration());

    if (!beamable) {
      flush();
    } else {
      const noteBeat = Math.floor(tickInMeasure / QUARTER_NOTE_TICKS);
      if (run.length > 0 && noteBeat !== runBeat) flush();
      run.push(sn);
      runBeat = noteBeat;
    }
    tickInMeasure += vNote.ticks;
  }
  flush();

  return beams;
}
