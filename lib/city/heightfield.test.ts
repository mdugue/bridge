import { expect, test } from "bun:test";
import {
  decodeHeightfield,
  encodeHeightfield,
  HEIGHTFIELD_NODATA,
  HEIGHTFIELD_VERSION,
  type HeightfieldHeader,
  parseHeightfieldHeader,
  resolveSiblingUrl,
} from "./heightfield";

const validHeader: HeightfieldHeader = {
  version: HEIGHTFIELD_VERSION,
  n: 512,
  bounds: [412_000, 5_656_000, 414_000, 5_658_000],
  data: "dgm1_33412_5656_2_sn.heightfield-512.u16.gz",
  zMin: 100,
  zScale: 0.01,
};

test("a valid header round-trips through JSON", () => {
  expect(
    parseHeightfieldHeader(JSON.parse(JSON.stringify(validHeader)))
  ).toEqual(validHeader);
});

test("rejects a non-object", () => {
  expect(() => parseHeightfieldHeader(null)).toThrow(/not an object/);
  expect(() => parseHeightfieldHeader("{}")).toThrow(/not an object/);
});

test("rejects an unknown version", () => {
  expect(() => parseHeightfieldHeader({ ...validHeader, version: 1 })).toThrow(
    /version 1/
  );
});

test("rejects a non-integer or non-positive n", () => {
  expect(() => parseHeightfieldHeader({ ...validHeader, n: 512.5 })).toThrow(
    /positive integer/
  );
  expect(() => parseHeightfieldHeader({ ...validHeader, n: 0 })).toThrow(
    /positive integer/
  );
});

test("rejects degenerate or malformed bounds", () => {
  expect(() =>
    parseHeightfieldHeader({ ...validHeader, bounds: [1, 2, 1, 4] })
  ).toThrow(/degenerate bounds/);
  expect(() =>
    parseHeightfieldHeader({ ...validHeader, bounds: [1, 2, 3] })
  ).toThrow(/array of 4/);
  expect(() =>
    parseHeightfieldHeader({ ...validHeader, bounds: [1, 2, 3, Number.NaN] })
  ).toThrow(/finite/);
});

test("rejects a data name that escapes the header's directory", () => {
  expect(() =>
    parseHeightfieldHeader({ ...validHeader, data: "../secrets.f32" })
  ).toThrow(/bare file name/);
  expect(() =>
    parseHeightfieldHeader({ ...validHeader, data: "/etc/passwd" })
  ).toThrow(/bare file name/);
  expect(() => parseHeightfieldHeader({ ...validHeader, data: "" })).toThrow(
    /non-empty/
  );
});

test("rejects a missing or non-positive zScale", () => {
  expect(() =>
    parseHeightfieldHeader({ ...validHeader, zScale: undefined })
  ).toThrow(/zScale/);
  expect(() => parseHeightfieldHeader({ ...validHeader, zScale: 0 })).toThrow(
    /zScale must be positive/
  );
});

test("encodeHeightfield maps the nodata sentinel and non-finite values to NoData", () => {
  const out = encodeHeightfield(
    [120.5, -9999, Number.POSITIVE_INFINITY, 121],
    -9999
  );
  expect(out.zMin).toBe(120.5);
  expect(out.zScale).toBe(0.01);
  expect(out.samples[0]).toBe(0);
  expect(out.samples[1]).toBe(HEIGHTFIELD_NODATA);
  expect(out.samples[2]).toBe(HEIGHTFIELD_NODATA);
  expect(out.samples[3]).toBe(50);
});

test("encodeHeightfield widens the step when the relief exceeds 16 bits", () => {
  const out = encodeHeightfield([0, 2000], null);
  expect(out.zScale).toBeGreaterThan(0.01);
  expect(out.samples[1]).toBeLessThanOrEqual(HEIGHTFIELD_NODATA - 1);
});

test("decodeHeightfield returns what encodeHeightfield wrote (to the cm)", () => {
  const encoded = encodeHeightfield([101.234, 102, 103.5, -9999], -9999);
  const decoded = decodeHeightfield(encoded.samples.buffer as ArrayBuffer, {
    n: 2,
    zMin: encoded.zMin,
    zScale: encoded.zScale,
  });
  expect(decoded[0]).toBeCloseTo(101.23, 2);
  expect(decoded[1]).toBeCloseTo(102, 2);
  expect(decoded[2]).toBeCloseTo(103.5, 2);
  expect(Number.isNaN(decoded[3])).toBe(true);
});

test("decodeHeightfield rejects a buffer of the wrong length", () => {
  expect(() =>
    decodeHeightfield(new ArrayBuffer(6), { n: 2, zMin: 0, zScale: 1 })
  ).toThrow(/expected 8 bytes, got 6/);
});

test("resolveSiblingUrl swaps the last path segment", () => {
  expect(resolveSiblingUrl("/data/x.heightfield-512.json", "x.u16.gz")).toBe(
    "/data/x.u16.gz"
  );
  expect(resolveSiblingUrl("x.heightfield-512.json", "x.u16.gz")).toBe(
    "x.u16.gz"
  );
});
