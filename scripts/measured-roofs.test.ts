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

/** The gable `gablePart` stands by default: 5 m at its ridge, on the cell
 *  centres at x = 10.5, falling 0.5 m per metre either side. */
const gable = (x: number) => 5 - Math.abs(x - 10.5) / 2;

/** A face over the 20 × 20 m courtyard part, `roof(x)` metres above `z`,
 *  sampled on a 1 m grid that reaches two cells past the outline. */
function gablePart(z: number, roof = gable) {
  const part = courtyardPart(z);
  const cols = 24;
  const rows = 24;
  const dz: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      dz.push(Math.round(roof(-2 + c + 0.5) * 100));
    }
  }
  return {
    ...part,
    properties: {
      id: "a",
      z,
      surface: { x: -2, y: 22, res: 1, cols, rows, dz },
    },
  } satisfies MeasuredRoofFeature;
}

test("a face stands on the measured surface, walls up to its edge", () => {
  const mesh = measuredRoofMesh([gablePart(110)], 100, { cx: 0, cy: 0 });
  let area = 0;
  for (const { c, n } of triangles(mesh.positions)) {
    if (Math.abs(n[2]) > 1e-6) {
      // the roof, facing up, over the part's 300 m² without gap or overlap
      expect(Math.sign(n[2])).toBe(1);
      area += n[2] / 2;
      continue;
    }
    // a wall looks out of the solid, as a flat part's does
    const out = (c[0] - 10) * n[0] + (c[1] - 10) * n[1];
    const onCourtyard = Math.max(Math.abs(c[0] - 10), Math.abs(c[1] - 10)) < 6;
    expect(Math.sign(out)).toBe(onCourtyard ? -1 : 1);
  }
  expect(area).toBeCloseTo(300, 6);
  // the roof and the walls' tops on the measured gable
  for (let i = 0; i < mesh.isRoof.length; i++) {
    const [x, , z] = mesh.positions.slice(i * 3, i * 3 + 3);
    if (mesh.isRoof[i] === 1 || z > 100) {
      expect(Math.abs(z - 110 - gable(x))).toBeLessThan(0.11);
    }
  }
});

test("a plane face is a handful of triangles, not one per cell", () => {
  const pent = gablePart(110, (x) => x / 4);
  const mesh = measuredRoofMesh([pent], 100, { cx: 0, cy: 0 });
  const roofTris = mesh.isRoof.filter((r) => r === 1).length / 3;
  // the 300 m² roof would be 600 triangles at one pair per cell
  expect(roofTris).toBeLessThan(40);
  const zs = mesh.positions.filter(
    (_, i) => i % 3 === 2 && mesh.isRoof[(i - 2) / 3] === 1
  );
  expect(Math.min(...zs)).toBeCloseTo(110, 1);
  expect(Math.max(...zs)).toBeCloseTo(115, 1);
});

test("a face shades smoothly over itself, a ridge stays sharp, walls and flat parts flat", () => {
  const mesh = measuredRoofMesh([gablePart(110), courtyardPart(120)], 100, {
    cx: 0,
    cy: 0,
  });
  expect(mesh.normals).toHaveLength(mesh.positions.length);
  const byPoint = new Map<string, Set<string>>();
  for (let i = 0; i < mesh.isRoof.length; i++) {
    const n = mesh.normals.slice(i * 3, i * 3 + 3);
    const [x, y, z] = mesh.positions.slice(i * 3, i * 3 + 3);
    if (mesh.isRoof[i] !== 1 || z === 120) {
      // walls, and the flat part's roof: the triangle's own normal
      expect(n.every(Number.isNaN)).toBe(true);
      continue;
    }
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 6);
    // the gable's slope either side: 0.5 m a metre
    expect(Math.abs(n[0] / n[2])).toBeCloseTo(0.5, 2);
    const key = `${x},${y}`;
    const set = byPoint.get(key) ?? new Set<string>();
    set.add(n.map((c) => c.toFixed(4)).join(","));
    byPoint.set(key, set);
  }
  for (const [key, normals] of byPoint) {
    const x = Number(key.split(",")[0]);
    // one normal a point over each slope; the ridge keeps both
    expect(normals.size).toBe(Math.abs(x - 10.5) < 1e-6 ? 2 : 1);
  }
});
