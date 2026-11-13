/**
 * The shopfronts of the building bake (scripts/bake-city-mesh.ts): laid
 * out per wall (`planShopfronts`), their windows and signs cut into the
 * LoD2 walls and their glass, reveals and canopies appended
 * (`appendShopfronts`). No DOM.
 */
import { cm, mixRgb, treeTriangles } from "./city-bake";
import type { PlinthBreak, BakedCityMesh } from "./city-bake";
import {
  hasObjectFlag,
  OBJECT_FLAG_GLASS,
  OBJECT_FLAG_METAL,
  OBJECT_FLAG_OWN_COLOUR,
  OBJECT_FLAG_SHOP,
  OBJECT_SOURCE_LOD2,
  OBJECT_SOURCE_SHOPFRONT,
} from "../lib/city/city-mesh";
import type { CityObjectRow } from "../lib/city/city-mesh";
import type { V3 } from "../lib/city/doors";
import type { Shaded } from "../lib/city/plinths";
import type { DoorFeature, ShopfrontWall } from "../lib/city/features";
import {
  doorSpans,
  footAt,
  paneTop,
  spanSegments,
  CANOPY,
  SHOPFRONT,
  shopfrontMesh,
  wallBays,
  wallFrame,
  wallShiftAt,
} from "../lib/city/shopfronts";
import type { ShopfrontMesh, ShopOpening } from "../lib/city/shopfronts";
import { cutWall, openingBox } from "../lib/city/shop-windows";
import type { CutTriangle, WallAxes, WallCut } from "../lib/city/shop-windows";
import { appended } from "./vertex-stream";

/** The clay's base colour (the material's 0xece7df, linear) and how much
 *  of a building's tint the walls show at Farbvariation's fixed strength
 *  (app/_components/visual-style.ts `TINT`): a wall as one sees it. */
const CLAY_BASE: [number, number, number] = [0.838, 0.799, 0.737];
const WALL_TINT_SHOWN = 0.6;
/** A shop window: a muted glass a little darker and cooler than its wall
 *  — the wall as shown, darkened, drawn towards a cool slate — not a
 *  black hole; smooth enough to hold a calm reflection of the sun (its
 *  `rough` column is the pane's roughness, read as such for own-colour
 *  glass) and of the sky (the clay's `paneSky`,
 *  app/_components/visual-style.ts). */
const PANE_SLATE: [number, number, number] = [0.07, 0.09, 0.12];
const PANE_ROUGH = 0.2;
/** A painted store sign: its wall as shown, darker and a touch cooler —
 *  paint on the wall, not a board on it. */
const SIGN_COOL: [number, number, number] = [0.52, 0.55, 0.6];
/** A host this far above the ground in front of its wall stands on another
 *  part (a storey on a podium, a roof terrace): no shopfront on it. */
const SHOP_HOST_ABOVE_M = 2;

/** The shop glass and the painted sign for a host of tint `tint`
 *  (linear). */
export function shopfrontColours(tint: readonly number[]): {
  glass: [number, number, number];
  sign: [number, number, number];
} {
  const wall = mixRgb(CLAY_BASE, tint, WALL_TINT_SHOWN);
  return {
    glass: mixRgb(
      wall.map((c) => c * 0.4),
      PANE_SLATE,
      0.45
    ),
    sign: mixRgb(
      wall.map((c) => c * 0.8),
      SIGN_COOL,
      0.2
    ),
  };
}

/** A shopfront the tile will get: its wall, its host and the host's own
 *  triangles (what is cut), and what goes on the wall — only the
 *  windows its LoD2 wall takes (`shopfrontMesh`'s `cuts`). */
export interface ShopPlan {
  host: CityObjectRow;
  hostIndex: number;
  mesh: ShopfrontMesh;
  triangles: number[];
  w: ShopfrontWall;
}

/**
 * The shopfronts on the LoD2 walls, laid out before anything is cut or
 * laid: each run's wall found by rays into the untouched LoD2
 * (`wallShiftAt`; a wall cut before would no longer be found), and each
 * bay asked of the wall it is to be cut into (`cutWall` on the host's own
 * LoD2 triangles — a sibling part's coplanar wall keeps its ground floor
 * and is never cut: openings on one plane never overlap, so what covers it
 * now covers it after the cuts before it), so the plinth breaks for the
 * windows cut and no other (`shopWindowBreaks`). Skipped: a host the tile
 * does not hold, a glass or metal facade (its own front), a host not on
 * the ground; a bay is cut where an OSM door stands.
 */
export function planShopfronts(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  walls: readonly ShopfrontWall[],
  doors: readonly DoorFeature[],
  objectIndex: ReadonlyMap<string, number>
): ShopPlan[] {
  if (walls.length === 0) {
    return [];
  }
  const trees = treeTriangles(baked);
  const p = baked.vertices.positions;
  const hostRootOf = (id: string) => {
    const i = objectIndex.get(id);
    return i === undefined ? undefined : baked.objects[i]?.root;
  };
  const plans: ShopPlan[] = [];
  for (const w of walls) {
    const hostIndex = objectIndex.get(w.oid);
    const host = hostIndex === undefined ? undefined : baked.objects[hostIndex];
    if (!(hostIndex !== undefined && host && w.z) || !shopHost(host, w)) {
      continue;
    }
    const bays = wallBays(
      w,
      doorSpans(w, doors, (of) => hostRootOf(of) === host.root)
    );
    const tree = trees.get(host.root) ?? [];
    // cut into the host's own wall alone: its ground floor is the one that
    // gives its windows up (`facadeOf`), a sibling part's beside it keeps
    // its own
    const ids = baked.vertices.objectIds;
    const triangles = tree.filter((t) => ids[t] === hostIndex);
    const lod2 = lod2Triangles(baked, triangles);
    const mesh = shopfrontMesh(
      w,
      bays,
      host.storeyH,
      baked.offset,
      (span) => wallShiftAt(w, span, baked.offset, p, tree),
      (o) =>
        cutWall(wallFrame(w, baked.offset, o.shift), [o.rect], lod2).openings
          .length > 0
    );
    plans.push({ host, hostIndex, mesh, triangles, w });
  }
  return plans;
}

/**
 * The shopfronts on the LoD2 walls (pipeline/bake/shopfronts.py: bays and
 * signs from street photos, canopies from the surface model). Each bay a
 * shop window cut into its wall (lib/city/shop-windows.ts): the LoD2
 * triangles on the wall's plane lose the opening (the cut ones collapsed
 * in place, their remainder appended in their own objects), its reveals
 * appended in the host's own clay, the glass at the back one object per
 * window (its `eaveH` the pane's top, where the head's soft shadow falls —
 * `paneShade` in visual-style.ts). The store signs painted on: each sign
 * band cut out of the wall the same way and laid back flush as one object
 * in a darker tone (no relief), after the windows; the canopy in the
 * host's own clay; the host's building tree (asking or demolishing one
 * takes the building), no footprint, no storey band or eave line on them,
 * `source` 6 (a wall with a sign and no bay gets its sign alone). The host's plinth breaks for
 * each window (`shopWindowBreaks`, before the plinths are laid).
 * Skipped: a host the tile does not hold, a glass or metal
 * facade (its own front), a host not on the ground; a bay is cut where an
 * OSM door stands. Returns the walls a shop window was cut into (each with
 * the objects cut) and, per remainder triangle appended, the LoD2 triangle
 * it was cut from (by triangle: the ground's rise in front is its).
 */
export function appendShopfronts(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  plans: readonly ShopPlan[]
): { opened: Map<ShopfrontWall, Set<number>>; from: Map<number, number> } {
  const shop: ShopParts = {
    positions: [],
    normals: [],
    objectIds: [],
    walls: [],
  };
  const opened = new Map<ShopfrontWall, Set<number>>();
  for (const { w, host, hostIndex, mesh, triangles } of plans) {
    const objects = new Set<number>();
    const cut = cutShopWindows(
      baked,
      w,
      mesh.openings,
      triangles,
      shop,
      objects
    );
    if (cut.length > 0) {
      opened.set(w, objects);
    }
    const part = shopPart(baked, shop, host, w);
    const colours = shopfrontColours(host.tint);
    for (const pane of cut) {
      part(
        {
          positions: pane.glass,
          normals: pane.glass.map(() => Number.NaN),
        },
        colours.glass,
        OBJECT_FLAG_OWN_COLOUR + OBJECT_FLAG_GLASS,
        PANE_ROUGH,
        // the glass's eave is its top: the head's shadow under it
        pane.top
      );
      pushTriangles(shop, pane.reveals, hostIndex);
    }
    // a sign takes whatever of it the wall covers
    const sign = cutOnWall(baked, w, mesh.signs, triangles, shop, {
      keep: true,
      minCover: 0,
    }).flatMap(({ cut: c }) => c.taken);
    if (sign.length > 0) {
      part(
        { positions: sign, normals: sign.map(() => Number.NaN) },
        colours.sign,
        OBJECT_FLAG_OWN_COLOUR,
        host.rough
      );
    }
    // the canopy is the building's own: its clay and tint, lit like its
    // walls (not a frame's darker own colour), the shop wash left to the
    // ground floor behind it
    if (mesh.canopy.positions.length > 0) {
      part(mesh.canopy, host.tint, host.flags & ~OBJECT_FLAG_SHOP, host.rough);
    }
  }
  const v = baked.vertices;
  const from = new Map<number, number>();
  for (const t of shop.walls) {
    const first = (v.positions.length + shop.positions.length) / 9;
    for (let j = 0; j < t.positions.length / 9; j += 1) {
      from.set(first + j, t.from / 3);
    }
    pushTriangles(shop, t.positions, t.object);
  }
  baked.vertices = appended(v, [
    { id: shop.objectIds, normals: shop.normals, positions: shop.positions },
  ]);
  return { opened, from };
}

/** What `appendShopfronts` adds to the tile: triangles with their objects
 *  and normals, and the walls' remainders after a cut (one may be cut
 *  again by the next wall's windows on the same plane). */
interface ShopParts {
  normals: number[];
  objectIds: number[];
  positions: number[];
  /** the cut walls' remainders, each with its object and the LoD2
   *  triangle it was cut from (its first vertex) */
  walls: { object: number; positions: number[]; from: number }[];
}

/** Appends flat triangles (`positions`, 9 a triangle) to `object`. */
function pushTriangles(
  out: ShopParts,
  positions: readonly number[],
  object: number
): void {
  out.positions.push(...positions);
  for (let i = 0; i < positions.length; i += 3) {
    out.normals.push(Number.NaN, Number.NaN, Number.NaN);
    out.objectIds.push(object);
  }
}

/** A window cut into a wall: its glass, reveals and the pane's top over
 *  the shopfront's foot (cm, the glass object's `eaveH`). */
interface CutWindow {
  glass: number[];
  reveals: number[];
  top: number;
}

/**
 * Cuts the shop windows `openings` into the wall `w` stands on: the LoD2
 * triangles of its host and the remainders earlier cuts left
 * (`out.walls`), each run's wall where `wallShiftAt` found it. A cut LoD2
 * triangle collapses onto its first vertex (the per-vertex columns of the
 * LoD2 stream stay aligned), its remainder goes to `out.walls`.
 */
function cutShopWindows(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  w: ShopfrontWall,
  openings: readonly ShopOpening[],
  triangles: readonly number[],
  out: ShopParts,
  objects: Set<number>
): CutWindow[] {
  const base = footAt(w, [0, w.L]);
  return cutOnWall(baked, w, openings, triangles, out, {}).flatMap(
    ({ axes, cut, objects: of }) => {
      for (const o of of) {
        objects.add(o);
      }
      return cut.openings.map((o, k) => ({
        ...openingBox(axes, cut.corners[k]),
        top: cm(o.z1 - base),
      }));
    }
  );
}

/**
 * Cuts the rectangles `openings` into the wall `w` stands on: the LoD2
 * triangles of its host (`triangles`) and the remainders earlier cuts in
 * them left (`out.walls`), each run's wall where
 * `wallShiftAt` found it. A cut LoD2 triangle collapses onto its first
 * vertex (the per-vertex columns of the LoD2 stream stay aligned), its
 * remainder goes to `out.walls`. `cutWall`'s options: `keep` hands back
 * what each cut took (`taken`, a painted sign). Each cut names the objects
 * whose triangles it cut.
 */
function cutOnWall(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  w: ShopfrontWall,
  openings: readonly ShopOpening[],
  triangles: readonly number[],
  out: ShopParts,
  options: { keep?: boolean; minCover?: number }
): { axes: WallAxes; cut: WallCut; objects: Set<number> }[] {
  const ids = baked.vertices.objectIds;
  const cuts: { axes: WallAxes; cut: WallCut; objects: Set<number> }[] = [];
  // (no tree, nothing to cut: no remainder of another matches)
  if (triangles.length === 0) {
    return cuts;
  }
  const object = ids[triangles[0]];
  for (const shift of new Set(openings.map((o) => o.shift))) {
    const rects = openings.filter((o) => o.shift === shift).map((o) => o.rect);
    const axes = wallFrame(w, baked.offset, shift);
    // read again each run: the run before collapsed what it cut
    const lod2 = lod2Triangles(baked, triangles);
    // only this object's: another's coplanar wall is not this one
    const remainders = out.walls.flatMap((r, k) =>
      r.object === object
        ? splitTriangles(r.positions).map((tri, j) => ({
            id: -1 - (k * 1e6 + j),
            p: tri,
          }))
        : []
    );
    const cut = cutWall(axes, rects, [...lod2, ...remainders], options);
    // the objects cut, read before the remainders' list changes
    const objects = new Set(
      cut.replaced.map(({ id }) =>
        id >= 0 ? ids[id] : out.walls[Math.floor((-1 - id) / 1e6)].object
      )
    );
    replaceCut(cut.replaced, baked, out);
    cuts.push({ axes, cut, objects });
  }
  return cuts;
}

/** A building tree's LoD2 triangles (by first vertex) as `cutWall` takes
 *  them: what the bake added on the walls (plinths, signs, reveals) is no
 *  wall to cut. */
function lod2Triangles(
  baked: Pick<BakedCityMesh, "objects" | "vertices">,
  triangles: readonly number[]
): { id: number; p: readonly [V3, V3, V3] }[] {
  const p = baked.vertices.positions;
  const ids = baked.vertices.objectIds;
  const at = (i: number): V3 => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  return triangles
    .filter(
      (t) =>
        (baked.objects[ids[t]]?.source ?? OBJECT_SOURCE_LOD2) ===
        OBJECT_SOURCE_LOD2
    )
    .map((t) => ({ id: t, p: [at(t), at(t + 1), at(t + 2)] as const }));
}

/** The triangles of a flat position list (9 a triangle). */
function splitTriangles(positions: readonly number[]): [V3, V3, V3][] {
  const out: [V3, V3, V3][] = [];
  for (let i = 0; i + 8 < positions.length; i += 9) {
    out.push([
      [positions[i], positions[i + 1], positions[i + 2]],
      [positions[i + 3], positions[i + 4], positions[i + 5]],
      [positions[i + 6], positions[i + 7], positions[i + 8]],
    ]);
  }
  return out;
}

/** Puts a cut's remainders in place of what it cut: a LoD2 triangle (id ≥
 *  0, its first vertex) collapsed onto its first vertex, a remainder (id
 *  −1 − (k·10⁶ + j): `out.walls[k]`'s triangle j) taken out of its list. */
function replaceCut(
  replaced: readonly CutTriangle[],
  baked: Pick<BakedCityMesh, "objects" | "vertices">,
  out: ShopParts
): void {
  const p = baked.vertices.positions;
  const ids = baked.vertices.objectIds;
  const dropped = new Map<number, Set<number>>();
  for (const r of replaced) {
    if (r.id >= 0) {
      const i = 3 * r.id;
      p.copyWithin(i + 3, i, i + 3);
      p.copyWithin(i + 6, i, i + 3);
      out.walls.push({
        object: ids[r.id],
        positions: r.positions,
        from: r.id,
      });
      continue;
    }
    const code = -1 - r.id;
    const k = Math.floor(code / 1e6);
    const set = dropped.get(k) ?? new Set<number>();
    set.add(code - k * 1e6);
    dropped.set(k, set);
    out.walls.push({
      object: out.walls[k].object,
      positions: r.positions,
      from: out.walls[k].from,
    });
  }
  for (const [k, gone] of dropped) {
    const tris = splitTriangles(out.walls[k].positions);
    out.walls[k].positions = tris
      .filter((_, j) => !gone.has(j))
      .flatMap((tri): number[] => [...tri[0], ...tri[1], ...tri[2]]);
  }
}

/** A shopfront part's appender: one object in the host's building tree
 *  (no footprint, its own colour and flags), `eaveH` its top over the
 *  shopfront's foot. */
function shopPart(
  baked: Pick<BakedCityMesh, "objects">,
  out: ShopParts,
  host: CityObjectRow,
  w: ShopfrontWall
) {
  const base = footAt(w, [0, w.L]);
  const above = cm(
    Math.max(...(w.z ?? [0])) -
      base +
      Math.max(
        paneTop(w, host.storeyH) + SHOPFRONT.head + CANOPY.tuck,
        w.sign?.z?.[1] ?? 0,
        ...(w.canopy ?? []).map((c) => c.h)
      ) +
      1
  );
  return (
    tris: Shaded,
    tint: [number, number, number],
    flags: number,
    rough: number,
    eaveH = above
  ) => {
    const index = baked.objects.length;
    out.positions.push(...tris.positions);
    out.normals.push(...tris.normals);
    for (let i = 0; i < tris.positions.length / 9; i += 1) {
      out.objectIds.push(index, index, index);
    }
    baked.objects.push({
      ...host,
      building: false,
      baseZ: cm(base),
      // above the shopfront: no eave stroke, no storey band on it
      eaveH,
      storeyH: above,
      glow: 0,
      // its own colour, none of the host's OSM looks (no shop wash)
      flags,
      rough,
      tint,
      source: OBJECT_SOURCE_SHOPFRONT,
      footprints: [],
    });
  };
}

/** The segments the plinth breaks for: each window the plan cuts, a
 *  little wider. */
export function shopWindowBreaks(plans: readonly ShopPlan[]): PlinthBreak[] {
  return plans.flatMap(({ w, mesh, host }) =>
    spanSegments(
      w,
      mesh.openings.map(({ rect }): [number, number] => [
        rect.s0 - PLINTH_BREAK_M,
        rect.s1 + PLINTH_BREAK_M,
      ])
    ).map((at) => ({ at, root: host.root }))
  );
}

/** How much wider than its window the plinth's break is (m). */
const PLINTH_BREAK_M = 0.05;

/** Whether a host may wear a shopfront: not a glass or metal facade (its
 *  own front), and standing on the ground in front of the wall. */
function shopHost(
  host: Pick<CityObjectRow, "baseZ" | "flags">,
  w: ShopfrontWall
): boolean {
  if (
    hasObjectFlag(host.flags, OBJECT_FLAG_GLASS) ||
    hasObjectFlag(host.flags, OBJECT_FLAG_METAL)
  ) {
    return false;
  }
  return host.baseZ <= Math.min(...(w.z ?? [host.baseZ])) + SHOP_HOST_ABOVE_M;
}
