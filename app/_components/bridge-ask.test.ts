import { expect, test } from "bun:test";
import { BoxGeometry, Group, Mesh } from "three/webgpu";
import type { AskItem, Slab } from "@/lib/city/ask-solids";
import type { FeatureInquiry } from "@/lib/city/inquiry-features";
import { bridgeAskSet } from "./bridge-ask";
import { buildBvhOffThread } from "./bvh-client";
// the BVH the set builds on its first question (collision.ts patches it in)
import "./collision";

// a deck 40 m long over x 0…40, its top at 10 m
const slab: Slab = {
  ring: [
    [0, -4],
    [40, -4],
    [40, 4],
    [0, 4],
  ],
  y0: 8.7,
  y1: 11.3,
  above: 1.3,
  below: 1.3,
  topAt: () => 10,
};
const deck = {
  solids: [{ slab }],
  target: { kind: "bridge" },
} as unknown as AskItem<FeatureInquiry>;

const bridge = () => {
  const rail = new Group();
  const mesh = new Mesh(new BoxGeometry(40, 1, 8));
  mesh.position.set(20, 9.5, 0);
  mesh.userData.bridge = true;
  rail.add(mesh);
  rail.updateMatrixWorld(true);
  return { rail, mesh };
};

const down = { x: 0, y: -1, z: 0 };

test("asked first by the autofocus, a bridge has the worker build its BVH", async () => {
  const { rail, mesh } = bridge();
  const set = bridgeAskSet(rail, [deck]);
  // unbuilt: passed by, and its build sent off the thread
  expect(set?.unbuilt?.()).toBe(true);
  await buildBvhOffThread(mesh.geometry);
  expect(set?.unbuilt?.()).toBe(false);
  // then the drawn bridge answers, named by its deck
  expect(set?.nearest({ x: 20, y: 20, z: 0 }, down, 100)?.distance).toBeCloseTo(
    10,
    5
  );
});

test("asked first by a question, a bridge builds its BVH at once", () => {
  const { rail, mesh } = bridge();
  const set = bridgeAskSet(rail, [deck]);
  expect(set?.nearest({ x: 20, y: 20, z: 0 }, down, 100)?.distance).toBeCloseTo(
    10,
    5
  );
  expect(mesh.geometry.boundsTree).toBeDefined();
});
