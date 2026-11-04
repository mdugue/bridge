import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bridgeItems, monumentItems, moreSets, treeSets } from "./ask-items";
import { hitsInSets, nearestItem } from "./ask-solids";
import type { AskSolid } from "./ask-solids";
import type {
  BridgeFeature,
  CanopyFeature,
  FeatureCollection,
  FurnitureFeature,
  LampFeature,
  MonumentFeature,
  TreeFeature,
} from "./features";
import { epsgToWorld } from "./ground-clamp";

const TILE = "33412_5656_2_sn";
const read = <F>(kind: string) =>
  (
    JSON.parse(
      readFileSync(
        path.join(
          import.meta.dir,
          "..",
          "..",
          "data",
          "dresden",
          "dlm",
          `${kind}_${TILE}.geojson`
        ),
        "utf-8"
      )
    ) as FeatureCollection<F>
  ).features ?? [];

const offset = { cx: 412_000, cy: 5_656_000 };
const ctx = { offset, tile: TILE, heightAt: () => 110 };
const down = { x: 0, y: -1, z: 0 };

test("every tree of the file is askable, by its index there", () => {
  const trees = read<TreeFeature>("trees");
  const sets = treeSets(trees, ctx);
  const i = 1234;
  const [ex, ey] = trees[i].geometry.coordinates;
  const w = epsgToWorld(ex, ey, offset);
  const hit = hitsInSets({ x: w.x, y: 200, z: w.z }, down, sets, 500)[0];
  expect(hit?.target).toMatchObject({ kind: "tree", index: i, tile: TILE });
  // its solids come with it, for the outline
  expect(hit?.solids).toHaveLength(2);
  // straight down onto the crown's top
  expect(hit?.distance).toBeCloseTo(
    200 - 110 - (trees[i].properties?.h ?? 0),
    0
  );
});

test("an orchard tree appended to the file's is askable past its end, as an orchard tree", () => {
  const trees = read<TreeFeature>("trees");
  const at: [number, number] = [412_500.5, 5_656_500.5];
  const orchard: TreeFeature = {
    geometry: { type: "Point", coordinates: at },
    properties: { a: 0, h: 4.5, d: 4, l: "d", s: "orchard" },
  };
  const sets = treeSets([...trees, orchard], ctx);
  const w = epsgToWorld(at[0], at[1], offset);
  const hit = hitsInSets({ x: w.x, y: 200, z: w.z }, down, sets, 500)[0];
  expect(hit?.target).toMatchObject({
    kind: "tree",
    index: trees.length,
    orchard: true,
  });
  expect(hit?.target).not.toHaveProperty("measured");
  if (!orchard.properties) {
    throw new Error("the orchard tree has no properties");
  }
  const measured = treeSets(
    [...trees, { ...orchard, properties: { ...orchard.properties, m: 1 } }],
    ctx
  );
  const again = hitsInSets({ x: w.x, y: 200, z: w.z }, down, measured, 500)[0];
  expect(again?.target).toMatchObject({ orchard: true, measured: true });
});

const tree = (x: number, a: number): TreeFeature => ({
  geometry: { type: "Point", coordinates: [412_000 + x, 5_656_000] },
  properties: { a, h: 12, d: 6, l: a === 0 ? "d" : "e" },
});

test("a pine and a yew are needle trees on the card, as the cone's conifers are", () => {
  // round, conifer, pine, bush (tree-inventory.ts TREE_ARCHETYPES)
  const trees = [tree(0, 0), tree(40, 3), tree(80, 6), tree(120, 7)];
  const sets = treeSets(trees, ctx);
  const conifer = trees.map((t) => {
    const [ex, ey] = t.geometry.coordinates;
    const w = epsgToWorld(ex, ey, offset);
    const hit = hitsInSets({ x: w.x, y: 200, z: w.z }, down, sets, 500)[0];
    return (hit?.target as { conifer?: boolean } | undefined)?.conifer;
  });
  expect(conifer).toEqual([false, true, true, true]);
  // only the cone's conifer is drawn, and outlined, as the cone
  const cone = trees.map((t) => {
    const [ex, ey] = t.geometry.coordinates;
    const w = epsgToWorld(ex, ey, offset);
    const hit = hitsInSets({ x: w.x, y: 200, z: w.z }, down, sets, 500)[0];
    return (hit?.target as { cone?: boolean } | undefined)?.cone === true;
  });
  expect(cone).toEqual([false, true, false, false]);
});

test("a fountain basin and the monuments are askable where they stand", () => {
  const monuments = read<MonumentFeature>("monuments");
  const items = monumentItems(monuments, ctx);
  expect(items).toHaveLength(monuments.length);
  const named = items.find(
    (m) => m.target.kind === "monument" && m.target.properties.name
  );
  expect(named).toBeDefined();
  const [ex, ey] =
    named?.target.kind === "monument" ? named.target.position : [0, 0];
  const w = epsgToWorld(ex, ey, offset);
  const hit = nearestItem({ x: w.x, y: 150, z: w.z }, down, items, 500);
  expect(hit?.target).toBe(named?.target);
});

test("a bridge is met on its deck, not in the air over its ends", () => {
  const bridges = read<BridgeFeature>("bridge");
  const items = bridgeItems(bridges, ctx);
  const albert = items.find(
    (b) =>
      b.target.kind === "bridge" && b.target.properties.name === "Albertbrücke"
  );
  expect(albert).toBeDefined();
  if (albert?.target.kind !== "bridge") {
    return;
  }
  expect(albert.target.length).toBeGreaterThan(100);
  const props = albert.target.properties;
  const [ax, ay] = props.axis?.[0] ?? [0, 0];
  const [bx, by] = props.axis?.at(-1) ?? [0, 0];
  // the middle of the deck: met from above near the measured top
  const mid = epsgToWorld((ax + bx) / 2, (ay + by) / 2, offset);
  const hit = nearestItem({ x: mid.x, y: 200, z: mid.z }, down, [albert], 500);
  const top = Math.max(...(props.line ?? [0]));
  expect(hit).not.toBeNull();
  expect(200 - (hit?.distance ?? 0)).toBeGreaterThan(top - 3);
  expect(200 - (hit?.distance ?? 0)).toBeLessThan(top + 1.5);
  // level with the arch's crown, a ray along the deck over its low end
  // passes over it until the deck rises to meet it
  const end = epsgToWorld(ax, ay, offset);
  const along = { x: mid.x - end.x, y: 0, z: mid.z - end.z };
  const len = Math.hypot(along.x, along.z);
  const lowEnd = props.line?.[0] ?? 0;
  const ray = nearestItem(
    { x: end.x, y: lowEnd + 2.6, z: end.z },
    { x: along.x / len, y: 0, z: along.z / len },
    [albert],
    500
  );
  expect(ray === null || (ray.distance ?? 0) > 5).toBe(true);
});

/** The lowest a solid reaches. */
function solidBottom(s: AskSolid): number {
  if ("cylinder" in s) {
    return s.cylinder.y0;
  }
  return "prism" in s ? s.prism.y0 : s.slab.y0;
}
const bottom = (solids: readonly AskSolid[]) =>
  Math.min(...solids.map(solidBottom));

const point = (dx: number): [number, number] => [412_500 + dx, 5_656_500];
const geometry = (dx: number) => ({
  type: "Point" as const,
  coordinates: point(dx),
});

test("a lamp, a bench and a canopy tree stand on the tile's own ground, a monument on every terrain's", () => {
  // near a seam the two grounds differ: the tile's own terrain (50) and
  // every loaded terrain's (110)
  const grounds = { ...ctx, treeHeightAt: () => 50 };
  const canopy: CanopyFeature = {
    geometry: geometry(0),
    properties: { h: 18 },
  };
  const lamp: LampFeature = { geometry: geometry(20), properties: {} };
  const bench: FurnitureFeature = {
    geometry: geometry(40),
    properties: { k: "bench" },
  };
  const monument: MonumentFeature = {
    geometry: geometry(60),
    properties: { kind: "statue", source: "osm" },
  };
  const sets = moreSets(
    {
      canopy: [canopy],
      scan: [],
      rows: [],
      hedges: [],
      lamps: [lamp],
      furniture: [bench],
      trams: [],
      river: [],
    },
    grounds
  );
  const at = (dx: number) => {
    const [x, y] = point(dx);
    const w = epsgToWorld(x, y, offset);
    return hitsInSets({ x: w.x, y: 300, z: w.z }, down, sets, 1000)[0];
  };
  for (const [dx, kind] of [
    [0, "canopy"],
    [20, "lamp"],
    [40, "furniture"],
  ] as const) {
    const hit = at(dx);
    expect(hit?.target.kind).toBe(kind);
    expect(bottom(hit?.solids ?? [])).toBeGreaterThan(49);
    expect(bottom(hit?.solids ?? [])).toBeLessThan(51);
  }
  const [item] = monumentItems([monument], grounds);
  expect(bottom(item.solids)).toBeGreaterThan(109);
  expect(bottom(item.solids)).toBeLessThan(111);
});
