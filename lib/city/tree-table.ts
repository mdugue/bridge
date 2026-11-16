/**
 * A tile's trees as the build hands them over (plan 090, phase 1): the
 * `trees` and `register` sections of a dressing file
 * (lib/city/dressing-pack.ts) — each tree where it stands **with the
 * ground under it baked in** (its height, the slope at its foot) and the
 * orthophoto's greenness there, so the viewer reads no ground, no raster
 * and no GeoJSON to stand it. What a record holds is what was measured,
 * never what is derived from it: a tree's turn, the touch its size varies
 * by, its crown's frame and its season's offset are hashes and arithmetic
 * of the measured values (`canopyPlacement`, `inventoryTree`), and a
 * record that carried them would be half noise — measured on the forest
 * tile, the tree as the vertex stage places it (lib/city/stand-record.ts)
 * gzips to 16 bytes a tree, this record to 5–7 (plan 090, *Findings*). The
 * viewer makes the stand record from it (app/_components/tree-stands.ts).
 *
 * A tile's trees are split between its two levels' files: the third of
 * them the coarse level draws (lib/city/coarse-crowns.ts `drawnCoarse`)
 * are in the coarse level's file alone, and the fine level, which draws
 * every tree, reads both — the coarse level's is loaded before the fine
 * one shows.
 *
 * A canopy or row tree (`trees`, six words):
 *
 *   word 0, 2   easting, northing from the file's corner, decimetres (the
 *               bakes write one decimal)
 *   word 1      the ground under it over the corner's elevation, in steps
 *               of TREE_STEP_Y_M
 *   word 3      bits 0–9 its measured height (dm; 0 = not measured), then
 *               EVERGREEN, PINE, ROAD (its crown reaches over a
 *               carriageway), PHOTO (an evergreen the leaf-off orthophoto
 *               showed) and ROW (a tree of a mapped row, not a measured
 *               one: the height is its drawn one)
 *   word 4      low byte the laser scan's crown radius (dm; 0 = none; a
 *               ROW tree's turn, 0..π over 0..255); high byte the NDVI
 *               (× 254; 255 = none)
 *   word 5      the ground's slope at its foot along x and z, two bytes
 *               (signed, × 127, + 128)
 *
 * A surveyed tree (`register`, ten words): words 0–2 as above;
 *
 *   word 3      bits 0–9 its height (dm), 10–12 its archetype, then GLOBE,
 *               EVERGREEN and MEASURED (an orchard tree the surface model
 *               measured)
 *   word 4      bits 0–9 its crown's width (dm), 10–11 its foliage colour,
 *               12–13 its source (0 the register, 1 OSM, 2 an orchard)
 *   word 5      its trunk's diameter at breast height (cm; 0 = none)
 *   word 6      its planting year (0 = none)
 *   word 7      its row in the tile's tree file — which is its row among
 *               the tree facts a card reads (`treeFacts`) — as the step
 *               from the record before it (the first: from 0): a file's
 *               surveyed trees are in their source's order, and a step
 *               is a small number where a row is not
 *   word 8      low byte its genus, high byte the NDVI
 *   word 9      the slope, as a canopy tree's
 *
 * No THREE, no DOM.
 */
import type { Steps } from "./build-steps";
import { fieldAt, sectionStride } from "./dressing-pack";
import type { DressingPack } from "./dressing-pack";
import type { TreeFeature } from "./features";
import type { RecenterOffset } from "./ground-clamp";
import type { JoinPoint } from "./ground-join";
import type { InventoryTree } from "./tree-inventory";
import { inventoryTree } from "./tree-inventory";
import { BASE_TREE_H, canopyPlacement, rowTree } from "./tree-placement";
import type { CanopyFacts, Placement } from "./tree-placement";

/** Words a record. */
export const TREE_WORDS = sectionStride("trees") / 2;
export const REGISTER_WORDS = sectionStride("register") / 2;

/** One step of a record's easting and northing (m): the decimetre the
 *  bakes write. */
const STEP_M = 0.1;
/** One step of the ground's height (m): 2 048 m of relief a file. A
 *  record's ground is the step at or below the ground's own (a foot's
 *  sink, ADR 0030: up to 3.1 cm under, never over) — a trunk's roots turn
 *  to earth over 45 cm, and the rings round it lie 5 cm proud
 *  (app/_components/tree-foot.ts). */
export const TREE_STEP_Y_M = 1 / 32;
/** The slope's bytes are multiples of this (of ± 127): within 3 % of the
 *  ground's slope, where the feet are draped toward the eye by 8 % of
 *  their reach (app/_components/tree-foot.ts `DRAPE_SLOPE`). Every bit
 *  here is the ground's noise on the wire: a byte in full cost the forest
 *  tile's fine level 51 kB. */
export const TREE_SLOPE_STEP = 8;
/** The NDVI's byte is a multiple of this (of 254): 32 steps of greenness
 *  under each crown's own touch of colour. */
export const TREE_NDVI_STEP = 8;

const WORD_MAX = 65_535;
const HEIGHT_BITS = 10;
const HEIGHT_MAX = (1 << HEIGHT_BITS) - 1;
const NO_NDVI = 255;

const T = {
  place: fieldAt("trees", "place"),
  height: fieldAt("trees", "height"),
  crown: fieldAt("trees", "crown"),
  slope: fieldAt("trees", "slope"),
} as const;

const R = {
  place: fieldAt("register", "place"),
  height: fieldAt("register", "height"),
  crown: fieldAt("register", "crown"),
  trunk: fieldAt("register", "trunk"),
  year: fieldAt("register", "year"),
  index: fieldAt("register", "index"),
  leaves: fieldAt("register", "leaves"),
  slope: fieldAt("register", "slope"),
} as const;

/** The height word's flags of a canopy tree, over its ten bits. */
const EVERGREEN = 1 << HEIGHT_BITS;
const PINE = 2 << HEIGHT_BITS;
const ROAD = 4 << HEIGHT_BITS;
const PHOTO = 8 << HEIGHT_BITS;
const ROW = 16 << HEIGHT_BITS;

/** A register tree's: its archetype in bits 10–12, then these. */
const ARCHETYPE_SHIFT = HEIGHT_BITS;
const GLOBE = 1 << 13;
const REGISTER_EVERGREEN = 1 << 14;
const MEASURED = 1 << 15;
const COLOUR_SHIFT = 10;
const SOURCE_SHIFT = 12;
const SOURCES = [undefined, "osm", "orchard"] as const;

/** Fields a table could not hold as they are (a place outside the file's
 *  box, a height past its bits): a build fails on any. */
export interface TreePackReport {
  clamped: number;
  /** slopes steeper than their byte holds, kept at its steepest step: no
   *  failure, a bank is that steep */
  steep?: number;
}

/** The ground a tree stands on, as the build read it. */
interface Standing {
  /** easting and northing (the site's CRS) */
  e: number;
  ground: number;
  n: number;
  /** the NDVI there, 0..1 */
  ndvi?: number;
  /** the ground's slope along x and z (lib/city/ground-clamp.ts
   *  `groundSlope`) */
  slope: readonly [number, number];
}

/** A canopy or row tree as measured. */
export interface TreeFact extends Standing, CanopyFacts {
  /** an evergreen the leaf-off orthophoto showed (`ls: "dop"`) */
  photo?: boolean;
  /** a mapped row's tree: its vertical scale and its turn */
  row?: { rot: number; s: number };
}

/** A surveyed tree as its file has it. */
export interface RegisterFact extends Standing {
  /** its row in the tile's tree file (the orchard trees after it); in a
   *  record, the step from the record before it (`writeRegister`,
   *  `registerAt`) */
  index: number;
  props: NonNullable<TreeFeature["properties"]>;
}

function field(v: number, max: number, report: TreePackReport): number {
  const rounded = Math.round(v);
  if (!(rounded >= 0 && rounded <= max)) {
    report.clamped += 1;
  }
  return Math.min(Math.max(Number.isFinite(rounded) ? rounded : 0, 0), max);
}

/** The most steps a slope's byte holds either way: ± 15 of
 *  `TREE_SLOPE_STEP` round 128, so the byte stays a byte (16 would be 256). */
const SLOPE_STEPS = Math.floor(127 / TREE_SLOPE_STEP);

/** A height in decimetres; a measured one under half a decimetre stays
 *  one decimetre, since 0 says "not measured". */
function heightField(h: number, report: TreePackReport): number {
  if (!Number.isFinite(h)) {
    return 0;
  }
  return h > 0 ? Math.max(field(h * 10, HEIGHT_MAX, report), 1) : 0;
}

/** A slope as its byte: steps of `TREE_SLOPE_STEP` of 127 round 128. A bank
 *  steeper than the byte holds (about 0.945, 43°) keeps its side at the
 *  steepest step and is counted (`steep`): the feet drape as far as they
 *  go, the way the ground falls. */
function slopeByte(s: number, report: TreePackReport): number {
  const steps = Math.round((s * 127) / TREE_SLOPE_STEP);
  const held = Math.min(
    Math.max(Number.isFinite(steps) ? steps : 0, -SLOPE_STEPS),
    SLOPE_STEPS
  );
  if (held !== steps) {
    report.steep = (report.steep ?? 0) + 1;
  }
  return held * TREE_SLOPE_STEP + 128;
}

const ndviByte = (ndvi: number | undefined): number =>
  ndvi === undefined || !Number.isFinite(ndvi)
    ? NO_NDVI
    : Math.min(
        Math.max(Math.round((ndvi * 254) / TREE_NDVI_STEP), 0) * TREE_NDVI_STEP,
        254 - (254 % TREE_NDVI_STEP)
      );

function writeStanding(
  words: Uint16Array,
  at: number,
  s: Standing,
  origin: readonly [number, number, number],
  report: TreePackReport
): void {
  words[at] = field((s.e - origin[0]) / STEP_M, WORD_MAX, report);
  // down to the step, never up: a foot stands in the ground or on it,
  // never over it (ADR 0030; `treeJoins` reports each)
  words[at + 1] = field(
    Math.floor((s.ground - origin[2]) / TREE_STEP_Y_M),
    WORD_MAX,
    report
  );
  words[at + 2] = field((s.n - origin[1]) / STEP_M, WORD_MAX, report);
}

const slopeWord = (
  slope: readonly [number, number],
  report: TreePackReport
): number => slopeByte(slope[0], report) | (slopeByte(slope[1], report) << 8);

/** Writes `tree` as record `index` of a `trees` section. */
export function writeTree(
  words: Uint16Array,
  index: number,
  tree: TreeFact,
  origin: readonly [number, number, number],
  report: TreePackReport
): void {
  const at = index * TREE_WORDS;
  writeStanding(words, at + T.place, tree, origin, report);
  const drawn = tree.row ? tree.row.s * BASE_TREE_H : tree.h;
  words[at + T.height] =
    heightField(drawn, report) |
    (tree.evergreen ? EVERGREEN : 0) |
    (tree.evergreen && tree.pine ? PINE : 0) |
    (tree.c ? ROAD : 0) |
    (tree.evergreen && tree.photo ? PHOTO : 0) |
    (tree.row ? ROW : 0);
  const low = tree.row
    ? Math.min(Math.max(Math.round((tree.row.rot / Math.PI) * 255), 0), 255)
    : // (a radius past the byte is past every crown's clamp: 0.75 of its
      // height, lib/city/tree-placement.ts `canopyCrownWidth`)
      Math.min(Math.max(Math.round((tree.r ?? 0) * 10), 0), 255);
  words[at + T.crown] = low | (ndviByte(tree.ndvi) << 8);
  words[at + T.slope] = slopeWord(tree.slope, report);
}

/** Writes `tree` as record `index` of a `register` section; `before` is
 *  the row of the record before it (0 for the first). */
export function writeRegister(
  words: Uint16Array,
  index: number,
  tree: RegisterFact,
  origin: readonly [number, number, number],
  report: TreePackReport,
  before = 0
): void {
  const at = index * REGISTER_WORDS;
  const p = tree.props;
  writeStanding(words, at + R.place, tree, origin, report);
  words[at + R.height] =
    field(p.h * 10, HEIGHT_MAX, report) |
    (field(p.a, 7, report) << ARCHETYPE_SHIFT) |
    (p.g === 1 ? GLOBE : 0) |
    (p.l === "e" ? REGISTER_EVERGREEN : 0) |
    (p.m === 1 ? MEASURED : 0);
  words[at + R.crown] =
    field(p.d * 10, HEIGHT_MAX, report) |
    (field(p.c ?? 0, 3, report) << COLOUR_SHIFT) |
    (Math.max(SOURCES.indexOf(p.s), 0) << SOURCE_SHIFT);
  words[at + R.trunk] = field(p.t ?? 0, WORD_MAX, report);
  words[at + R.year] = field(p.y ?? 0, WORD_MAX, report);
  words[at + R.index] = field(tree.index - before, WORD_MAX, report);
  words[at + R.leaves] =
    field(p.gn ?? 0, 255, report) | (ndviByte(tree.ndvi) << 8);
  words[at + R.slope] = slopeWord(tree.slope, report);
}

const ndviOf = (byte: number): number | undefined =>
  byte === NO_NDVI ? undefined : byte / 254;

const slopeOf = (word: number): [number, number] => [
  (word & 0xff) - 128,
  (word >> 8) - 128,
];

/**
 * Record `index` of a `trees` section as the tree the fine level draws
 * (`canopyPlacement`, `rowTree`), its slope with it, and what a card says
 * of it (`measured`: its height as measured, 0 for a row's; `photo`).
 *
 * A canopy point's easting and northing are the float32 offsets the packed
 * canopy file held before (lib/city/point-pack.ts), so each tree keeps the
 * turn and the touch of size its coordinates seed.
 */
export function treeAt(
  words: Uint16Array,
  index: number,
  origin: readonly [number, number, number],
  offset: RecenterOffset
): {
  measured: number;
  p: Placement;
  photo: boolean;
  row: boolean;
  /** a laser-scan crown (it has a radius), not the surface model's */
  scan: boolean;
} {
  const at = index * TREE_WORDS;
  const ex = origin[0] + Math.fround(words[at + T.place] * STEP_M);
  const ey = origin[1] + Math.fround(words[at + T.place + 2] * STEP_M);
  const ground = origin[2] + words[at + T.place + 1] * TREE_STEP_Y_M;
  const height = words[at + T.height];
  const crown = words[at + T.crown];
  const dm = height & HEIGHT_MAX;
  const ndvi = ndviOf(crown >> 8);
  const slope = slopeOf(words[at + T.slope]);
  const photo = (height & PHOTO) !== 0;
  if ((height & ROW) !== 0) {
    const p = rowTree(
      ex,
      ey,
      ground,
      dm / 10 / BASE_TREE_H,
      ((crown & 0xff) / 255) * Math.PI,
      offset,
      ndvi
    );
    p.slope = slope;
    return { measured: 0, p, photo, row: true, scan: false };
  }
  const r = crown & 0xff;
  const p = canopyPlacement(
    ex,
    ey,
    ground,
    {
      h: dm === 0 ? Number.NaN : dm / 10,
      r: r === 0 ? undefined : r / 10,
      c: (height & ROAD) !== 0,
      evergreen: (height & EVERGREEN) !== 0,
      pine: (height & PINE) !== 0,
    },
    offset,
    ndvi
  );
  p.slope = slope;
  return { measured: dm / 10, p, photo, row: false, scan: r !== 0 };
}

/** Record `index` of a `register` section: where it stands (EPSG), its
 *  file's properties and its row there (`before`: the row of the record
 *  before it, 0 for the first). */
export function registerAt(
  words: Uint16Array,
  index: number,
  origin: readonly [number, number, number],
  before = 0
): RegisterFact {
  const at = index * REGISTER_WORDS;
  const height = words[at + R.height];
  const crown = words[at + R.crown];
  const leaves = words[at + R.leaves];
  const trunk = words[at + R.trunk];
  const year = words[at + R.year];
  const colour = (crown >> COLOUR_SHIFT) & 3;
  const source = SOURCES[(crown >> SOURCE_SHIFT) & 3];
  const genus = leaves & 0xff;
  return {
    // exact: both are whole decimetres
    e: (Math.round(origin[0] * 10) + words[at + R.place]) / 10,
    n: (Math.round(origin[1] * 10) + words[at + R.place + 2]) / 10,
    ground: origin[2] + words[at + R.place + 1] * TREE_STEP_Y_M,
    index: before + words[at + R.index],
    ndvi: ndviOf(leaves >> 8),
    slope: slopeOf(words[at + R.slope]),
    props: {
      h: (height & HEIGHT_MAX) / 10,
      d: (crown & HEIGHT_MAX) / 10,
      a: (height >> ARCHETYPE_SHIFT) & 7,
      l: (height & REGISTER_EVERGREEN) === 0 ? "d" : "e",
      ...((height & GLOBE) === 0 ? {} : { g: 1 }),
      ...((height & MEASURED) === 0 ? {} : { m: 1 as const }),
      ...(colour === 0 ? {} : { c: colour }),
      ...(source ? { s: source } : {}),
      ...(genus === 0 ? {} : { gn: genus }),
      ...(trunk === 0 ? {} : { t: trunk }),
      ...(year === 0 ? {} : { y: year }),
    },
  };
}

/** A register record as the tree the fine level draws (`inventoryTree`),
 *  in `year`. */
export function registerTree(
  fact: RegisterFact,
  offset: RecenterOffset,
  year: number
): InventoryTree {
  return {
    ...inventoryTree(
      fact.e,
      fact.n,
      fact.ground,
      fact.props,
      offset,
      fact.ndvi,
      year
    ),
    slope: fact.slope,
  };
}

/** Records read per step (lib/city/build-steps.ts). */
const READ_RUN = 2048;

/**
 * Every tree of `packs` (a tile's dressing files: the fine level reads
 * its own and its coarse level's, the coarse level its own) as the layers
 * draw it, in steps: per run of records.
 *
 * @yields {void} once per run of records read
 */
export function* standingTreesSteps(
  packs: readonly DressingPack[],
  offset: RecenterOffset,
  year: number
): Steps<{ register: InventoryTree[]; trees: Placement[] }> {
  const trees: Placement[] = [];
  const register: InventoryTree[] = [];
  for (const pack of packs) {
    const canopy = pack.sections.trees.words;
    for (let i = 0; i < canopy.length / TREE_WORDS; i += 1) {
      trees.push(treeAt(canopy, i, pack.origin, offset).p);
      if (i % READ_RUN === READ_RUN - 1) {
        yield;
      }
    }
    const facts = registerFacts([pack]);
    for (const [i, fact] of facts.entries()) {
      register.push(registerTree(fact, offset, year));
      if (i % READ_RUN === READ_RUN - 1) {
        yield;
      }
    }
  }
  return { trees, register };
}

/** The surveyed trees of `packs` as their files had them, each on its
 *  ground: what a question about one is answered from. */
export function registerFacts(packs: readonly DressingPack[]): RegisterFact[] {
  const out: RegisterFact[] = [];
  for (const pack of packs) {
    const { words } = pack.sections.register;
    let row = 0;
    for (let i = 0; i < words.length / REGISTER_WORDS; i += 1) {
      const fact = registerAt(words, i, pack.origin, row);
      row = fact.index;
      out.push(fact);
    }
  }
  return out;
}

/** The canopy's, the scan's and the rows' trees of `packs`, each with
 *  what its card says of it (`treeAt`). */
export function placedTrees(
  packs: readonly DressingPack[],
  offset: RecenterOffset
): ReturnType<typeof treeAt>[] {
  const out: ReturnType<typeof treeAt>[] = [];
  for (const pack of packs) {
    const { words } = pack.sections.trees;
    for (let i = 0; i < words.length / TREE_WORDS; i += 1) {
      out.push(treeAt(words, i, pack.origin, offset));
    }
  }
  return out;
}

/**
 * Where every tree of `packs` meets the ground (ADR 0030): its foot, at
 * the ground its record holds — which the check sets against the ground
 * it was stood on (scripts/ground-joins.ts `trees`,
 * scripts/bake-dressing.test.ts).
 */
export function treeJoins(packs: readonly DressingPack[]): JoinPoint[] {
  const out: JoinPoint[] = [];
  for (const pack of packs) {
    const [east, north, low] = pack.origin;
    const canopy = pack.sections.trees.words;
    for (let at = 0; at < canopy.length; at += TREE_WORDS) {
      out.push({
        kind: "foot",
        x: east + Math.fround(canopy[at + T.place] * STEP_M),
        y: north + Math.fround(canopy[at + T.place + 2] * STEP_M),
        z: low + canopy[at + T.place + 1] * TREE_STEP_Y_M,
      });
    }
    for (const fact of registerFacts([pack])) {
      out.push({ kind: "foot", x: fact.e, y: fact.n, z: fact.ground });
    }
  }
  return out;
}
