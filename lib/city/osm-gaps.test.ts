import { expect, test } from "bun:test";
import {
  gapsGeoJson,
  MIN_LEVELS_HEIGHT_M,
  osmGaps,
  osmLinks,
} from "./osm-gaps";
import type { StadtwissenIndex, WissenTile } from "./stadtwissen";

const X = 411_600;
const Y = 5_656_500;
const INDEX: StadtwissenIndex = {
  epsg: 25_833,
  site: "dresden",
  sources: {},
  tiles: [{ id: "t", file: "t.json" }],
  landmarks: [
    {
      id: "Q1",
      name: "Unbenannt",
      tile: "t",
      x: X,
      y: Y,
      h: 30,
      links: 9,
      objects: ["a"],
    },
    {
      id: "Q2",
      name: "Benannt",
      tile: "t",
      x: X,
      y: Y,
      h: 30,
      links: 9,
      objects: ["b", "c"],
    },
    {
      id: "Q4",
      name: "Nur Teile",
      tile: "t",
      x: X,
      y: Y,
      h: 20,
      links: 3,
      objects: ["part-of-j"],
    },
    {
      id: "Q3",
      name: "Pöppelmannbrücke (Grimma)",
      tile: "t",
      x: X,
      y: Y,
      h: 10,
      links: 9,
      objects: ["g"],
    },
  ],
};
const TILE: WissenTile = {
  tile: "t",
  monuments: [],
  buildings: [
    { id: "a", wd: "Q1", x: X, y: Y, z: 110, h: 30 },
    { id: "b", wd: "Q2", x: X, y: Y, z: 110 },
    { id: "c", wd: "Q2", name: "Benannt", x: X, y: Y, z: 110 },
    { id: "d", addr: "Hochhaus 1", x: X, y: Y, z: 110, h: 40 },
    {
      id: "e",
      addr: "Flach 2",
      x: X,
      y: Y,
      z: 110,
      h: MIN_LEVELS_HEIGHT_M - 1,
    },
    { id: "f", heritage: true, x: X, y: Y, z: 110, h: 12 },
    { id: "g", wd: "Q3", x: X, y: Y, z: 110 },
    { id: "h", name: "Kreuzkirche", x: X, y: Y, z: 110, h: 90 },
    { id: "i", addr: "Gezählt 3", levels: 5, x: X, y: Y, z: 110, h: 20 },
    // tied to its landmark by wd only (the landmark lists its parts)
    { id: "j", wd: "Q4", x: X, y: Y, z: 110, h: 20 },
  ],
};

test("the gaps are a nameless landmark, a tall house without storeys and a nameless listed building", () => {
  // the seam's building is in both tiles' directories: one task
  const seam: WissenTile = {
    tile: "u",
    monuments: [],
    buildings: [TILE.buildings[3]],
  };
  const gaps = osmGaps(INDEX, [TILE, seam]);
  expect(gaps.map((g) => `${g.kind}:${g.id}`)).toEqual([
    "denkmal-ohne-name:f",
    "geschosse-fehlen:d",
    "wahrzeichen-ohne-name:Q1",
    "wahrzeichen-ohne-name:Q4",
  ]);
  const near = gaps[0];
  expect(near.lat).toBeCloseTo(51.04, 1);
  expect(near.lon).toBeCloseTo(13.73, 1);
});

test("a task is a GeoJSON point with its instruction and links", () => {
  const gaps = osmGaps(INDEX, [TILE]);
  const geo = gapsGeoJson("geschosse-fehlen", gaps);
  expect(geo.features).toHaveLength(1);
  const f = geo.features[0];
  expect(f.geometry.coordinates).toEqual([gaps[1].lon, gaps[1].lat]);
  expect(f.properties.aufgabe).toContain("building:levels");
  expect(f.properties.editor).toBe(osmLinks(gaps[1]).editor);
});
