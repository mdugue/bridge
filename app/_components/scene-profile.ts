/**
 * Scene profile and render budget — how much world the viewer builds and how
 * expensive each frame is allowed to be.
 *
 * `full` is the product: the primary tile plus its 2x2 neighbour block, a
 * 3072² shadow map and Medium-quality SSAO. `lite` exists for the headless
 * e2e suite, where every frame is rasterized on the CPU by SwiftShader: it
 * loads the primary tile only, shrinks the shadow map, halves the render
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
 * cap and the 2048² land-cover rasters. Same world, same shaders — only fill,
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

/**
 * Where the trees come from. `canopy` is the product: DLM tree rows plus the
 * DOM1 canopy points. `kataster` (🧪, `?trees=kataster`) adds the Dresden
 * street-tree cadastre at its surveyed positions, heights, crown widths and
 * archetype shapes (tree-inventory-layer.ts), and drops the row/canopy trees
 * standing inside a cadastre tree's crown.
 */
export type TreeSource = "canopy" | "kataster";

/** The N8AO quality modes this scene uses (the pass also knows Low/High/Ultra). */
export type AoQuality = "Medium" | "Performance";

/**
 * How the ground is meshed. `grid` is the product (the baked heightfield,
 * plus the client-side wall conflation); `tin` is the `?terrain=tin`
 * experiment — the primary tile loads the error-bounded TIN baked from the
 * native 1 m DGM (lib/city/terrain-tin.ts) and the wall ribbons snap to its
 * measured steps instead of burning steps into the ground. Tiles without a
 * TIN keep their grid either way.
 */
export type TerrainMode = "grid" | "tin";

export interface SceneBudget {
  /** phones take the 2048² land-cover rasters (lib/city/tile.ts, MOBILE_RASTER_PX) */
  lowRasters: boolean;
  /** whether the neighbour tiles load: always in `full`, in `lite` only with `?block=1` */
  neighbourTiles: boolean;
  profile: SceneProfile;
  /** `?terrain=tin` opts into the terrain TIN experiment; default `grid` */
  terrain: TerrainMode;
  tier: DeviceTier;
  /** the tree inputs (experimental: `?trees=kataster`) */
  trees: TreeSource;
}

/** Parses the terrain mode out of a `location.search` string. Pure. */
export function terrainModeFromSearch(search: string): TerrainMode {
  return new URLSearchParams(search).get("terrain") === "tin" ? "tin" : "grid";
}

/** Parses the profile out of a `location.search` string. Pure, for tests. */
export function sceneProfileFromSearch(search: string): SceneProfile {
  return new URLSearchParams(search).get("scene") === "lite" ? "lite" : "full";
}

/**
 * `?scene=lite&block=1` keeps the neighbour tiles in the lite profile — a QA
 * knob for exercising the tile streaming (loadRest in create-app.ts) headless,
 * where the full profile's shadow map and pixel count are unaffordable. Pure.
 */
export function liteKeepsBlockFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("block") === "1";
}

/** `?trees=kataster` opts into the tree-cadastre prototype. Pure. */
export function treeSourceFromSearch(search: string): TreeSource {
  return new URLSearchParams(search).get("trees") === "kataster"
    ? "kataster"
    : "canopy";
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
    terrain: terrainModeFromSearch(search),
    trees: treeSourceFromSearch(search),
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

/**
 * SSAO quality for a profile: headless SwiftShader cannot afford the product's
 * sample count. Keyed on the profile, not `navigator.webdriver` — Playwright
 * sets that flag in the `--headed` shot harness too, which must render the
 * product's AO.
 */
export function aoQualityFor(profile: SceneProfile): AoQuality {
  return profile === "lite" ? "Performance" : "Medium";
}
