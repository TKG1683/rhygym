/**
 * Imperative VexFlow renderer for a 1-line percussion staff.
 *
 * Lays measures out left-to-right, wrapping to a new line when the
 * viewport width is exceeded. Returns a map from RhythmNote.id to the
 * rendered notehead's SVG coordinates so an overlay layer (judge line,
 * hit effects) can align with each note.
 */

import { Barline, Beam, Dot, Formatter, Renderer, Stave, StaveNote, Stem, Tuplet, Voice } from 'vexflow';
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
  /**
   * Per-measure width overrides. When provided, this wins over
   * `measureWidth` / `measuresPerLine` for sizing each bar — the
   * renderer uses entry `i` for measure `i`. Use this from Result to
   * give note-dense bars more room than sparse ones. Length must match
   * the score's measure count.
   */
  measureWidths?: readonly number[];
  /**
   * Strip the SVG's intrinsic width/height attributes after render so
   * CSS becomes the single source of sizing truth. Used by the Game
   * screen so a `max-height: <vh>` on the host wrapper can scale the
   * staff down uniformly via the viewBox. Off by default — Result
   * relies on the intrinsic width to trigger horizontal scroll.
   */
  responsiveScaling?: boolean;
}

const DEFAULT_MEASURE_WIDTH = 220;
const MIN_MEASURE_WIDTH = 100;
// Compact vertical layout. 62 px row pitch is the floor for our
// 5-line staff: VexFlow's middle-line note + stem up extends ~30 px
// above the middle line, so we need ~62 px between consecutive
// staves (stem-bottom of row N to stem-top of row N+1) to keep beams
// from colliding.
//
// STAVE_TOP_OFFSET is the empty band ABOVE the first staff line.
// 12 keeps the score sitting visually "high" in its frame; stem tops
// for ♪ flag groups still fit because VexFlow's stems-up extend
// ~15 px above the staff (= y ≥ -3, fully visible in the SVG).
//
// BOTTOM_PADDING is the empty band BELOW the last staff line, sized
// to cover stem-down (~15 px below the bottom staff line) plus a few
// pixels of breathing room. Smaller values clip the final row's
// stem-bottoms (visible as "notes cut off at the bottom").
const LINE_HEIGHT = 62;
const STAVE_TOP_OFFSET = 6;
const BOTTOM_PADDING = 32;
const FIRST_MEASURE_LEFT_PAD = 5;

export function renderScore(score: Score, opts: RenderOptions): RenderResult {
  opts.container.innerHTML = '';
  const vex = scoreToVex(score);

  // Resolve per-measure widths. Per-measure overrides (Result's
  // note-density-driven sizing) win; otherwise fall back to the
  // measuresPerLine / measureWidth scheme.
  const fallbackWidth = opts.measuresPerLine
    ? Math.max(MIN_MEASURE_WIDTH, Math.floor(opts.viewportWidth / opts.measuresPerLine))
    : (opts.measureWidth ?? DEFAULT_MEASURE_WIDTH);
  const widths: number[] = opts.measureWidths
    ? vex.measures.map((_, i) => opts.measureWidths![i] ?? fallbackWidth)
    : vex.measures.map(() => fallbackWidth);

  // measuresPerLine: explicit caller value wins; if per-measure widths
  // are supplied and no explicit cap is given, fit as many as the
  // running cumulative width allows.
  const measuresPerLine =
    opts.measuresPerLine ??
    (opts.measureWidths
      ? vex.measures.length // assume the caller will scroll horizontally
      : Math.max(1, Math.floor(opts.viewportWidth / fallbackWidth)));

  // Pre-compute x offsets per measure, restarting at each new line.
  const xOffsets: number[] = new Array(vex.measures.length);
  let lineCount = 0;
  let runX = 0;
  for (let i = 0; i < vex.measures.length; i++) {
    if (i % measuresPerLine === 0) {
      runX = 0;
      lineCount++;
    }
    xOffsets[i] = runX + FIRST_MEASURE_LEFT_PAD;
    runX += widths[i]!;
  }
  if (lineCount === 0) lineCount = 1;
  const height = lineCount * LINE_HEIGHT + BOTTOM_PADDING;

  // SVG width: pin to whichever is wider, the caller-supplied viewport
  // or the widest line we just laid out. Otherwise note tails on long
  // bars get clipped.
  const maxLineWidth = computeMaxLineWidth(widths, measuresPerLine);
  const svgWidth = Math.max(opts.viewportWidth, maxLineWidth + FIRST_MEASURE_LEFT_PAD * 2);

  const renderer = new Renderer(opts.container, Renderer.Backends.SVG);
  renderer.resize(svgWidth, height);
  const ctx = renderer.getContext();
  const noteCoords = new Map<string, NoteCoords>();

  vex.measures.forEach((m, idx) => {
    const lineIdx = Math.floor(idx / measuresPerLine);
    const measureWidth = widths[idx]!;
    const x = xOffsets[idx]!;
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
    // Draw the time signature on bar 1 AND on any bar where the meter
    // changes from the previous bar — without this, a meter switch
    // (e.g. Lv9-5 / Lv10) is silent on the staff and the player has
    // no way to know they're now in 5/8 / 7/8 / etc.
    const prevMeasure = idx > 0 ? vex.measures[idx - 1]! : null;
    const tsChanged =
      prevMeasure === null ||
      prevMeasure.numerator !== m.numerator ||
      prevMeasure.denominator !== m.denominator;
    if (tsChanged) {
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
    const tuplets = buildTuplets(staveNotes, m.notes);

    const voice = new Voice({ numBeats: m.numerator, beatValue: m.denominator });
    voice.setStrict(false);
    voice.addTickables(staveNotes);

    // Format width must respect the clef/timeSig that this stave already
    // consumed; otherwise the first note collides with the time signature.
    const formatWidth = Math.max(60, stave.getNoteEndX() - stave.getNoteStartX() - 10);
    new Formatter().joinVoices([voice]).format([voice], formatWidth);
    voice.draw(ctx, stave);
    beams.forEach((b) => b.setContext(ctx).draw());
    tuplets.forEach((t) => t.setContext(ctx).draw());

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

  // Always emit a viewBox so consumers can scale via CSS if they want
  // to. Only when responsiveScaling is on do we strip the intrinsic
  // pixel size — Result needs the pixel size so its horizontal scroll
  // wrapper still works.
  const svg = opts.container.querySelector('svg');
  if (svg) {
    svg.setAttribute('viewBox', `0 0 ${svgWidth} ${height}`);
    if (opts.responsiveScaling) {
      svg.removeAttribute('width');
      svg.removeAttribute('height');
    }
  }

  return { noteCoords, height };
}

function computeMaxLineWidth(widths: readonly number[], measuresPerLine: number): number {
  let maxW = 0;
  let lineW = 0;
  for (let i = 0; i < widths.length; i++) {
    if (i % measuresPerLine === 0) lineW = 0;
    lineW += widths[i]!;
    if (lineW > maxW) maxW = lineW;
  }
  return maxW;
}

/**
 * Group consecutive notes sharing a tupletGroupId into Tuplet brackets.
 * Each group becomes one Tuplet drawn above the run; without these the
 * notes look identical to plain duplets and the reader can't tell a
 * triplet from three eighths.
 */
function buildTuplets(staveNotes: StaveNote[], vexNotes: VexNote[]): Tuplet[] {
  const tuplets: Tuplet[] = [];
  const byGroup = new Map<number, { notes: StaveNote[]; shape: { num: number; denom: number } }>();
  for (let i = 0; i < vexNotes.length; i++) {
    const v = vexNotes[i]!;
    if (v.tupletGroupId == null || !v.tupletShape) continue;
    const entry = byGroup.get(v.tupletGroupId) ?? { notes: [], shape: v.tupletShape };
    entry.notes.push(staveNotes[i]!);
    byGroup.set(v.tupletGroupId, entry);
  }
  for (const { notes, shape } of byGroup.values()) {
    tuplets.push(
      new Tuplet(notes, { numNotes: shape.num, notesOccupied: shape.denom }),
    );
  }
  return tuplets;
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
