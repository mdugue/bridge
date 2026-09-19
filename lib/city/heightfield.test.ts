import { expect, test } from "bun:test";
import {
  decodeHeightfield,
  encodeHeightfield,
  HEIGHTFIELD_VERSION,
  type HeightfieldHeader,
  parseHeightfieldHeader,
  resolveSiblingUrl,
} from "./heightfield";

const validHeader: HeightfieldHeader = {
  version: HEIGHTFIELD_VERSION,
  n: 512,
  bounds: [412_000, 5_656_000, 414_000, 5_658_000],
  data: "dgm1_33412_5656_2_sn.heightfield-512.f32",
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
  expect(() => parseHeightfieldHeader({ ...validHeader, version: 2 })).toThrow(
    /version 2/
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

test("encodeHeightfield maps the nodata sentinel and non-finite values to NaN", () => {
  const out = encodeHeightfield(
    [120.5, -9999, Number.POSITIVE_INFINITY],
    -9999
  );
  expect(out[0]).toBe(120.5);
  expect(Number.isNaN(out[1])).toBe(true);
  expect(Number.isNaN(out[2])).toBe(true);
});

test("encodeHeightfield with nodata null only drops non-finite values", () => {
  const out = encodeHeightfield([-9999, Number.NaN, 104.25], null);
  expect(out[0]).toBe(-9999);
  expect(Number.isNaN(out[1])).toBe(true);
  expect(out[2]).toBe(104.25);
});

test("decodeHeightfield returns what encodeHeightfield wrote", () => {
  const encoded = encodeHeightfield([1, 2, 3, -9999], -9999);
  const decoded = decodeHeightfield(encoded.buffer as ArrayBuffer, 2);
  expect(Array.from(decoded.slice(0, 3))).toEqual([1, 2, 3]);
  expect(Number.isNaN(decoded[3])).toBe(true);
});

test("decodeHeightfield rejects a buffer of the wrong length", () => {
  expect(() => decodeHeightfield(new ArrayBuffer(12), 2)).toThrow(
    /expected 16 bytes, got 12/
  );
});

test("resolveSiblingUrl swaps the last path segment", () => {
  expect(resolveSiblingUrl("/data/x.heightfield-512.json", "x.f32")).toBe(
    "/data/x.f32"
  );
  expect(resolveSiblingUrl("x.heightfield-512.json", "x.f32")).toBe("x.f32");
});
