import { expect, test } from "bun:test";
import {
  deviceTierFromMedia,
  pixelRatioFor,
  sceneProfileFromSearch,
  shadowMapSizeFor,
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

test("deviceTierFromMedia maps the coarse-pointer query", () => {
  expect(deviceTierFromMedia(true)).toBe("mobile");
  expect(deviceTierFromMedia(false)).toBe("desktop");
});
