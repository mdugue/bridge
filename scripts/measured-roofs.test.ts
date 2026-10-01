import { expect, test } from "bun:test";
import type { MeasuredRoofFeature } from "../lib/city/features";
import { measuredRoofMesh, measuredRoofsById } from "./measured-roofs";

/** A 20 × 20 m part with a 10 × 10 m courtyard, both rings as given. */
function courtyardPart(z: number, flip = false): MeasuredRoofFeature {
  const outer: [number, number][] = [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
    [0, 0],
  ];
  const hole: [number, number][] = [
    [5, 5],
    [5, 15],
    [15, 15],
    [15, 5],
    [5, 5],
  ];
  return {
    geometry: {
      type: "Polygon",
      coordinates: flip ? [outer.reverse(), hole.reverse()] : [outer, hole],
    },
    properties: { id: "a", z },
  };
}

/** Each triangle's normal (unnormalised) and centroid. */
function triangles(positions: number[]) {
  const out: { c: number[]; n: number[] }[] = [];
  for (let i = 0; i < positions.length; i += 9) {
    const [a, b, c] = [0, 3, 6].map((k) => positions.slice(i + k, i + k + 3));
    const u = b.map((x, j) => x - a[j]);
    const v = c.map((x, j) => x - a[j]);
    out.push({
      n: [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ],
      c: [0, 1, 2].map((j) => (a[j] + b[j] + c[j]) / 3),
    });
  }
  return out;
}

test.each([false, true])(
  "every face looks out of the solid, whatever the rings' winding (flipped: %p)",
  (flip) => {
    const mesh = measuredRoofMesh([courtyardPart(112, flip)], 100, {
      cx: 0,
      cy: 0,
    });
    const tris = triangles(mesh.positions);
    // 8 wall quads (outer + courtyard) + the ring's cap; no floor
    expect(tris.length).toBe(16 + 8);
    for (const { c, n } of tris) {
      if (Math.abs(n[2]) > 1e-6) {
        // the roof, facing up
        expect(c[2]).toBe(112);
        expect(Math.sign(n[2])).toBe(1);
        continue;
      }
      // a wall: outward = away from the centre on the outer ring, toward it
      // on the courtyard's
      const out = (c[0] - 10) * n[0] + (c[1] - 10) * n[1];
      const onCourtyard =
        Math.max(Math.abs(c[0] - 10), Math.abs(c[1] - 10)) < 6;
      expect(Math.sign(out)).toBe(onCourtyard ? -1 : 1);
    }
    // the roof flag is on the cap's top only
    const roofZ = mesh.positions.filter(
      (_, i) => i % 3 === 2 && mesh.isRoof[(i - 2) / 3] === 1
    );
    expect(new Set(roofZ)).toEqual(new Set([112]));
  }
);

test("the offset is subtracted; a part not above the base is left out", () => {
  const mesh = measuredRoofMesh([courtyardPart(112), courtyardPart(99)], 100, {
    cx: 5,
    cy: 5,
  });
  expect(mesh.positions.length / 9).toBe(24);
  const xs = mesh.positions.filter((_, i) => i % 3 === 0);
  expect(Math.min(...xs)).toBe(-5);
  expect(Math.max(...xs)).toBe(15);
});

test("parts group by their object's id; features without one are skipped", () => {
  const a = courtyardPart(110);
  const b = { ...courtyardPart(120), properties: { id: "b", z: 120 } };
  const grouped = measuredRoofsById([a, b, a, { ...a, properties: null }]);
  expect([...grouped.keys()]).toEqual(["a", "b"]);
  expect(grouped.get("a")).toHaveLength(2);
});
