import { describe, expect, test } from "bun:test";
import { readLandXml } from "./landxml";
import { recordClass, recordFeatures } from "./plan-records";
import { readDbf, readShapefile } from "./shapefile";
import { readGpkgGeometry } from "./wkb";

/** A .shp of polygons (type 5) or PolygonZ (15), one record per shape. */
function shp(
  type: number,
  shapes: [number, number, number?][][][]
): ArrayBuffer {
  const z = type === 15;
  const records = shapes.map((rings) => {
    const n = rings.reduce((s, r) => s + r.length, 0);
    const bytes = 44 + rings.length * 4 + n * 16 + (z ? 16 + n * 8 : 0);
    const b = new DataView(new ArrayBuffer(bytes));
    b.setInt32(0, type, true);
    b.setInt32(36, rings.length, true);
    b.setInt32(40, n, true);
    let start = 0;
    rings.forEach((r, i) => {
      b.setInt32(44 + i * 4, start, true);
      start += r.length;
    });
    const pts = rings.flat();
    const at = 44 + rings.length * 4;
    pts.forEach(([x, y], i) => {
      b.setFloat64(at + i * 16, x, true);
      b.setFloat64(at + i * 16 + 8, y, true);
    });
    if (z) {
      pts.forEach(([, , h], i) => {
        b.setFloat64(at + n * 16 + 16 + i * 8, h ?? 0, true);
      });
    }
    return new Uint8Array(b.buffer);
  });
  const length = 100 + records.reduce((s, r) => s + 8 + r.length, 0);
  const out = new DataView(new ArrayBuffer(length));
  out.setInt32(0, 9994, false);
  out.setInt32(24, length / 2, false);
  out.setInt32(28, 1000, true);
  out.setInt32(32, type, true);
  let at = 100;
  records.forEach((r, i) => {
    out.setInt32(at, i + 1, false);
    out.setInt32(at + 4, r.length / 2, false);
    new Uint8Array(out.buffer).set(r, at + 8);
    at += 8 + r.length;
  });
  return out.buffer;
}

/** A .dbf with character fields. */
function dbf(fields: string[], rows: string[][], encoder = new TextEncoder()) {
  const width = 20;
  const header = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.length * width;
  const bytes = new Uint8Array(header + rows.length * recordLength + 1);
  const v = new DataView(bytes.buffer);
  bytes[0] = 3;
  v.setUint32(4, rows.length, true);
  v.setUint16(8, header, true);
  v.setUint16(10, recordLength, true);
  fields.forEach((f, i) => {
    bytes.set(encoder.encode(f), 32 + i * 32);
    bytes[32 + i * 32 + 11] = "C".charCodeAt(0);
    bytes[32 + i * 32 + 16] = width;
  });
  bytes[header - 1] = 0x0d;
  rows.forEach((row, r) => {
    const at = header + r * recordLength;
    bytes[at] = 0x20;
    row.forEach((value, i) => {
      const cell = new Uint8Array(width).fill(0x20);
      cell.set(encoder.encode(value).subarray(0, width));
      bytes.set(cell, at + 1 + i * width);
    });
  });
  return bytes.buffer;
}

const square = (x0: number, y0: number, a: number): [number, number][] => [
  [x0, y0],
  [x0, y0 + a],
  [x0 + a, y0 + a],
  [x0 + a, y0],
  [x0, y0],
];

describe("shapefile", () => {
  test("polygons with their holes and their attributes", () => {
    const records = readShapefile(
      shp(5, [
        [square(0, 0, 10), square(2, 2, 2).reverse()],
        [square(20, 0, 5)],
      ]),
      dbf(["NUTZUNG"], [["Rasen"], ["Pflaster"]]),
      null
    );
    expect(records).toHaveLength(2);
    expect(records[0].kind).toBe("polygon");
    expect(records[0].parts).toHaveLength(2);
    expect(records[1].attributes.NUTZUNG).toBe("Pflaster");
    const { features } = recordFeatures(records, "Flaechen");
    expect(features.map((f) => f.kind === "area" && f.cls)).toEqual([
      "lawn",
      "paving",
    ]);
    expect(features[0].kind === "area" && features[0].rings).toHaveLength(2);
  });

  test("PolygonZ keeps its heights", () => {
    const ring = square(0, 0, 10).map(
      ([x, y]) => [x, y, 112.5] as [number, number, number]
    );
    const [record] = readShapefile(shp(15, [[ring]]), null, null);
    expect(record.parts[0][0][2]).toBe(112.5);
  });

  test("a .dbf without a .cpg: by its language driver, else by its bytes", () => {
    const latin = {
      encode: (t: string) =>
        Uint8Array.from({ length: t.length }, (_, i) => t.charCodeAt(i)),
    } as unknown as TextEncoder;
    const ansi = dbf(["ART"], [["Bäume"]], latin);
    new DataView(ansi).setUint8(29, 0x57);
    expect(readDbf(ansi, null)[0].ART).toBe("Bäume");
    // no driver byte: not valid UTF-8, so Windows ANSI
    const unsaid = dbf(["ART"], [["Bäume"]], latin);
    expect(readDbf(unsaid, null)[0].ART).toBe("Bäume");
    expect(readDbf(dbf(["ART"], [["Bäume"]]), null)[0].ART).toBe("Bäume");
  });

  test("a .dbf in windows-1252 by its .cpg", () => {
    // "Gehölz" in windows-1252: ö = 0xf6
    const latin = {
      encode: (s: string) =>
        Uint8Array.from({ length: s.length }, (_, i) => s.charCodeAt(i)),
    } as unknown as TextEncoder;
    const rows = readDbf(
      dbf(["ART"], [["Gehölz"]], latin),
      new TextDecoder("windows-1252")
    );
    expect(rows[0].ART).toBe("Gehölz");
  });
});

describe("GeoPackage geometry", () => {
  /** A GP blob: header without envelope, then little-endian WKB. */
  function blob(wkb: number[]): Uint8Array {
    const header = [0x47, 0x50, 0, 0b0000_0001, 0xe9, 0x64, 0, 0]; // srs 25833
    return Uint8Array.from([...header, ...wkb]);
  }
  const f64 = (v: number) => [...new Uint8Array(new Float64Array([v]).buffer)];
  const u32 = (v: number) => [...new Uint8Array(new Uint32Array([v]).buffer)];

  test("a point Z and a multipolygon", () => {
    const point = readGpkgGeometry(
      blob([1, ...u32(1001), ...f64(412_300), ...f64(5_657_420), ...f64(112)])
    );
    expect(point.srs).toBe(25_833);
    expect(point.shapes[0].parts[0][0]).toEqual([412_300, 5_657_420, 112]);
    const ring = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    const polygon = [
      1,
      ...u32(3),
      ...u32(1),
      ...u32(ring.length),
      ...ring.flatMap(([x, y]) => [...f64(x), ...f64(y)]),
    ];
    const multi = readGpkgGeometry(
      blob([1, ...u32(6), ...u32(2), ...polygon, ...polygon])
    );
    expect(multi.shapes).toHaveLength(2);
    expect(multi.shapes[1].kind).toBe("polygon");
  });
});

describe("LandXML", () => {
  test("a surface's TIN, north first, and its EPSG code", () => {
    const xml = `<?xml version="1.0"?>
<LandXML><CoordinateSystem epsgCode="25833"/><Surfaces>
<Surface name="Planung"><Definition surfType="TIN"><Pnts>
<P id="1">5657420 412300 112.0</P><P id="2">5657420 412310 112.5</P>
<P id="3">5657430 412300 113.0</P><P id="4">5657430 412310 113.0</P>
</Pnts><Faces><F>1 2 3</F><F i="1">2 4 3</F></Faces></Definition></Surface>
</Surfaces></LandXML>`;
    const plan = readLandXml(xml);
    expect(plan.epsg).toBe(25_833);
    expect(plan.surfaces).toEqual(["Planung"]);
    const mesh = plan.features[0];
    expect(mesh.kind === "mesh" && mesh.triangles).toHaveLength(1);
    expect(mesh.kind === "mesh" && mesh.triangles[0][1]).toEqual([
      412_310, 5_657_420, 112.5,
    ]);
  });
});

describe("a record's class", () => {
  const polygon = (attributes: Record<string, string | number | null>) => ({
    kind: "polygon" as const,
    parts: [],
    attributes,
  });

  test("a place's name does not make a park paving or road", () => {
    // Dresden's Park- und Grünanlagen: the place in `ort`, a form's link
    const park = polygon({
      ort: "Alaunplatz - Parkerweiterung Kamenzer Straße",
      anlage: "Park- und Grünanlagen",
      antrag: "http://www.dresden.de/media/pdf/formulare/Antrag.pdf",
    });
    expect(recordClass(park, "gruenanlagen")).toBe("lawn");
  });

  test("a class-like attribute speaks first, a name only last", () => {
    expect(
      recordClass(polygon({ name: "Rasenplatz", belag: "Pflaster" }), "x")
    ).toBe("paving");
    expect(recordClass(polygon({ name: "Kiesweg" }), "Flaechen")).toBe(
      "gravel"
    );
    expect(recordClass(polygon({ name: "Hofgarten" }), "Rasen")).toBe("lawn");
  });
});
