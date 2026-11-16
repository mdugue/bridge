import { expect, test } from "bun:test";
import {
  DRESSING_SECTIONS,
  emptyPack,
  fieldAt,
  packDressing,
  SECTION_NAMES,
  sectionStride,
  unpackDressing,
  vertexLayout,
} from "./dressing-pack";
import type { DressingPack, PackRun, SectionName } from "./dressing-pack";
import { STAND_RECORD_BYTES, STAND_WORD } from "./stand-record";

const buffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

const run = (start: number, count: number, cx = 0): PackRun => ({
  cx,
  cz: -3,
  group: 2,
  start,
  count,
  box: [1.5, 100, -20, 250, 131.25, -0.5],
  reach: 4.5,
});

/** A pack with `count` records of every section, each word its own. */
function filled(count: number): DressingPack {
  const pack = emptyPack([412_000, 5_656_000, 104]);
  for (const [s, name] of SECTION_NAMES.entries()) {
    const { words } = DRESSING_SECTIONS[name];
    pack.sections[name] = {
      runs: [run(0, 1, s), run(1, count - 1, s + 10)],
      words: Uint16Array.from(
        { length: count * words },
        (_, i) => (i * 7919 + s * 131) % 65_536
      ),
    };
  }
  return pack;
}

test("every section's record is a multiple of four bytes, its fields within it", () => {
  for (const name of SECTION_NAMES) {
    const spec = DRESSING_SECTIONS[name];
    expect([name, sectionStride(name) % 4]).toEqual([name, 0]);
    const covered = new Set<number>();
    for (const f of spec.fields) {
      for (let w = f.at; w < f.at + f.words; w += 1) {
        // no word is two fields'
        expect([name, f.name, covered.has(w)]).toEqual([name, f.name, false]);
        covered.add(w);
      }
      expect(f.at + f.words).toBeLessThanOrEqual(spec.words);
    }
  }
});

test("a pack round-trips: every section's records, its runs and the corner", () => {
  const pack = filled(5);
  const back = unpackDressing(buffer(packDressing(pack)));
  expect(back?.origin).toEqual(pack.origin);
  for (const name of SECTION_NAMES) {
    expect([name, Array.from(back?.sections[name].words ?? [])]).toEqual([
      name,
      Array.from(pack.sections[name].words),
    ]);
    expect(back?.sections[name].runs).toEqual([...pack.sections[name].runs]);
  }
});

test("a section's records are a view of the file's bytes, at a multiple of four", () => {
  const file = buffer(packDressing(filled(3)));
  const back = unpackDressing(file);
  for (const name of SECTION_NAMES) {
    const words = back?.sections[name].words;
    expect(words?.buffer).toBe(file);
    expect((words?.byteOffset ?? 1) % 4).toBe(0);
  }
});

test("a tile with nothing still has every section, empty", () => {
  const back = unpackDressing(buffer(packDressing(emptyPack([1, 2, 3]))));
  expect(Object.keys(back?.sections ?? {}).toSorted()).toEqual(
    [...SECTION_NAMES].toSorted()
  );
  for (const name of SECTION_NAMES) {
    expect(back?.sections[name].words).toHaveLength(0);
    expect(back?.sections[name].runs).toEqual([]);
  }
});

test("the stand section's vertex layout is the table's, and the stand record's", () => {
  // what a set of records draws with (app/_components/instancing.ts takes
  // exactly these views): derived from the table, so a file's layout and
  // the GPU's cannot differ
  expect(vertexLayout("stand")).toEqual([
    { attribute: "iPlace", itemSize: 4, offset: 0 },
    { attribute: "iSize", itemSize: 4, offset: 4 },
    { attribute: "iKind", itemSize: 2, offset: 8 },
  ]);
  expect(sectionStride("stand")).toBe(STAND_RECORD_BYTES);
  expect(fieldAt("stand", "place")).toBe(STAND_WORD.place);
  expect(fieldAt("stand", "size")).toBe(STAND_WORD.scale);
  expect(fieldAt("stand", "kind")).toBe(STAND_WORD.kind);
  // a table the viewer reads and rewrites draws with none of its own
  expect(vertexLayout("trees")).toEqual([]);
  expect(vertexLayout("register")).toEqual([]);
});

/** `pack`'s file with its `index`-th directory entry rewritten. */
function withEntry(
  pack: DressingPack,
  index: number,
  edit: (view: DataView, entry: number) => void
): ArrayBuffer {
  const file = buffer(packDressing(pack));
  edit(new DataView(file), 32 + index * 24);
  return file;
}

test("an unknown section, another record size, a wrong magic are refused", () => {
  const pack = filled(2);
  expect(
    unpackDressing(
      withEntry(pack, 1, (view, entry) => view.setUint8(entry, 88))
    )
  ).toBeNull();
  expect(
    unpackDressing(
      withEntry(pack, 0, (view, entry) => view.setUint32(entry + 8, 12, true))
    )
  ).toBeNull();
  const file = buffer(packDressing(pack));
  new DataView(file).setUint8(0, 0);
  expect(unpackDressing(file)).toBeNull();
  expect(unpackDressing(new ArrayBuffer(8))).toBeNull();
});

test("records or runs that leave the file are refused", () => {
  const pack = filled(2);
  const whole = packDressing(pack);
  expect(unpackDressing(buffer(whole.subarray(0, -4)))).toBeNull();
  expect(
    unpackDressing(
      withEntry(pack, 2, (view, entry) => view.setUint32(entry + 12, 99, true))
    )
  ).toBeNull();
});

/** `pack`'s file with run `r` (counted over every section) rewritten. */
function withRun(
  pack: DressingPack,
  r: number,
  edit: (view: DataView, at: number) => void
): ArrayBuffer {
  const file = buffer(packDressing(pack));
  edit(new DataView(file), 32 + SECTION_NAMES.length * 24 + r * 48);
  return file;
}

/** Where a directory entry holds its records' offset; a run its start and
 *  its count. */
const ENTRY_OFFSET = 16;
const RUN_START = 8;
const RUN_COUNT = 12;

test("records that start inside the directory or the runs are refused", () => {
  const pack = filled(2);
  const runsFrom = 32 + SECTION_NAMES.length * 24;
  const recordsFrom = runsFrom + SECTION_NAMES.length * 2 * 48;
  // sanity: the first section's records start right after the runs
  const whole = new DataView(buffer(packDressing(pack)));
  expect(whole.getUint32(32 + ENTRY_OFFSET, true)).toBe(recordsFrom);
  for (const at of [
    // inside the header, the directory, the first run, the last run
    0,
    32,
    runsFrom,
    recordsFrom - 48,
    recordsFrom - 4,
  ]) {
    expect([
      at,
      unpackDressing(
        withEntry(pack, 0, (view, entry) =>
          view.setUint32(entry + ENTRY_OFFSET, at, true)
        )
      ),
    ]).toEqual([at, null]);
  }
});

test("records off a four-byte boundary are refused", () => {
  // a section alone, with room behind it, so only the boundary is wrong
  const pack = emptyPack([0, 0, 0]);
  pack.sections.trees = { runs: [], words: new Uint16Array(12) };
  const file = packDressing(pack);
  const grown = new Uint8Array(file.length + 4);
  grown.set(file);
  const index = SECTION_NAMES.indexOf("trees");
  const entry = 32 + index * 24 + ENTRY_OFFSET;
  const view = new DataView(grown.buffer);
  const at = view.getUint32(entry, true);
  // every later section is empty: move them along
  for (let i = index + 1; i < SECTION_NAMES.length; i += 1) {
    view.setUint32(32 + i * 24 + ENTRY_OFFSET, at + 28, true);
  }
  expect(unpackDressing(grown.buffer)).not.toBeNull();
  view.setUint32(entry, at + 2, true);
  expect(unpackDressing(grown.buffer)).toBeNull();
});

test("a section's records that lie in another's are refused", () => {
  const pack = filled(2);
  const whole = new DataView(buffer(packDressing(pack)));
  const first = whole.getUint32(32 + ENTRY_OFFSET, true);
  // the second section at the first one's records, whole and aligned
  expect(
    unpackDressing(
      withEntry(pack, 1, (view, entry) =>
        view.setUint32(entry + ENTRY_OFFSET, first, true)
      )
    )
  ).toBeNull();
});

test("runs that are not the section's records in order, each once, are refused", () => {
  const pack = filled(3);
  // as packed: [0, 1) and [1, 3)
  expect(unpackDressing(buffer(packDressing(pack)))).not.toBeNull();
  const edits: [string, (view: DataView, at: number) => void, number][] = [
    // the second run starts at the section's end, past every record
    ["past", (v, at) => v.setUint32(at + RUN_START, 3, true), 1],
    ["overlap", (v, at) => v.setUint32(at + RUN_START, 0, true), 1],
    ["gap", (v, at) => v.setUint32(at + RUN_START, 2, true), 1],
    ["late", (v, at) => v.setUint32(at + RUN_START, 1, true), 0],
    ["short", (v, at) => v.setUint32(at + RUN_COUNT, 1, true), 1],
    ["long", (v, at) => v.setUint32(at + RUN_COUNT, 5, true), 1],
  ];
  for (const [what, edit, r] of edits) {
    expect([what, unpackDressing(withRun(pack, r, edit))]).toEqual([
      what,
      null,
    ]);
  }
  const twice = emptyPack([0, 0, 0]);
  twice.sections.trees = {
    runs: [run(0, 1), run(0, 1)],
    words: new Uint16Array(12),
  };
  expect(() => packDressing(twice)).toThrow("in order, each once");
});

test("a section whose words are no whole records, or a run past them, does not pack", () => {
  const odd = emptyPack([0, 0, 0]);
  odd.sections.trees = { runs: [], words: new Uint16Array(7) };
  expect(() => packDressing(odd)).toThrow("not a multiple");
  const past = emptyPack([0, 0, 0]);
  past.sections.trees = { runs: [run(0, 2)], words: new Uint16Array(6) };
  expect(() => packDressing(past)).toThrow("leaves its records");
});

test("a field is found by its name, an unknown one is an error", () => {
  const name: SectionName = "register";
  expect(fieldAt(name, "index")).toBe(7);
  expect(() => fieldAt(name, "colour")).toThrow("no field");
});
