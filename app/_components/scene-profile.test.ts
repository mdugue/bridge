import { expect, test } from "bun:test";
import {
  aoSamplesFor,
  deviceTierFromMedia,
  liteKeepsBlockFromSearch,
  pixelRatioFor,
  postProfileFor,
  sceneBudgetFor,
  sceneProfileFromSearch,
  shadowMapBytesFor,
  shadowMapSizeFor,
  LARGEST_TILE_BYTES,
  tileCacheBytesFor,
} from "./scene-profile";
import { SAFETY_LEVELS } from "@/lib/city/gpu-safety";
import { memoryLimitsFor } from "@/lib/city/memory-governor";

const MiB = 1024 ** 2;
const GiB = 1024 * MiB;

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
    forceWebGL: false,
    profile: "full",
    safety: 0,
    tier: "desktop",
    neighbourTiles: true,
    lowRasters: false,
  });
  expect(sceneBudgetFor("?scene=lite", true, 2)).toEqual({
    forceWebGL: false,
    profile: "lite",
    safety: 2,
    tier: "mobile",
    neighbourTiles: false,
    lowRasters: true,
  });
  // The QA knob keeps the block in the lite profile; alone it does nothing.
  expect(sceneBudgetFor("?scene=lite&block=1", false).neighbourTiles).toBe(
    true
  );
  expect(sceneBudgetFor("?block=1", false).neighbourTiles).toBe(true);
  // WebGPU where available; the WebGL2 backend only on request.
  expect(sceneBudgetFor("?gpu=webgl2", false).forceWebGL).toBe(true);
  expect(sceneBudgetFor("?gpu=webgpu", false).forceWebGL).toBe(false);
});

test("aoSamplesFor halves the GTAO samples in the lite profile and on a phone", () => {
  expect(aoSamplesFor("full", "desktop")).toBe(16);
  expect(aoSamplesFor("full", "mobile")).toBe(8);
  expect(aoSamplesFor("lite", "desktop")).toBe(8);
});

test("tileCacheBytesFor keeps less out-of-view content on a phone", () => {
  const phone = tileCacheBytesFor("mobile");
  const desktop = tileCacheBytesFor("desktop");
  expect(phone.min).toBeLessThan(phone.max);
  expect(desktop.min).toBeLessThan(desktop.max);
  expect(phone.max).toBeLessThan(desktop.min);
  // the desktop's page as it always was
  expect(desktop).toEqual({ min: 1.2 * GiB, max: 1.6 * GiB });
});

test("tileCacheBytesFor can always unload the largest tile", () => {
  // The cache keeps a tile whose unloading would take it below `min`, and
  // loads nothing while at `max`: with a narrower gap one big unused tile
  // can hold it just over `max` forever (the Alaunpark never loaded).
  for (const tier of ["mobile", "desktop"] as const) {
    for (const safety of SAFETY_LEVELS) {
      const { min, max } = tileCacheBytesFor(tier, safety);
      expect(max - min).toBeGreaterThan(LARGEST_TILE_BYTES[tier]);
    }
  }
});

test("postProfileFor leaves the costly post work to the desktop", () => {
  const desktop = postProfileFor("desktop");
  const phone = postProfileFor("mobile");
  // the desktop keeps the full picture: lens blur and SMAA; no tier warms
  // the picture styles
  expect(desktop).toEqual({
    dof: true,
    antialias: "smaa",
    warmStyles: "outline-only",
    warmPaper: false,
  });
  // a phone builds no lens blur, antialiases without targets of its own
  // and warms nothing but the outline
  expect(phone).toEqual({
    dof: false,
    antialias: "fxaa",
    warmStyles: "outline-only",
    warmPaper: false,
  });
});

test("shadowMapBytesFor counts the depth map and its one-byte colour target", () => {
  expect(shadowMapBytesFor(shadowMapSizeFor("full", "mobile"))).toBe(
    20 * 1024 ** 2
  );
  expect(shadowMapBytesFor(512)).toBe(512 * 512 * 5);
});

/**
 * What three counts as fixed on the 402×874 iPhone the phone's numbers are
 * derived for: the screen targets of the phone's post profile (24 bytes
 * per drawn pixel covers the scene's colour and depth, the one-byte AO and
 * outline targets, and a picture style's own target while one is on) and
 * the shadow map (depth plus a one-byte colour target).
 */
function phoneFixedBytes(safety: (typeof SAFETY_LEVELS)[number]): number {
  const ratio = pixelRatioFor("full", "mobile", 3, safety);
  const pixels = Math.floor(402 * ratio) * Math.floor(874 * ratio);
  const shadow = shadowMapSizeFor("full", "mobile", safety);
  return pixels * 24 + shadowMapBytesFor(shadow);
}

test("a phone's tile cache fits under the governor's soft line with the rest it holds", () => {
  // Before, the cache's max (600 MB) alone sat above the hard line (560):
  // it never bound anything before Safari took the GPU away at 614 MB.
  for (const safety of SAFETY_LEVELS) {
    const { max } = tileCacheBytesFor("mobile", safety);
    const { soft } = memoryLimitsFor("mobile", safety);
    // 100 MiB for the scene-wide sets and the cache's own overshoot
    expect(max + phoneFixedBytes(safety) + 100 * MiB).toBeLessThanOrEqual(soft);
  }
});

test("every safety level is a lighter page than the one before", () => {
  for (const tier of ["mobile", "desktop"] as const) {
    for (const safety of SAFETY_LEVELS.slice(1)) {
      const lighter = tileCacheBytesFor(tier, safety);
      const before = tileCacheBytesFor(tier, (safety - 1) as 0);
      expect(lighter.max).toBeLessThan(before.max);
      expect(lighter.min).toBeLessThan(before.min);
      expect(pixelRatioFor("full", tier, 3, safety)).toBeLessThan(
        pixelRatioFor("full", tier, 3, (safety - 1) as 0)
      );
      expect(shadowMapSizeFor("full", tier, safety)).toBeLessThanOrEqual(
        shadowMapSizeFor("full", tier, (safety - 1) as 0)
      );
    }
    // the lightest page has a smaller shadow map than the first
    expect(shadowMapSizeFor("full", tier, 3)).toBeLessThan(
      shadowMapSizeFor("full", tier, 0)
    );
  }
  // the lite profile's own numbers hold at every level
  expect(pixelRatioFor("lite", "mobile", 3, 3)).toBe(0.5);
  expect(shadowMapSizeFor("lite", "mobile", 3)).toBe(512);
});
