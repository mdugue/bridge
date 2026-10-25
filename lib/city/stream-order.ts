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
 *   4. the coarse ground before anything else: it is small (0.5 MB of
 *      glTF), and a tile with ground but no buildings yet reads as a
 *      plain, one with buildings but no ground as a hole,
 *   5. nearer before farther,
 *   6. on one tile: ground, then buildings, then the fine ground,
 *   7. higher error first (the renderer's own last word).
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

/** Whether a content is the given site tile's (its published name carries
 *  the tile id: `city_<id>.<hash>.glb.gz`, `terrain_<id>_l1.<hash>.glb.gz`). */
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

/**
 * The queues' comparator: 1 loads `a` first, −1 `b` (the renderer's
 * convention: its queues run the item that sorts last). `bootTile` is the
 * site tile the boot waits on, or null once the first frame is up.
 */
export function streamOrder(
  bootTile: () => string | null
): (a: OrderedTile, b: OrderedTile) => number {
  return (a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) {
      return pa > pb ? 1 : -1;
    }
    const ta = a.traversal;
    const tb = b.traversal;
    if (!(ta && tb)) {
      return 0;
    }
    const boot = bootTile();
    const ra = contentRank(a.internal?.depth);
    const rb = contentRank(b.internal?.depth);
    return (
      prefer(ta.used, tb.used) ||
      (boot === null
        ? 0
        : prefer(isTileContent(a, boot), isTileContent(b, boot))) ||
      prefer(ta.inFrustum, tb.inFrustum) ||
      prefer(ra === CONTENT_RANK.coarse, rb === CONTENT_RANK.coarse) ||
      prefer(
        ta.distanceFromCamera < tb.distanceFromCamera,
        tb.distanceFromCamera < ta.distanceFromCamera
      ) ||
      prefer(ra < rb, rb < ra) ||
      prefer(ta.error > tb.error, tb.error > ta.error)
    );
  };
}
