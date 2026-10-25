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
 *   2. until the first frame, the tile the boot starts on,
 *   3. in view before out of view (the shadow camera's),
 *   4. nearer before farther, the coarse ground counted `COARSE_LEAD_M`
 *      nearer than it is: it is small (0.5 MB of glTF), and a tile with
 *      ground but no buildings yet reads as a plain, one with buildings
 *      but no ground as a hole — but a whole flight's worth of far coarse
 *      tiles must not hold up the buildings under the camera,
 *   5. on one tile: ground, then buildings, then the fine ground,
 *   6. higher error first (the renderer's own last word).
 *
 * When the tile cache is full the renderer admits new loads in the order
 * it would keep them (`keepOrder`), so that order ranks the same way.
 */

/** The part of a tile the comparator reads (3DTilesRendererJS's `Tile`). */
export interface OrderedTile {
  content?: { uri?: string } | null;
  internal?: { depth: number } | null;
  priority?: number;
  traversal?: {
    distanceFromCamera: number;
    error: number;
    inFrustum: boolean;
    used: boolean;
  } | null;
}

/**
 * What a content is, by its depth in the tileset (`buildTileset`: the root,
 * then per site tile its buildings, the coarse ground under them and the
 * fine ground under that). Lower comes first on one tile.
 */
export const CONTENT_RANK = { coarse: 0, city: 1, fine: 2, other: 3 } as const;

const RANK_AT_DEPTH: readonly number[] = [
  CONTENT_RANK.other,
  CONTENT_RANK.city,
  CONTENT_RANK.coarse,
  CONTENT_RANK.fine,
];

export function contentRank(depth: number | undefined): number {
  return (
    (depth === undefined ? undefined : RANK_AT_DEPTH[depth]) ??
    CONTENT_RANK.other
  );
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
  // which contents are the boot tile's: a name scan once per content
  let bootId: string | null = null;
  let isBoot = new WeakMap<OrderedTile, boolean>();
  const onBootTile = (tile: OrderedTile): boolean => {
    let known = isBoot.get(tile);
    if (known === undefined) {
      known = bootId !== null && isTileContent(tile, bootId);
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
    const ra = contentRank(a.internal?.depth);
    const rb = contentRank(b.internal?.depth);
    const da = rankedDistance(ta.distanceFromCamera, ra);
    const db = rankedDistance(tb.distanceFromCamera, rb);
    return (
      prefer(ta.used, tb.used) ||
      (boot === null ? 0 : prefer(onBootTile(a), onBootTile(b))) ||
      prefer(ta.inFrustum, tb.inFrustum) ||
      prefer(da < db, db < da) ||
      prefer(ra < rb, rb < ra) ||
      prefer(ta.error > tb.error, tb.error > ta.error)
    );
  };
}

/** The part of a tile the cache's comparator reads. */
export interface CachedTile {
  internal?: { depth: number } | null;
  traversal?: { lastFrameVisited: number } | null;
}

/**
 * The tile cache's unload order (3DTilesRendererJS `unloadPriorityCallback`:
 * 1 unloads `a` first), which is also the order a full cache admits new
 * loads in, reversed. The renderer's own (`base`) decides, except that of
 * one site tile's contents last seen in the same frame the fine ground
 * goes first, then the buildings, and the coarse ground last — its own
 * prefers the shallower, so with the cache full a tile's buildings took
 * the last room before its ground.
 */
export function keepOrder<T extends CachedTile>(
  base: (a: T, b: T) => number
): (a: T, b: T) => number {
  return (a, b) => {
    const fa = a.traversal?.lastFrameVisited;
    const fb = b.traversal?.lastFrameVisited;
    if (fa === fb) {
      const ra = contentRank(a.internal?.depth);
      const rb = contentRank(b.internal?.depth);
      if (ra !== rb && ra !== CONTENT_RANK.other && rb !== CONTENT_RANK.other) {
        return ra > rb ? 1 : -1;
      }
    }
    return base(a, b);
  };
}
