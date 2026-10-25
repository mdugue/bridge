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

type Kind = "city" | "far" | "coarse" | "fine";
const URIS: Record<Kind, (id: string) => string> = {
  city: (id) => `city_${id}.15f084ef.glb.gz`,
  far: (id) => `city_${id}_far.0c1d2e3f.glb.gz`,
  coarse: (id) => `terrain_${id}_l1.5b9b066a.glb.gz`,
  fine: (id) => `terrain_${id}_l0.a7ae8fff.glb.gz`,
};

function content(
  kind: Kind,
  tile: string,
  traversal: Partial<NonNullable<OrderedTile["traversal"]>> = {}
): OrderedTile {
  return {
    content: { uri: `https://example.org/data/dresden/${URIS[kind](tile)}` },
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

test("the names rank the contents buildTileset writes", () => {
  const baked = (id: string, x: number): BakedTile => ({
    bounds: [x, 0, x + 2000, 2000],
    city: URIS.city(id),
    cityFar: URIS.far(id),
    id,
    terrain: { 0: URIS.fine(id), 1: URIS.coarse(id) },
    zRange: [100, 150],
  });
  type Node = { children?: Node[]; content?: { uri: string } };
  const json = buildTileset([baked(SPAWN, 0), baked(NEIGHBOUR, 2000)], {
    epsg: 25833,
    offset: { cx: 0, cy: 0 },
    site: "dresden",
    tiles: [],
  }) as { root: Node };
  const ranks: number[] = [];
  const walk = (node: Node) => {
    if (node.content) {
      ranks.push(contentRank(node.content.uri));
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  walk(json.root);
  // per tile: the far buildings over the baked ones, the coarse ground
  // over the fine
  const tile = [
    CONTENT_RANK.cityFar,
    CONTENT_RANK.city,
    CONTENT_RANK.coarse,
    CONTENT_RANK.fine,
  ];
  expect(ranks).toEqual([...tile, ...tile]);
  expect(contentRank(undefined)).toBe(CONTENT_RANK.other);
  expect(contentRank("tileset-spawn.json")).toBe(CONTENT_RANK.other);
});

test("every tile's coarse ground before any buildings, nearer before farther", () => {
  const near = content("city", SPAWN, { distanceFromCamera: 100, error: 1e6 });
  const nearFine = content("fine", SPAWN, {
    distanceFromCamera: 100,
    error: 30,
  });
  const nearCoarse = content("coarse", SPAWN, {
    distanceFromCamera: 100,
    error: 400,
  });
  const far = content("city", NEIGHBOUR, {
    distanceFromCamera: 1500,
    error: 1e5,
  });
  const farCoarse = content("coarse", NEIGHBOUR, {
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

test("until the first frame what it waits for goes first: the boot tile's ground and far buildings", () => {
  const spawnCity = content("city", SPAWN, { distanceFromCamera: 900 });
  const spawnFar = content("far", SPAWN, { distanceFromCamera: 900 });
  const spawnCoarse = content("coarse", SPAWN, { distanceFromCamera: 900 });
  const spawnFine = content("fine", SPAWN, { distanceFromCamera: 900 });
  const neighbourCoarse = content("coarse", NEIGHBOUR, {
    distanceFromCamera: 10,
  });
  expect(
    runOrder(
      [neighbourCoarse, spawnFine, spawnCity, spawnFar, spawnCoarse],
      SPAWN
    )
  ).toEqual([spawnCoarse, spawnFar, neighbourCoarse, spawnCity, spawnFine]);
  // after it, the nearer neighbour's ground comes first
  expect(
    runOrder([neighbourCoarse, spawnFine, spawnCity, spawnFar, spawnCoarse])[0]
  ).toBe(neighbourCoarse);
});

test("used before unused and in view before out of view, whatever the kind", () => {
  const unused = content("coarse", SPAWN, {
    used: false,
    distanceFromCamera: 0,
  });
  const behind = content("coarse", SPAWN, {
    inFrustum: false,
    distanceFromCamera: 0,
  });
  const ahead = content("city", NEIGHBOUR, { distanceFromCamera: 1900 });
  expect(runOrder([unused, behind, ahead])).toEqual([ahead, behind, unused]);
});

test("the renderer's own priority still decides first, as its comparator has it", () => {
  // a fine ground far away whose priority sorts it last runs first
  const coarse = {
    ...content("coarse", SPAWN, { distanceFromCamera: 0 }),
    priority: 1,
  };
  const fine = {
    ...content("fine", NEIGHBOUR, { distanceFromCamera: 1e4 }),
    priority: 2,
  };
  expect(runOrder([coarse, fine])[0]).toBe(fine);
  // a tile without one ranks as the renderer's: Infinity
  expect(runOrder([coarse, content("fine", NEIGHBOUR)])[0]).not.toBe(coarse);
});

test("a tile without traversal state is left where it is", () => {
  const order = streamOrder(() => null);
  expect(order({ content: { uri: "x" } }, content("coarse", SPAWN))).toBe(0);
});

test("a content is a site tile's by the id in its name", () => {
  expect(isTileContent(content("city", SPAWN), SPAWN)).toBe(true);
  expect(isTileContent(content("coarse", SPAWN), SPAWN)).toBe(true);
  expect(isTileContent(content("far", SPAWN), SPAWN)).toBe(true);
  expect(isTileContent(content("city", NEIGHBOUR), SPAWN)).toBe(false);
  expect(isTileContent({}, SPAWN)).toBe(false);
});

test("a far tile's coarse ground waits behind the buildings under the camera", () => {
  const here = content("city", SPAWN, { distanceFromCamera: 0 });
  const nearCoarse = content("coarse", NEIGHBOUR, {
    distanceFromCamera: COARSE_LEAD_M - 1,
  });
  const farCoarse = content("coarse", NEIGHBOUR, {
    distanceFromCamera: COARSE_LEAD_M + 500,
  });
  expect(runOrder([farCoarse, here, nearCoarse])).toEqual([
    nearCoarse,
    here,
    farCoarse,
  ]);
});

test("a full cache admits a tile's ground before its buildings, and unloads it last", () => {
  const DEPTH: Record<Kind, number> = { far: 2, city: 3, coarse: 2, fine: 3 };
  const seen = (kind: Kind | "root", lastFrameVisited: number) => ({
    content: { uri: kind === "root" ? "tileset.json" : URIS[kind](SPAWN) },
    internal: { depth: kind === "root" ? 0 : DEPTH[kind] },
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
  const city = seen("city", 10);
  const far = seen("far", 10);
  const coarse = seen("coarse", 10);
  const fine = seen("fine", 10);
  const old = seen("coarse", 3);
  // ascending: what is kept longest first, as the renderer admits loads
  expect([fine, old, city, far, coarse].sort(order)).toEqual([
    coarse,
    far,
    city,
    fine,
    old,
  ]);
  // other contents are the renderer's call
  expect(order(seen("root", 10), city)).toBe(base(seen("root", 10), city));
});
