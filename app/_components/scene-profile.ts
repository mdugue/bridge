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
 */

export type SceneProfile = "full" | "lite";

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

/** Shadow-map resolution for a profile (see sun-rig.ts for the full recipe). */
export function shadowMapSizeFor(profile: SceneProfile): number {
  // 512² is a ~36x cheaper depth pass than 3072². The shadows look coarse,
  // which is fine: the headless suite asserts that shadows are ENABLED and
  // that the depth pass runs without error, never how soft an edge is (that
  // is what the --headed snapshot harness on a real GPU is for).
  return profile === "lite" ? 512 : 3072;
}
