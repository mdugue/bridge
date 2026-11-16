/**
 * A terrain level's dressing as one file (plan 090, phase 1): a magic, the
 * corner its records count from, a directory and the sections — tables of
 * fixed records, each a row of unsigned 16-bit words, little-endian, sorted
 * by 250 m vegetation chunk. One table of sections, `DRESSING_SECTIONS`,
 * says what a record of each holds; the packer, the reader and — for a
 * section the GPU draws from as it is — the vertex layout are derived from
 * it, so the file's layout cannot differ from the one a set draws with
 * (app/_components/instancing.ts takes its views from `vertexLayout`).
 * Published pre-gzipped as `dressing_<tile>.drs.gz` (a fine level's) and
 * `dressing_<tile>.c.drs.gz` (a coarse level's); every tile has both, with
 * empty sections where it has nothing. No THREE, no DOM.
 *
 * Why words: three keeps one typed array per interleaved buffer and takes
 * every view's vertex format from it (lib/city/stand-record.ts), so a
 * record's fields are words, and a byte or a few bits are taken out of
 * their word by whoever reads them.
 *
 * Layout:
 *
 *   bytes 0–3     "DRS1"
 *   bytes 4–7     uint32 sections
 *   bytes 8–31    float64 × 3: the corner — easting, northing (the site's
 *                 CRS) and elevation (m) — every record's place counts from
 *   then, a section: 8 bytes of name (ASCII, NUL-padded), uint32 words a
 *                 record, uint32 records, uint32 the records' byte offset,
 *                 uint32 runs
 *   then, a run (every section's, in the directory's order), 48 bytes:
 *                 int16 cx, cz (the chunk, lib/city/tree-placement.ts
 *                 `cellKey`), uint16 group, uint16 0, uint32 first record,
 *                 uint32 records, float32 × 8: the box of its records in
 *                 the viewer's Y-up frame (min x, y, z; max x, y, z), how
 *                 far a record reaches sideways beyond its place, 0
 *   then the sections' records, each section at a multiple of four bytes:
 *                 a typed-array view needs no copy.
 */

/** A field of a record: its first word, how many words it spans and — in
 *  a section a set draws from — the instance attribute that views it. */
export interface RecordField {
  at: number;
  attribute?: string;
  name: string;
  words: number;
}

/** One kind of table. */
export interface SectionSpec {
  fields: readonly RecordField[];
  /** words a record (two bytes each; even, so a record is a multiple of
   *  four bytes) */
  words: number;
}

/**
 * The sections a dressing file may hold, and what a record of each is.
 *
 * - `stand`: one thing that stands as the vertex stage places it
 *   (lib/city/stand-record.ts) — the layout a set of records draws with.
 * - `trees`: a canopy or row tree as the build measured it
 *   (lib/city/tree-table.ts), twelve bytes; the viewer makes its stand
 *   record from it.
 * - `register`: a surveyed tree (the cadastre's, OSM's, an orchard's),
 *   twenty bytes, likewise.
 */
export const DRESSING_SECTIONS = {
  stand: {
    words: 10,
    fields: [
      { name: "place", at: 0, words: 4, attribute: "iPlace" },
      { name: "size", at: 4, words: 4, attribute: "iSize" },
      { name: "kind", at: 8, words: 2, attribute: "iKind" },
    ],
  },
  trees: {
    words: 6,
    fields: [
      { name: "place", at: 0, words: 3 },
      { name: "height", at: 3, words: 1 },
      { name: "crown", at: 4, words: 1 },
      { name: "slope", at: 5, words: 1 },
    ],
  },
  register: {
    words: 10,
    fields: [
      { name: "place", at: 0, words: 3 },
      { name: "height", at: 3, words: 1 },
      { name: "crown", at: 4, words: 1 },
      { name: "trunk", at: 5, words: 1 },
      { name: "year", at: 6, words: 1 },
      { name: "index", at: 7, words: 1 },
      { name: "leaves", at: 8, words: 1 },
      { name: "slope", at: 9, words: 1 },
    ],
  },
} as const satisfies Record<string, SectionSpec>;

export type SectionName = keyof typeof DRESSING_SECTIONS;

export const SECTION_NAMES = Object.keys(DRESSING_SECTIONS) as SectionName[];

/** Bytes a record of `section`. */
export const sectionStride = (section: SectionName): number =>
  DRESSING_SECTIONS[section].words * 2;

/** Where `field` of `section` starts in a record (words). */
export function fieldAt(section: SectionName, field: string): number {
  const found = (
    DRESSING_SECTIONS[section].fields as readonly RecordField[]
  ).find((f) => f.name === field);
  if (!found) {
    throw new Error(`dressing pack: ${section} has no field ${field}`);
  }
  return found.at;
}

/** One instance attribute over a section's records. */
export interface VertexView {
  attribute: string;
  /** words an instance */
  itemSize: number;
  /** its first word in a record */
  offset: number;
}

/** The instance attributes a set draws a section's records with: the
 *  fields that name one, each a view of the one interleaved buffer. */
export function vertexLayout(section: SectionName): VertexView[] {
  return (DRESSING_SECTIONS[section].fields as readonly RecordField[]).flatMap(
    (f) =>
      f.attribute
        ? [{ attribute: f.attribute, itemSize: f.words, offset: f.at }]
        : []
  );
}

/** A run of a section's records: one vegetation chunk's (and, where a
 *  section groups them, one group's). */
export interface PackRun {
  /** min x, y, z and max x, y, z of the run's records in the viewer's
   *  Y-up frame (m), their tops included */
  box: readonly [number, number, number, number, number, number];
  count: number;
  cx: number;
  cz: number;
  group: number;
  /** how far a record reaches sideways beyond its place (m) */
  reach: number;
  start: number;
}

export interface PackSection {
  runs: readonly PackRun[];
  /** the records, `words` a record */
  words: Uint16Array;
}

/** A dressing file's content. */
export interface DressingPack {
  /** easting, northing and elevation every record's place counts from */
  origin: readonly [number, number, number];
  sections: Record<SectionName, PackSection>;
}

const MAGIC = "DRS1";
const HEADER_BYTES = 32;
const ENTRY_BYTES = 24;
const NAME_BYTES = 8;
const RUN_BYTES = 48;
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** A section with nothing in it. */
export const emptySection = (): PackSection => ({
  runs: [],
  words: new Uint16Array(0),
});

/** A pack with every section empty. */
export function emptyPack(
  origin: readonly [number, number, number]
): DressingPack {
  return {
    origin,
    sections: Object.fromEntries(
      SECTION_NAMES.map((name) => [name, emptySection()])
    ) as Record<SectionName, PackSection>,
  };
}

const aligned = (bytes: number): number => Math.ceil(bytes / 4) * 4;

function checked(name: SectionName, section: PackSection): number {
  const { words } = DRESSING_SECTIONS[name];
  if (section.words.length % words !== 0) {
    throw new Error(
      `dressing pack: ${name} holds ${section.words.length} words, not a multiple of ${words}`
    );
  }
  const count = section.words.length / words;
  for (const run of section.runs) {
    if (run.start < 0 || run.count < 0 || run.start + run.count > count) {
      throw new Error(`dressing pack: a run of ${name} leaves its records`);
    }
  }
  if (!runsCover(section.runs, count)) {
    throw new Error(
      `dressing pack: the runs of ${name} are not its records in order, each once`
    );
  }
  return count;
}

function writeRun(view: DataView, at: number, run: PackRun): void {
  view.setInt16(at, run.cx, true);
  view.setInt16(at + 2, run.cz, true);
  view.setUint16(at + 4, run.group, true);
  view.setUint32(at + 8, run.start, true);
  view.setUint32(at + 12, run.count, true);
  for (let i = 0; i < 6; i += 1) {
    view.setFloat32(at + 16 + i * 4, run.box[i], true);
  }
  view.setFloat32(at + 40, run.reach, true);
}

/** `pack` as a file's bytes: every section of the table, in its order. */
export function packDressing(pack: DressingPack): Uint8Array {
  const counts = SECTION_NAMES.map((name) =>
    checked(name, pack.sections[name])
  );
  const runs = SECTION_NAMES.reduce(
    (sum, name) => sum + pack.sections[name].runs.length,
    0
  );
  let offset = aligned(
    HEADER_BYTES + SECTION_NAMES.length * ENTRY_BYTES + runs * RUN_BYTES
  );
  const offsets = SECTION_NAMES.map((name) => {
    const at = offset;
    offset = aligned(offset + pack.sections[name].words.byteLength);
    return at;
  });
  const bytes = new Uint8Array(offset);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < MAGIC.length; i += 1) {
    view.setUint8(i, MAGIC.codePointAt(i) ?? 0);
  }
  view.setUint32(4, SECTION_NAMES.length, true);
  for (let axis = 0; axis < 3; axis += 1) {
    view.setFloat64(8 + axis * 8, pack.origin[axis], true);
  }
  let runAt = HEADER_BYTES + SECTION_NAMES.length * ENTRY_BYTES;
  for (const [index, name] of SECTION_NAMES.entries()) {
    const section = pack.sections[name];
    const entry = HEADER_BYTES + index * ENTRY_BYTES;
    for (let i = 0; i < name.length; i += 1) {
      view.setUint8(entry + i, name.codePointAt(i) ?? 0);
    }
    view.setUint32(entry + NAME_BYTES, DRESSING_SECTIONS[name].words, true);
    view.setUint32(entry + NAME_BYTES + 4, counts[index], true);
    view.setUint32(entry + NAME_BYTES + 8, offsets[index], true);
    view.setUint32(entry + NAME_BYTES + 12, section.runs.length, true);
    for (const run of section.runs) {
      writeRun(view, runAt, run);
      runAt += RUN_BYTES;
    }
    for (let i = 0; i < section.words.length; i += 1) {
      view.setUint16(offsets[index] + i * 2, section.words[i], true);
    }
  }
  return bytes;
}

function readRun(view: DataView, at: number): PackRun {
  const box = [0, 0, 0, 0, 0, 0] as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  for (let i = 0; i < 6; i += 1) {
    box[i] = view.getFloat32(at + 16 + i * 4, true);
  }
  return {
    cx: view.getInt16(at, true),
    cz: view.getInt16(at + 2, true),
    group: view.getUint16(at + 4, true),
    start: view.getUint32(at + 8, true),
    count: view.getUint32(at + 12, true),
    box,
    reach: view.getFloat32(at + 40, true),
  };
}

/** A section's records as words: a view of the file's bytes on a
 *  little-endian platform (every one a browser runs on), read one by one
 *  elsewhere. */
function wordsOf(buffer: ArrayBuffer, offset: number, n: number): Uint16Array {
  if (LITTLE_ENDIAN) {
    return new Uint16Array(buffer, offset, n);
  }
  const view = new DataView(buffer);
  const words = new Uint16Array(n);
  for (let i = 0; i < n; i += 1) {
    words[i] = view.getUint16(offset + i * 2, true);
  }
  return words;
}

function sectionName(view: DataView, entry: number): string {
  let name = "";
  for (let i = 0; i < NAME_BYTES; i += 1) {
    const code = view.getUint8(entry + i);
    if (code !== 0) {
      name += String.fromCodePoint(code);
    }
  }
  return name;
}

const isSection = (name: string): name is SectionName =>
  Object.hasOwn(DRESSING_SECTIONS, name);

/** Whether `runs` are a section's records in order, each once: the first
 *  at record 0, each where the one before ended, the last at the section's
 *  end (a section without runs is not cut into any). */
export function runsCover(runs: readonly PackRun[], count: number): boolean {
  let at = 0;
  for (const run of runs) {
    if (run.start !== at) {
      return false;
    }
    at += run.count;
  }
  return runs.length === 0 || at === count;
}

/**
 * The pack of a file's bytes, or null for anything that is not one: a
 * wrong magic, a section this table does not know or one whose record is
 * of another size (a file of another build), records or runs that leave
 * the buffer, records that start inside the directory, the runs or
 * another section's records, runs that are not the section's records in
 * order, each once. A section the file lacks is empty.
 */
export function unpackDressing(buffer: ArrayBuffer): DressingPack | null {
  if (buffer.byteLength < HEADER_BYTES) {
    return null;
  }
  const view = new DataView(buffer);
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (view.getUint8(i) !== (MAGIC.codePointAt(i) ?? 0)) {
      return null;
    }
  }
  const sections = view.getUint32(4, true);
  let runAt = HEADER_BYTES + sections * ENTRY_BYTES;
  if (runAt > buffer.byteLength) {
    return null;
  }
  // the records start after the directory and every section's runs
  let recordsFrom = runAt;
  for (let index = 0; index < sections; index += 1) {
    recordsFrom +=
      view.getUint32(
        HEADER_BYTES + index * ENTRY_BYTES + NAME_BYTES + 12,
        true
      ) * RUN_BYTES;
  }
  const pack = emptyPack([
    view.getFloat64(8, true),
    view.getFloat64(16, true),
    view.getFloat64(24, true),
  ]);
  // where the section before ended: no two sections share a record
  let recordsEnd = recordsFrom;
  for (let index = 0; index < sections; index += 1) {
    const entry = HEADER_BYTES + index * ENTRY_BYTES;
    const name = sectionName(view, entry);
    const words = view.getUint32(entry + NAME_BYTES, true);
    const count = view.getUint32(entry + NAME_BYTES + 4, true);
    const offset = view.getUint32(entry + NAME_BYTES + 8, true);
    const runCount = view.getUint32(entry + NAME_BYTES + 12, true);
    if (
      !isSection(name) ||
      DRESSING_SECTIONS[name].words !== words ||
      offset % 4 !== 0 ||
      offset < recordsEnd ||
      offset + count * words * 2 > buffer.byteLength ||
      runAt + runCount * RUN_BYTES > buffer.byteLength
    ) {
      return null;
    }
    recordsEnd = offset + count * words * 2;
    const runs: PackRun[] = [];
    for (let r = 0; r < runCount; r += 1) {
      runs.push(readRun(view, runAt));
      runAt += RUN_BYTES;
    }
    if (!runsCover(runs, count)) {
      return null;
    }
    pack.sections[name] = {
      runs,
      words: wordsOf(buffer, offset, count * words),
    };
  }
  return pack;
}
