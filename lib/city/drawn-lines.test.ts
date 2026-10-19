import { expect, test } from "bun:test";
import {
  OBJECT_FLAG_GLASS,
  OBJECT_FLAG_GROUNDED,
  OBJECT_FLAG_LANDMARK,
  OBJECT_SOURCE_DOOR,
  OBJECT_SOURCE_LOD2,
  OBJECT_SOURCE_PLINTH,
  OBJECT_SOURCE_SCAN,
} from "./city-mesh";
import { type DrawnFacts, encodeDrawn } from "./drawn-facts";
import { cssColour, type DrawnRow, drawnGroups } from "./drawn-lines";
import type { BuildingInquiry, InquiryObject, ObjectLook } from "./inquiry";
import { NO_FACT, type ObjectFacts } from "./object-facts";
import { packStyle } from "./windows";

const facts = (over: Partial<ObjectFacts> = {}): ObjectFacts => ({
  buildingId: "DESNATPU1000HJx5",
  drawn: "",
  function: "31001_1000",
  roofType: "3100",
  created: "",
  name: "",
  addr: "",
  height: 18,
  roofPitch: 40,
  area: 300,
  levels: NO_FACT,
  ...over,
});

const look = (over: Partial<ObjectLook> = {}): ObjectLook => ({
  glow: false,
  roof: [0.4, 0.2, 0.1],
  storeyH: 3.2,
  tint: [0.8, 0.7, 0.6],
  windows: { axis: 2.7, w: 1.15, h: 1.9, style: packStyle({ frame: true }) },
  ...over,
});

const object = (
  drawn: DrawnFacts,
  over: Partial<InquiryObject> = {},
  factsOver: Partial<ObjectFacts> = {}
): InquiryObject => ({
  building: true,
  eaveH: 16,
  facts: facts({ drawn: encodeDrawn(drawn), ...factsOver }),
  flags: OBJECT_FLAG_GROUNDED,
  look: look(),
  objectIndex: 0,
  source: OBJECT_SOURCE_LOD2,
  ...over,
});

const ask = (
  picked: InquiryObject,
  tree: InquiryObject[] = [picked]
): BuildingInquiry => ({
  kind: "building",
  tile: "33412_5656_2_sn",
  picked,
  tree,
  // the Frauenkirche's square (EPSG:25833)
  at: [411_835, 5_656_525],
});

/** Every row by its label. */
const rows = (b: BuildingInquiry): Record<string, DrawnRow> =>
  Object.fromEntries(
    drawnGroups(b, 25_833).flatMap((g) => g.rows.map((r) => [r.label, r]))
  );

test("what OSM maps is quoted as OSM's, with the place to look it up", () => {
  const r = rows(
    ask(
      object(
        {
          wall: "osm",
          colour: "#c8b89a",
          material: "glass",
          storey: "osm",
          windows: "type",
          roof: "dop",
        },
        { flags: OBJECT_FLAG_GROUNDED + OBJECT_FLAG_GLASS },
        { levels: 5 }
      )
    )
  );
  expect(r.Geschosse).toMatchObject({
    value: "5 × 3,2 m",
    method: "taken",
    source: "osm",
    detail: "building:levels = 5",
  });
  expect(r.Material).toMatchObject({ value: "Glas", source: "osm" });
  expect(r.Material.url).toStartWith(
    "https://www.openstreetmap.org/query?lat=51.05"
  );
  expect(r.Wandfarbe).toMatchObject({
    swatch: cssColour([0.8, 0.7, 0.6]),
    source: "osm",
    detail: "building:colour = #c8b89a, aufgehellt",
  });
  expect(r.Dachfarbe).toMatchObject({ method: "computed", source: "dop" });
});

test("where nothing is mapped or measured, the card says the viewer assumed it", () => {
  const r = rows(
    ask(object({ wall: "use", storey: "height", windows: "type" }))
  );
  expect(r.Geschosse).toMatchObject({
    value: "5 × 3,2 m",
    method: "assumed",
    source: "viewer",
  });
  expect(r.Material).toMatchObject({ value: "Putz", method: "assumed" });
  expect(r.Wandfarbe).toMatchObject({ method: "assumed", source: "viewer" });
  expect(r.Wandfarbe.detail).toContain("Wohngebäude");
  expect(r.Fenster).toMatchObject({
    value: "Achsen 2,7 m, Fenster 1,15 × 1,90 m, Faschen",
    method: "assumed",
    source: "viewer",
  });
  expect(r.Dachfarbe).toMatchObject({ method: "assumed", source: "viewer" });
});

test("a storey count OSM maps but too high to draw is named as the reason", () => {
  const r = rows(
    ask(object({ storey: "height" }, { eaveH: 19.2 }, { levels: 3 }))
  );
  expect(r.Geschosse).toMatchObject({ method: "assumed", source: "viewer" });
  expect(r.Geschosse.detail).toContain("building:levels = 3 ergäbe 6,4 m");
});

test("windows measured in street photos are Mapillary's, with the photos there", () => {
  const r = rows(ask(object({ windows: "measured", storey: "photos" })));
  expect(r.Fenster).toMatchObject({ method: "detected", source: "mapillary" });
  expect(r.Fenster.url).toStartWith("https://www.mapillary.com/app/?lat=51.05");
  expect(r.Geschosse).toMatchObject({ source: "mapillary" });
  // a neighbour's rhythm is lent, not seen on this house
  expect(rows(ask(object({ windows: "near" }))).Fenster.method).toBe("assumed");
});

test("a church draws no windows and no town house's plinth, because of its use", () => {
  const r = rows(
    ask(
      object(
        { own: "use", windows: "none", noWindows: "facade", wikidata: "Q2516" },
        {
          flags: OBJECT_FLAG_GROUNDED + OBJECT_FLAG_LANDMARK,
          look: look({ windows: { axis: 0, w: 0, h: 0, style: 0 } }),
        },
        { function: "31001_3041" }
      )
    )
  );
  expect(r.Fenster).toMatchObject({
    value: "keine",
    source: "lod2",
    detail: "eigene Fassade: Kirche",
  });
  expect(r["Sockel, Gesimse"]).toMatchObject({ value: "keine" });
  expect(r.Wahrzeichen).toMatchObject({
    value: "Q2516",
    url: "https://www.wikidata.org/wiki/Q2516",
  });
});

test("a listed public building without a storey count is said to be one", () => {
  const r = rows(
    ask(
      object(
        { own: "listed", windows: "none", noWindows: "facade" },
        {
          flags: OBJECT_FLAG_GROUNDED + OBJECT_FLAG_LANDMARK,
          look: look({ windows: { axis: 0, w: 0, h: 0, style: 0 } }),
        },
        { function: "31001_3015" }
      )
    )
  );
  expect(r.Fenster).toMatchObject({ value: "keine", method: "assumed" });
  expect(r.Fenster.detail).toContain("Baudenkmal");
});

test("a door asked describes the house it opens, and the house's parts", () => {
  const house = object({ windows: "type" }, { objectIndex: 1 });
  const door = object(
    { windows: "type" },
    {
      building: false,
      objectIndex: 2,
      source: OBJECT_SOURCE_DOOR,
      look: look({ windows: { axis: 0, w: 0, h: 0, style: 0 } }),
    }
  );
  const plinth = { ...door, objectIndex: 3, source: OBJECT_SOURCE_PLINTH };
  const r = rows(ask(door, [house, door, plinth]));
  expect(r.Fenster.value).toStartWith("Achsen 2,7 m");
  expect(r.Haustüren).toMatchObject({ source: "osm" });
  expect(r["Sockel, Gesimse"]).toMatchObject({ value: "modelliert" });
});

test("a tile baked before the look reached the card shows no drawn values", () => {
  expect(drawnGroups(ask(object({}, { look: undefined })), 25_833)).toEqual([]);
});

test("a landmark Wikidata named keeps its facade on Wikidata's word", () => {
  const r = rows(
    ask(
      object(
        { windows: "none", noWindows: "facade", wikidata: "Q1" },
        {
          flags: OBJECT_FLAG_GROUNDED + OBJECT_FLAG_LANDMARK,
          look: look({ windows: { axis: 0, w: 0, h: 0, style: 0 } }),
        }
      )
    )
  );
  expect(r.Fenster).toMatchObject({ source: "wikidata", method: "detected" });
  expect(r["Sockel, Gesimse"]).toMatchObject({ source: "wikidata" });
});

test("a scan's building has no LoD2 row, so no drawn values", () => {
  expect(
    drawnGroups(ask(object({}, { source: OBJECT_SOURCE_SCAN })), 25_833)
  ).toEqual([]);
});

test("colours are written as the screen's hex", () => {
  expect(cssColour([1, 1, 1])).toBe("#ffffff");
  expect(cssColour([0, 0, 0])).toBe("#000000");
  expect(cssColour([0.2159, 0.2159, 0.2159])).toBe("#808080");
});
