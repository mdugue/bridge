import { expect, test } from "bun:test";
import {
  buildingGlows,
  ownFacade,
  palatialFacade,
  partFacade,
  buildingTint,
  inheritedAttributes,
  ownFacadeReason,
  roofColor,
  roofColourSource,
  roofTint,
  roughJitter,
  mappedStoreyHeight,
  brickWalls,
  isStructure,
  neighbourStorey,
  storeyHeight,
  wallColourSource,
} from "./building-tint";

const inRange = (rgb: number[]) =>
  rgb.every((c) => c >= 0 && c <= 1) && rgb.length === 3;

test("different ids generally get different tints (hash spread)", () => {
  const seen = new Set(
    Array.from({ length: 200 }, (_, i) =>
      buildingTint(`B${i}`, {})
        .map((c) => c.toFixed(4))
        .join(",")
    )
  );
  // With jitter + 4 swatches the 200 ids should yield many distinct colours.
  expect(seen.size).toBeGreaterThan(150);
});

test("output is always linear RGB in [0,1]", () => {
  for (const id of ["", "a", "kurz", "DESNATPU1000HJx5", "🏠"]) {
    expect(inRange(buildingTint(id, { measuredHeight: 120 }))).toBe(true);
    expect(inRange(buildingTint(id, { measuredHeight: -5 }))).toBe(true);
  }
});

test("missing/garbage attributes fall back to the housing family, never throw", () => {
  expect(inRange(buildingTint("x"))).toBe(true);
  // wrong types must be ignored, not crash
  expect(
    inRange(buildingTint("x", { function: 42, measuredHeight: "tall" }))
  ).toBe(true);
});

test("civic stone reads warm greige, special structures cool grey", () => {
  // Same id so only the family differs: a church's sandstone is warm (red
  // over blue) and paler in chroma than a house's render; a structure that
  // is no building keeps its cool grey.
  const housing = buildingTint("same-id", { function: "31001_9998" });
  const civic = buildingTint("same-id", { function: "31001_3021" });
  const special = buildingTint("same-id", { function: "53001_1800" });
  const blueBias = (c: number[]) => c[2] - c[0];
  expect(blueBias(civic)).toBeLessThan(0);
  expect(blueBias(special)).toBeGreaterThan(blueBias(housing));
  expect(blueBias(special)).toBeGreaterThan(blueBias(civic));
});

test("brick keeps its clinker and the cool grey stays cool at any height", () => {
  const chroma = (c: number[]) => Math.max(...c) - Math.min(...c);
  for (const id of ["a", "b", "c", "d", "e"]) {
    const brickLow = buildingTint(id, { measuredHeight: 6 }, "brick");
    const brickTall = buildingTint(id, { measuredHeight: 40 }, "brick");
    expect(chroma(brickTall)).toBeCloseTo(chroma(brickLow), 9);
    const tank = buildingTint(id, {
      function: "53001_1800",
      measuredHeight: 4,
    });
    expect(tank[2]).toBeGreaterThanOrEqual(tank[0]);
  }
});

test("mapped stone is warm, never slate", () => {
  for (const id of ["a", "b", "c", "d", "e"]) {
    const c = buildingTint(id, { measuredHeight: 40 }, "render", {
      material: "stone",
    });
    expect(c[0]).toBeGreaterThan(c[2]);
  }
});

test("taller buildings grow paler in chroma, never bluer", () => {
  const chroma = (c: number[]) => Math.max(...c) - Math.min(...c);
  for (const fn of ["31001_9998", "31001_3021"]) {
    const short = buildingTint("h", { function: fn, measuredHeight: 6 });
    const mid = buildingTint("h", { function: fn, measuredHeight: 18 });
    const tall = buildingTint("h", { function: fn, measuredHeight: 30 });
    expect(chroma(tall)).toBeLessThan(chroma(mid));
    expect(short[0] - short[2]).toBeGreaterThan(mid[0] - mid[2]);
    // the hue holds: blue's share of the chroma is the mid-height one's
    // (a blue push would raise it)
    const blueShare = (c: number[]) => (c[2] - c[0]) / chroma(c);
    expect(blueShare(tall)).toBeLessThanOrEqual(blueShare(mid) + 0.05);
  }
});

test("roofTint: pitched/tiled roofs are warmer (R>B) than flat/slate roofs", () => {
  const tiled = roofTint("r", { roofType: "3100" }); // Satteldach
  const flat = roofTint("r", { roofType: "1000" }); // Flachdach
  expect(tiled[0]).toBeGreaterThan(tiled[2]); // terracotta: red-biased
  expect(flat[0] - flat[2]).toBeLessThan(tiled[0] - tiled[2]); // slate: ~neutral
  expect(roofTint("r").every((c) => c >= 0 && c <= 1)).toBe(true);
});

test("roofTint: low pitch reads flat, steep pitch reads tiled (unknown roofType)", () => {
  const lowPitch = roofTint("r", { roofType: "9999", Dachneigung: 2 });
  const steep = roofTint("r", { roofType: "9999", Dachneigung: 40 });
  expect(steep[0] - steep[2]).toBeGreaterThan(lowPitch[0] - lowPitch[2]);
});

test("roofColor: uses the DOP LUT when present, else falls back to roofTint", () => {
  const lut = {
    DESNATPU1000HJx5: [0.42, 0.18, 0.12] as [number, number, number],
  };
  // LUT hit → exact sampled colour, regardless of roofType.
  expect(roofColor("DESNATPU1000HJx5", { roofType: "1000" }, lut)).toEqual([
    0.42, 0.18, 0.12,
  ]);
  // LUT miss → synthesized roofTint for that id+attrs.
  expect(roofColor("not-in-lut", { roofType: "3100" }, lut)).toEqual(
    roofTint("not-in-lut", { roofType: "3100" })
  );
  // No LUT at all → roofTint.
  expect(roofColor("x", { roofType: "1000" })).toEqual(
    roofTint("x", { roofType: "1000" })
  );
});

test("buildingGlows: commerce and public buildings glow, housing and structures do not", () => {
  expect(buildingGlows({ function: "31001_2000" })).toBe(true); // commerce
  expect(buildingGlows({ function: "31001_3021" })).toBe(true); // public
  expect(buildingGlows({ function: "31001_9998" })).toBe(false); // housing
  // no building: a tank, a canopy, a tower has no entrance to light
  expect(buildingGlows({ function: "51003_1000" })).toBe(false); // tank
  expect(buildingGlows({ function: "51009_1610" })).toBe(false); // canopy
  expect(buildingGlows({ function: "53001_1800" })).toBe(false);
  expect(buildingGlows({})).toBe(false);
});

test("inheritedAttributes: a part inherits its Building's function", () => {
  const building = {
    function: "31001_2000",
    name: "Kaufhaus",
    roofType: "3100",
  };
  const part = { measuredHeight: 12, roofType: "1000" };
  const resolved = inheritedAttributes(part, building);
  expect(resolved.function).toBe("31001_2000");
  expect(buildingGlows(resolved)).toBe(true);
  expect(buildingGlows(part)).toBe(false);
  // The part's own values win over the root's.
  expect(resolved.roofType).toBe("1000");
  expect(resolved.measuredHeight).toBe(12);
  // A part's own function wins too; a null own value falls back.
  expect(
    inheritedAttributes({ function: "31001_1000" }, building).function
  ).toBe("31001_1000");
  expect(inheritedAttributes({ function: null }, building).function).toBe(
    "31001_2000"
  );
  // A root resolves to itself; no root leaves the bag untouched.
  expect(inheritedAttributes(building, building)).toBe(building);
  expect(inheritedAttributes(part)).toBe(part);
});

test("storeyHeight: snaps near ~3.2 m, clamps, falls back to 3", () => {
  expect(storeyHeight(undefined)).toBe(3);
  expect(storeyHeight(1)).toBe(3); // implausibly short → fallback
  const h = storeyHeight(12);
  expect(h).toBeGreaterThanOrEqual(2.5);
  expect(h).toBeLessThanOrEqual(4.5);
  expect(Math.round(12 / h)).toBe(4); // 12 m → 4 storeys of 3 m
});

test("mappedStoreyHeight: OSM's storeys up to the eave, else the estimate", () => {
  // a Gründerzeit block: 17 m to the eave over 4 storeys
  expect(mappedStoreyHeight(17, 22, 4)).toBe(4.25);
  // a Plattenbau: 16.8 m over 6
  expect(mappedStoreyHeight(16.8, 18, 6)).toBeCloseTo(2.8);
  // no count, or one implausible for these walls → the height's estimate
  expect(mappedStoreyHeight(17, 22, undefined)).toBe(storeyHeight(22));
  expect(mappedStoreyHeight(40, 45, 4)).toBe(storeyHeight(45)); // a tower
  expect(mappedStoreyHeight(6, 9, 5)).toBe(storeyHeight(9)); // a typo
  expect(mappedStoreyHeight(6, 9, 0)).toBe(storeyHeight(9));
});

test("neighbourStorey: the eave in whole storeys of about the neighbours' (G21)", () => {
  // a Gründerzeit block, 18.5 m to the eave, among 3.7 m storeys: 5 of
  // them, where 3.2 m storeys made 6
  expect(Math.round(18.5 / neighbourStorey(18.5, 3.7))).toBe(5);
  expect(Math.round(18.5 / storeyHeight(18.5))).toBe(6);
  // held to 2.5–4.5 m
  expect(neighbourStorey(3, 2.4)).toBe(3);
  expect(neighbourStorey(4.8, 4.6)).toBe(4.5);
  expect(neighbourStorey(4.8, 3)).toBe(2.5);
  expect(neighbourStorey(2.6, 3)).toBe(2.6);
});

test("mappedStoreyHeight: OSM's count first, then the neighbours', then the height's", () => {
  expect(mappedStoreyHeight(17, 22, 4, 3.7)).toBe(4.25);
  expect(mappedStoreyHeight(18.5, 22, undefined, 3.7)).toBeCloseTo(3.7, 9);
  // no neighbours, or walls too low to count: the old estimate
  expect(mappedStoreyHeight(18.5, 22, undefined, 0)).toBe(storeyHeight(22));
  expect(mappedStoreyHeight(2, 2.4, undefined, 3.7)).toBe(storeyHeight(2.4));
});

test("structures and brick walls (G17, G12)", () => {
  expect(isStructure("51003_1000")).toBe(true);
  expect(isStructure("31001_1000")).toBe(false);
  expect(isStructure(undefined)).toBe(false);
  expect(brickWalls({ function: "31001_1000" }, "brick")).toBe(true);
  expect(brickWalls({ function: "31001_1000" }, "render")).toBe(false);
  // a tank in a brick quarter keeps its stone
  expect(brickWalls({ function: "51003_1000" }, "brick")).toBe(false);
});

test("roughJitter: deterministic, in [-1,1]", () => {
  expect(roughJitter("x")).toBe(roughJitter("x"));
  for (const id of ["a", "b", "kurz", "DESNATPU1000HJx5"]) {
    const v = roughJitter(id);
    expect(v).toBeGreaterThanOrEqual(-1);
    expect(v).toBeLessThanOrEqual(1);
  }
});

test("a brick city paints its buildings in brick, structures keep their stone", () => {
  const redness = ([r, , b]: [number, number, number]) => r - b;
  let brick = 0;
  for (let i = 0; i < 200; i++) {
    const t = buildingTint(`B${i}`, { function: "31001_9998" }, "brick");
    if (redness(t) > 0.15) {
      brick++;
    }
  }
  // four of the five brick swatches are brick red, one pale render
  expect(brick).toBeGreaterThan(120);
  // a school in a brick quarter is brick (Hamburg's), a tank is not
  const civic = { function: "31001_3021" };
  expect(buildingTint("c", civic, "brick")).toEqual(
    buildingTint("c", { function: "31001_9998" }, "brick")
  );
  const tank = { function: "51003_1000" };
  expect(buildingTint("t", tank, "brick")).toEqual(buildingTint("t", tank));
  expect(buildingTint("h", {}, "render")).toEqual(buildingTint("h", {}));
});

test("ownFacade: monumental uses and hall storeys, not town houses", () => {
  expect(ownFacade({ function: "31001_3041" })).toBe(true); // Kirche
  expect(ownFacade({ function: "31001_3032" })).toBe(true); // Theater, Oper
  expect(ownFacade({ function: "31001_1000" }, 18, 6)).toBe(false);
  expect(ownFacade({ function: "31001_2000" }, 18, 2)).toBe(true); // a hall
  expect(ownFacade({ function: "31001_2000" }, 18)).toBe(false); // no levels
});

test("ownFacade: a listed public building whose storeys OSM does not count", () => {
  const court = { function: "31001_3015" }; // Gericht: the Ständehaus
  expect(ownFacade(court, 30, 0, true)).toBe(true);
  expect(ownFacade(court, 30)).toBe(false); // not listed
  // counted storeys a storey house's keep its windows
  expect(ownFacade(court, 16, 4, true)).toBe(false);
  // a listed house is a house
  expect(ownFacade({ function: "31001_1000" }, 18, 0, true)).toBe(false);
});

test("partFacade: a part shares its building's own facade unless OSM's storeys fit it", () => {
  // the Kulturpalast's raised roof: 3.6 m of wall, the hall's 3 storeys
  expect(partFacade(false, true, 3.6, 3)).toBe(true);
  expect(partFacade(false, true, 3.6)).toBe(true);
  // an annex whose own count fits
  expect(partFacade(false, true, 12, 4)).toBe(false);
  expect(partFacade(false, false, 3.6, 3)).toBe(false);
  expect(partFacade(true, false, 12, 4)).toBe(true);
});

test("palatialFacade: public buildings, not churches, stations or sports halls", () => {
  expect(palatialFacade({ function: "31001_3031" })).toBe(true); // Schloss
  expect(palatialFacade({ function: "31001_3034" })).toBe(true); // Museum
  expect(palatialFacade({ function: "31001_3011" })).toBe(true); // Parlament
  expect(palatialFacade({ function: "31001_3041" })).toBe(false); // Kirche
  expect(palatialFacade({ function: "31001_3032" })).toBe(true); // Theater
  expect(palatialFacade({ function: "31001_3211" })).toBe(false); // Sporthalle
  expect(palatialFacade({ function: "31001_3091" })).toBe(false); // Bahnhof
  expect(palatialFacade({ function: "31001_2090" })).toBe(false);
  expect(palatialFacade({})).toBe(false);
});

test("the card is told where a wall's and a roof's colour come from", () => {
  const housing = { function: "31001_9998" };
  expect(wallColourSource(housing, "render", { colour: "#c8b89a" })).toBe(
    "osm"
  );
  // a colour that is no colour falls through to the palette, as the tint
  expect(wallColourSource(housing, "render", { colour: "red" })).toBe("use");
  expect(wallColourSource(housing, "brick", { material: "glass" })).toBe(
    "material"
  );
  expect(wallColourSource(housing, "brick")).toBe("brick");
  // civic follows its brick quarter; a structure keeps its stone
  expect(wallColourSource({ function: "31001_3021" }, "brick")).toBe("brick");
  expect(wallColourSource({ function: "51003_1000" }, "brick")).toBe("use");
  expect(roofColourSource("a", { a: [0.1, 0.1, 0.1] })).toBe("dop");
  expect(roofColourSource("a", {}, { roof_colour: "#806040" })).toBe("osm");
  expect(roofColourSource("a")).toBe("palette");
});

test("ownFacadeReason names the use, the hall or the listed public building", () => {
  expect(ownFacadeReason({ function: "31001_3041" })).toBe("use");
  expect(ownFacadeReason({ function: "31001_2000" }, 18, 2)).toBe("hall");
  expect(ownFacadeReason({ function: "31001_3015" }, 30, 0, true)).toBe(
    "listed"
  );
  expect(ownFacadeReason({ function: "31001_1000" }, 18, 6)).toBeNull();
});
