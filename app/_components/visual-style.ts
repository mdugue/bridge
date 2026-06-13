import type { Group, Material, Mesh } from "three";
import { MeshPhysicalMaterial, MeshStandardMaterial } from "three";

/**
 * City rendering styles. Picking/demolish read geometry attributes, not
 * materials, so the loader meshes can carry any material we like:
 *  - standard: the loader's per-type CityObjectsMaterial (LoD colors)
 *  - ghost: frosted-glass massing (physical transmission — the backdrop
 *    shows through blurred; EXPENSIVE, re-renders the scene each frame)
 *  - clay: archviz clay with adjustable plain transparency (opaque, cheap)
 */
export type CityStyleId = "standard" | "ghost" | "clay";
export const CITY_STYLE_IDS: CityStyleId[] = ["standard", "ghost", "clay"];

/** Transparency defaults per style (0 = solid, 1 = fully see-through). */
export const DEFAULT_GHOST_TRANSPARENCY = 0.05;
export const DEFAULT_CLAY_TRANSPARENCY = 0;

export interface StyleResources {
  clay: MeshStandardMaterial;
  dispose: () => void;
  ghost: MeshPhysicalMaterial;
}

/** Shared materials, created once per app instance. */
export function createStyleResources(): StyleResources {
  // Frosted glass: `transmission` samples a blurred buffer of the scene
  // BEHIND, so what shows through is stable under camera motion.
  const ghost = new MeshPhysicalMaterial({
    color: 0xdf_e5_e9,
    roughness: 0.8,
    metalness: 0,
    specularIntensity: 0.4,
    transmission: DEFAULT_GHOST_TRANSPARENCY,
    ior: 1.2,
    thickness: 8,
    attenuationColor: 0xb8_c4_cc,
    attenuationDistance: 12,
  });

  const clay = new MeshStandardMaterial({
    color: 0xec_e7_df,
    roughness: 1,
    metalness: 0,
    // Hash-dithered transparency (see setCityTransparency) — opaque-pass
    // compositing keeps occlusion correct on the batched mesh.
    opacity: 1 - DEFAULT_CLAY_TRANSPARENCY,
    alphaHash: DEFAULT_CLAY_TRANSPARENCY > 0,
  });

  // Shared across reloads — disposeObject3D must not free them mid-session.
  ghost.userData.shared = true;
  clay.userData.shared = true;

  return {
    ghost,
    clay,
    dispose: () => {
      ghost.dispose();
      clay.dispose();
    },
  };
}

/**
 * Transparency for the ACTIVE style, 0 (solid) .. 1 (fully see-through).
 *
 * Ghost maps it to frosted transmission (stable, but only the backdrop
 * shows through). Clay uses hash-dithered transparency (`alphaHash`):
 * stochastic coverage composited in the OPAQUE pass with full depth
 * testing, so buildings behind buildings, backsides and roofs all occlude
 * correctly — the batched mesh makes sorted alpha blending impossible.
 *
 * NOTE on needsUpdate: three bakes an OPAQUE define (alpha forced to 1)
 * and the alpha-hash/transmission code paths into the compiled program.
 * Crossing the on/off boundary without flagging needsUpdate leaves the
 * stale program running until something else (e.g. the sun light count
 * changing at sunrise) happens to force a rebuild.
 */
export function setCityTransparency(
  resources: StyleResources,
  style: CityStyleId,
  transparency: number
): void {
  const t = Math.min(Math.max(transparency, 0), 1);
  if (style === "ghost") {
    const wasTransmissive = resources.ghost.transmission > 0;
    resources.ghost.transmission = t;
    if (t > 0 !== wasTransmissive) {
      resources.ghost.needsUpdate = true;
    }
    return;
  }
  if (style === "clay") {
    const clay = resources.clay;
    const wasHashed = clay.alphaHash;
    clay.opacity = 1 - t;
    clay.alphaHash = t > 0;
    clay.transparent = false;
    if (clay.alphaHash !== wasHashed) {
      clay.needsUpdate = true;
    }
  }
}

interface StyledCityMesh extends Mesh {
  isCityObjectMesh?: boolean;
  userData: {
    originalMaterial?: Material | Material[];
  };
}

/**
 * Applies a style to all batched city meshes in the loader group. After a
 * demolish-reload the new meshes start bare, so call this again with the
 * current style.
 */
export function applyCityStyle(
  cityGroup: Group,
  style: CityStyleId,
  resources: StyleResources
): void {
  cityGroup.traverse((obj) => {
    const mesh = obj as StyledCityMesh;
    if (!mesh.isCityObjectMesh) {
      return;
    }
    mesh.userData.originalMaterial ??= mesh.material;
    if (style === "standard") {
      mesh.material = mesh.userData.originalMaterial;
    } else {
      mesh.material = style === "ghost" ? resources.ghost : resources.clay;
    }
  });
}
