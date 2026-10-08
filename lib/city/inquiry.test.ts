import { expect, test } from "bun:test";
import {
  OBJECT_FLAG_SHOP,
  OBJECT_SOURCE_LOD2,
  OBJECT_SOURCE_SCAN,
} from "./city-mesh";
import {
  functionLabel,
  germanDates,
  type Inquiry,
  type InquiryObject,
  inquiryCard,
  metres,
  roofLabel,
  squareMetres,
} from "./inquiry";
import {
  MEASURED_ROOF,
  MEASURED_SHAPE,
  NO_FACT,
  type ObjectFacts,
} from "./object-facts";
import type { SiteProvenance } from "./provenance";
import type { CardCredits } from "./card-lines";
import type { Stated } from "./methods";

const lines = (sources: readonly Stated[]) => sources.map((l) => l.text);

/** Dresden's credits (sites/providers.ts, sites/dresden.ts) as the HUD
 *  hands them over. */
const DRESDEN: CardCredits = {
  dlm: true,
  provider: "Quelle: GeoSN, dl-de/by-2-0",
  register: "Landeshauptstadt Dresden, dl-de/by-2-0",
};

const facts = (over: Partial<ObjectFacts> = {}): ObjectFacts => ({
  buildingId: "DESNATPU1000HJx5",
  function: "31001_9998",
  roofType: "",
  created: "",
  name: "",
  addr: "",
  height: NO_FACT,
  roofPitch: NO_FACT,
  area: NO_FACT,
  levels: NO_FACT,
  ...over,
});

const object = (over: Partial<InquiryObject> = {}): InquiryObject => ({
  building: false,
  eaveH: 0,
  facts: facts(),
  flags: 0,
  objectIndex: 0,
  source: OBJECT_SOURCE_LOD2,
  ...over,
});

const provenance: SiteProvenance = {
  version: 1,
  sources: {
    lod2: {
      label: "3D-Stadtmodell LoD2",
      credit: "Quelle: GeoSN, dl-de/by-2-0",
      licence: "dl-de/by-2-0",
    },
    dlm: {
      label: "Basis-DLM",
      credit: "Quelle: GeoSN, dl-de/by-2-0",
      licence: "dl-de/by-2-0",
    },
    wikidata: { label: "Wikidata", credit: "CC0", licence: "CC0" },
    lsc: {
      label: "Laserscan",
      credit: "Quelle: GeoSN, dl-de/by-2-0",
      licence: "dl-de/by-2-0",
    },
    dgm: {
      label: "DGM1",
      credit: "Quelle: GeoSN, dl-de/by-2-0",
      licence: "dl-de/by-2-0",
    },
    dom: {
      label: "DOM1",
      credit: "Quelle: GeoSN, dl-de/by-2-0",
      licence: "dl-de/by-2-0",
    },
    dop: {
      label: "DOP",
      credit: "Quelle: GeoSN, dl-de/by-2-0",
      licence: "dl-de/by-2-0",
    },
    osm: {
      label: "OpenStreetMap",
      credit: "© OpenStreetMap-Mitwirkende",
      licence: "ODbL",
      stand: "2026-09-26",
    },
    trees: {
      label: "Stadtbaumkataster",
      credit: "Landeshauptstadt Dresden",
      licence: "dl-de/by-2-0",
    },
  },
  tiles: {
    t: {
      lod2: "2024 (LSC: 2016, Basis-DLM: 2022, DGM: 2016)",
      lsc: "2024-11-30",
    },
  },
};

test("numbers, dates and codes read as German", () => {
  expect(metres(18.077)).toBe("18,1 m");
  expect(squareMetres(1234.4)).toBe("1.234 m²");
  expect(germanDates("2024-11-27, 2024-11-30")).toBe("27.11.2024, 30.11.2024");
  expect(functionLabel("31001_3041")).toBe("Kirche");
  expect(functionLabel("31001_9998")).toBe("");
  expect(functionLabel("99999_1")).toBe("Funktion 99999_1");
  expect(roofLabel("3100", 38.4)).toBe("Satteldach, 38°");
  expect(roofLabel("1000", 0)).toBe("Flachdach, 0°");
  expect(roofLabel("", NO_FACT)).toBe("");
});

test("the Building's own tree facts win over its parts' (the bake's union)", () => {
  const card = inquiryCard(
    {
      kind: "building",
      tile: "t",
      picked: object({ facts: facts({ height: 10, area: 300 }) }),
      tree: [
        object({
          building: true,
          objectIndex: 2,
          facts: facts({ height: 24.5, area: 520 }),
        }),
        object({ facts: facts({ height: 10, area: 300 }) }),
        object({ objectIndex: 1, facts: facts({ height: 24, area: 300 }) }),
      ],
    },
    null,
    DRESDEN
  );
  const fact = (label: string) =>
    card.facts.find((f) => f.label === label)?.value;
  // overlapping parts counted once, the tower's top over the podium's base
  expect(fact("Grundfläche")).toBe("520 m²");
  expect(fact("Höhe")).toBe("24,5 m");
});

test("a shop matched to the footprint is marked detected, on its line and its fact", () => {
  const card = inquiryCard(
    {
      kind: "building",
      tile: "t",
      picked: object({
        flags: OBJECT_FLAG_SHOP,
        facts: facts({ addr: "A 1" }),
      }),
      tree: [],
    },
    provenance,
    DRESDEN
  );
  expect(card.facts).toContainEqual({
    label: "Erdgeschoss",
    value: "Laden oder Gastronomie",
    method: "detected",
  });
  expect(card.sources.map((l) => l.method)).toEqual([
    "taken",
    "taken",
    "detected",
  ]);
  expect(card.sources[2]?.text).toStartWith("Erdgeschoss: OpenStreetMap");
});

test("a roof rebuilt from the surface model is said to be measured there", () => {
  const card = inquiryCard(
    {
      kind: "building",
      tile: "t",
      picked: object({
        facts: facts({ roofType: MEASURED_ROOF, height: 19.2 }),
      }),
      tree: [],
    },
    provenance,
    DRESDEN
  );
  expect(card.facts).toContainEqual({
    label: "Dach",
    value: "flach, gestuft (gemessen)",
    method: "detected",
  });
  // the LoD2 line no longer claims the roof; the surface model's does
  expect(card.sources[0]?.text).not.toContain("Dach gemessen");
  expect(card.sources[1]?.text).toStartWith("Dach und Höhe: DOM1");
});

test("a rebuilt roof with measured faces is said to be shaped as measured", () => {
  const card = inquiryCard(
    {
      kind: "building",
      tile: "t",
      picked: object({ facts: facts({ roofType: MEASURED_SHAPE }) }),
      tree: [],
    },
    provenance,
    DRESDEN
  );
  expect(card.facts).toContainEqual({
    label: "Dach",
    value: "geformt wie gemessen",
    method: "detected",
  });
  expect(card.sources[1]?.text).toStartWith("Dach und Höhe: DOM1");
});

test("a named church: name as title, use above, every source quoted", () => {
  const part = object({
    eaveH: 21.5,
    flags: 2,
    facts: facts({
      function: "31001_3041",
      roofType: "3100",
      roofPitch: 45,
      height: 54.2,
      area: 900,
      created: "2025-07-04",
      name: "Kreuzkirche",
      addr: "An der Kreuzkirche 6",
    }),
  });
  const tower = object({
    objectIndex: 1,
    facts: facts({ height: 92.1, area: 150 }),
  });
  const inquiry: Inquiry = {
    kind: "building",
    tile: "t",
    picked: part,
    tree: [object({ building: true, objectIndex: 2 }), part, tower],
  };
  const card = inquiryCard(inquiry, provenance, DRESDEN);
  expect(card.title).toBe("Kreuzkirche");
  expect(card.kicker).toBe("Kirche");
  expect(card.address).toBe("An der Kreuzkirche 6");
  expect(card.id).toBe("DESNATPU1000HJx5");
  expect(card.facts).toEqual([
    // the tree's highest part: the tower
    { label: "Höhe", value: "92,1 m" },
    { label: "Traufe", value: "21,5 m" },
    { label: "Dach", value: "Satteldach, 45°" },
    { label: "Grundfläche", value: "1.050 m²" },
    { label: "Gebäudeteile", value: "2" },
    { label: "Denkmal", value: "Kulturdenkmal" },
  ]);
  expect(lines(card.sources)).toEqual([
    "3D-Stadtmodell LoD2 · Modell 2024 · Dach gemessen 2016 · Grundriss 2022 · Objekt exportiert 04.07.2025 · Quelle: GeoSN, dl-de/by-2-0",
    "Name, Adresse, Denkmal: OpenStreetMap · Stand 26.09.2026 · © OpenStreetMap-Mitwirkende, ODbL",
  ]);
});

test("an unspecified house says so and quotes no OSM it did not use", () => {
  const card = inquiryCard(
    {
      kind: "building",
      tile: "t",
      picked: object({ facts: facts({ height: 12 }) }),
      tree: [],
    },
    null,
    DRESDEN
  );
  expect(card.title).toBe("Gebäude");
  expect(card.facts[0]).toEqual({ label: "Nutzung", value: "nicht angegeben" });
  expect(lines(card.sources)).toHaveLength(1);
  // without the manifest the line still names the source and its licence
  expect(card.sources[0]?.text).toBe(
    "3D-Stadtmodell LoD2 · Quelle: GeoSN, dl-de/by-2-0"
  );
});

test("without the manifest a card on another Land's site credits that Land, not GeoSN", () => {
  const credits: CardCredits = {
    dlm: false,
    provider: "Quelle: LGV Hamburg, dl-de/by-2-0",
  };
  const shed = object({ source: OBJECT_SOURCE_SCAN });
  const lod2 = inquiryCard(
    { kind: "building", tile: "t", picked: object(), tree: [] },
    null,
    credits
  );
  const scan = inquiryCard(
    { kind: "building", tile: "t", picked: shed, tree: [shed] },
    null,
    credits
  );
  expect(lod2.sources[0]?.text).toBe(
    "3D-Stadtmodell LoD2 · Quelle: LGV Hamburg, dl-de/by-2-0"
  );
  expect(scan.sources[0]?.text).toContain("Quelle: LGV Hamburg, dl-de/by-2-0");
  expect([...lines(lod2.sources), ...lines(scan.sources)].join()).not.toContain(
    "GeoSN"
  );
});

test("a shed from the laser scan is marked as not in the official model", () => {
  const shed = object({
    source: OBJECT_SOURCE_SCAN,
    facts: facts({
      buildingId: "scan:t:1:2",
      function: "",
      height: 2.5,
      area: 12,
    }),
  });
  const card = inquiryCard(
    { kind: "building", tile: "t", picked: shed, tree: [shed] },
    provenance,
    DRESDEN
  );
  expect(card.title).toBe("Kleinbau");
  expect(card.facts.map((f) => f.label)).toEqual(["Höhe", "Grundfläche"]);
  expect(card.sources[0]?.text).toBe(
    "Laserscan · Befliegung 30.11.2024 · nicht im amtlichen Stadtmodell · Quelle: GeoSN, dl-de/by-2-0"
  );
});
