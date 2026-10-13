import { expect, test } from "bun:test";
import { RIVERSIDE_LOOKS } from "./riverside-layer";

test("the ferry's wake is a faint ink that never casts, over the water", () => {
  const look = RIVERSIDE_LOOKS["riverside-ferry"];
  expect(look.cast).toBe(false);
  expect(look.receive).toBe(false);
  expect(look.renderOrder).toBe(3);
  const ink = look.material();
  expect(ink.isNodeMaterial).toBe(true);
  expect(ink.userData.shared).toBe(true);
  expect(ink.transparent).toBe(true);
  expect(ink.depthWrite).toBe(false);
  expect(ink.opacityNode).not.toBeNull();
});

test("the piers, pontoons and groynes cast; piles and posts in their own material", () => {
  for (const name of [
    "riverside-pier",
    "riverside-hull",
    "riverside-pontoon-deck",
    "riverside-hut",
    "riverside-roof",
    "riverside-gangway",
    "riverside-railing",
    "riverside-groyne",
    "riverside-piles",
    "riverside-posts",
  ] as const) {
    expect(RIVERSIDE_LOOKS[name].cast).toBe(true);
  }
  const piles = RIVERSIDE_LOOKS["riverside-piles"].material();
  // the instanced material it was, which draws a merged mesh as it is
  expect(piles.positionNode).not.toBeNull();
  expect(piles.userData.shared).toBe(true);
});
