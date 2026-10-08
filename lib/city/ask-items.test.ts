import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bridgeItems, monumentItems, treeSets } from "./ask-items";
import { nearestInSets, nearestItem } from "./ask-solids";
import type {
  BridgeFeature,
  FeatureCollection,
  MonumentFeature,
  TreeFeature,
} from "./features";
import { epsgToWorld } from "./ground-clamp";

const TILE = "33412_5656_2_sn";
const read = <F>(kind: string) =>
  (
    JSON.parse(
      readFileSync(
        join(
          import.meta.dir,
          "..",
          "..",
          "data",
          "dresden",
          "dlm",
          `${kind}_${TILE}.geojson`
        ),
        "utf8"
      )
    ) as FeatureCollection<F>
  ).features ?? [];

const offset = { cx: 412000, cy: 5656000 };
const ctx = { offset, tile: TILE, heightAt: () => 110 };
const down = { x: 0, y: -1, z: 0 };

test("every tree of the file is askable, by its index there", () => {
  const trees = read<TreeFeature>("trees");
  const sets = treeSets(trees, ctx);
  const i = 1234;
  const [ex, ey] = trees[i].geometry.coordinates;
  const w = epsgToWorld(ex, ey, offset);
  const hit = nearestInSets({ x: w.x, y: 200, z: w.z }, down, sets, 500);
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
  const hit = nearestInSets({ x: w.x, y: 200, z: w.z }, down, sets, 500);
  expect(hit?.target).toMatchObject({
    kind: "tree",
    index: trees.length,
    orchard: true,
  });
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
