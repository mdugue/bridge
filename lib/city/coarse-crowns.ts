/**
 * The coarse terrain level's trees. Each terrain level carries its own:
 * the fine level every tree (vegetation-layer.ts), the coarse level a
 * third of them, drawn wider (coarse-crowns-layer.ts) — and the tile
 * renderer shows one level per place, so wherever there is ground there
 * are trees, at any scale and whichever level a device can hold. This is
 * a plan's generalization by selection: COARSE_TREE_SHARE of the trees,
 * chosen by a hash of where each stands, their crowns COARSE_TREE_WIDEN
 * wider so a wood still covers the ground it covers. The build places
 * a tile's trees (scripts/bake-trees.ts) and puts that third in the
 * coarse level's own file (lib/city/tree-table.ts), so a coarse crown
 * stands where its fine tree does. No THREE, no DOM.
 */
import type { InventoryTree, TreeExtents } from "./tree-inventory";
import type { Placement } from "./tree-placement";

/** The share of the trees the coarse level draws. */
export const COARSE_TREE_SHARE = 1 / 3;
/** How much wider it draws their crowns: as many square metres of crown
 *  as all the trees have (share × widen² = 1). */
export const COARSE_TREE_WIDEN = Math.sqrt(1 / COARSE_TREE_SHARE);

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
 * The trees of a coarse level's file as that level's crowns: its row and
 * canopy trees (`placements`) and the register's. The file is the
 * selection (`drawnCoarse`, at the build: scripts/bake-trees.ts).
 */
export function coarseCrowns(
  placements: readonly Placement[],
  register: readonly InventoryTree[]
): CoarseCrown[] {
  const canopy = placements.map((p): CoarseCrown => ({
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
  const registered = register.map((t): CoarseCrown => ({
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
