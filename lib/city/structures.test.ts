import { expect, test } from "bun:test";
import { ShapeUtils, Vector2 } from "three";
import type { StructureFeature } from "./features";
import type { StructureMesh } from "./small-buildings";
import {
  buildingMesh,
  columnMesh,
  STRUCTURE_SINK,
  structureFootprint,
} from "./structures";

const triangulate = (data: number[], holes: number[]): number[] => {
  const pts: Vector2[] = [];
  for (let i = 0; i + 1 < data.length; i += 2) {
    pts.push(new Vector2(data[i], data[i + 1]));
  }
  const cuts = [...holes, pts.length];
  const contour = pts.slice(0, cuts[0]);
  const rings = holes.map((start, i) => pts.slice(start, cuts[i + 1]));
  // triangulateShape indexes contour ++ holes, as Triangulate does
  return ShapeUtils.triangulateShape(contour, rings).flat();
};

/** The signed volume of a triangle soup: positive and right for a closed
 *  mesh wound counter-clockwise seen from outside. */
function volume(m: StructureMesh): number {
  const p = m.positions;
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.slice(i, i + 9);
    v +=
      (ax * (by * cz - bz * cy) -
        ay * (bx * cz - bz * cx) +
        az * (bx * cy - by * cx)) /
      6;
  }
  return v;
}

const chimney: StructureFeature = {
  geometry: { type: "Point", coordinates: [1000, 2000] },
  properties: { kind: "chimney", z: 100, h: 48, r: 2, rt: 1.2 },
};

test("a column is a closed, outward-wound solid of about its measured size", () => {
  const m = columnMesh(chimney, { cx: 990, cy: 1990 });
  expect(m.positions.length % 9).toBe(0);
  expect(m.isRoof.length * 3).toBe(m.positions.length);
  // a frustum r 2 → 1.2 over 48 m is ≈ 390 m³; the 16-gon and the head band
  // stay within a few percent of it
  const h = 48 + STRUCTURE_SINK;
  const frustum = (Math.PI * h * (4 + 2 * 1.2 + 1.44)) / 3;
  expect(volume(m)).toBeGreaterThan(frustum * 0.9);
  expect(volume(m)).toBeLessThan(frustum * 1.05);
  const zs = m.positions.filter((_, i) => i % 3 === 2);
  expect(Math.max(...zs)).toBeCloseTo(148, 5);
  expect(Math.min(...zs)).toBeCloseTo(100 - STRUCTURE_SINK, 5);
});

test("every column kind is a closed solid", () => {
  for (const kind of [
    "tower",
    "mast",
    "communications_tower",
    "water_tower",
    "lighthouse",
  ] as const) {
    const m = columnMesh(
      { ...chimney, properties: { ...chimney.properties, kind } as never },
      { cx: 0, cy: 0 }
    );
    expect(volume(m)).toBeGreaterThan(0);
  }
});

test("a missing building is its outline extruded, holes cut out", () => {
  const square: StructureFeature = {
    geometry: {
      type: "Polygon",
      coordinates: [
        // clockwise on purpose: the builder turns it
        [
          [0, 0],
          [0, 20],
          [20, 20],
          [20, 0],
          [0, 0],
        ],
        [
          [5, 5],
          [15, 5],
          [15, 15],
          [5, 15],
          [5, 5],
        ],
      ],
    },
    properties: { kind: "building", z: 50, h: 12 },
  };
  const m = buildingMesh(square, { cx: 0, cy: 0 }, triangulate);
  expect(volume(m)).toBeCloseTo((400 - 100) * (12 + STRUCTURE_SINK), 3);
  expect(structureFootprint(square)).toHaveLength(4);
});

test("a feature of the wrong shape builds nothing", () => {
  expect(
    columnMesh(
      { ...chimney, geometry: { type: "Polygon", coordinates: [] } },
      {
        cx: 0,
        cy: 0,
      }
    ).positions
  ).toHaveLength(0);
  expect(
    buildingMesh(chimney, { cx: 0, cy: 0 }, triangulate).positions
  ).toHaveLength(0);
});
