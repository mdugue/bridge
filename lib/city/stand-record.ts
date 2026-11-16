/**
 * The stand record (plan 090, phase 0): one thing that stands — a crown, a
 * lamp, a bench — as the twenty bytes the vertex stage places it from, in
 * the layout the GPU draws from. A table of them is ten unsigned 16-bit
 * words a record, little-endian, so a file's bytes are the instance
 * buffer: the viewer makes a view, never a matrix
 * (app/_components/instancing.ts `Instances.ofStands`).
 *
 *   word 0–2   x, y, z   the place in the viewer's Y-up frame from the
 *                        table's origin: x and z in steps of STAND_STEP_M
 *                        (a tile's box: 2 048 m a side, 3 cm a step), the
 *                        height in STAND_STEP_Y_M (256 m of relief, 4 mm
 *                        a step: a foot's sink is 5 cm at the least,
 *                        lib/city/ground-join.ts `SINK`, and half a plan
 *                        step in height would be a third of it)
 *   word 3     turn      about the vertical, 0..2π over 0..65536
 *   word 4–6   sx, sy, sz  the scale of the set's geometry, × STAND_SCALE_UNIT
 *   word 7     spare     (a second turn, a lean, a drop: the kind's own)
 *   word 8     kind      two bytes the kind reads (a crown's: code, NDVI)
 *   word 9     more      two more (a crown's: genus, season jitter)
 *
 * Why words and not mixed widths: three keeps one typed array per
 * interleaved buffer and derives every attribute's vertex format from it
 * (WebGPUAttributeUtils, r187), so 16-bit and 8-bit fields share a buffer
 * only as 16-bit words; a shader that wants a byte takes it out of its
 * word (`standByte`). The origin reaches the shader as a uniform of the
 * drawn object, so every table of one material shares one build.
 *
 * A value a record cannot hold is never bent in silence: `writeStand`
 * counts every field it had to clamp, and a build that packs a table
 * fails on any (`packStands`, `strict`).
 *
 * No THREE, no DOM: the build writes it, the viewer and the tests read it.
 */

/** Bytes a record. */
export const STAND_RECORD_BYTES = 20;
/** 16-bit words a record. */
export const STAND_RECORD_WORDS = STAND_RECORD_BYTES / 2;
/** One step of a record's x and z (m): 65 535 steps span 2 048 m. */
export const STAND_STEP_M = 1 / 32;
/** One step of its height (m): 256 m of relief a table. */
export const STAND_STEP_Y_M = 1 / 256;
/** A record's scale is in units of 1 / STAND_SCALE_UNIT (up to 64×). */
export const STAND_SCALE_UNIT = 1024;
/** The turn's full circle. */
export const STAND_TURN_UNIT = 65_536;

/** Where each field starts in a record (words). */
export const STAND_WORD = {
  place: 0,
  turn: 3,
  scale: 4,
  spare: 7,
  kind: 8,
  more: 9,
} as const;

/** One thing that stands, in metres and radians. */
export interface Stand {
  /** two bytes for the kind (0..255 each) */
  kind?: readonly [number, number];
  /** two more */
  more?: readonly [number, number];
  /** the scale of the geometry along its own axes */
  scale: readonly [number, number, number];
  /** the kind's own 16 bits */
  spare?: number;
  /** the turn about the vertical (rad) */
  turn: number;
  x: number;
  y: number;
  z: number;
}

const TAU = Math.PI * 2;
const WORD_MAX = 65_535;

/** Fields the writes had to bend into their range (a place outside the
 *  table's box, a scale of 64 or more or one too small to tell from
 *  nothing, a byte outside 0..255). */
export interface StandPackReport {
  clamped: number;
}

/** `v` as a field of at most `max`, counted in `report` where it had to
 *  be bent: out of range, or a scale that is not nothing rounded to 0. */
function field(v: number, max: number, report: StandPackReport): number {
  const rounded = Math.round(v);
  if (rounded < 0 || rounded > max) {
    report.clamped += 1;
  }
  return Math.min(Math.max(rounded, 0), max);
}

/** A table's origin for `stands`: the corner all of them lie beyond, on
 *  whole metres (a tile's own box in a published table). */
export function standOrigin(
  stands: readonly Pick<Stand, "x" | "y" | "z">[]
): [number, number, number] {
  const origin: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  for (const s of stands) {
    origin[0] = Math.min(origin[0], s.x);
    origin[1] = Math.min(origin[1], s.y);
    origin[2] = Math.min(origin[2], s.z);
  }
  return stands.length === 0
    ? [0, 0, 0]
    : [Math.floor(origin[0]), Math.floor(origin[1]), Math.floor(origin[2])];
}

/** A scale's word, counted where it is out of range or too small to tell
 *  from nothing (the thing would vanish). */
function scaleWord(scale: number, report: StandPackReport): number {
  const scaled = scale * STAND_SCALE_UNIT;
  if (scaled > 0 && Math.round(scaled) === 0) {
    report.clamped += 1;
  }
  return field(scaled, WORD_MAX, report);
}

const UNCOUNTED: StandPackReport = { clamped: 0 };

/**
 * Writes record `index` of `words` from its fields, the place from
 * `origin`: what `writeStand` writes, without a `Stand` made for it — a
 * forest tile writes tens of thousands (lib/city/tree-stands.ts
 * `placementRecords`). `bytes` is the kind and more words' four bytes
 * packed (`standBytes`).
 */
export function writeStandFields(
  words: Uint16Array,
  index: number,
  place: { turn: number; x: number; y: number; z: number },
  scale: { sx: number; sy: number; sz: number },
  spare: number,
  bytes: number,
  origin: readonly [number, number, number],
  counted?: StandPackReport
): void {
  const report = counted ?? UNCOUNTED;
  const at = index * STAND_RECORD_WORDS;
  words[at] = field((place.x - origin[0]) / STAND_STEP_M, WORD_MAX, report);
  words[at + 1] = field(
    (place.y - origin[1]) / STAND_STEP_Y_M,
    WORD_MAX,
    report
  );
  words[at + 2] = field((place.z - origin[2]) / STAND_STEP_M, WORD_MAX, report);
  const turn = (((place.turn % TAU) + TAU) % TAU) / TAU;
  // (a full circle is no turn: 65 536 wraps to 0)
  words[at + STAND_WORD.turn] =
    Math.round(turn * STAND_TURN_UNIT) % STAND_TURN_UNIT;
  words[at + STAND_WORD.scale] = scaleWord(scale.sx, report);
  words[at + STAND_WORD.scale + 1] = scaleWord(scale.sy, report);
  words[at + STAND_WORD.scale + 2] = scaleWord(scale.sz, report);
  words[at + STAND_WORD.spare] = field(spare, WORD_MAX, report);
  words[at + STAND_WORD.kind] = bytes & 0xff_ff;
  words[at + STAND_WORD.more] = bytes >>> 16;
}

/** Four bytes (0..255 each) as `writeStandFields` takes them: the kind
 *  word's two, then the more word's; one out of range is counted. */
export function standBytes(
  kind: readonly [number, number],
  more: readonly [number, number],
  counted?: StandPackReport
): number {
  const report = counted ?? UNCOUNTED;
  return (
    (field(kind[0], 255, report) |
      (field(kind[1], 255, report) << 8) |
      (field(more[0], 255, report) << 16) |
      (field(more[1], 255, report) << 24)) >>>
    0
  );
}

/** Writes `stand` as record `index` of `words`, its place from `origin`;
 *  counts in `report` every field it had to bend. */
export function writeStand(
  words: Uint16Array,
  index: number,
  stand: Stand,
  origin: readonly [number, number, number],
  counted?: StandPackReport
): void {
  writeStandFields(
    words,
    index,
    stand,
    { sx: stand.scale[0], sy: stand.scale[1], sz: stand.scale[2] },
    stand.spare ?? 0,
    standBytes(stand.kind ?? ZERO_BYTES, stand.more ?? ZERO_BYTES, counted),
    origin,
    counted
  );
}

const ZERO_BYTES = [0, 0] as const;

/** `stands` as a table over its own buffer. `report` counts the fields
 *  that had to be bent; with `strict` (a build) any is an error. */
export function packStands(
  stands: readonly Stand[],
  origin: readonly [number, number, number],
  counted?: StandPackReport,
  strict = false
): Uint16Array<ArrayBuffer> {
  const report = counted ?? { clamped: 0 };
  const words = new Uint16Array(stands.length * STAND_RECORD_WORDS);
  for (let i = 0; i < stands.length; i += 1) {
    writeStand(words, i, stands[i], origin, report);
  }
  if (strict && report.clamped > 0) {
    throw new Error(
      `stand record: ${report.clamped} fields do not fit (a place outside the table's box, a scale out of range, a byte outside 0..255)`
    );
  }
  return words;
}

/** Record `index` of `words`, as the vertex stage reads it. */
export function standAt(
  words: Uint16Array,
  index: number,
  origin: readonly [number, number, number]
): Required<Stand> {
  const at = index * STAND_RECORD_WORDS;
  const kind = words[at + STAND_WORD.kind];
  const more = words[at + STAND_WORD.more];
  return {
    x: origin[0] + words[at] * STAND_STEP_M,
    y: origin[1] + words[at + 1] * STAND_STEP_Y_M,
    z: origin[2] + words[at + 2] * STAND_STEP_M,
    turn: (words[at + STAND_WORD.turn] / STAND_TURN_UNIT) * TAU,
    scale: [
      words[at + STAND_WORD.scale] / STAND_SCALE_UNIT,
      words[at + STAND_WORD.scale + 1] / STAND_SCALE_UNIT,
      words[at + STAND_WORD.scale + 2] / STAND_SCALE_UNIT,
    ],
    spare: words[at + STAND_WORD.spare],
    kind: [kind & 0xff, kind >> 8],
    more: [more & 0xff, more >> 8],
  };
}

/** How many records `words` holds. */
export const standCount = (words: Uint16Array): number =>
  Math.floor(words.length / STAND_RECORD_WORDS);

/**
 * A stand's matrix as the vertex stage composes it, column-major (three's
 * `Matrix4.elements`): place · turn about Y · scale.
 */
export function standMatrix(
  s: Pick<Stand, "scale" | "turn" | "x" | "y" | "z">
): number[] {
  const c = Math.cos(s.turn);
  const sn = Math.sin(s.turn);
  const [sx, sy, sz] = s.scale;
  return [
    c * sx,
    0,
    -sn * sx,
    0,
    0,
    sy,
    0,
    0,
    sn * sz,
    0,
    c * sz,
    0,
    s.x,
    s.y,
    s.z,
    1,
  ];
}
