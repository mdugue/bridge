import { expect, test } from "bun:test";
import {
  ownsPoint,
  buildTileset,
  COARSE_TERRAIN_ERROR,
  FAR_CITY_ERROR,
  parseTilesetExtras,
  terrainRasterExtras,
  tileBox,
  contentExtras,
  tileTopsOf,
} from "./tileset";
import type { BakedTile, TilesetExtras } from "./tileset";

const offset = { cx: 413_000, cy: 5_657_000 };
const tile = (id: string, e: number): BakedTile => ({
  id,
  bounds: [e, 5_656_000, e + 2000, 5_658_000],
  city: `city_${id}.glb.gz`,
  cityFar: `city_${id}_far.glb.gz`,
  files: {
    city: { svf: `svf_${id}.png` },
    terrain: {
      0: {
        landcover: `lc_${id}.png`,
        landcoverLow: "",
        dressing: { lamps: `lamps_${id}.geojson` },
      },
      1: { landcover: `lc_${id}_1.png`, landcoverLow: "" },
    },
  },
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

test("each tile: far buildings replaced by the baked ones, coarse terrain by fine terrain", () => {
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
        content?: { uri: string };
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
  expect(a.content).toBeUndefined();
  const [far, coarse] = a.children;
  expect(far.refine).toBe("REPLACE");
  expect(far.geometricError).toBe(FAR_CITY_ERROR);
  expect(far.content.uri).toBe("city_a_far.glb.gz");
  expect(far.children[0].content.uri).toBe("city_a.glb.gz");
  expect(far.children[0].geometricError).toBe(0);
  expect(coarse.refine).toBe("REPLACE");
  expect(coarse.geometricError).toBe(COARSE_TERRAIN_ERROR);
  expect(coarse.content.uri).toBe("terrain_a_l1.glb.gz");
  expect(coarse.children[0].content.uri).toBe("terrain_a_l0.glb.gz");
  expect(coarse.children[0].geometricError).toBe(0);
});

test("parseTilesetExtras accepts what the bake writes and rejects the rest", () => {
  expect(parseTilesetExtras({ extras })).toEqual(extras);
  expect(() => parseTilesetExtras({})).toThrow(/extras/u);
  expect(() =>
    parseTilesetExtras({ extras: { ...extras, tiles: [] } })
  ).toThrow();
});

test("a tile's top is its box's, in the extras' order", () => {
  const high: BakedTile = { ...tile("b", 410_000), zRange: [90, 340] };
  const set = buildTileset([tile("a", 412_000), high], extras);
  expect(tileTopsOf(set)).toEqual([200, 340]);
  expect(tileTopsOf({ root: { children: [{}] } })).toEqual([undefined]);
  expect(tileTopsOf({})).toEqual([]);
  expect(tileTopsOf(null)).toEqual([]);
});

test("a point on a seam belongs to exactly one tile", () => {
  const west: [number, number, number, number] = [
    410_000, 5_656_000, 412_000, 5_658_000,
  ];
  const east: [number, number, number, number] = [
    412_000, 5_656_000, 414_000, 5_658_000,
  ];
  const onSeam: [number, number] = [412_000, 5_657_000];
  expect(ownsPoint(west, ...onSeam)).toBe(false);
  expect(ownsPoint(east, ...onSeam)).toBe(true);
  expect(ownsPoint(east, 411_950, 5_657_000)).toBe(false);
  expect(ownsPoint(east, 413_999.9, 5_657_999.9)).toBe(true);
});

test("a terrain level's raster extras are what prepare-data wrote by hand, key for key", () => {
  // the published names of a tile with every raster, and the outputs of
  // the hand-written extras (scripts/prepare/terrain.ts `described` and
  // `paintAndLight`, before plan 077 step 1) over the same fixtures: the
  // glb's bytes and the cache keys follow the order, so the strings are
  // pinned
  const every = {
    landcover: "lc.png",
    landcoverLow: "lcl.png",
    landcoverCoarse: "lcc.png",
    ndvi: "ndvi.png",
    surface: "surface.png",
    edges: "edges.png",
    sport: "sport.png",
    sportTable: "sport.json",
    cultivatedRaster: "cult.png",
    cultivatedLow: "cultl.png",
    markings: "mk.png",
    markingsLow: "mkl.png",
    markingsTable: "mk.json",
    svf: "svf.png",
    horizon: "hz.png",
  };
  type Crop = [number, number, number, number, number];
  const crop: Crop = [1, 2, 3, 4, 4096];
  const cases: [Partial<typeof every>, 0 | 1, Crop | undefined, string][] = [
    [
      every,
      0,
      crop,
      '{"landcover":"lc.png","landcoverLow":"lcl.png","ndvi":"ndvi.png","surface":"surface.png","edges":"edges.png","sport":"sport.png","sportTable":"sport.json","cultivated":"cult.png","cultivatedCrop":[1,2,3,4,4096],"cultivatedLow":"cultl.png","markings":"mk.png","markingsTable":"mk.json","markingsLow":"mkl.png","svf":"svf.png","horizon":"hz.png"}',
    ],
    [
      every,
      1,
      crop,
      '{"landcover":"lcc.png","landcoverLow":"lcc.png","ndvi":"ndvi.png","sport":"sport.png","sportTable":"sport.json","svf":"svf.png","horizon":"hz.png"}',
    ],
    // no low twins
    [
      {
        ...every,
        landcoverLow: undefined,
        markingsLow: undefined,
        cultivatedLow: undefined,
      },
      0,
      crop,
      '{"landcover":"lc.png","landcoverLow":"","ndvi":"ndvi.png","surface":"surface.png","edges":"edges.png","sport":"sport.png","sportTable":"sport.json","cultivated":"cult.png","cultivatedCrop":[1,2,3,4,4096],"markings":"mk.png","markingsTable":"mk.json","svf":"svf.png","horizon":"hz.png"}',
    ],
    // a table without its raster, a raster without its table
    [
      { ...every, sport: undefined, markingsTable: undefined },
      0,
      crop,
      '{"landcover":"lc.png","landcoverLow":"lcl.png","ndvi":"ndvi.png","surface":"surface.png","edges":"edges.png","cultivated":"cult.png","cultivatedCrop":[1,2,3,4,4096],"cultivatedLow":"cultl.png","svf":"svf.png","horizon":"hz.png"}',
    ],
    // a colony raster without a crop
    [
      every,
      0,
      undefined,
      '{"landcover":"lc.png","landcoverLow":"lcl.png","ndvi":"ndvi.png","surface":"surface.png","edges":"edges.png","sport":"sport.png","sportTable":"sport.json","markings":"mk.png","markingsTable":"mk.json","markingsLow":"mkl.png","svf":"svf.png","horizon":"hz.png"}',
    ],
    [{}, 0, undefined, '{"landcover":"","landcoverLow":""}'],
    [{}, 1, undefined, '{"landcover":"","landcoverLow":""}'],
  ];
  for (const [names, level, colonies, written] of cases) {
    expect(JSON.stringify(terrainRasterExtras(names, level, colonies))).toBe(
      written
    );
  }
});

test("each content's tile names the side files it is dressed with, and the viewer reads them with the glTF's own extras", () => {
  const set = buildTileset([tile("a", 412_000)], extras) as {
    root: {
      children: {
        children: { children: { extras: object }[]; extras: object }[];
      }[];
    };
  };
  const [city, terrain] = set.root.children[0].children;
  expect(city.extras).toEqual({ svf: "svf_a.png" });
  expect(city.children[0].extras).toEqual({ svf: "svf_a.png" });
  expect(terrain.extras).toEqual({
    landcover: "lc_a_1.png",
    landcoverLow: "",
  });
  // what the glTF says of itself, then what its tile names
  const own = { kind: "terrain", tileId: "a", level: 0 };
  const read = contentExtras(own, terrain.children[0]);
  expect(read).toBe(own as typeof read);
  expect(read).toEqual({
    kind: "terrain",
    tileId: "a",
    level: 0,
    landcover: "lc_a.png",
    landcoverLow: "",
    dressing: { lamps: "lamps_a.geojson" },
  } as unknown as typeof read);
  // a tile without extras (a tileset baked before them) adds nothing
  expect(contentExtras({ kind: "city", tileId: "a" }, {})).toEqual({
    kind: "city",
    tileId: "a",
  });
});
