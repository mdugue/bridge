import { describe, expect, test } from "bun:test";
import { latLngToUtm, utmToLatLng } from "./crs";
import {
  compoundDegrees,
  epsgOfName,
  type IfcPlacement,
  mapConversionPlacement,
  siPrefixFactor,
  siteReferencePlacement,
} from "./ifc-georef";

/** A design-frame point (x, y up, z south) through a row-major matrix. */
function apply(m: number[], [x, y, z]: [number, number, number]) {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}

const placed = (p: IfcPlacement | { why: string } | null): IfcPlacement => {
  if (!p || "why" in p) {
    throw new Error("not placed");
  }
  return p;
};

describe("mapConversionPlacement", () => {
  const map = {
    crs: "EPSG:25833",
    eastings: 412_300,
    northings: 5_657_420,
    height: 112,
    abscissa: 1,
    ordinate: 0,
    scale: 1,
    unit: 1,
  };

  test("an unturned conversion sets the origin at its easting, northing and height", () => {
    const p = placed(mapConversionPlacement(map, 25_833));
    // 10 m along the model's x (east), 3 up, 5 along its north (−z)
    const [e, h, z] = apply(p.matrix, [10, 3, -5]);
    expect(e).toBeCloseTo(412_310, 6);
    expect(h).toBeCloseTo(115, 6);
    expect(-z).toBeCloseTo(5_657_425, 6);
    expect(p.note).toContain("EPSG:25833");
  });

  test("the x axis follows XAxisAbscissa/Ordinate, anticlockwise from grid east", () => {
    // x axis 30° north of east
    const p = placed(
      mapConversionPlacement(
        { ...map, abscissa: Math.cos(Math.PI / 6), ordinate: 0.5 },
        25_833
      )
    );
    const [e, , z] = apply(p.matrix, [10, 0, 0]);
    expect(e - 412_300).toBeCloseTo(10 * Math.cos(Math.PI / 6), 6);
    expect(-z - 5_657_420).toBeCloseTo(5, 6);
    // the model's north (−z) turns with it: 30° west of north
    const [e2, , z2] = apply(p.matrix, [0, 0, -10]);
    expect(e2 - 412_300).toBeCloseTo(-5, 6);
    expect(-z2 - 5_657_420).toBeCloseTo(10 * Math.cos(Math.PI / 6), 6);
  });

  test("a direction that is not a unit vector is normalised", () => {
    const p = placed(
      mapConversionPlacement({ ...map, abscissa: 3, ordinate: 0 }, 25_833)
    );
    expect(apply(p.matrix, [1, 0, 0])[0] - 412_300).toBeCloseTo(1, 9);
  });

  test("a projection scale is kept, a unit scale (mm → m) is not applied twice", () => {
    const k = placed(mapConversionPlacement({ ...map, scale: 0.9996 }, 25_833));
    expect(apply(k.matrix, [1000, 0, 0])[0] - 412_300).toBeCloseTo(999.6, 6);
    const mm = placed(mapConversionPlacement({ ...map, scale: 0.001 }, 25_833));
    expect(apply(mm.matrix, [1000, 0, 0])[0] - 412_300).toBeCloseTo(1000, 6);
  });

  test("a zone-prefixed easting loses its zone", () => {
    const p = placed(
      mapConversionPlacement({ ...map, eastings: 33_412_300 }, 25_833)
    );
    expect(apply(p.matrix, [0, 0, 0])[0]).toBeCloseTo(412_300, 6);
  });

  test("the other German UTM zone is carried over through lat/lng", () => {
    const ll = utmToLatLng(25_833, 412_300, 5_657_420);
    const in32 = latLngToUtm(25_832, ll!.lat, ll!.lng)!;
    const p = placed(
      mapConversionPlacement(
        { ...map, crs: "EPSG:25832", eastings: in32.x, northings: in32.y },
        25_833
      )
    );
    const [e, , z] = apply(p.matrix, [0, 0, 0]);
    expect(e).toBeCloseTo(412_300, 3);
    expect(-z).toBeCloseTo(5_657_420, 3);
    expect(p.note).toContain("umgerechnet");
    // grid north of zone 32 lies a few degrees off zone 33's here
    const [e1] = apply(p.matrix, [0, 0, -100]);
    expect(Math.abs(e1 - 412_300)).toBeGreaterThan(1);
  });

  test("a CRS that is not ETRS89/UTM is not read", () => {
    const p = mapConversionPlacement({ ...map, crs: "EPSG:31469" }, 25_833);
    expect("why" in p && p.why).toContain("EPSG:31469");
  });

  test("a CRS named in words that city walk cannot read is not guessed", () => {
    const p = mapConversionPlacement({ ...map, crs: "DE_DHDN_3GK4" }, 25_833);
    expect("why" in p && p.why).toContain("DE_DHDN_3GK4");
  });

  test("eastings, northings and height in the map's unit", () => {
    const p = placed(
      mapConversionPlacement(
        {
          ...map,
          eastings: 412_300_000,
          northings: 5_657_420_000,
          height: 112_000,
          unit: 0.001,
        },
        25_833
      )
    );
    const [e, h, z] = apply(p.matrix, [0, 0, 0]);
    expect(e).toBeCloseTo(412_300, 3);
    expect(h).toBeCloseTo(112, 6);
    expect(-z).toBeCloseTo(5_657_420, 3);
  });

  test("a conversion without a CRS name is taken as the site's", () => {
    const p = placed(mapConversionPlacement({ ...map, crs: null }, 25_833));
    expect(apply(p.matrix, [0, 0, 0])[0]).toBeCloseTo(412_300, 6);
  });
});

describe("siteReferencePlacement", () => {
  test("places the origin at the site's latitude and longitude, its elevation in the model's unit", () => {
    const p = placed(
      siteReferencePlacement(
        {
          latitude: [51, 3, 22, 0],
          longitude: [13, 45, 0, 0],
          elevation: 112_000,
          unit: 0.001,
          trueNorth: null,
          origin: null,
        },
        25_833
      )
    );
    const at = latLngToUtm(25_833, 51 + 3 / 60 + 22 / 3600, 13.75)!;
    const [e, h, z] = apply(p.matrix, [0, 0, 0]);
    expect(e).toBeCloseTo(at.x, 3);
    expect(-z).toBeCloseTo(at.y, 3);
    expect(h).toBeCloseTo(112, 6);
    expect(p.note).toContain("ungefähr");
  });

  test("TrueNorth turns the model: north along its +x puts its x axis on grid north", () => {
    const p = placed(
      siteReferencePlacement(
        {
          latitude: [51, 3, 0],
          longitude: [15, 0, 0],
          elevation: null,
          unit: 1,
          // on zone 33's central meridian: no convergence
          trueNorth: [1, 0],
          origin: null,
        },
        25_833
      )
    );
    const o = apply(p.matrix, [0, 0, 0]);
    const x = apply(p.matrix, [10, 0, 0]);
    expect(x[0] - o[0]).toBeCloseTo(0, 6);
    expect(-(x[2] - o[2])).toBeCloseTo(10, 6);
  });

  test("the reference point is the site's placement, not the model's origin", () => {
    const p = placed(
      siteReferencePlacement(
        {
          latitude: [51, 3, 22, 0],
          longitude: [13, 45, 0, 0],
          elevation: 0,
          unit: 1,
          trueNorth: null,
          origin: [40, 0, -25],
        },
        25_833
      )
    );
    const at = latLngToUtm(25_833, 51 + 3 / 60 + 22 / 3600, 13.75)!;
    const [e, , z] = apply(p.matrix, [40, 0, -25]);
    expect(e).toBeCloseTo(at.x, 3);
    expect(-z).toBeCloseTo(at.y, 3);
  });

  test("an unset 0/0 reference is none", () => {
    expect(
      siteReferencePlacement(
        {
          latitude: [0, 0, 0],
          longitude: [0, 0, 0],
          elevation: 0,
          unit: 1,
          trueNorth: null,
          origin: null,
        },
        25_833
      )
    ).toBeNull();
  });
});

describe("the parts", () => {
  test("compound angles, with their sign", () => {
    expect(compoundDegrees([51, 30, 0, 0])).toBeCloseTo(51.5, 9);
    expect(compoundDegrees([-13, -30, 0])).toBeCloseTo(-13.5, 9);
    expect(compoundDegrees([0, -30, 0])).toBeCloseTo(-0.5, 9);
    expect(compoundDegrees([1])).toBeNull();
  });

  test("EPSG codes from CRS names", () => {
    expect(epsgOfName("EPSG:25833")).toBe(25_833);
    expect(epsgOfName("urn:ogc:def:crs:EPSG::25832")).toBe(25_832);
    expect(epsgOfName("ETRS89 / UTM zone 32N")).toBe(25_832);
    expect(epsgOfName("ETRS_1989_UTM_Zone_33N")).toBe(25_833);
    expect(epsgOfName("http://www.opengis.net/def/crs/EPSG/0/25832")).toBe(
      25_832
    );
    expect(epsgOfName("DE_DHDN_3GK4")).toBeNull();
    expect(epsgOfName(null)).toBeNull();
  });

  test("SI prefixes", () => {
    expect(siPrefixFactor(".MILLI.")).toBe(0.001);
    expect(siPrefixFactor("CENTI")).toBe(0.01);
    expect(siPrefixFactor(null)).toBe(1);
  });
});
