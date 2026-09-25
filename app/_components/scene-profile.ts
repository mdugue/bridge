/**
 * Scene profile and render budget — how much world the viewer builds and how
 * expensive each frame is allowed to be.
 *
 * `full` is the product: the whole site streams (lib/city/tileset.ts), a
 * 3072² shadow map and Medium-quality SSAO. `lite` exists for the headless
 * e2e suite, where every frame is rasterized on the CPU by SwiftShader: it
 * streams the spawn tile only, shrinks the shadow map, halves the render
 * scale and runs N8AO in its Performance mode — the four knobs that actually
 * cost seconds a frame there. Everything a test asserts on — the loaders, the
 * layer construction, the shader programs of every style, the HUD wiring —
 * is identical in both profiles. Measured on two cores: a clay frame drops
 * from ~4 s to well under one, and boot from ~14 s to ~5 s.
 *
 * Opt in with `?scene=lite`. The default is always `full`, so nothing about a
 * normal visit changes.
 *
 * Orthogonal to the profile is the **device tier**: a phone (coarse pointer,
 * no hover) shares one memory pool between CPU and GPU and Safari kills the
 * tab well under 1.5 GB, so it gets a 2048² shadow map, a 1.5 pixel-ratio
 * cap, the 2048² land-cover rasters and a smaller cache for tiles out of
 * view (`tileCacheBytesFor`). Same world, same shaders — only fill,
 * shadow texels and texture memory shrink; AO quality follows the profile,
 * not the tier.
 *
 * Both are read from the page ONCE (`currentSceneBudget`, in
 * city-walk-client.tsx) and handed down as a `SceneBudget`: the renderer, the
 * sun rig, the post stack and the tile loader take the number they need from
 * it instead of reading the window themselves.
 */

export type SceneProfile = "full" | "lite";

export type DeviceTier = "desktop" | "mobile";

/** The N8AO quality modes this scene uses (the pass also knows Low/High/Ultra). */
export type AoQuality = "Medium" | "Performance";

export interface SceneBudget {
  /** phones take the 2048² land-cover rasters (lib/city/tile.ts, MOBILE_RASTER_PX) */
  lowRasters: boolean;
  /** whether the rest of the site streams: always in `full`, in `lite` only with `?block=1` */
  neighbourTiles: boolean;
  profile: SceneProfile;
  tier: DeviceTier;
}

/** Parses the profile out of a `location.search` string. Pure, for tests. */
export function sceneProfileFromSearch(search: string): SceneProfile {
  return new URLSearchParams(search).get("scene") === "lite" ? "lite" : "full";
}

/**
 * `?scene=lite&block=1` streams the whole site in the lite profile — a QA
 * knob for exercising the tile streaming (tile-stream.ts) headless,
 * where the full profile's shadow map and pixel count are unaffordable. Pure.
 */
export function liteKeepsBlockFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("block") === "1";
}

/** The media query that marks a touch-first device (also drives the touch HUD). */
export const MOBILE_MEDIA_QUERY = "(pointer: coarse) and (hover: none)";

/** Pure mapping from the media-query result, for tests. */
export function deviceTierFromMedia(coarseNoHover: boolean): DeviceTier {
  return coarseNoHover ? "mobile" : "desktop";
}

/** Pure: the budget for a page's `location.search` and its media-query result. */
export function sceneBudgetFor(
  search: string,
  coarseNoHover: boolean
): SceneBudget {
  const profile = sceneProfileFromSearch(search);
  const tier = deviceTierFromMedia(coarseNoHover);
  return {
    profile,
    tier,
    neighbourTiles: profile === "full" || liteKeepsBlockFromSearch(search),
    lowRasters: tier === "mobile",
  };
}

/**
 * The budget of the page this runs in. Safe during SSR (the full desktop
 * budget); read it once inside the browser-only startup path, never during
 * render, so the server and client markup can't disagree.
 */
export function currentSceneBudget(): SceneBudget {
  if (typeof window === "undefined") {
    return sceneBudgetFor("", false);
  }
  return sceneBudgetFor(
    window.location.search,
    window.matchMedia(MOBILE_MEDIA_QUERY).matches
  );
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

const MB = 1024 * 1024;
const GB = 1024 * MB;

/**
 * How much tile content (decoded geometry and textures) the tile renderer
 * keeps around, in bytes: it starts unloading tiles no longer in use past
 * `max` and stops at `min`. Tiles in use are never unloaded, so this bounds
 * only what lingers after the camera moves on. 3DTilesRendererJS's default,
 * 0.3–0.4 GB, is kept on the desktop. On a phone that much lingering
 * content, plus the dressing of the tiles still in view, took the tab past
 * what Safari allows: jumping from the start straight into the Dresdner
 * Heide by the minimap kept the whole start area loaded while two forest
 * tiles arrived, and the page died.
 */
export function tileCacheBytesFor(tier: DeviceTier): {
  max: number;
  min: number;
} {
  return tier === "mobile"
    ? { min: 120 * MB, max: 180 * MB }
    : { min: 0.3 * GB, max: 0.4 * GB };
}

/**
 * SSAO quality for a profile: headless SwiftShader cannot afford the product's
 * sample count. Keyed on the profile, not `navigator.webdriver` — Playwright
 * sets that flag in the `--headed` shot harness too, which must render the
 * product's AO.
 */
export function aoQualityFor(profile: SceneProfile): AoQuality {
  return profile === "lite" ? "Performance" : "Medium";
}
