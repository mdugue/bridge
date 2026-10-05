/**
 * The coarse terrain level's trees. Each terrain level carries its own:
 * the fine level every tree (vegetation-layer.ts), the coarse level a
 * third of them, drawn wider (coarse-crowns-layer.ts) — and the tile
 * renderer shows one level per place, so wherever there is ground there
 * are trees, at any scale and whichever level a device can hold. This is
 * a plan's generalization by selection: COARSE_TREE_SHARE of the trees,
 * chosen by a hash of where each stands, their crowns COARSE_TREE_WIDEN
 * wider so a wood still covers the ground it covers. The build step
 * (scripts/coarse-crowns.ts) runs the fine level's own placement over a
 * tile's tree files (lib/city/tree-placement.ts, tree-inventory.ts), so a
 * coarse crown stands where its fine tree does. No THREE, no DOM.
 *
 * The published file (`crowns_<tile>.crw.gz`), little-endian:
 *
 *   bytes 0–3   "CRW1"
 *   bytes 4–7   uint32 count
 *   bytes 8…    count × 20 bytes:
 *     float32 x, float32 z   the world (Y-up) position, the float the fine
 *                            level's instance matrix holds
 *     uint8  code            0 = a canopy or row tree; 1 + REGISTER_COLOURS
 *                            index = a register tree
 *     uint8  ndvi            0..254 (NDVI × 254), 255 = none
 *     uint8  genus           TREE_GENERA index (register trees; 0 = other)
 *     int8   jitter          the register tree's season offset × 10 (days)
 *     uint16 rot             the turn about the vertical, 0..2π over 0..65535
 *     uint16 a, b, c         a canopy tree: its scale × 4096, 0, 0; a
 *                            register tree: its crown's base, top and width
 *                            in centimetres
 */
import type { InventoryTree, TreeExtents } from "./tree-inventory";
import type { Placement } from "./tree-placement";

/** The share of the trees the coarse level draws. */
export const COARSE_TREE_SHARE = 1 / 3;
/** How much wider it draws their crowns: as many square metres of crown
 *  as all the trees have (share × widen² = 1). */
export const COARSE_TREE_WIDEN = Math.sqrt(1 / COARSE_TREE_SHARE);

const MAGIC = "CRW1";
const HEADER_BYTES = 8;
const RECORD_BYTES = 20;
const SCALE_UNIT = 4096;
const NO_NDVI = 255;

/** A PCG step on an unsigned 32-bit seed: [0, 1). */
function pcg(seed: number): number {
  const state = (Math.imul(seed, 747_796_405) + 2_891_336_453) >>> 0;
  const word =
    Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277_803_737) >>>
    0;
  return (((word >>> 22) ^ word) >>> 0) / 2 ** 32;
}

/**
 * Whether the coarse level draws the tree standing at world (x, z): a hash
 * of where it stands (to the decimetre), so a tile rebuilt keeps the same
 * trees and neighbours are chosen independently — no row or stripe of
 * trees goes as one.
 */
export function drawnCoarse(x: number, z: number): boolean {
  const seed =
    Math.imul(Math.round(x * 10), 73_856_093) ^
    Math.imul(Math.round(z * 10), 19_349_663);
  return pcg(seed >>> 0) < COARSE_TREE_SHARE;
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

/** One crown of the coarse level, at its natural size (the layer widens
 *  it by COARSE_TREE_WIDEN). */
export type CoarseCrown = {
  ndvi?: number;
  rot: number;
  /** the world (Y-up) position, as the fine level's matrix holds it */
  x: number;
  z: number;
} & (
  | {
      kind: "canopy";
      /** the tree's scale (tree-placement.ts) */
      s: number;
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
 * The crowns a tile's coarse level draws: of the trees its fine level
 * draws — the row and canopy trees (`placements`) and the register's —
 * those `drawnCoarse` keeps.
 */
export function coarseCrowns(
  placements: readonly Placement[],
  register: readonly InventoryTree[]
): CoarseCrown[] {
  const canopy = placements
    .filter((p) => drawnCoarse(p.x, p.z))
    .map((p): CoarseCrown => ({
      kind: "canopy",
      x: p.x,
      z: p.z,
      rot: p.rot,
      s: p.s,
      ndvi: p.ndvi,
    }));
  const registered = register
    .filter((t) => drawnCoarse(t.x, t.z))
    .map((t): CoarseCrown => ({
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
    }));
  return [...canopy, ...registered];
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
    const colour = REGISTER_COLOURS[code - 1];
    if (code === 0 || colour === undefined) {
      out.push({ ...base, kind: "canopy", s: a / SCALE_UNIT });
      continue;
    }
    out.push({
      ...base,
      kind: "register",
      colour,
      ext: {
        crownBase: a / 100,
        crownTop: view.getUint16(at + 16, true) / 100,
        crownWidth: view.getUint16(at + 18, true) / 100,
      },
      genus: view.getUint8(at + 10),
      jitter: view.getInt8(at + 11) / 10,
    });
  }
  return out;
}
