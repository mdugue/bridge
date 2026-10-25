import { expect, test } from "bun:test";
import {
  COARSE_LEAD_M,
  CONTENT_RANK,
  contentRank,
  isTileContent,
  keepOrder,
  type OrderedTile,
  streamOrder,
} from "./stream-order";
import { type BakedTile, buildTileset } from "./tileset";

const SPAWN = "33412_5656_2_sn";
const NEIGHBOUR = "33414_5656_2_sn";

const URIS: Record<number, (id: string) => string> = {
  1: (id) => `city_${id}.15f084ef.glb.gz`,
  2: (id) => `terrain_${id}_l1.5b9b066a.glb.gz`,
  3: (id) => `terrain_${id}_l0.a7ae8fff.glb.gz`,
};

function content(
  depth: number,
  tile: string,
  traversal: Partial<NonNullable<OrderedTile["traversal"]>> = {}
): OrderedTile {
  return {
    content: { uri: URIS[depth]?.(tile) },
    internal: { depth },
    traversal: {
      distanceFromCamera: 500,
      error: 10,
      inFrustum: true,
      used: true,
      ...traversal,
    },
  };
}

/** What the queue runs first, in order (it runs what sorts last). */
function runOrder(tiles: OrderedTile[], boot: string | null = null) {
  return [...tiles].sort(streamOrder(() => boot)).reverse();
}

test("the depths name the contents buildTileset writes", () => {
  const baked = (id: string, x: number): BakedTile => ({
    bounds: [x, 0, x + 2000, 2000],
    city: URIS[1](id),
    id,
    terrain: { 0: URIS[3](id), 1: URIS[2](id) },
    zRange: [100, 150],
  });
  type Node = { children?: Node[]; content?: { uri: string } };
  const json = buildTileset([baked(SPAWN, 0), baked(NEIGHBOUR, 2000)], {
    epsg: 25833,
    offset: { cx: 0, cy: 0 },
    site: "dresden",
    tiles: [],
  }) as { root: Node };
  const ranks: [string, number][] = [];
  const walk = (node: Node, depth: number) => {
    if (node.content) {
      ranks.push([node.content.uri, contentRank(depth)]);
    }
    for (const child of node.children ?? []) {
      walk(child, depth + 1);
    }
  };
  walk(json.root, 0);
  expect(ranks).toHaveLength(6);
  for (const [uri, rank] of ranks) {
    const expected = uri.startsWith("city_")
      ? CONTENT_RANK.city
      : uri.includes("_l1.")
        ? CONTENT_RANK.coarse
        : CONTENT_RANK.fine;
    expect(rank).toBe(expected);
  }
});

test("every tile's coarse ground before any buildings, nearer before farther", () => {
  const near = content(1, SPAWN, { distanceFromCamera: 100, error: 1e6 });
  const nearFine = content(3, SPAWN, { distanceFromCamera: 100, error: 30 });
  const nearCoarse = content(2, SPAWN, { distanceFromCamera: 100, error: 400 });
  const far = content(1, NEIGHBOUR, { distanceFromCamera: 1500, error: 1e5 });
  const farCoarse = content(2, NEIGHBOUR, {
    distanceFromCamera: 1500,
    error: 30,
  });
  expect(runOrder([far, nearFine, near, farCoarse, nearCoarse])).toEqual([
    nearCoarse,
    farCoarse,
    near,
    nearFine,
    far,
  ]);
});

test("until the first frame the boot's tile goes first, whole", () => {
  const spawnCity = content(1, SPAWN, { distanceFromCamera: 900 });
  const spawnFine = content(3, SPAWN, { distanceFromCamera: 900 });
  const neighbourCoarse = content(2, NEIGHBOUR, { distanceFromCamera: 10 });
  expect(runOrder([neighbourCoarse, spawnFine, spawnCity], SPAWN)).toEqual([
    spawnCity,
    spawnFine,
    neighbourCoarse,
  ]);
  // after it, the neighbour's ground comes first
  expect(runOrder([neighbourCoarse, spawnFine, spawnCity])[0]).toBe(
    neighbourCoarse
  );
});

test("used before unused and in view before out of view, whatever the kind", () => {
  const unused = content(2, SPAWN, { used: false, distanceFromCamera: 0 });
  const behind = content(2, SPAWN, { inFrustum: false, distanceFromCamera: 0 });
  const ahead = content(1, NEIGHBOUR, { distanceFromCamera: 1900 });
  expect(runOrder([unused, behind, ahead])).toEqual([ahead, behind, unused]);
});

test("the renderer's own priority still decides first, as its comparator has it", () => {
  // a fine ground far away whose priority sorts it last runs first
  const coarse = {
    ...content(2, SPAWN, { distanceFromCamera: 0 }),
    priority: 1,
  };
  const fine = {
    ...content(3, NEIGHBOUR, { distanceFromCamera: 1e4 }),
    priority: 2,
  };
  expect(runOrder([coarse, fine])[0]).toBe(fine);
  // a tile without one ranks as the renderer's: Infinity
  expect(runOrder([coarse, content(3, NEIGHBOUR)])[0]).not.toBe(coarse);
});

test("a tile without traversal state is left where it is", () => {
  const order = streamOrder(() => null);
  expect(order({ internal: { depth: 1 } }, content(2, SPAWN))).toBe(0);
});

test("a content is a site tile's by the id in its name", () => {
  expect(isTileContent(content(1, SPAWN), SPAWN)).toBe(true);
  expect(isTileContent(content(2, SPAWN), SPAWN)).toBe(true);
  expect(isTileContent(content(1, NEIGHBOUR), SPAWN)).toBe(false);
  expect(isTileContent({}, SPAWN)).toBe(false);
});

test("a far tile's coarse ground waits behind the buildings under the camera", () => {
  const here = content(1, SPAWN, { distanceFromCamera: 0 });
  const nearCoarse = content(2, NEIGHBOUR, {
    distanceFromCamera: COARSE_LEAD_M - 1,
  });
  const farCoarse = content(2, NEIGHBOUR, {
    distanceFromCamera: COARSE_LEAD_M + 500,
  });
  expect(runOrder([farCoarse, here, nearCoarse])).toEqual([
    nearCoarse,
    here,
    farCoarse,
  ]);
});

test("a full cache admits a tile's ground before its buildings, and unloads it last", () => {
  const seen = (depth: number, lastFrameVisited: number) => ({
    internal: { depth },
    traversal: { lastFrameVisited },
  });
  // the renderer's: the least recently seen first, then the deeper
  const base = (
    a: ReturnType<typeof seen>,
    b: ReturnType<typeof seen>
  ): number =>
    a.traversal.lastFrameVisited !== b.traversal.lastFrameVisited
      ? a.traversal.lastFrameVisited > b.traversal.lastFrameVisited
        ? -1
        : 1
      : a.internal.depth > b.internal.depth
        ? 1
        : -1;
  const order = keepOrder(base);
  const city = seen(1, 10);
  const coarse = seen(2, 10);
  const fine = seen(3, 10);
  const old = seen(2, 3);
  // ascending: what is kept longest first, as the renderer admits loads
  expect([fine, old, city, coarse].sort(order)).toEqual([
    coarse,
    city,
    fine,
    old,
  ]);
  // other depths are the renderer's call
  expect(order(seen(0, 10), city)).toBe(base(seen(0, 10), city));
});
