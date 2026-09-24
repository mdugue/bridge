import { expect, test } from "bun:test";
import {
  type BakedTile,
  buildTileset,
  COARSE_TERRAIN_ERROR,
  parseTilesetExtras,
  type TilesetExtras,
  tileBox,
} from "./tileset";

const offset = { cx: 413_000, cy: 5_657_000 };
const tile = (id: string, e: number): BakedTile => ({
  id,
  bounds: [e, 5_656_000, e + 2000, 5_658_000],
  city: `city_${id}.glb.gz`,
  terrain: { 0: `terrain_${id}_l0.glb.gz`, 1: `terrain_${id}_l1.glb.gz` },
  zRange: [100, 200],
});
const extras: TilesetExtras = {
  site: "dresden",
  epsg: 25_833,
  offset,
  tiles: [
    {
      id: "a",
      bounds: [412_000, 5_656_000, 414_000, 5_658_000],
      footprints: "f.json",
      minimap: "m.png",
    },
  ],
};

test("a tile box is centred in the recentered frame", () => {
  expect(
    tileBox([412_000, 5_656_000, 414_000, 5_658_000], [100, 200], offset)
  ).toEqual([0, 0, 150, 1000, 0, 0, 0, 1000, 0, 0, 0, 50]);
});

test("each tile: buildings added, coarse terrain replaced by fine terrain", () => {
  const set = buildTileset(
    [tile("a", 412_000), tile("b", 410_000)],
    extras
  ) as {
    asset: { version: string };
    extras: TilesetExtras;
    root: {
      boundingVolume: { box: number[] };
      children: {
        children: {
          children: { content: { uri: string }; geometricError: number }[];
          content: { uri: string };
          geometricError: number;
          refine: string;
        }[];
        content: { uri: string };
        refine: string;
      }[];
      refine: string;
    };
  };
  expect(set.asset.version).toBe("1.1");
  expect(set.extras).toEqual(extras);
  expect(set.root.refine).toBe("ADD");
  expect(set.root.children).toHaveLength(2);
  // The union box spans both tiles: 410–414 km east.
  expect(set.root.boundingVolume.box.slice(0, 4)).toEqual([
    -1000, 0, 150, 2000,
  ]);
  const [a] = set.root.children;
  expect(a.refine).toBe("ADD");
  expect(a.content.uri).toBe("city_a.glb.gz");
  const coarse = a.children[0];
  expect(coarse.refine).toBe("REPLACE");
  expect(coarse.geometricError).toBe(COARSE_TERRAIN_ERROR);
  expect(coarse.content.uri).toBe("terrain_a_l1.glb.gz");
  expect(coarse.children[0].content.uri).toBe("terrain_a_l0.glb.gz");
  expect(coarse.children[0].geometricError).toBe(0);
});

test("parseTilesetExtras accepts what the bake writes and rejects the rest", () => {
  expect(parseTilesetExtras({ extras })).toEqual(extras);
  expect(() => parseTilesetExtras({})).toThrow(/extras/);
  expect(() =>
    parseTilesetExtras({ extras: { ...extras, tiles: [] } })
  ).toThrow();
});
