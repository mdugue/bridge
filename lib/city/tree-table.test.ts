import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import { SITES } from "../../sites/index";
import type { TreeFeature } from "./features";
import { sideFileSource, siteDataDir, tileArtifacts, tileIds } from "./tile";
import { inventoryTree } from "./tree-inventory";
import { canopyPlacement, rowTree } from "./tree-placement";
import {
  REGISTER_WORDS,
  registerAt,
  registerTree,
  TREE_NDVI_STEP,
  TREE_SLOPE_STEP,
  TREE_STEP_Y_M,
  TREE_WORDS,
  treeAt,
  writeRegister,
  writeTree,
} from "./tree-table";
import type { RegisterFact, TreeFact } from "./tree-table";

const offset = { cx: 411_000.37, cy: 5_657_000.81 };
const origin = [412_000, 5_656_000, 104] as const;

const oneTree = (fact: TreeFact) => {
  const words = new Uint16Array(TREE_WORDS);
  const report = { clamped: 0 };
  writeTree(words, 0, fact, origin, report);
  return { ...treeAt(words, 0, origin, offset), clamped: report.clamped };
};

describe("a canopy tree's record", () => {
  const fact: TreeFact = {
    e: 412_004.2,
    n: 5_657_998.5,
    ground: 131.37,
    h: 17.4,
    r: 2.3,
    c: true,
    evergreen: true,
    pine: true,
    photo: true,
    ndvi: 0.412,
    slope: [0.21, -0.07],
  };

  test("gives the placement back: its turn, its size, its crown, to the bit", () => {
    const back = oneTree(fact);
    // the float32 offsets the packed canopy held, so the hashes are seeded
    // as they were
    const e = origin[0] + Math.fround(fact.e - origin[0]);
    const n = origin[1] + Math.fround(fact.n - origin[1]);
    // the step at or below the ground: a foot never stands over it
    const ground = origin[2] + Math.floor((fact.ground - origin[2]) * 32) / 32;
    const ndvi =
      (Math.round(((fact.ndvi ?? 0) * 254) / TREE_NDVI_STEP) * TREE_NDVI_STEP) /
      254;
    const want = canopyPlacement(e, n, ground, fact, offset, ndvi);
    expect(back.clamped).toBe(0);
    expect(back.p).toEqual({ ...want, slope: back.p.slope });
    expect(back.p.y).toBeLessThanOrEqual(fact.ground);
    expect(fact.ground - back.p.y).toBeLessThan(TREE_STEP_Y_M);
    expect(back.measured).toBeCloseTo(17.4, 6);
    expect([back.photo, back.row, back.scan]).toEqual([true, false, true]);
  });

  test("keeps the ground's slope within its step", () => {
    const [sx, sz] = oneTree(fact).p.slope ?? [0, 0];
    expect(Math.abs(sx - 0.21 * 127)).toBeLessThanOrEqual(TREE_SLOPE_STEP / 2);
    expect(Math.abs(sz + 0.07 * 127)).toBeLessThanOrEqual(TREE_SLOPE_STEP / 2);
    expect(sx % TREE_SLOPE_STEP).toBe(0);
  });

  test("a broadleaf of the surface model: no radius, no leaves told", () => {
    const back = oneTree({
      e: 412_100.5,
      n: 5_656_100.5,
      ground: 110,
      h: 9.1,
      slope: [0, 0],
    });
    expect(back.p.evergreen).toBeUndefined();
    expect(back.p.ndvi).toBeUndefined();
    expect([back.photo, back.row, back.scan]).toEqual([false, false, false]);
  });

  test("a height nothing measured stays unmeasured", () => {
    const back = oneTree({
      e: 412_100.5,
      n: 5_656_100.5,
      ground: 110,
      h: Number.NaN,
      slope: [0, 0],
    });
    expect(back.measured).toBe(0);
    expect(back.p.s).toBeGreaterThan(0.8);
  });

  test("a row's tree keeps its scale and its turn", () => {
    const back = oneTree({
      e: 412_050.3,
      n: 5_656_050.7,
      ground: 108,
      h: Number.NaN,
      slope: [0, 0],
      row: { rot: 1.2, s: 1.1 },
    });
    const want = rowTree(412_050.3, 5_656_050.7, 108, 1.1, 1.2, offset);
    expect(back.row).toBe(true);
    expect(back.p.s).toBeCloseTo(want.s, 1);
    expect(back.p.rot).toBeCloseTo(1.2, 1);
    expect(back.p.base).toBeCloseTo(want.base ?? 0, 0);
  });

  test("a tree outside the file's box, or taller than its bits, is counted", () => {
    const outside = oneTree({ ...fact, e: origin[0] - 3 });
    expect(outside.clamped).toBeGreaterThan(0);
    const tall = oneTree({ ...fact, h: 140 });
    expect(tall.clamped).toBeGreaterThan(0);
  });
});

const round = (f: RegisterFact) => {
  const words = new Uint16Array(REGISTER_WORDS);
  const report = { clamped: 0 };
  writeRegister(words, 0, f, origin, report);
  return { back: registerAt(words, 0, origin), clamped: report.clamped };
};

describe("a surveyed tree's record", () => {
  const props: NonNullable<TreeFeature["properties"]> = {
    a: 2,
    c: 1,
    d: 4.5,
    g: 1,
    gn: 14,
    h: 15.5,
    l: "e",
    s: "osm",
    t: 34,
    y: 1987,
  };
  const fact: RegisterFact = {
    e: 412_000.7,
    n: 5_657_966.2,
    ground: 118.42,
    index: 6450,
    ndvi: 0.3,
    slope: [0, 0.1],
    props,
  };
  test("gives its file's properties, its place and its row back", () => {
    const { back, clamped } = round(fact);
    expect(clamped).toBe(0);
    expect(back.props).toEqual(props);
    // exact: decimetres both
    expect([back.e, back.n, back.index]).toEqual([fact.e, fact.n, 6450]);
    expect(back.ground).toBeLessThanOrEqual(fact.ground);
    expect(fact.ground - back.ground).toBeLessThan(TREE_STEP_Y_M);
  });

  test("stands as the tree the layer drew from its feature", () => {
    const { back } = round(fact);
    const tree = registerTree(back, offset, 2026);
    expect(tree).toEqual({
      ...inventoryTree(
        fact.e,
        fact.n,
        back.ground,
        props,
        offset,
        back.ndvi,
        2026
      ),
      slope: back.slope,
    });
    expect(tree.age).toBe(39);
  });

  test("an orchard's measured tree, and a plain one, keep what they lack", () => {
    const orchard = round({
      ...fact,
      props: { a: 5, d: 4, h: 4.5, l: "d", s: "orchard", m: 1 },
    });
    expect(orchard.back.props).toEqual({
      a: 5,
      d: 4,
      h: 4.5,
      l: "d",
      s: "orchard",
      m: 1,
    });
  });

  test("its row is a step from the record before it", () => {
    const words = new Uint16Array(REGISTER_WORDS);
    const report = { clamped: 0 };
    writeRegister(words, 0, fact, origin, report, 6447);
    expect(words[7]).toBe(3);
    expect(registerAt(words, 0, origin, 6447).index).toBe(6450);
    expect(report.clamped).toBe(0);
  });

  test("a step past the word is counted", () => {
    expect(round({ ...fact, index: 70_000 }).clamped).toBeGreaterThan(0);
  });
});

// A record's easting, northing, height and width are decimetres: the bakes
// write one decimal. A bake that wrote more would be bent here in silence
// (within 5 cm), so every committed file is held to it.
const ROOT = nodePath.join(import.meta.dir, "..", "..");
const onDecimetre = (v: number) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6;

describe.each(
  Object.values(SITES)
    .filter((site) => existsSync(nodePath.join(ROOT, siteDataDir(site), "dlm")))
    .map((site) => [site.id, site] as const)
)("%s: the tree files' decimals", (_, site) => {
  const off = (kind: "canopy" | "canopyx" | "trees", keys: string[]) => {
    let bad = 0;
    for (const tile of tileIds(site)) {
      const path = nodePath.join(
        ROOT,
        sideFileSource(site, tileArtifacts(tile)[kind].file)
      );
      if (!existsSync(path)) {
        continue;
      }
      const doc = JSON.parse(readFileSync(path, "utf-8")) as {
        features: {
          geometry: { coordinates: [number, number] };
          properties: Record<string, unknown>;
        }[];
      };
      for (const f of doc.features) {
        const values = [
          ...f.geometry.coordinates,
          ...keys.flatMap((k) =>
            typeof f.properties[k] === "number" ? [f.properties[k]] : []
          ),
        ];
        if (!values.every(onDecimetre)) {
          bad += 1;
        }
      }
    }
    return bad;
  };

  test("the canopy's, the scan's and the register's are whole decimetres", () => {
    expect(off("canopy", ["h"])).toBe(0);
    expect(off("canopyx", ["h", "r"])).toBe(0);
    expect(off("trees", ["h", "d"])).toBe(0);
  });
});
