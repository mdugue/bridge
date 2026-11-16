/**
 * The stand record (plan 090, phase 0): one thing that stands — a crown, a
 * lamp, a bench — as the twenty bytes the vertex stage places it from, in
 * the layout the GPU draws from. A table of them is ten unsigned 16-bit
 * words a record, little-endian, so a file's bytes are the instance
 * buffer: the viewer makes a view, never a matrix
 * (app/_components/instancing.ts `Instances.ofStands`).
 *
 *   word 0–2   x, y, z   the place in the viewer's Y-up frame, in steps of
 *                        STAND_STEP_M from the table's origin (a tile's
 *                        box: 2 048 m a side, 3 cm a step)
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
 * No THREE, no DOM: the build writes it, the viewer and the tests read it.
 */

/** Bytes a record. */
export const STAND_RECORD_BYTES = 20;
/** 16-bit words a record. */
export const STAND_RECORD_WORDS = STAND_RECORD_BYTES / 2;
/** One step of a record's place (m): 65 535 steps span 2 048 m. */
export const STAND_STEP_M = 1 / 32;
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
const word = (v: number): number =>
  Math.min(Math.max(Math.round(v), 0), WORD_MAX);
const byte = (v: number): number => Math.min(Math.max(Math.round(v), 0), 255);

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

/** Writes `stand` as record `index` of `words`, its place from `origin`. */
export function writeStand(
  words: Uint16Array,
  index: number,
  stand: Stand,
  origin: readonly [number, number, number]
): void {
  const at = index * STAND_RECORD_WORDS;
  words[at] = word((stand.x - origin[0]) / STAND_STEP_M);
  words[at + 1] = word((stand.y - origin[1]) / STAND_STEP_M);
  words[at + 2] = word((stand.z - origin[2]) / STAND_STEP_M);
  const turn = (((stand.turn % TAU) + TAU) % TAU) / TAU;
  // (a full circle is no turn: 65 536 wraps to 0)
  words[at + STAND_WORD.turn] =
    Math.round(turn * STAND_TURN_UNIT) % STAND_TURN_UNIT;
  for (let axis = 0; axis < 3; axis += 1) {
    words[at + STAND_WORD.scale + axis] = word(
      stand.scale[axis] * STAND_SCALE_UNIT
    );
  }
  words[at + STAND_WORD.spare] = word(stand.spare ?? 0);
  const [k0, k1] = stand.kind ?? [0, 0];
  words[at + STAND_WORD.kind] = byte(k0) | (byte(k1) << 8);
  const [m0, m1] = stand.more ?? [0, 0];
  words[at + STAND_WORD.more] = byte(m0) | (byte(m1) << 8);
}

/** `stands` as a table over its own buffer. */
export function packStands(
  stands: readonly Stand[],
  origin: readonly [number, number, number]
): Uint16Array<ArrayBuffer> {
  const words = new Uint16Array(stands.length * STAND_RECORD_WORDS);
  for (let i = 0; i < stands.length; i += 1) {
    writeStand(words, i, stands[i], origin);
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
    y: origin[1] + words[at + 1] * STAND_STEP_M,
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
