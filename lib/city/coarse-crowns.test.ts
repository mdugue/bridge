import { describe, expect, test } from "bun:test";
import {
  type CoarseCrown,
  coarseCrowns,
  packCrowns,
  treeRank,
  unpackCrowns,
} from "./coarse-crowns";
import { MODEL_TREES_FLOOR } from "./model-view";
import type { InventoryTree } from "./tree-inventory";
import { CHUNK_SIZE, type Placement } from "./tree-placement";
import { FAR_THIN_MIN_TREES, FAR_THIN_WIDEN } from "./vegetation-lod";

/** three's TSL `hash` written out in BigInt, uint32 step by step. */
function referenceHash(seed: bigint): number {
  const M = 0xffff_ffffn;
  const state = (seed * 747_796_405n + 2_891_336_453n) & M;
  const word = (((state >> ((state >> 28n) + 4n)) ^ state) * 277_803_737n) & M;
  const result = ((word >> 22n) ^ word) & M;
  return Math.fround(Math.fround(Number(result)) * 2 ** -32);
}

function bits(v: number): bigint {
  const f = new Float32Array([v]);
  return BigInt(new Uint32Array(f.buffer)[0]);
}

const at = (x: number, z: number, i = 0): Placement => ({
  x: Math.fround(x),
  z: Math.fround(z),
  y: 0,
  rot: i * 0.1,
  s: 1 + i * 0.01,
});

describe("the rank", () => {
  test("is three's PCG hash of the position's float bits", () => {
    for (const [x, z] of [
      [0, 0],
      [12.5, -803.25],
      [-1234.567, 4321.125],
      [Math.fround(1999.9), Math.fround(-0.1)],
    ]) {
      const seed =
        (bits(x) ^ ((bits(z) * 0x9e_37_79_b1n) & 0xffff_ffffn)) & 0xffff_ffffn;
      expect(treeRank(x, z)).toBe(referenceHash(seed));
    }
  });

  test("spreads evenly: a share keeps about that share of a grid of trees", () => {
    let kept = 0;
    let n = 0;
    for (let x = -1000; x < 1000; x += 7.3) {
      for (let z = -1000; z < 1000; z += 9.1) {
        n++;
        const r = treeRank(Math.fround(x), Math.fround(z));
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(1);
        if (r < MODEL_TREES_FLOOR) {
          kept++;
        }
      }
    }
    expect(kept / n).toBeCloseTo(MODEL_TREES_FLOOR, 1);
  });

  test("is a property of the place, not of the order", () => {
    expect(treeRank(10, 20)).toBe(treeRank(10, 20));
    expect(treeRank(10, 20)).not.toBe(treeRank(20, 10));
  });
});

describe("the coarse crowns", () => {
  test("are the far tier's crowns below the floor", () => {
    // a sparse chunk: every tree is in the far tier, none widened
    const sparse = Array.from({ length: 200 }, (_, i) => at(10 + i, 10, i));
    const crowns = coarseCrowns(sparse, []);
    const expected = sparse.filter(
      (p) => treeRank(p.x, p.z) < MODEL_TREES_FLOOR
    );
    expect(crowns.map((c) => [c.x, c.z])).toEqual(
      expected.map((p) => [p.x, p.z])
    );
    for (const c of crowns) {
      expect(c).toMatchObject({ kind: "canopy", widen: 1 });
    }
  });

  test("a dense chunk keeps every other tree, widened, as its far tier does", () => {
    const n = FAR_THIN_MIN_TREES + 50;
    const dense = Array.from({ length: n }, (_, i) =>
      at((i % 30) * 7 + 1, Math.floor(i / 30) * 7 + 1, i)
    );
    // all in one chunk
    expect(Math.max(...dense.map((p) => p.x))).toBeLessThan(CHUNK_SIZE);
    const crowns = coarseCrowns(dense, [], 1);
    expect(crowns).toHaveLength(Math.ceil(n / 2));
    expect(crowns[1]).toMatchObject({ x: dense[2].x, z: dense[2].z });
    for (const c of crowns) {
      expect(c).toMatchObject({ kind: "canopy", widen: FAR_THIN_WIDEN });
    }
  });

  test("every register tree below the floor joins, with its crown and season", () => {
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
    const below = register.filter(
      (t) => treeRank(t.x, t.z) < MODEL_TREES_FLOOR
    );
    expect(crowns).toHaveLength(below.length);
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
      widen: 1.35,
      ndvi: 0.42,
    },
    { kind: "canopy", x: -0.125, z: 1999.75, rot: 0, s: 0.5, widen: 1 },
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
    expect(back).not.toBeNull();
    expect(back).toHaveLength(crowns.length);
    for (const [i, c] of crowns.entries()) {
      const b = back?.[i];
      expect(b?.kind).toBe(c.kind);
      // the float32 the rank hashes, bit for bit
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
        expect(b.widen).toBeCloseTo(c.widen, 3);
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
