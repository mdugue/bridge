import { expect, test } from "bun:test";
import { stadtwissenIndex, stadtwissenTile } from "./bake-stadtwissen";

const city = {
  CityObjects: {
    // a landmark: unnamed in OSM, its part taller than itself
    kirche: {
      type: "Building",
      attributes: { function: "31001_3040", roofType: "3100" },
      children: ["kirche-turm"],
      geographicalExtent: [100, 200, 110, 140, 260, 150],
    },
    "kirche-turm": {
      type: "BuildingPart",
      attributes: { measuredHeight: 91.2 },
      parents: ["kirche"],
    },
    // named and addressed through its part's OSM row
    haus: {
      type: "Building",
      attributes: { function: "31001_1000", measuredHeight: 14.04 },
      children: ["haus-1"],
      geographicalExtent: [0, 0, 112, 10, 10, 126],
    },
    "haus-1": { type: "BuildingPart", parents: ["haus"] },
    // nobody names it: not in the directory
    schuppen: {
      type: "Building",
      attributes: { measuredHeight: 3 },
      geographicalExtent: [50, 50, 110, 52, 52, 113],
    },
  },
};

test("a tile's directory: named, addressed, listed and landmark Buildings", () => {
  const tile = stadtwissenTile({
    tile: "t",
    city,
    osm: {
      "haus-1": { name: "Kügelgenhaus", addr: "Hauptstraße 13", levels: 4 },
      haus: { heritage: 1, shop: 1 },
    },
    landmarks: {
      landmarks: [
        {
          id: "Q1",
          name: "Kirche",
          links: 30,
          objects: ["kirche-turm"],
          x: 120,
          y: 230,
        },
      ],
    },
    monuments: {
      features: [
        {
          geometry: { type: "Point", coordinates: [10.4, 20.6] },
          properties: { name: "Brunnen", kind: "fountain" },
        },
        {
          geometry: { type: "Point", coordinates: [11, 21] },
          properties: { kind: "stone" },
        },
      ],
    },
  });
  expect(tile.buildings).toEqual([
    {
      id: "haus",
      name: "Kügelgenhaus",
      addr: "Hauptstraße 13",
      x: 5,
      y: 5,
      z: 112,
      h: 14,
      r: 7.1,
      use: "Wohngebäude",
      levels: 4,
      heritage: true,
      shop: true,
    },
    {
      id: "kirche",
      x: 120,
      y: 230,
      z: 110,
      h: 91.2,
      r: 36.1,
      use: "Gebäude für religiöse Zwecke",
      roof: "Satteldach",
      wd: "Q1",
    },
  ]);
  expect(tile.monuments).toEqual([
    { id: "m10_21", name: "Brunnen", kind: "fountain", x: 10.4, y: 20.6 },
  ]);
});

test("without a geographicalExtent the box comes from its and its parts' vertices", () => {
  // Hamburg's files: integer vertices under a transform, no extents
  const tile = stadtwissenTile({
    tile: "t",
    city: {
      transform: { scale: [0.01, 0.01, 0.01], translate: [1000, 2000, 0] },
      vertices: [
        [0, 0, 1000],
        [2000, 1000, 1000],
        [1000, 500, 2800],
      ],
      CityObjects: {
        haus: {
          type: "Building",
          children: ["haus-1"],
          geometry: [{ boundaries: [[[[0, 1]]]] }],
        },
        "haus-1": {
          type: "BuildingPart",
          parents: ["haus"],
          geometry: [{ boundaries: [[[[2]]]] }],
        },
      },
    },
    osm: { haus: { name: "Speicher" } },
  });
  expect(tile.buildings).toEqual([
    { id: "haus", name: "Speicher", r: 11.2, x: 1010, y: 2005, z: 10, h: 18 },
  ]);
});

test("the index lists each landmark once, most notable first, with its facts", () => {
  const entry = (id: string, links: number) => ({
    id,
    name: id,
    links,
    objects: [],
    x: 0,
    y: 0,
    h: 10,
  });
  const index = stadtwissenIndex({
    site: "probe",
    epsg: 25833,
    tiles: [{ id: "a", file: "stadtwissen_a.json" }],
    sources: {},
    landmarks: [
      { tile: "a", file: { landmarks: [entry("Q1", 5), entry("Q2", 9)] } },
      { tile: "b", file: { landmarks: [entry("Q1", 5)] } },
    ],
    wikidata: {
      attribution: "Wikidata, CC0",
      retrieved: "2026-10-29",
      entities: { Q2: { label: "Zwei", claims: {} } },
    },
  });
  expect(index.landmarks.map((l) => [l.id, l.tile, l.facts?.label])).toEqual([
    ["Q2", "a", "Zwei"],
    ["Q1", "a", undefined],
  ]);
});
