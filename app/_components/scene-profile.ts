/**
 * Scene profile — how much world the viewer builds and how expensive each
 * frame is allowed to be.
 *
 * `full` is the product: the primary tile plus its 2x2 neighbour block and a
 * 3072² shadow map. `lite` exists for the headless e2e suite, where every
 * frame is rasterized on the CPU by SwiftShader: it loads the primary tile
 * only and shrinks the shadow map, which is what actually costs seconds a
 * frame there. Everything a test asserts on — the loaders, the layer
 * construction, the shader programs of every style, the HUD wiring — is
 * identical in both profiles; only the amount of geometry and shadow fill
 * changes. Measured on two cores: a clay frame drops from ~4 s to well under
 * one, and boot from ~14 s to ~5 s.
 *
 * Opt in with `?scene=lite`. The default is always `full`, so nothing about a
 * normal visit changes.
 *
 * Orthogonal to the profile is the **device tier**: a phone (coarse pointer,
 * no hover) shares one memory pool between CPU and GPU and Safari kills the
 * tab well under 1.5 GB, so it gets a 2048² shadow map and a 1.5 pixel-ratio
 * cap. Same world, same shaders — only fill and shadow texels shrink.
 */

export type SceneProfile = "full" | "lite";

export type DeviceTier = "desktop" | "mobile";

/** Parses the profile out of a `location.search` string. Pure, for tests. */
export function sceneProfileFromSearch(search: string): SceneProfile {
  return new URLSearchParams(search).get("scene") === "lite" ? "lite" : "full";
}

/**
 * The profile this page was opened with. Safe during SSR (returns `full`);
 * read it inside the browser-only startup path, never during render, so the
 * server and client markup can't disagree.
 */
export function currentSceneProfile(): SceneProfile {
  if (typeof window === "undefined") {
    return "full";
  }
  return sceneProfileFromSearch(window.location.search);
}

/**
 * `?scene=lite&block=1` keeps the neighbour tiles in the lite profile — a QA
 * knob for exercising the tile streaming (loadRest in create-app.ts) headless,
 * where the full profile's shadow map and pixel count are unaffordable. Pure.
 */
export function liteKeepsBlockFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("block") === "1";
}

/** Whether the neighbour tiles load for this page (see liteKeepsBlockFromSearch). */
export function loadsNeighbourTiles(profile: SceneProfile): boolean {
  if (profile === "full") {
    return true;
  }
  return (
    typeof window !== "undefined" &&
    liteKeepsBlockFromSearch(window.location.search)
  );
}

/** The media query that marks a touch-first device (same as use-coarse-pointer). */
export const MOBILE_MEDIA_QUERY = "(pointer: coarse) and (hover: none)";

/** Pure mapping from the media-query result, for tests. */
export function deviceTierFromMedia(coarseNoHover: boolean): DeviceTier {
  return coarseNoHover ? "mobile" : "desktop";
}

/** The tier of the device this page runs on (`desktop` during SSR). */
export function currentDeviceTier(): DeviceTier {
  if (typeof window === "undefined") {
    return "desktop";
  }
  return deviceTierFromMedia(window.matchMedia(MOBILE_MEDIA_QUERY).matches);
}

/** Shadow-map resolution for a profile + tier (see sun-rig.ts for the recipe). */
export function shadowMapSizeFor(
  profile: SceneProfile,
  tier: DeviceTier = "desktop"
): number {
  // 512² is a ~36x cheaper depth pass than 3072². The shadows look coarse,
  // which is fine: the headless suite asserts that shadows are ENABLED and
  // that the depth pass runs without error, never how soft an edge is (that
  // is what the --headed snapshot harness on a real GPU is for).
  if (profile === "lite") {
    return 512;
  }
  // A phone's shadow map is a quarter of the desktop's texels (16 MB instead
  // of 36 MB) and a quarter of the per-frame depth fill; the soft PCF radius
  // hides the coarser texel over the 110 m frustum.
  return tier === "mobile" ? 2048 : 3072;
}

/**
 * Render pixel ratio for a profile + tier. `lite` renders at half linear
 * resolution (a quarter of the pixels) and lets the browser upscale — the
 * only honest way to cut fill-rate in the headless suite, where every pixel
 * is shaded on the CPU. A phone is capped at 1.5 (its 3x panel would
 * otherwise push the post stack's half-float buffers past what fits).
 */
export function pixelRatioFor(
  profile: SceneProfile,
  tier: DeviceTier,
  devicePixelRatio: number
): number {
  if (profile === "lite") {
    return 0.5;
  }
  return Math.min(devicePixelRatio, tier === "mobile" ? 1.5 : 2);
}
