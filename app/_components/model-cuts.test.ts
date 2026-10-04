import { expect, test } from "bun:test";
import { createModelCuts } from "./model-cuts";

const cut = (cx: number) => ({
  centre: { x: cx, z: 0 },
  halfRight: 100,
  halfAhead: 100,
  turnDeg: 0,
});

test("an Ausschnitt shows only once revealed, and stays as it moves", () => {
  const cuts = createModelCuts();
  const flat = () => 0;
  const [, plinth] = cuts.objects;
  cuts.setCutOut(cut(0), flat, 1);
  // set but not shown: its programs are still being built
  expect(cuts.cutOut()).not.toBeNull();
  expect(cuts.revealed()).toBe(false);
  expect(cuts.group.enabled).toBe(false);
  expect(plinth.visible).toBe(false);
  cuts.reveal();
  expect(cuts.group.enabled).toBe(true);
  expect(plinth.visible).toBe(true);
  // moved (or the ground changed): the same four planes, still shown
  const planes = cuts.group.clippingPlanes;
  cuts.setCutOut(cut(50), flat, 2);
  expect(cuts.group.enabled).toBe(true);
  expect(cuts.group.clippingPlanes).toBe(planes);
  expect(planes).toHaveLength(4);
  // lifted: a new one waits for its programs again
  cuts.setCutOut(null, flat, 3);
  expect(cuts.group.enabled).toBe(false);
  expect(plinth.visible).toBe(false);
  cuts.setCutOut(cut(0), flat, 4);
  expect(cuts.revealed()).toBe(false);
  cuts.dispose();
});
