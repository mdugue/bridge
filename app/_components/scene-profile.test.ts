import { expect, test } from "bun:test";
import {
  aoQualityFor,
  deviceTierFromMedia,
  liteKeepsBlockFromSearch,
  pixelRatioFor,
  sceneBudgetFor,
  sceneProfileFromSearch,
  shadowMapSizeFor,
  treeSourceFromSearch,
  vegExtrasFromSearch,
} from "./scene-profile";

test("sceneProfileFromSearch defaults to the full product scene", () => {
  expect(sceneProfileFromSearch("")).toBe("full");
  expect(sceneProfileFromSearch("?")).toBe("full");
  expect(sceneProfileFromSearch("?foo=bar")).toBe("full");
  // Anything but the exact opt-in value stays on the product scene, so a
  // typo in a test URL can never silently thin out the world under test.
  expect(sceneProfileFromSearch("?scene=")).toBe("full");
  expect(sceneProfileFromSearch("?scene=LITE")).toBe("full");
  expect(sceneProfileFromSearch("?scene=light")).toBe("full");
});

test("sceneProfileFromSearch reads the lite opt-in", () => {
  expect(sceneProfileFromSearch("?scene=lite")).toBe("lite");
  expect(sceneProfileFromSearch("?a=1&scene=lite")).toBe("lite");
  expect(sceneProfileFromSearch("scene=lite")).toBe("lite");
});

test("shadowMapSizeFor keeps the product map and shrinks the lite one", () => {
  expect(shadowMapSizeFor("full")).toBe(3072);
  expect(shadowMapSizeFor("lite")).toBe(512);
});

test("the mobile tier shrinks the shadow map unless lite already did", () => {
  expect(shadowMapSizeFor("full", "mobile")).toBe(2048);
  expect(shadowMapSizeFor("full", "desktop")).toBe(3072);
  expect(shadowMapSizeFor("lite", "mobile")).toBe(512);
});

test("pixelRatioFor caps phones at 1.5, desktops at 2, lite at 0.5", () => {
  expect(pixelRatioFor("full", "desktop", 3)).toBe(2);
  expect(pixelRatioFor("full", "desktop", 1)).toBe(1);
  expect(pixelRatioFor("full", "mobile", 3)).toBe(1.5);
  expect(pixelRatioFor("full", "mobile", 1)).toBe(1);
  expect(pixelRatioFor("lite", "mobile", 3)).toBe(0.5);
});

test("liteKeepsBlockFromSearch reads the block=1 QA knob only", () => {
  expect(liteKeepsBlockFromSearch("?scene=lite&block=1")).toBe(true);
  expect(liteKeepsBlockFromSearch("?scene=lite")).toBe(false);
  expect(liteKeepsBlockFromSearch("?block=true")).toBe(false);
});

test("deviceTierFromMedia maps the coarse-pointer query", () => {
  expect(deviceTierFromMedia(true)).toBe("mobile");
  expect(deviceTierFromMedia(false)).toBe("desktop");
});

test("sceneBudgetFor resolves profile, tier, the neighbour tiles and the rasters in one go", () => {
  expect(sceneBudgetFor("", false)).toEqual({
    profile: "full",
    tier: "desktop",
    neighbourTiles: true,
    lowRasters: false,
    terrain: "grid",
    trees: "canopy",
    vegExtras: { low: false, trees: false },
  });
  expect(sceneBudgetFor("?scene=lite", true)).toEqual({
    profile: "lite",
    tier: "mobile",
    neighbourTiles: false,
    lowRasters: true,
    terrain: "grid",
    trees: "canopy",
    vegExtras: { low: false, trees: false },
  });
  // The terrain TIN is an opt-in experiment; anything else keeps the grid.
  expect(sceneBudgetFor("?terrain=tin", false).terrain).toBe("tin");
  expect(sceneBudgetFor("?terrain=TIN", false).terrain).toBe("grid");
  // The QA knob keeps the block in the lite profile; alone it does nothing.
  expect(sceneBudgetFor("?scene=lite&block=1", false).neighbourTiles).toBe(
    true
  );
  expect(sceneBudgetFor("?block=1", false).neighbourTiles).toBe(true);
});

test("the tree cadastre is opt-in via ?trees=kataster, orthogonal to the profile", () => {
  expect(treeSourceFromSearch("")).toBe("canopy");
  expect(treeSourceFromSearch("?trees=osm")).toBe("canopy");
  expect(treeSourceFromSearch("?trees=kataster")).toBe("kataster");
  expect(sceneBudgetFor("?scene=lite&trees=kataster", false).trees).toBe(
    "kataster"
  );
});

test("the experimental vegetation layers are opt-in via ?veg=", () => {
  expect(vegExtrasFromSearch("")).toEqual({ low: false, trees: false });
  expect(vegExtrasFromSearch("?veg=low")).toEqual({ low: true, trees: false });
  expect(vegExtrasFromSearch("?veg=trees")).toEqual({
    low: false,
    trees: true,
  });
  expect(vegExtrasFromSearch("?scene=lite&veg=low,trees")).toEqual({
    low: true,
    trees: true,
  });
  expect(vegExtrasFromSearch("?veg=all")).toEqual({ low: true, trees: true });
  expect(vegExtrasFromSearch("?veg=lowish")).toEqual({
    low: false,
    trees: false,
  });
});

test("aoQualityFor drops to Performance only in the lite profile", () => {
  expect(aoQualityFor("full")).toBe("Medium");
  expect(aoQualityFor("lite")).toBe("Performance");
});
