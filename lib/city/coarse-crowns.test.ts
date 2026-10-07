import { describe, expect, test } from "bun:test";
import {
  COARSE_TREE_SHARE,
  COARSE_TREE_WIDEN,
  type CoarseCrown,
  coarseCrowns,
  drawnCoarse,
  packCrowns,
  unpackCrowns,
} from "./coarse-crowns";
import type { InventoryTree } from "./tree-inventory";
import type { Placement } from "./tree-placement";

const at = (x: number, z: number, i = 0): Placement => ({
  x: Math.fround(x),
  z: Math.fround(z),
  y: 0,
  rot: i * 0.1,
  s: 1 + i * 0.01,
});

describe("which trees the coarse level draws", () => {
  test("a third of them, the crowns as much wider as covers what all covered", () => {
    let kept = 0;
    let n = 0;
    for (let x = -1000; x < 1000; x += 7.3) {
      for (let z = -1000; z < 1000; z += 9.1) {
        n++;
        if (drawnCoarse(x, z)) {
          kept++;
        }
      }
    }
    expect(kept / n).toBeCloseTo(COARSE_TREE_SHARE, 2);
    expect(COARSE_TREE_SHARE * COARSE_TREE_WIDEN ** 2).toBeCloseTo(1, 12);
  });

  test("a row of trees is thinned tree by tree, never as one", () => {
    // a street's trees every 9 m along a diagonal
    const row = Array.from({ length: 300 }, (_, i) => at(i * 6.4, i * 6.4, i));
    const kept = row.filter((p) => drawnCoarse(p.x, p.z)).length;
    expect(kept / row.length).toBeGreaterThan(0.2);
    expect(kept / row.length).toBeLessThan(0.47);
  });

  test("the same trees, however the tile lists them", () => {
    const trees = Array.from({ length: 200 }, (_, i) =>
      at(10 + i * 3.7, 20 - i * 1.3, i)
    );
    const keys = (list: Placement[]) =>
      coarseCrowns(list, [])
        .map((c) => `${c.x},${c.z}`)
        .sort();
    expect(keys([...trees].reverse())).toEqual(keys(trees));
  });

  test("register trees join with their crown, colour and season", () => {
    const tree = (x: number): InventoryTree => ({
      colour: 2,
      ext: { crownBase: 3, crownTop: 12, crownWidth: 8, trunkTop: 6 },
      genus: 4,
      ground: 0,
      jitter: -2.5,
      leaf: "d",
      ndvi: 0.4,
      rot: 1,
      shape: "cone",
      x: Math.fround(x),
      z: 5,
    });
    const register = Array.from({ length: 300 }, (_, i) => tree(i * 3.7));
    const crowns = coarseCrowns([], register);
    expect(crowns).toHaveLength(
      register.filter((t) => drawnCoarse(t.x, t.z)).length
    );
    expect(crowns[0]).toMatchObject({
      kind: "register",
      colour: "golden",
      genus: 4,
      jitter: -2.5,
      ext: { crownBase: 3, crownTop: 12, crownWidth: 8 },
    });
  });
});

describe("the file", () => {
  const crowns: CoarseCrown[] = [
    {
      kind: "canopy",
      x: 1234.5,
      z: -77.25,
      rot: 2.5,
      s: 3.21,
      w: 2.1,
      ndvi: 0.42,
    },
    { kind: "canopy", x: -0.125, z: 1999.75, rot: 0, s: 0.5 },
    {
      kind: "register",
      x: Math.fround(10.1),
      z: Math.fround(-20.2),
      rot: 5.9,
      colour: "evergreen",
      ext: { crownBase: 2.34, crownTop: 17.5, crownWidth: 9.99 },
      genus: 12,
      jitter: 3.4,
      ndvi: 0.1,
    },
  ];

  test("keeps the positions exact and the rest to its units", () => {
    const back = unpackCrowns(packCrowns(crowns).buffer as ArrayBuffer);
    expect(back).toHaveLength(crowns.length);
    for (const [i, c] of crowns.entries()) {
      const b = back?.[i];
      expect(b?.kind).toBe(c.kind);
      expect(b?.x).toBe(Math.fround(c.x));
      expect(b?.z).toBe(Math.fround(c.z));
      expect(b?.rot).toBeCloseTo(c.rot, 3);
      if (c.ndvi === undefined) {
        expect(b?.ndvi).toBeUndefined();
      } else {
        expect(b?.ndvi).toBeCloseTo(c.ndvi, 2);
      }
      if (c.kind === "canopy" && b?.kind === "canopy") {
        expect(b.s).toBeCloseTo(c.s, 3);
        expect(b.w).toBeCloseTo(c.w ?? c.s, 3);
      }
      if (c.kind === "register" && b?.kind === "register") {
        expect(b.colour).toBe(c.colour);
        expect(b.genus).toBe(c.genus);
        expect(b.jitter).toBeCloseTo(c.jitter, 1);
        expect(b.ext.crownBase).toBeCloseTo(c.ext.crownBase, 2);
        expect(b.ext.crownTop).toBeCloseTo(c.ext.crownTop, 2);
        expect(b.ext.crownWidth).toBeCloseTo(c.ext.crownWidth, 2);
      }
    }
  });

  test("reads nothing that is not one", () => {
    expect(unpackCrowns(new ArrayBuffer(4))).toBeNull();
    expect(
      unpackCrowns(new TextEncoder().encode("PTS1xxxx").buffer)
    ).toBeNull();
    const short = packCrowns(crowns).slice(0, 20);
    expect(unpackCrowns(short.buffer)).toBeNull();
  });
});
