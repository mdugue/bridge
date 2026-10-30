import { expect, test } from "bun:test";
import type { Ring2 } from "@/lib/city/decks";
import {
  addColumn,
  addFootprint,
  addRibbon,
  addStrut,
  type Mesh3,
  mesh3,
  meshFrom,
  quad,
} from "./mesh-kit";

/** Every triangle's geometric normal points the way its stored normal
 *  does: the kit's one guarantee (every material is FrontSide). */
function facesItsNormal(acc: Mesh3): boolean {
  for (let t = 0; t < acc.pos.length; t += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = acc.pos.slice(t, t + 9);
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const g = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const n = acc.nrm.slice(t, t + 3);
    if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0) {
      return false;
    }
  }
  return true;
}

test("a quad faces its normal whichever way its corners run", () => {
  const acc = mesh3();
  quad(acc, [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 1, 0]);
  quad(acc, [0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 1, 0]);
  quad(acc, [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, -1, 0]);
  expect(acc.pos.length).toBe(3 * 2 * 3 * 3);
  expect(acc.nrm.length).toBe(acc.pos.length);
  expect(facesItsNormal(acc)).toBe(true);
});

test("a footprint's fascia faces out of the ring, either winding", () => {
  const square = [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 4, z: 4 },
    { x: 0, z: 4 },
  ];
  for (const pts of [square, [...square].reverse()]) {
    const acc = mesh3();
    addFootprint(
      acc,
      { cx: 2, cz: 2, pts } satisfies Ring2,
      [1, 1, 1, 1],
      0.5,
      true
    );
    expect(facesItsNormal(acc)).toBe(true);
    // each side's normal points away from the centre
    for (let t = 0; t < acc.pos.length; t += 9) {
      const n = acc.nrm.slice(t, t + 3);
      if (n[1] !== 0) {
        continue;
      }
      const mx = (acc.pos[t] + acc.pos[t + 3] + acc.pos[t + 6]) / 3;
      const mz = (acc.pos[t + 2] + acc.pos[t + 5] + acc.pos[t + 8]) / 3;
      expect(n[0] * (mx - 2) + n[2] * (mz - 2)).toBeGreaterThan(0);
    }
  }
});

test("ribbons, columns and struts face their normals", () => {
  const acc = mesh3();
  addRibbon(
    acc,
    [
      { x: 0, y: 1, z: 0 },
      { x: 5, y: 1, z: 1 },
      { x: 9, y: 1.5, z: 4 },
    ],
    0.4,
    0.1,
    0.2
  );
  addColumn(acc, 3, 3, 0, 4, 0.5);
  addStrut(acc, [0, 0, 0], [2, 5, 1], 0.2);
  addStrut(acc, [0, 0, 0], [0, 6, 0], 0.2);
  expect(acc.pos.length).toBeGreaterThan(0);
  expect(facesItsNormal(acc)).toBe(true);
});

test("an empty soup makes no mesh, a deck frame of the wrong length is left off", () => {
  expect(meshFrom(mesh3(), 0xffffff, { cast: false })).toBeNull();
  const acc = mesh3();
  quad(acc, [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 1, 0]);
  acc.deck = [0, 0, 0, 0];
  const mesh = meshFrom(acc, 0xffffff, { cast: false });
  expect(mesh?.geometry.getAttribute("aDeck")).toBeUndefined();
  acc.deck = Array.from({ length: 6 * 4 }, () => 1);
  const framed = meshFrom(acc, 0xffffff, { cast: false });
  expect(framed?.geometry.getAttribute("aDeck")?.count).toBe(6);
});
