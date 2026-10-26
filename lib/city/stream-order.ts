/**
 * The order the tile stream downloads and parses contents in
 * (app/_components/tile-stream.ts `orderStreaming`). No THREE, no DOM.
 *
 * 3DTilesRendererJS sorts its queues by screen-space error, highest first.
 * In this tileset (lib/city/tileset.ts) that is the wrong way round: a
 * tile's buildings carry `TILE_ERROR` so that they always show, which
 * makes them the "worst" content of every tile in view, and every visible
 * tile's full LoD2 buildings (4 MB on average, 7 MB at most for Dresden)
 * queued ahead of any ground — a flight showed roofs over holes for
 * seconds, and on a phone's two parse slots the neighbours' buildings held
 * up everyone's ground. So the order is ours:
 *
 *   1. what the renderer marked (`priority`), used before unused,
 *   2. until the first frame, what it waits for: the boot tile's coarse
 *      ground and far buildings (its fine ground parsing beside them,
 *      rasters and all, held the first frame up by a third, headless; its
 *      baked buildings twice the far ones' bytes),
 *   3. in view before out of view (the shadow camera's),
 *   4. nearer before farther, the coarse ground counted `COARSE_LEAD_M`
 *      nearer than it is: it is small (0.5 MB of glTF), and a tile with
 *      ground but no buildings yet reads as a plain, one with buildings
 *      but no ground as a hole — but a whole flight's worth of far coarse
 *      tiles must not hold up the buildings under the camera,
 *   5. on one tile: ground, far buildings, buildings, the fine ground,
 *   6. higher error first (the renderer's own last word).
 *
 * When the tile cache is full the renderer admits new loads in the order
 * it would keep them (`keepOrder`), so that order ranks the same way.
 */

/** The part of a tile the comparator reads (3DTilesRendererJS's `Tile`). */
export interface OrderedTile {
  content?: { uri?: string } | null;
  priority?: number;
  traversal?: {
    distanceFromCamera: number;
    error: number;
    inFrustum: boolean;
    used: boolean;
  } | null;
}

/**
 * What a content is, by its published name (`buildTileset` and
 * scripts/prepare-data.ts: `terrain_<id>_l1`, `city_<id>_far`,
 * `city_<id>`, `terrain_<id>_l0`, each `.<hash>.glb.gz`). Lower comes
 * first on one tile.
 */
export const CONTENT_RANK = {
  coarse: 0,
  cityFar: 1,
  city: 2,
  fine: 3,
  other: 4,
} as const;

const NAMED_RANKS: readonly [RegExp, number][] = [
  [/^terrain_.*_l1\./, CONTENT_RANK.coarse],
  [/^terrain_.*_l0\./, CONTENT_RANK.fine],
  [/^city_.*_far\./, CONTENT_RANK.cityFar],
  [/^city_/, CONTENT_RANK.city],
];

export function contentRank(uri: string | undefined): number {
  const name = uri?.slice(uri.lastIndexOf("/") + 1) ?? "";
  return (
    NAMED_RANKS.find(([pattern]) => pattern.test(name))?.[1] ??
    CONTENT_RANK.other
  );
}

/** The site tile a content belongs to, from its published name
 *  (`city_<id>[_far].<hash>…`, `terrain_<id>_l<n>.<hash>…`); null for
 *  anything else. */
export function siteTileOf(uri: string | undefined): string | null {
  const name = uri?.slice(uri.lastIndexOf("/") + 1) ?? "";
  return (
    /^(?:city|terrain)_(.+?)(?:_far|_l\d)?\.[^.]+\.glb/.exec(name)?.[1] ?? null
  );
}

/** A content's site tile, read once per tile (a name scan). */
const siteTiles = new WeakMap<object, string | null>();
function siteTileOfTile(tile: CachedTile): string | null {
  let id = siteTiles.get(tile);
  if (id === undefined) {
    id = siteTileOf(tile.content?.uri);
    siteTiles.set(tile, id);
  }
  return id;
}

/** A content's rank, read once per tile (a name scan). */
const ranks = new WeakMap<object, number>();
function rankOf(tile: { content?: { uri?: string } | null }): number {
  let rank = ranks.get(tile);
  if (rank === undefined) {
    rank = contentRank(tile.content?.uri);
    ranks.set(tile, rank);
  }
  return rank;
}

/**
 * How much nearer (m) the coarse ground counts than it is: one site tile.
 * Every tile's coarse ground within a tile's edge of the nearest buildings
 * comes before them; farther ones wait their turn by distance.
 */
export const COARSE_LEAD_M = 2000;

/** Whether a content is the given site tile's (its published name carries
 *  the tile id: `city_<id>.<hash>.glb.gz`, `terrain_<id>_l1.<hash>.glb.gz`
 *  — scripts/prepare-data.ts). */
export function isTileContent(tile: OrderedTile, tileId: string): boolean {
  return tile.content?.uri?.includes(`_${tileId}`) ?? false;
}

/** What the first frame waits for on the boot tile: its coarse ground and
 *  its far buildings (the same shapes, a sixth of the triangles — the
 *  baked ones follow like any near tile's). */
const BOOT_RANKS: ReadonlySet<number> = new Set([
  CONTENT_RANK.coarse,
  CONTENT_RANK.cityFar,
]);

/** +1 when `a` wins, −1 when `b` does, 0 when the test does not decide. */
function prefer(a: boolean, b: boolean): number {
  if (a === b) {
    return 0;
  }
  return a ? 1 : -1;
}

/** The distance a content is ranked by (`COARSE_LEAD_M`). */
function rankedDistance(distance: number, rank: number): number {
  return rank === CONTENT_RANK.coarse ? distance - COARSE_LEAD_M : distance;
}

/**
 * The queues' comparator: 1 loads `a` first, −1 `b` (the renderer's
 * convention: its queues run the item that sorts last). `bootTile` is the
 * site tile the boot waits on, or null once the first frame is up.
 * An item without traversal state (not a tile) is left where it is, as
 * the renderer's own comparator does; one without `priority` ranks as
 * the renderer's (`Infinity`).
 */
export function streamOrder(
  bootTile: () => string | null
): (a: OrderedTile, b: OrderedTile) => number {
  // which contents the first frame waits for: a name scan once per content
  let bootId: string | null = null;
  let isBoot = new WeakMap<OrderedTile, boolean>();
  const forBoot = (tile: OrderedTile): boolean => {
    let known = isBoot.get(tile);
    if (known === undefined) {
      known =
        bootId !== null &&
        BOOT_RANKS.has(rankOf(tile)) &&
        isTileContent(tile, bootId);
      isBoot.set(tile, known);
    }
    return known;
  };
  return (a, b) => {
    const pa = a.priority ?? Number.POSITIVE_INFINITY;
    const pb = b.priority ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) {
      return pa > pb ? 1 : -1;
    }
    const ta = a.traversal;
    const tb = b.traversal;
    if (!(ta && tb)) {
      return 0;
    }
    const boot = bootTile();
    if (boot !== bootId) {
      bootId = boot;
      isBoot = new WeakMap();
    }
    const ra = rankOf(a);
    const rb = rankOf(b);
    const da = rankedDistance(ta.distanceFromCamera, ra);
    const db = rankedDistance(tb.distanceFromCamera, rb);
    return (
      prefer(ta.used, tb.used) ||
      (boot === null ? 0 : prefer(forBoot(a), forBoot(b))) ||
      prefer(ta.inFrustum, tb.inFrustum) ||
      prefer(da < db, db < da) ||
      prefer(ra < rb, rb < ra) ||
      prefer(ta.error > tb.error, tb.error > ta.error)
    );
  };
}

/** The part of a tile the cache's comparator reads. */
export interface CachedTile {
  content?: { uri?: string } | null;
  traversal?: { lastFrameVisited: number } | null;
}

/**
 * The tile cache's unload order (3DTilesRendererJS `unloadPriorityCallback`:
 * 1 unloads `a` first), which is also the order a full cache admits new
 * loads in, reversed. The renderer's own (`base`) decides, except that of
 * one site tile's contents last seen in the same frame the fine ground
 * goes first, then the buildings, the far ones, and the coarse ground
 * last — its own
 * prefers the shallower, so with the cache full a tile's buildings took
 * the last room before its ground.
 */
export function keepOrder<T extends CachedTile>(
  base: (a: T, b: T) => number
): (a: T, b: T) => number {
  return (a, b) => {
    const fa = a.traversal?.lastFrameVisited;
    const fb = b.traversal?.lastFrameVisited;
    // one site tile's contents only: across tiles the renderer's order
    // (by distance, through the visit frame and depth) stands — ranked by
    // kind alone, a full cache gave every far tile's coarse ground the
    // last room before the buildings under the camera
    const tile = siteTileOfTile(a);
    if (fa === fb && tile !== null && tile === siteTileOfTile(b)) {
      const ra = rankOf(a);
      const rb = rankOf(b);
      if (ra !== rb) {
        return ra > rb ? 1 : -1;
      }
    }
    return base(a, b);
  };
}
