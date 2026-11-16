/**
 * A tree as the stand records its sets draw (lib/city/stand-record.ts):
 * the crown's — which a canopy tree's trunk and feet share, a drop
 * putting the trunk's foot back on the ground — and a surveyed tree's
 * own trunk. The arithmetic the vegetation layer wrote into matrices
 * before (place, turn about the vertical, scale: all a tree's matrix ever
 * held), now twenty bytes a tree and no matrix
 * (app/_components/vegetation-layer.ts, tree-inventory-layer.ts,
 * coarse-crowns-layer.ts). No THREE, no DOM.
 */
import {
  STAND_RECORD_WORDS,
  writeStand,
  writeStandFields,
} from "./stand-record";
import type { Stand } from "./stand-record";
import { ageLook } from "./tree-age";
import { TRUNK_UNIT_H, trunkGirth } from "./tree-inventory";
import type { InventoryTree, TreeExtents } from "./tree-inventory";
import { BASE_TREE_H, GENERIC_CROWN_FOOT } from "./tree-placement";
import type { Placement } from "./tree-placement";

/**
 * How a placement stands the generic crown between its crown base
 * (`base`, lib/city/tree-placement.ts `crownBase`) and its top (s ·
 * BASE_TREE_H): the vertical scale, and the lift (m) of the crown's frame
 * off the ground. Without a base (a hedge) the scale is `s`, no lift — the
 * crown starts where its geometry does, 0.28 of its height up.
 */
export function crownFrame(p: Pick<Placement, "base" | "s">): {
  lift: number;
  scale: number;
} {
  if (p.base === undefined) {
    return { lift: 0, scale: p.s };
  }
  const top = p.s * BASE_TREE_H;
  const scale =
    Math.max(top - p.base, 0.1) / (BASE_TREE_H - GENERIC_CROWN_FOOT);
  return { lift: p.base - scale * GENERIC_CROWN_FOOT, scale };
}

/**
 * A trunk drawn on its crown's record has its foot lowered by the crown's
 * lift, in the record's own vertical units (lift / scale): the record's
 * spare word, × DROP_UNIT over DROP_BIAS (a crown that starts low lifts
 * its frame below the ground: the drop is signed). The trunk material and
 * the feet read it back (`app/_components/tree-foot.ts` `trunkDrop`).
 */
export const DROP_UNIT = 2048;
export const DROP_BIAS = 8;

const dropWord = (drop: number): number =>
  Math.min(Math.max(Math.round((drop + DROP_BIAS) * DROP_UNIT), 0), 65_535);

/** A slope's two signed bytes (lib/city/tree-placement.ts
 *  `Placement.slope`) as a record's unsigned ones, + 128. */
const slopeBytes = (
  slope: readonly [number, number] | undefined
): [number, number] => [128 + (slope?.[0] ?? 0), 128 + (slope?.[1] ?? 0)];

/**
 * A canopy or row tree's record: the generic crown between its base and
 * its top (`crownFrame`), `widen` times as wide (the far tier's thinned
 * forest, the coarse level's third). Its trunk and its feet are drawn from
 * the same record: the drop, and the ground's slope at its foot.
 */
export function placementStand(p: Placement, widen = 1): Stand {
  const { lift, scale } = crownFrame(p);
  const w = (p.w ?? p.s) * widen;
  return {
    x: p.x,
    y: p.y + lift,
    z: p.z,
    turn: p.rot,
    scale: [w, scale, w],
    spare: dropWord(lift / scale),
    more: slopeBytes(p.slope),
  };
}

/** A crown geometry's local box, which a surveyed tree's crown is fitted
 *  into: its height, its lowest point and its width. */
export interface CrownFit {
  height: number;
  minY: number;
  width: number;
}

/** Where a crown stands and how far it reaches. */
export type CrownPlace = Pick<InventoryTree, "ground" | "rot" | "x" | "z"> & {
  ext: Pick<TreeExtents, "crownBase" | "crownTop" | "crownWidth">;
};

/** A surveyed tree's crown: the geometry's box (`fit`) fitted to the
 *  tree's crown, `widen` times as wide. */
export function registerCrownStand(
  t: CrownPlace,
  fit: CrownFit,
  widen = 1
): Stand {
  const sy = (t.ext.crownTop - t.ext.crownBase) / fit.height;
  const sxz = (t.ext.crownWidth / fit.width) * widen;
  return {
    x: t.x,
    y: t.ground + t.ext.crownBase - fit.minY * sy,
    z: t.z,
    turn: t.rot,
    scale: [sxz, sy, sxz],
    spare: dropWord(0),
  };
}

/**
 * A surveyed tree's own trunk, from the ground to into its crown: its
 * girth the measured diameter's where there is one, else its height's,
 * thinned or thickened by its age (lib/city/tree-inventory.ts
 * `trunkGirth`, lib/city/tree-age.ts).
 */
export function registerTrunkStand(t: InventoryTree): Stand {
  // a measured trunk is as measured; else the age thins or thickens it
  const girth =
    trunkGirth(t.ext, t.dbh) * (t.dbh === undefined ? ageLook(t.age).girth : 1);
  return {
    x: t.x,
    y: t.ground,
    z: t.z,
    turn: t.rot,
    scale: [girth, t.ext.trunkTop / TRUNK_UNIT_H, girth],
    spare: dropWord(0),
    more: slopeBytes(t.slope),
  };
}

/**
 * A cell's table of records: its canopy and row trees (`placementStand`,
 * `widen` times as wide) and, after them, the records `others` bring (the
 * register's crowns). Written field by field — no `Stand` a tree: a
 * forest tile writes tens of thousands — over a corner under all of
 * them, on whole metres.
 */
export function placementRecords(
  trees: readonly Placement[],
  widen = 1,
  others: readonly Stand[] = []
): { origin: [number, number, number]; words: Uint16Array<ArrayBuffer> } {
  const origin: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  for (const p of trees) {
    origin[0] = Math.min(origin[0], p.x);
    origin[1] = Math.min(origin[1], p.y + crownFrame(p).lift);
    origin[2] = Math.min(origin[2], p.z);
  }
  for (const s of others) {
    origin[0] = Math.min(origin[0], s.x);
    origin[1] = Math.min(origin[1], s.y);
    origin[2] = Math.min(origin[2], s.z);
  }
  for (let axis = 0; axis < 3; axis += 1) {
    origin[axis] = Number.isFinite(origin[axis]) ? Math.floor(origin[axis]) : 0;
  }
  const words = new Uint16Array(
    (trees.length + others.length) * STAND_RECORD_WORDS
  );
  const place = { x: 0, y: 0, z: 0, turn: 0 };
  const scale = { sx: 0, sy: 0, sz: 0 };
  for (let i = 0; i < trees.length; i += 1) {
    const p = trees[i];
    const frame = crownFrame(p);
    const w = (p.w ?? p.s) * widen;
    place.x = p.x;
    place.y = p.y + frame.lift;
    place.z = p.z;
    place.turn = p.rot;
    scale.sx = w;
    scale.sy = frame.scale;
    scale.sz = w;
    writeStandFields(
      words,
      i,
      place,
      scale,
      dropWord(frame.lift / frame.scale),
      // the ground's slope at the foot, in the more word's two bytes
      ((128 + (p.slope?.[0] ?? 0)) << 16) | ((128 + (p.slope?.[1] ?? 0)) << 24),
      origin
    );
  }
  for (const [k, s] of others.entries()) {
    writeStand(words, trees.length + k, s, origin);
  }
  return { origin, words };
}
