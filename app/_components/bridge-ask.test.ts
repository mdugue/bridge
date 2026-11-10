import { expect, test } from "bun:test";
import { BoxGeometry, Group, Mesh } from "three/webgpu";
import type { AskItem, Slab } from "@/lib/city/ask-solids";
import type { FeatureInquiry } from "@/lib/city/inquiry-features";
import { bridgeAskSet } from "./bridge-ask";
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
const east = { x: 1, y: 0, z: 0 };

test("before its BVH a bridge answers by its deck, then by what is drawn", () => {
  const { rail, mesh } = bridge();
  const set = bridgeAskSet(rail, [deck]);
  expect(set?.unbuilt?.()).toBe(true);
  // from above, down onto the deck's top
  expect(set?.rough?.({ x: 20, y: 20, z: 0 }, down, 100)?.distance).toBeCloseTo(
    10,
    0
  );
  // level, from the bank: into the deck under its top, not the band over it
  expect(
    set?.rough?.({ x: -5, y: 9.5, z: 0 }, east, 100)?.distance
  ).toBeCloseTo(5, 0);
  expect(set?.rough?.({ x: -5, y: 10.8, z: 0 }, east, 100)).toBeNull();
  // a question builds the BVH; then the drawn bridge answers
  expect(set?.nearest({ x: 20, y: 20, z: 0 }, down, 100)?.distance).toBeCloseTo(
    10,
    5
  );
  expect(mesh.geometry.boundsTree).toBeDefined();
  expect(set?.unbuilt?.()).toBe(false);
});
