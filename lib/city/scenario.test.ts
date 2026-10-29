import { describe, expect, test } from "bun:test";
import { latLngToUtm } from "./crs";
import {
  berlinInstant,
  clampVolume,
  convexHull,
  depthBands,
  floodReading,
  floodSurface,
  insidePolygon,
  levelAtReference,
  riverOf,
  shadedHours,
  shadowOf,
  shadowStudy,
  volumeCorners,
} from "./scenario";

const elbe = riverOf("dresden")!;
const EPSG = 25_833;

describe("Hochwasser", () => {
  test("only Dresden has a river with gauges", () => {
    expect(elbe.name).toBe("Elbe");
    expect(riverOf("hamburg")).toBeNull();
  });

  test("an event is its crest, a reading is held to range", () => {
    expect(floodReading(elbe, { ereignis: "2002" })?.cm).toBe(940);
    expect(floodReading(elbe, { ereignis: "1999" })).toBeNull();
    expect(floodReading(elbe, { pegel_cm: 99_999 })?.cm).toBe(1500);
    expect(floodReading(elbe, {})).toBeNull();
  });

  test("the surface is the gauge zero plus the reading at each gauge", () => {
    const surface = floodSurface(elbe, EPSG, 940);
    for (const g of elbe.gauges) {
      const p = latLngToUtm(EPSG, g.lat, g.lng)!;
      expect(surface(p.x, p.y)).toBeCloseTo(g.zero + 9.4, 2);
    }
    expect(levelAtReference(elbe, 940)).toBeCloseTo(112.1, 5);
  });

  test("it falls downstream between the gauges, and runs on past the ends", () => {
    const surface = floodSurface(elbe, EPSG, 0);
    const [pirna, dresden, meissen] = elbe.gauges.map((g) =>
      latLngToUtm(EPSG, g.lat, g.lng)!
    );
    const mid = surface(
      (dresden.x + meissen.x) / 2,
      (dresden.y + meissen.y) / 2
    );
    expect(mid).toBeCloseTo((102.7 + 94.823) / 2, 1);
    // upstream of Pirna it is higher than at Pirna
    const above = surface(
      pirna.x + (pirna.x - dresden.x) * 0.2,
      pirna.y + (pirna.y - dresden.y) * 0.2
    );
    expect(above).toBeGreaterThan(108.026);
  });

  test("depths fall into their bands", () => {
    expect(depthBands([0.1, 0.5, 0.6, 2, 2.1, 5])).toEqual({
      bis_0_5_m: 2,
      von_0_5_bis_2_m: 2,
      ueber_2_m: 2,
    });
  });
});

describe("Baukörper", () => {
  const box = { x: 0, y: 0, breite: 20, tiefe: 10, hoehe: 30, drehung: 0 };

  test("a turn of 90° swaps its sides", () => {
    const xs = volumeCorners({ ...box, drehung: 90 }).map((c) => c.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 6);
  });

  test("a volume is held to a house or a tower", () => {
    const v = clampVolume({ ...box, breite: 1, hoehe: 900, drehung: -90 });
    expect(v.breite).toBe(2);
    expect(v.hoehe).toBe(300);
    expect(v.drehung).toBe(270);
  });

  test("the hull of a square and a point holds both", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0.5, y: 0.5 },
      { x: 3, y: 0.5 },
    ]);
    expect(hull).toHaveLength(5);
    expect(insidePolygon(hull, { x: 2, y: 0.5 })).toBe(true);
    expect(insidePolygon(hull, { x: 2, y: 2 })).toBe(false);
  });

  test("a sun in the south at 45° casts the height to the north", () => {
    const s = shadowOf(box, 45, 180, 0)!;
    expect(s.length).toBeCloseTo(30, 6);
    expect(s.towards).toBeCloseTo(0, 6);
    expect(insidePolygon(s.hull, { x: 0, y: 30 })).toBe(true);
    expect(insidePolygon(s.hull, { x: 0, y: -10 })).toBe(false);
    expect(shadowOf(box, 1, 180, 0)).toBeNull();
  });

  test("a local hour is Berlin's, in summer and in winter", () => {
    expect(berlinInstant("2026-06-21", 12).toISOString()).toBe(
      "2026-06-21T10:00:00.000Z"
    );
    expect(berlinInstant("2026-12-21", 9.5).toISOString()).toBe(
      "2026-12-21T08:30:00.000Z"
    );
  });

  test("a tower by the Frauenkirche shades its northern neighbour at noon in winter", () => {
    const v = {
      x: 411_600,
      y: 5_656_500,
      breite: 20,
      tiefe: 20,
      hoehe: 60,
      drehung: 0,
    };
    const north = { name: "Nord", x: 411_600, y: 5_656_560 };
    const south = { name: "Süd", x: 411_600, y: 5_656_440 };
    const hours = shadowStudy(v, "2026-12-21", EPSG, [north, south]);
    // a short day: no hour before 8 or after 16
    expect(hours.length).toBeGreaterThan(4);
    expect(hours.length).toBeLessThan(10);
    const noon = hours.find((h) => h.zeit === "12:00")!;
    expect(noon.verschattet).toEqual(["Nord"]);
    expect(noon.sonnenhoehe).toBeLessThan(17);
    expect(shadedHours(hours)[0].name).toBe("Nord");
  });
});
