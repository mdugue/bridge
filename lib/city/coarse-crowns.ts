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
 *                            index = a register tree, + CONE_FLAG for one
 *                            whose crown is the conifer's cone, + PINE_FLAG
 *                            for one whose crown is a pine's
 *     uint8  ndvi            0..254 (NDVI × 254), 255 = none
 *     uint8  genus           TREE_GENERA index (register trees; 0 = other);
 *                            a canopy tree: 1 = an evergreen (drawn as the
 *                            cone), 2 = an evergreen pine (the pine's
 *                            crown), 0 = neither
 *     int8   jitter          the register tree's season offset × 10 (days)
 *     uint16 rot             the turn about the vertical, 0..2π over 0..65535
 *     uint16 a, b, c         a canopy tree: its vertical and horizontal
 *                            scale × 4096 and its crown's base in
 *                            millimetres (0 = none: a hedge's crown, drawn
 *                            by its scale); a register tree: its crown's
 *                            base, top and width in centimetres
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
/** The code byte's bits for a register tree drawn as a cone, and as a
 *  pine. */
const CONE_FLAG = 0x80;
const PINE_FLAG = 0x40;
/** The genus byte of a canopy tree: an evergreen, and an evergreen pine. */
const CANOPY_EVERGREEN = 1;
const CANOPY_PINE = 2;

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
      /** an evergreen (tree-placement.ts `Placement.evergreen`) */
      evergreen?: boolean;
      /** an evergreen whose crown is a pine's (`Placement.pine`) */
      pine?: boolean;
      /** the tree's vertical scale (tree-placement.ts) */
      s: number;
      /** its horizontal scale (absent = `s`) */
      w?: number;
      /** where its crown starts (m over the ground, `Placement.base`):
       *  the fine level's crown frame (vegetation-layer.ts `crownFrame`) */
      base?: number;
    }
  | {
      kind: "register";
      colour: RegisterColour;
      /** its crown is the conifer's cone (tree-inventory.ts `shape`) */
      cone?: boolean;
      /** its crown is a pine's (tree-inventory.ts `shape`) */
      pine?: boolean;
      ext: Pick<TreeExtents, "crownBase" | "crownTop" | "crownWidth">;
      genus: number;
      jitter: number;
    }
);

/** The crown a coarse tree wears: the lobed crown, the cone or a pine's. */
export type CoarseForm = "broad" | "cone" | "pine";

/**
 * Which crown a coarse tree is drawn with: a canopy evergreen's cone or
 * pine (vegetation-layer.ts `canopyForm`), a register tree's cone or pine
 * (its `shape`), else the lobed crown — the fine level's forms, so a wood
 * keeps its conifers and its pines at a distance.
 */
export function coarseForm(c: CoarseCrown): CoarseForm {
  if (c.kind === "canopy") {
    if (c.evergreen !== true) {
      return "broad";
    }
    return c.pine === true ? "pine" : "cone";
  }
  if (c.cone === true) {
    return "cone";
  }
  return c.pine === true ? "pine" : "broad";
}

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
      w: p.w ?? p.s,
      ndvi: p.ndvi,
      ...(p.base === undefined ? {} : { base: p.base }),
      ...(p.evergreen ? { evergreen: true } : {}),
      ...(p.evergreen && p.pine ? { pine: true } : {}),
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
      ...(t.shape === "cone" ? { cone: true } : {}),
      ...(t.shape === "pine" ? { pine: true } : {}),
    }));
  return [...canopy, ...registered];
}

// --- the file -------------------------------------------------------------------

/** A canopy crown's genus byte: an evergreen, an evergreen pine, or 0. */
function canopyLeaf(c: CoarseCrown & { kind: "canopy" }): number {
  if (!c.evergreen) {
    return 0;
  }
  return c.pine ? CANOPY_PINE : CANOPY_EVERGREEN;
}

/** A canopy crown's leaves from its genus byte (`canopyLeaf`). */
function canopyLeafOf(byte: number): { evergreen?: true; pine?: true } {
  if (byte === CANOPY_PINE) {
    return { evergreen: true, pine: true };
  }
  return byte === CANOPY_EVERGREEN ? { evergreen: true } : {};
}

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
      view.setUint8(at + 10, canopyLeaf(c));
      view.setUint16(at + 14, clampInt(c.s * SCALE_UNIT, 0, 65_535), true);
      const w = (c.w ?? c.s) * SCALE_UNIT;
      view.setUint16(at + 16, clampInt(w, 0, 65_535), true);
      const base =
        c.base === undefined ? 0 : clampInt(c.base * 1000, 1, 65_535);
      view.setUint16(at + 18, base, true);
      return;
    }
    view.setUint8(
      at + 8,
      (1 + REGISTER_COLOURS.indexOf(c.colour)) |
        (c.cone ? CONE_FLAG : 0) |
        (c.pine ? PINE_FLAG : 0)
    );
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
    const colour = REGISTER_COLOURS[(code & ~(CONE_FLAG | PINE_FLAG)) - 1];
    if (code === 0 || colour === undefined) {
      const w = view.getUint16(at + 16, true);
      const crownBase = view.getUint16(at + 18, true);
      out.push({
        ...base,
        kind: "canopy",
        s: a / SCALE_UNIT,
        w: (w || a) / SCALE_UNIT,
        ...(crownBase === 0 ? {} : { base: crownBase / 1000 }),
        ...canopyLeafOf(view.getUint8(at + 10)),
      });
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
      ...((code & CONE_FLAG) === 0 ? {} : { cone: true }),
      ...((code & PINE_FLAG) === 0 ? {} : { pine: true }),
    });
  }
  return out;
}

/** What the stream knows of one tile's two terrain levels. */
export interface TileLevelsShown {
  /** the coarse level is on screen */
  coarse: boolean;
  /** the fine level is on screen */
  fine: boolean;
  /** the fine level's dressing hangs on it (its trees, if it has any) */
  fineDressed: boolean;
}

/**
 * Whether a tile's coarse crowns stand in on its fine level: while the fine
 * level is on screen and its own trees are not — queued behind the
 * dressings of the tiles nearer the camera, or never built because the
 * build failed. A phone shows the fine level the moment it loads, and the
 * tile went bare for as long as its dressing waited. The crowns are the
 * coarse level's own, loaded with it already (the renderer keeps a shown
 * tile's coarse level loaded): no byte more, on the GPU or the wire.
 */
export function coarseCrownsStandIn(t: TileLevelsShown): boolean {
  return t.fine && !t.coarse && !t.fineDressed;
}
