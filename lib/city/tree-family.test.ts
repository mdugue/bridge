import { expect, test } from "bun:test";
import {
  FAMILY_LOOK,
  TREE_FAMILIES,
  TRUNK_BASE,
  familyLook,
  familyOf,
} from "./tree-family";
import { TREE_GENERA } from "./tree-season";

test("every named genus has a family; the generic index has none", () => {
  TREE_GENERA.forEach((name, gn) => {
    expect(familyOf(gn) === "generic").toBe(name === "");
  });
});

test("an evergreen without a genus is a conifer, a deciduous one generic", () => {
  expect(familyOf(0, true)).toBe("conifer");
  expect(familyOf(0)).toBe("generic");
  expect(familyOf(999)).toBe("generic");
  // the genus wins over the archetype's leaf
  expect(familyOf(TREE_GENERA.indexOf("Tilia"), true)).toBe("lime");
});

test("families tell the common street trees apart", () => {
  const look = (g: string) => familyLook(TREE_GENERA.indexOf(g as never));
  // a birch's bark paler than an oak's
  expect(look("Betula").bark).toBeGreaterThan(look("Quercus").bark);
  expect(look("Platanus").summer[2]).toBeGreaterThan(0);
  expect(look("Aesculus").summer[2]).toBeLessThan(0);
});

test("the looks stay in the crown's range", () => {
  for (const f of TREE_FAMILIES) {
    const { summer, bark } = FAMILY_LOOK[f];
    for (const d of summer) {
      expect(Math.abs(d)).toBeLessThanOrEqual(0.08);
    }
    expect(bark).toBeGreaterThanOrEqual(0);
    expect(bark).toBeLessThanOrEqual(0xff_ff_ff);
  }
  expect(FAMILY_LOOK.generic.bark).toBe(TRUNK_BASE);
});
