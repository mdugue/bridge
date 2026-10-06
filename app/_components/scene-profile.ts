/**
 * Scene profile and render budget — how much world the viewer builds and how
 * expensive each frame is allowed to be.
 *
 * `full` is the product: the whole site streams (lib/city/tileset.ts), a
 * 3072² shadow map and 16-sample contact shadows (GTAO). `lite` exists for
 * the headless e2e suite, where every frame is rasterized on the CPU by
 * SwiftShader: it streams the spawn tile only, shrinks the shadow map, halves
 * the render scale and halves the GTAO samples — the four knobs that
 * actually cost seconds a frame there. Everything a test asserts on — the
 * loaders, the layer construction, the node materials of every layer, the
 * HUD wiring — is identical in both profiles. Measured on two cores: a clay frame drops
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
 * Orthogonal to both is the device's **safety level** (0–3,
 * lib/city/gpu-safety.ts): how often it has lately run out of GPU memory.
 * Each level lowers the pixel-ratio cap, the shadow map and the tile cache
 * a step; level 0 is the page as it always was.
 *
 * All three are read from the page ONCE (`currentSceneBudget`, in
 * city-walk-client.tsx) and handed down as a `SceneBudget`: the renderer, the
 * sun rig, the post stack and the tile loader take the number they need from
 * it instead of reading the window themselves.
 */

import type { SafetyLevel } from "@/lib/city/gpu-safety";

export type SceneProfile = "full" | "lite";

export type DeviceTier = "desktop" | "mobile";

export interface SceneBudget {
  /**
   * `?gpu=webgl2`: WebGPURenderer on its WebGL2 backend even where WebGPU
   * is available — what a browser without WebGPU gets, for QA and for
   * comparing the two backends on one machine. Off by default.
   */
  forceWebGL: boolean;
  /** phones take the 2048² land-cover rasters (lib/city/tile.ts, MOBILE_RASTER_PX) */
  lowRasters: boolean;
  /** whether the rest of the site streams: always in `full`, in `lite` only with `?block=1` */
  neighbourTiles: boolean;
  profile: SceneProfile;
  /**
   * The device's safety level (lib/city/gpu-safety.ts, kept in the
   * browser by app/_components/gpu-safety.ts): 0 unless it ran out of GPU
   * memory lately, then a lighter page per level.
   */
  safety: SafetyLevel;
  tier: DeviceTier;
}

/** Parses the profile out of a `location.search` string. Pure, for tests. */
export function sceneProfileFromSearch(search: string): SceneProfile {
  return new URLSearchParams(search).get("scene") === "lite" ? "lite" : "full";
}

/** `?gpu=webgl2` forces the renderer's WebGL2 backend. Pure. */
export function forceWebGLFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("gpu") === "webgl2";
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

/**
 * Pure: the budget for a page's `location.search`, its media-query result
 * and the device's safety level (app/_components/gpu-safety.ts).
 */
export function sceneBudgetFor(
  search: string,
  coarseNoHover: boolean,
  safety: SafetyLevel = 0
): SceneBudget {
  const profile = sceneProfileFromSearch(search);
  const tier = deviceTierFromMedia(coarseNoHover);
  return {
    forceWebGL: forceWebGLFromSearch(search),
    profile,
    safety,
    tier,
    neighbourTiles: profile === "full" || liteKeepsBlockFromSearch(search),
    lowRasters: tier === "mobile",
  };
}

/**
 * The budget of the page this runs in, at the device's safety level.
 * Safe during SSR (the full desktop budget); read it once inside the
 * browser-only startup path, never during render, so the server and client
 * markup can't disagree.
 */
export function currentSceneBudget(safety: SafetyLevel = 0): SceneBudget {
  if (typeof window === "undefined") {
    return sceneBudgetFor("", false);
  }
  return sceneBudgetFor(
    window.location.search,
    window.matchMedia(MOBILE_MEDIA_QUERY).matches,
    safety
  );
}

/** The shadow map's edge per safety level (0–3), per tier. */
const SHADOW_MAP_SIZE: Record<DeviceTier, readonly number[]> = {
  desktop: [3072, 2048, 2048, 1024],
  mobile: [2048, 2048, 1024, 1024],
};

/**
 * Shadow-map resolution for a profile + tier at a safety level (see
 * sun-rig.ts for the recipe).
 */
export function shadowMapSizeFor(
  profile: SceneProfile,
  tier: DeviceTier = "desktop",
  safety: SafetyLevel = 0
): number {
  // 512² is a ~36x cheaper depth pass than 3072². The shadows look coarse,
  // which is fine: the headless suite asserts that shadows are ENABLED and
  // that the depth pass runs without error, never how soft an edge is (that
  // is what the --headed snapshot harness on a real GPU is for).
  if (profile === "lite") {
    return 512;
  }
  // A phone's shadow map is a quarter of the desktop's texels and a quarter
  // of the per-frame depth fill; the soft PCF radius hides the coarser
  // texel over the 110 m frustum. The map is a depth texture and a one-byte
  // colour target (`shadowMapBytesFor`): 20 MiB at 2048², 5 MiB at 1024².
  return SHADOW_MAP_SIZE[tier][safety];
}

/** The pixel-ratio cap per safety level (0–3), per tier. */
const PIXEL_RATIO_CAP: Record<DeviceTier, readonly number[]> = {
  desktop: [2, 1.5, 1.25, 1],
  mobile: [1.5, 1.25, 1, 0.85],
};

/**
 * Render pixel ratio for a profile + tier at a safety level. `lite`
 * renders at half linear resolution (a quarter of the pixels) and lets the
 * browser upscale — the only honest way to cut fill-rate in the headless
 * suite, where every pixel is shaded on the CPU. A phone is capped at 1.5
 * (its 3x panel would otherwise push the post stack's screen buffers past
 * what fits), and lower per safety level: the screen targets cost ~76
 * bytes per drawn pixel, 57 MiB at 1.5 on a 402×874 iPhone, 25 at 1.0.
 */
export function pixelRatioFor(
  profile: SceneProfile,
  tier: DeviceTier,
  devicePixelRatio: number,
  safety: SafetyLevel = 0
): number {
  if (profile === "lite") {
    return 0.5;
  }
  return Math.min(devicePixelRatio, PIXEL_RATIO_CAP[tier][safety]);
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

/**
 * The largest tile as the tile renderer's cache weighs it: a fine terrain
 * level — its glTF as the renderer estimates it (12.3 MB at the start tile,
 * 15 MB of decoded arrays; ~25 MB for the densest), the rasters its
 * terrain holds (tile-stream.ts `calculateBytesUsed`, the shared ones in
 * shares: whole once the coarse level has gone) and its dressing's
 * geometry (≲ 20 MB, the trees' instances most of it), with headroom. On
 * the desktop the rasters are the 4096² class raster and the splat painted
 * from it and the 8192-wide surface, sports and markings rasters (~160 MB).
 * On a phone they are 75.7 MiB: the 2048² class raster, its splat with its
 * mips, NDVI, sky view, horizon and sports grounds (45.7, shared with the
 * coarse level), and the level's own surface, edges, markings and
 * allotments (30). See `tileCacheBytesFor`.
 */
export const LARGEST_TILE_BYTES: Readonly<Record<DeviceTier, number>> = {
  desktop: 260 * MB,
  mobile: 128 * MB,
};

/**
 * The tile cache's bounds per safety level (0–3), per tier; on a phone
 * derived for the soft line of the memory governor (see below).
 */
const TILE_CACHE_BYTES: Record<
  DeviceTier,
  readonly { max: number; min: number }[]
> = {
  desktop: [
    { min: 1.2 * GB, max: 1.6 * GB },
    { min: 1 * GB, max: 1.4 * GB },
    { min: 0.8 * GB, max: 1.2 * GB },
    { min: 0.6 * GB, max: 1 * GB },
  ],
  mobile: [
    { min: 168 * MB, max: 336 * MB },
    { min: 148 * MB, max: 296 * MB },
    { min: 136 * MB, max: 272 * MB },
    { min: 96 * MB, max: 232 * MB },
  ],
};

/**
 * How much tile content the tile renderer keeps, in bytes, weighed as the
 * GPU holds it: the glTF, and the rasters and dressing the tile stream
 * adds (tile-stream.ts `calculateBytesUsed`). Past `max` it unloads tiles
 * no longer in use, down to `min`, and it asks for no new tile while at or
 * above `max` — so `max` bounds the GPU memory of the tiles, give or take
 * those in flight (which weigh nothing until they land). Before the
 * rasters counted, a phone's cache sat at 173 MB of its 180 while the GPU
 * held 865 MB, and Safari's next buffer failed to allocate (the render
 * stopped); flying to the Dresdner Heide by the minimap had killed the
 * page the same way.
 *
 * A phone's `max` is what fits under the memory governor's soft line
 * (lib/city/memory-governor.ts, lower per safety level) once the rest of
 * what three counts is there: soft − fixed − 100 MiB. Fixed are the screen
 * targets of the phone's post profile (`postProfileFor`: no lens blur, no
 * SMAA targets — 24 bytes per drawn pixel covers the scene's colour and
 * depth, the one-byte AO and outline targets and a picture style's own
 * target while one is on: on the 402×874 iPhone 18, 12.5, 8 and 6 MiB at
 * the pixel ratios 1.5, 1.25, 1.0, 0.85 of the four levels) and the
 * shadow map (`shadowMapBytesFor`: 20 MiB at 2048², 5 at 1024²): 38,
 * 32.5, 13 and 11 MiB. The 100 MiB are ~40 for the scene-wide sets (sky,
 * lamp pool, data layers, uniform buffers and shader text) and ~60 of
 * headroom: tiles in flight weigh nothing in the cache, it unloads only
 * past `max` and one tile over, and three counts a tree set's instance
 * matrices once per view. Against 480/432/389/350 MiB of soft line that
 * leaves 342, 299, 276 and 239 MiB: `max` is 336, 296, 272, 232. Until it
 * was derived the
 * phone's `max` was 600 MB, above the governor's own hard line (560): the
 * cache never bound anything before Safari took the GPU away, at 614 MB
 * held.
 *
 * A view that wants more than `max` (every city in the 6 km frustum and
 * its coarse level stay wanted at every governor step) then loads its
 * farthest tiles late, or not until the governor's coarser error target
 * has let fine levels go — what the soft line would force a moment later.
 * The desktop keeps at level 0 what it always kept.
 *
 * `max − min` must exceed the largest tile (LARGEST_TILE_BYTES). The cache
 * never unloads a tile that would take it below `min`, and asks for no new
 * tile while it is at or above `max`: at 120–180 MB a phone that flew to
 * the Alaunpark sat at 181 MB with a 62 MB tile first in line to go —
 * unloading it would have left 119 MB — and never loaded the ground there.
 * The phone's `min` is about half its `max` where that leaves the gap,
 * less further down the ladder, where the governor's floor
 * (memoryFloorFor) lowers it again anyway.
 */
export function tileCacheBytesFor(
  tier: DeviceTier,
  safety: SafetyLevel = 0
): {
  max: number;
  min: number;
} {
  return TILE_CACHE_BYTES[tier][safety];
}

/**
 * GTAO samples for a profile: headless SwiftShader cannot afford the
 * product's sample count. Keyed on the profile, not `navigator.webdriver` —
 * Playwright sets that flag in the `--headed` shot harness too, which must
 * render the product's AO. A construction-time setting: a change of the
 * count rebuilds the pass's material.
 */
export function aoSamplesFor(profile: SceneProfile): number {
  return profile === "lite" ? 8 : 16;
}

/**
 * What the post stack (post-stack.ts) builds and warms on a device tier.
 * Its screen-sized targets live in the GPU process for the whole session
 * and no step of the memory governor can shrink them, so on a phone they
 * are cut to what the picture cannot do without.
 */
export interface PostProfile {
  /**
   * Whether depth of field exists at all. Its pass holds six targets and
   * a full-resolution copy of its input (23 MB at an iPhone's 603×1311
   * drawing buffer) from the first frame, standing still or not — for a
   * lens hint a six-inch screen barely shows. Off: the HUD hides its switch,
   * the look keeps its value.
   */
  dof: boolean;
  /**
   * SMAA (three full-resolution half-float targets and a copy of the frame
   * before it, 24 MB on that iPhone) or FXAA, which needs no target: it
   * runs inside the last pass, on the scene's own colour.
   */
  antialias: "smaa" | "fxaa";
  /**
   * What the idle warm-up after the load prepares: every picture style
   * (their pipelines, their scene dressing), or only the outline of an
   * asked element — on a phone a style builds on its first frame instead
   * of holding its pipelines and dressing for a style most never pick.
   */
  warmStyles: "all" | "outline-only";
  /**
   * Whether the warm-up also compiles Papier's programs for the whole scene
   * (and each landing tile then compiles its own). Not on a phone: those
   * pipelines double what the GPU process holds, and an iPhone tab dies of
   * memory well before a desktop one — there the first Papier frame builds
   * what it draws.
   */
  warmPaper: boolean;
}

/** The post profile of a device tier (see `PostProfile`). */
export function postProfileFor(tier: DeviceTier): PostProfile {
  return tier === "mobile"
    ? {
        dof: false,
        antialias: "fxaa",
        warmStyles: "outline-only",
        warmPaper: false,
      }
    : { dof: true, antialias: "smaa", warmStyles: "all", warmPaper: true };
}

/**
 * GPU bytes of the sun's shadow map for its edge in texels: the depth
 * texture (4 bytes a texel; depth24plus is 32-bit on Apple GPUs) and the
 * one-byte colour target three renders beside it (sun-rig.ts) — no mips.
 */
export function shadowMapBytesFor(size: number): number {
  return size * size * (4 + 1);
}
