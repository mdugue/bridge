import { describe, expect, test } from "bun:test";
import type { Bed } from "./track-beds";
import { FORMATION_RUN_M, onFormations } from "./track-formation";
import type { CityJsonDocument } from "./types";

/** A 40 × 20 m box from z0 to z1 as a one-object document (cm units). */
function boxDoc(z0: number, z1: number): CityJsonDocument {
  const v: [number, number, number][] = [];
  for (const z of [z0, z1]) {
    for (const [x, y] of [
      [0, 0],
      [40, 0],
      [40, 20],
      [0, 20],
    ]) {
      v.push([x * 100, y * 100, z * 100]);
    }
  }
  return {
    type: "CityJSON",
    version: "2.0",
    transform: { scale: [0.01, 0.01, 0.01], translate: [0, 0, 0] },
    vertices: v,
    CityObjects: {
      b: {
        type: "Building",
        geometry: [
          {
            type: "Solid",
            boundaries: [
              [
                [[0, 3, 2, 1]],
                [[4, 5, 6, 7]],
                [[0, 1, 5, 4]],
                [[1, 2, 6, 5]],
                [[2, 3, 7, 6]],
                [[3, 0, 4, 7]],
              ],
            ],
          },
        ],
      },
    },
  };
}

/** A straight bed along y = 10 from x0 to x1 at profile z. */
function bed(x0: number, x1: number, z: number): Bed {
  const coords: [number, number][] = [];
  for (let x = x0; x <= x1; x += 2) {
    coords.push([x, 10]);
  }
  return { coords, z: coords.map(() => z), half: 2.25, drop: 0.1 };
}

/** The heights a document's object draws its vertices at. */
function heights(doc: CityJsonDocument): number[] {
  const g = doc.CityObjects.b.geometry?.[0] as { boundaries: number[][][][] };
  const ids = new Set(g.boundaries.flat(3));
  return [...ids].map((i) => doc.vertices[i][2] / 100).sort((a, b) => a - b);
}

describe("onFormations", () => {
  test("lowers a top a track runs on, just under its rails, to the bed", () => {
    const { doc, lowered } = onFormations(boxDoc(113.87, 120.13), [
      bed(-10, 50, 119.33),
    ]);
    expect(lowered).toEqual(["b"]);
    const hs = heights(doc);
    expect(hs.slice(0, 4)).toEqual([113.87, 113.87, 113.87, 113.87]);
    for (const h of hs.slice(4)) {
      expect(h).toBeCloseTo(119.23, 2);
    }
  });

  test("keeps a roof well above the track (a hall over it)", () => {
    const src = boxDoc(113, 128);
    expect(onFormations(src, [bed(-10, 50, 119.33)]).doc).toBe(src);
  });

  test("keeps a top a track only grazes", () => {
    const src = boxDoc(113.87, 120.13);
    const short = bed(-10, FORMATION_RUN_M / 2 - 4, 119.33);
    expect(onFormations(src, [short]).doc).toBe(src);
  });

  test("keeps a top the track lies over", () => {
    const src = boxDoc(113.87, 119.2);
    expect(onFormations(src, [bed(-10, 50, 119.33)]).doc).toBe(src);
  });
});
