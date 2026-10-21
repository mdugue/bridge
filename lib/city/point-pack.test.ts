import { expect, test } from "bun:test";
import type { CanopyExtraFeature, CanopyFeature } from "./features";
import {
  canopyStride,
  packPoints,
  pointFeatures,
  pointOf,
  ROWS_MEASURED,
  unpackPoints,
} from "./point-pack";

const ORIGIN: [number, number] = [412_000, 5_656_000];

const toBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

test("points come back where they were, to the tenth of a millimetre", () => {
  const points = [
    { x: 412_000.12, y: 5_657_999.87, h: 18.4 },
    { x: 413_999.99, y: 5_656_000.01, h: 6.2 },
    { x: 412_734.5, y: 5_656_901.25, h: 31 },
  ];
  const unpacked = unpackPoints(toBuffer(packPoints(points, ORIGIN, 3)));
  expect(unpacked?.count).toBe(3);
  expect(unpacked?.stride).toBe(3);
  const data = unpacked?.data ?? new Float32Array();
  const [ox, oy] = unpacked?.origin ?? [0, 0];
  points.forEach((p, i) => {
    expect(Math.abs(ox + (data[i * 3] ?? 0) - p.x)).toBeLessThan(1e-3);
    expect(Math.abs(oy + (data[i * 3 + 1] ?? 0) - p.y)).toBeLessThan(1e-3);
    expect(data[i * 3 + 2]).toBeCloseTo(p.h, 4);
  });
});

test("stride 4 keeps the crown radius; a missing one is NaN", () => {
  const unpacked = unpackPoints(
    toBuffer(
      packPoints(
        [
          { x: 412_010, y: 5_656_020, h: 12, r: 3.5 },
          { x: 412_011, y: 5_656_021, h: 9 },
        ],
        ORIGIN,
        4
      )
    )
  );
  expect(unpacked?.stride).toBe(4);
  expect(unpacked?.data[3]).toBeCloseTo(3.5, 5);
  expect(Number.isNaN(unpacked?.data[7])).toBe(true);
});

test("no points is a header and nothing else", () => {
  const bytes = packPoints([], ORIGIN, 3);
  expect(bytes.byteLength).toBe(32);
  expect(unpackPoints(toBuffer(bytes))?.count).toBe(0);
});

test("anything that is not a whole pack is refused", () => {
  const bytes = packPoints([{ x: 412_001, y: 5_656_001, h: 5 }], ORIGIN, 3);
  expect(unpackPoints(toBuffer(bytes.slice(0, bytes.length - 2)))).toBeNull();
  expect(unpackPoints(toBuffer(bytes.slice(0, 20)))).toBeNull();
  const wrong = bytes.slice();
  wrong[0] = "X".charCodeAt(0);
  expect(unpackPoints(toBuffer(wrong))).toBeNull();
  // a GeoJSON document (what the old artifact was) is not one either
  expect(
    unpackPoints(
      toBuffer(new TextEncoder().encode('{"type":"FeatureCollection"}'))
    )
  ).toBeNull();
});

test("a committed canopy comes back as the features it was, within a millimetre", async () => {
  const path = `${import.meta.dir}/../../data/dresden/dlm/canopyx_33412_5656_2_sn.geojson`;
  const doc = (await Bun.file(path).json()) as {
    features: CanopyExtraFeature[];
  };
  const unpacked = unpackPoints(
    toBuffer(packPoints(doc.features.map(pointOf), [412_000, 5_656_000], 4))
  );
  expect(unpacked).not.toBeNull();
  const back = unpacked ? pointFeatures(unpacked) : [];
  expect(back).toHaveLength(doc.features.length);
  let worst = 0;
  doc.features.forEach((f, i) => {
    const [x, y] = back[i]?.geometry.coordinates ?? [0, 0];
    worst = Math.max(
      worst,
      Math.abs(x - f.geometry.coordinates[0]),
      Math.abs(y - f.geometry.coordinates[1])
    );
    const p = back[i]?.properties;
    expect(p?.h).toBeCloseTo(f.properties?.h ?? 0, 4);
    expect(p && "r" in p ? p.r : Number.NaN).toBeCloseTo(
      f.properties?.r ?? 0,
      4
    );
  });
  expect(worst).toBeLessThan(1e-3);
});

test("an evergreen crown keeps what told it, through the pack", () => {
  const features: CanopyFeature[] = [
    {
      geometry: { type: "Point", coordinates: [412_100, 5_656_100] },
      properties: { h: 21, l: "e" },
    },
    {
      geometry: { type: "Point", coordinates: [412_110, 5_656_110] },
      properties: { h: 18, l: "e", ls: "dop" },
    },
    {
      geometry: { type: "Point", coordinates: [412_120, 5_656_120] },
      properties: { h: 15 },
    },
  ];
  const points = features.map(pointOf);
  expect(canopyStride(points, false)).toBe(5);
  const unpacked = unpackPoints(toBuffer(packPoints(points, ORIGIN, 5)));
  const back = unpacked ? pointFeatures(unpacked) : [];
  expect(back.map((f) => f.properties)).toEqual([
    { h: 21, l: "e" },
    { h: 18, l: "e", ls: "dop" },
    { h: 15 },
  ]);
});

test("a canopy without an evergreen packs as before", () => {
  const points = [{ x: 412_001, y: 5_656_001, h: 5 }];
  expect(canopyStride(points, false)).toBe(3);
  expect(canopyStride(points, true)).toBe(4);
});

test("the Heide's committed evergreens reach the browser", async () => {
  const path = `${import.meta.dir}/../../data/dresden/dlm/canopy_33416_5658_2_sn.geojson`;
  const doc = (await Bun.file(path).json()) as { features: CanopyFeature[] };
  const points = doc.features.map(pointOf);
  const unpacked = unpackPoints(
    toBuffer(
      packPoints(points, [416_000, 5_658_000], canopyStride(points, false))
    )
  );
  const back = unpacked ? pointFeatures(unpacked) : [];
  const evergreen = (fs: readonly CanopyFeature[]) =>
    fs.filter((f) => f.properties?.l === "e").length;
  expect(evergreen(doc.features)).toBeGreaterThan(1000);
  expect(evergreen(back)).toBe(evergreen(doc.features));
});

test("a crown over a carriageway keeps its flag, an evergreen's leaves beside it", () => {
  const features: CanopyFeature[] = [
    {
      geometry: { type: "Point", coordinates: [412_100, 5_656_100] },
      properties: { h: 9, c: 1 },
    },
    {
      geometry: { type: "Point", coordinates: [412_110, 5_656_110] },
      properties: { h: 18, l: "e", ls: "dop", c: 1 },
    },
    {
      geometry: { type: "Point", coordinates: [412_120, 5_656_120] },
      properties: { h: 15, row: 1 },
    },
  ];
  const points = features.map(pointOf);
  expect(canopyStride(points, false)).toBe(5);
  const unpacked = unpackPoints(toBuffer(packPoints(points, ORIGIN, 5)));
  const back = unpacked ? pointFeatures(unpacked) : [];
  // `row` is the bake's own: the browser has no use for it
  expect(back.map((f) => f.properties)).toEqual([
    { h: 9, c: 1 },
    { h: 18, l: "e", ls: "dop", c: 1 },
    { h: 15 },
  ]);
});

test("the header tells whether the canopy holds the tree rows' trees", () => {
  const points = [{ x: ORIGIN[0] + 1, y: ORIGIN[1] + 2, h: 12 }];
  const unpack = (bytes: Uint8Array) =>
    unpackPoints(bytes.buffer.slice(0) as ArrayBuffer);
  expect(unpack(packPoints(points, ORIGIN, 3))?.flags).toBe(0);
  expect(unpack(packPoints(points, ORIGIN, 3, ROWS_MEASURED))?.flags).toBe(
    ROWS_MEASURED
  );
});

test("an evergreen pine keeps its form through the pack; a broadleaf never is one", () => {
  const at = (x: number, properties: CanopyFeature["properties"]) => ({
    geometry: {
      type: "Point" as const,
      coordinates: [412_000 + x, 5_656_000] as [number, number],
    },
    properties,
  });
  const features: CanopyFeature[] = [
    at(1, { h: 22, l: "e", pine: 1 }),
    at(2, { h: 21, l: "e", ls: "dop", pine: 1, c: 1 }),
    at(3, { h: 19, l: "e" }),
    // a pine flag on no evergreen is not packed
    at(4, { h: 12, pine: 1 }),
  ];
  const points = features.map(pointOf);
  expect(canopyStride(points, false)).toBe(5);
  const unpacked = unpackPoints(toBuffer(packPoints(points, ORIGIN, 5)));
  const back = unpacked ? pointFeatures(unpacked) : [];
  expect(back.map((f) => f.properties)).toEqual([
    { h: 22, l: "e", pine: 1 },
    { h: 21, l: "e", ls: "dop", c: 1, pine: 1 },
    { h: 19, l: "e" },
    { h: 12 },
  ]);
});
