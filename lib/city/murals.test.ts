import { expect, test } from "bun:test";
import {
  type Mural,
  muralBytes,
  muralCredit,
  muralStrip,
  muralTexels,
  muralsOf,
  PHONE_PX_PER_M,
  parseMurals,
} from "./murals";

/** The Kulturpalast's west wall, north to south (as baked). */
const weg: Mural = {
  id: "n5978926932",
  name: "Der Weg der Roten Fahne",
  kind: "mural",
  tile: "33410_5656_2_sn",
  building: "DESNATPU1000Fh0f",
  path: [
    [411_527.53, 5_656_286.18],
    [411_521.05, 5_656_256.89],
  ],
  bottom: 116.34,
  top: 126.84,
  size: [30, 10.5],
  how: "whole",
  image: "n5978926932.webp",
  px: [1280, 448],
  photo: {
    title: "File:Weg der Roten Fahne, version a.jpg",
    author: "User:Heiko S",
    licence: "CC BY 2.0",
    url: "https://commons.wikimedia.org/wiki/File:Weg_der_Roten_Fahne,_version_a.jpg",
  },
};

const offset = { cx: 411_000, cy: 5_656_000 };

test("the file's murals, the malformed left out", () => {
  const { path: _path, ...pathless } = weg;
  expect(
    parseMurals({
      murals: [weg, pathless, { ...weg, top: weg.bottom }, null],
    })
  ).toEqual([weg]);
  expect(parseMurals({})).toBeNull();
  expect(parseMurals(null)).toBeNull();
});

test("the extras name the murals only well-formed", () => {
  const murals = { credits: ["a"], file: "murals.1234.json" };
  expect(muralsOf({ murals })).toEqual(murals);
  expect(muralsOf({ murals: { credits: [1], file: "x" } })).toBeUndefined();
  expect(muralsOf({ murals: { credits: [] } })).toBeUndefined();
  expect(muralsOf({})).toBeUndefined();
  expect(muralsOf(null)).toBeUndefined();
});

test("a photo's credit names the mural, its author, licence and Commons", () => {
  expect(muralCredit(weg)).toBe(
    "Wandbild „Der Weg der Roten Fahne“: Foto Heiko S, CC BY 2.0, Wikimedia Commons"
  );
  expect(muralCredit({ ...weg, name: "" })).toBe(
    "Wandbild: Foto Heiko S, CC BY 2.0, Wikimedia Commons"
  );
});

test("the strip stands on its path from bottom to top, the photo's left at its start", () => {
  const strip = muralStrip(weg, offset);
  const [x0, y0, z0, x1, y1, z1] = strip.positions;
  // the path's start, bottom then top, in the Y-up frame
  expect(x0).toBeCloseTo(527.53, 2);
  expect(z0).toBeCloseTo(-286.18, 2);
  expect(y0).toBeCloseTo(116.34, 2);
  expect([x1, z1]).toEqual([x0, z0]);
  expect(y1).toBeCloseTo(126.84, 2);
  // u along the path, v 1 at the bottom (the texture is not flipped)
  expect([...strip.uvs]).toEqual([0, 1, 0, 0, 1, 1, 1, 0]);
  expect([...strip.index]).toEqual([0, 2, 1, 1, 2, 3]);
});

test("the strip faces the wall's outside, front-faced from there", () => {
  const strip = muralStrip(weg, offset);
  const p = strip.positions;
  // the west wall: its outside faces west (−x), a little south of it
  const [nx, ny, nz] = strip.normals;
  expect(nx).toBeLessThan(-0.95);
  expect(ny).toBe(0);
  expect(Math.hypot(nx, nz)).toBeCloseTo(1, 5);
  // the first triangle's winding normal points the same way
  const v = (i: number) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
  const [a, b, c] = Array.from(strip.index.slice(0, 3), v);
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const face = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  expect(face[0] * nx + face[1] * ny + face[2] * nz).toBeGreaterThan(0);
});

test("a bent path keeps a column per vertex, its normal between its walls", () => {
  const bent = muralStrip(
    {
      bottom: 0,
      top: 3,
      path: [
        [0, 0],
        [10, 0],
        [10, -10],
      ],
    },
    { cx: 0, cy: 0 }
  );
  expect(bent.positions.length).toBe(3 * 6);
  expect(bent.index.length).toBe(2 * 6);
  // east then south, the outside on the right: south of the first leg,
  // west of the second; the corner's normal halfway
  const corner = bent.normals.slice(6, 9);
  expect(corner[0]).toBeCloseTo(-Math.SQRT1_2, 5);
  expect(corner[2]).toBeCloseTo(Math.SQRT1_2, 5);
  expect(bent.uvs[4]).toBeCloseTo(0.5, 5);
});

test("a phone decodes a mural at most PHONE_PX_PER_M a metre, never above the file", () => {
  expect(muralTexels(weg, false)).toEqual([1280, 448]);
  const [w, h] = muralTexels(weg, true);
  expect(w).toBe(30 * PHONE_PX_PER_M);
  expect(h).toBe(Math.round((448 * w) / 1280));
  // a small photo stays as it is
  expect(muralTexels({ px: [400, 140], size: [30, 10.5] }, true)).toEqual([
    400, 140,
  ]);
});

test("a decoded mural weighs its texture with mipmaps and its bitmap", () => {
  const base = 960 * 336 * 4;
  expect(muralBytes([960, 336])).toBe(Math.round(base * (4 / 3)) + base);
});
