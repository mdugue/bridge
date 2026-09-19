import { expect, test } from "bun:test";
import { sceneProfileFromSearch, shadowMapSizeFor } from "./scene-profile";

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
