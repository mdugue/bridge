/**
 * The trees of a small-scale Modell picture: the crowns the coarse terrain
 * level draws once the fine level, which carries the trees, has given way
 * (2.5 m/px, about 1 : 9 450). A plan generalizes its trees by selection
 * (lib/city/model-view.ts `treeShare`): at the smallest scales it keeps
 * MODEL_TREES_FLOOR of them, chosen by `treeRank`, a hash of where each one
 * stands. The build step (prepare-data.ts) runs the fine level's own
 * placement over a tile's tree files (lib/city/tree-placement.ts,
 * tree-inventory.ts) and keeps exactly the crowns the fine level shows at
 * that floor — its far tier, thinned and widened as the far tier is
 * (lib/city/vegetation-lod.ts) — so the trees stay where they are when the
 * level changes. No THREE, no DOM.
 *
 * The published file (`crowns_<tile>.crw.gz`), little-endian:
 *
 *   bytes 0–3   "CRW1"
 *   bytes 4–7   uint32 count
 *   bytes 8…    count × 20 bytes:
 *     float32 x, float32 z   the world (Y-up) position, exactly the float
 *                            the fine level's instance matrix holds
 *     uint8  code            0 = a canopy or row tree; 1 + REGISTER_COLOURS
 *                            index = a register tree
 *     uint8  ndvi            0..254 (NDVI × 254), 255 = none
 *     uint8  genus           TREE_GENERA index (register trees; 0 = other)
 *     int8   jitter          the register tree's season offset × 10 (days)
 *     uint16 rot             the turn about the vertical, 0..2π over 0..65535
 *     uint16 a, b, c         a canopy tree: scale × 4096, sideways widening
 *                            × 4096, 0; a register tree: its crown's base,
 *                            top and width in centimetres
 */
import type { Placement } from "./tree-placement";
import { bucketByCell } from "./tree-placement";
import type { InventoryTree, TreeExtents } from "./tree-inventory";
import { MODEL_TREES_FLOOR } from "./model-view";
import { FAR_THIN_WIDEN, keepInFarTier } from "./vegetation-lod";

const MAGIC = "CRW1";
const HEADER_BYTES = 8;
const RECORD_BYTES = 20;
const SCALE_UNIT = 4096;
const NO_NDVI = 255;

// --- the rank --------------------------------------------------------------

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);

/** A float32's bits as an unsigned integer. */
function bitsOf(v: number): number {
  F32[0] = v;
  return U32[0];
}

/** three's TSL `hash` (a PCG step) on an unsigned seed: [0, 1). */
function pcg(seed: number): number {
  const state = (Math.imul(seed, 747_796_405) + 2_891_336_453) >>> 0;
  const word =
    Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277_803_737) >>>
    0;
  const result = ((word >>> 22) ^ word) >>> 0;
  return Math.fround(Math.fround(result) * 2 ** -32);
}

/**
 * The rank (0..1) of the tree whose instance stands at world (x, z): the
 * crown shader keeps it while the rank is below Modell's share of trees
 * (app/_components/vegetation-layer.ts `crownKept`, the GPU twin — the
 * same hash of the same float bits). Where it stands, not its slot in a
 * buffer: the build step, the fine level and the coarse level rank a tree
 * alike, and a tile rebuilt in another order keeps the same trees.
 */
export function treeRank(x: number, z: number): number {
  return pcg((bitsOf(x) ^ Math.imul(bitsOf(z), 0x9e_37_79_b1)) >>> 0);
}

// --- the crowns ---------------------------------------------------------------

/** A register tree's foliage as its crown is painted
 *  (tree-inventory-layer.ts `inventoryColor`). */
export const REGISTER_COLOURS = [
  "leaf",
  "copper",
  "golden",
  "evergreen",
] as const;
export type RegisterColour = (typeof REGISTER_COLOURS)[number];

/** One crown of the coarse level. */
export type CoarseCrown = {
  ndvi?: number;
  rot: number;
  /** the world (Y-up) position, as the fine level's matrix holds it */
  x: number;
  z: number;
} & (
  | {
      kind: "canopy";
      /** the tree's scale, and how much wider its crown is drawn */
      s: number;
      widen: number;
    }
  | {
      kind: "register";
      colour: RegisterColour;
      ext: Pick<TreeExtents, "crownBase" | "crownTop" | "crownWidth">;
      genus: number;
      jitter: number;
    }
);

/** A register tree's foliage class. */
function registerColour(t: InventoryTree): RegisterColour {
  if (t.colour === 1) {
    return "copper";
  }
  if (t.colour === 2) {
    return "golden";
  }
  return t.leaf === "e" ? "evergreen" : "leaf";
}

/**
 * The crowns a tile's coarse level draws: of what its fine level draws in
 * the far tier — the row and canopy trees (`placements`, rows first, as
 * the vegetation layer collects them) thinned in their dense chunks and
 * widened there, and every register tree — those whose rank is below
 * `floor`.
 */
export function coarseCrowns(
  placements: readonly Placement[],
  register: readonly InventoryTree[],
  floor = MODEL_TREES_FLOOR
): CoarseCrown[] {
  const out: CoarseCrown[] = [];
  for (const cell of bucketByCell([...placements])) {
    const thinned = cell.length > 0 && !keepInFarTier(1, cell.length);
    cell.forEach((p, i) => {
      if (!keepInFarTier(i, cell.length) || treeRank(p.x, p.z) >= floor) {
        return;
      }
      out.push({
        kind: "canopy",
        x: p.x,
        z: p.z,
        rot: p.rot,
        s: p.s,
        widen: thinned ? FAR_THIN_WIDEN : 1,
        ndvi: p.ndvi,
      });
    });
  }
  for (const t of register) {
    if (treeRank(t.x, t.z) >= floor) {
      continue;
    }
    out.push({
      kind: "register",
      x: t.x,
      z: t.z,
      rot: t.rot,
      colour: registerColour(t),
      ext: {
        crownBase: t.ext.crownBase,
        crownTop: t.ext.crownTop,
        crownWidth: t.ext.crownWidth,
      },
      genus: t.genus,
      jitter: t.jitter,
      ndvi: t.ndvi,
    });
  }
  return out;
}

// --- the file -------------------------------------------------------------------

const TAU = Math.PI * 2;
const clampInt = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(Math.round(v), lo), hi);

export function packCrowns(crowns: readonly CoarseCrown[]): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + crowns.length * RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < MAGIC.length; i++) {
    view.setUint8(i, MAGIC.charCodeAt(i));
  }
  view.setUint32(4, crowns.length, true);
  crowns.forEach((c, k) => {
    const at = HEADER_BYTES + k * RECORD_BYTES;
    view.setFloat32(at, c.x, true);
    view.setFloat32(at + 4, c.z, true);
    const ndvi =
      c.ndvi === undefined || !Number.isFinite(c.ndvi)
        ? NO_NDVI
        : clampInt(c.ndvi * 254, 0, 254);
    view.setUint8(at + 9, ndvi);
    const turn = (((c.rot % TAU) + TAU) % TAU) / TAU;
    view.setUint16(at + 12, clampInt(turn * 65_535, 0, 65_535), true);
    if (c.kind === "canopy") {
      view.setUint8(at + 8, 0);
      view.setUint16(at + 14, clampInt(c.s * SCALE_UNIT, 0, 65_535), true);
      view.setUint16(at + 16, clampInt(c.widen * SCALE_UNIT, 0, 65_535), true);
      return;
    }
    view.setUint8(at + 8, 1 + REGISTER_COLOURS.indexOf(c.colour));
    view.setUint8(at + 10, clampInt(c.genus, 0, 255));
    view.setInt8(at + 11, clampInt(c.jitter * 10, -127, 127));
    const cm = (m: number) => clampInt(m * 100, 0, 65_535);
    view.setUint16(at + 14, cm(c.ext.crownBase), true);
    view.setUint16(at + 16, cm(c.ext.crownTop), true);
    view.setUint16(at + 18, cm(c.ext.crownWidth), true);
  });
  return bytes;
}

/** The crowns of a packed buffer, or null for anything that is not one. */
export function unpackCrowns(buffer: ArrayBuffer): CoarseCrown[] | null {
  if (buffer.byteLength < HEADER_BYTES) {
    return null;
  }
  const view = new DataView(buffer);
  for (let i = 0; i < MAGIC.length; i++) {
    if (view.getUint8(i) !== MAGIC.charCodeAt(i)) {
      return null;
    }
  }
  const count = view.getUint32(4, true);
  if (buffer.byteLength < HEADER_BYTES + count * RECORD_BYTES) {
    return null;
  }
  const out: CoarseCrown[] = [];
  for (let k = 0; k < count; k++) {
    const at = HEADER_BYTES + k * RECORD_BYTES;
    const code = view.getUint8(at + 8);
    const ndviByte = view.getUint8(at + 9);
    const base = {
      x: view.getFloat32(at, true),
      z: view.getFloat32(at + 4, true),
      rot: (view.getUint16(at + 12, true) / 65_535) * TAU,
      ...(ndviByte === NO_NDVI ? {} : { ndvi: ndviByte / 254 }),
    };
    const a = view.getUint16(at + 14, true);
    const b = view.getUint16(at + 16, true);
    const colour = REGISTER_COLOURS[code - 1];
    if (code === 0 || colour === undefined) {
      out.push({
        ...base,
        kind: "canopy",
        s: a / SCALE_UNIT,
        widen: b / SCALE_UNIT,
      });
      continue;
    }
    out.push({
      ...base,
      kind: "register",
      colour,
      ext: {
        crownBase: a / 100,
        crownTop: b / 100,
        crownWidth: view.getUint16(at + 18, true) / 100,
      },
      genus: view.getUint8(at + 10),
      jitter: view.getInt8(at + 11) / 10,
    });
  }
  return out;
}
