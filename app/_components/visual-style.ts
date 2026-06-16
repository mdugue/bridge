import type { Group, Material, Mesh } from "three";
import { MeshPhysicalMaterial, MeshStandardMaterial } from "three";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";

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

/** Clay facade-detail defaults (0..1). Ground-shade darkens the base; rim is the
 *  Streiflicht silhouette glow; bands are the faint storey contour lines. */
export const DEFAULT_BUILDING_GROUND_SHADE = 0.34;
export const DEFAULT_BUILDING_RIM = 0.6;
export const DEFAULT_BUILDING_BANDS = 0.18;
/** Per-building clay tint mix (0 = flat clay, 1 = full per-building colour). A
 *  middling default already breaks the uniform massing while staying painterly. */
export const DEFAULT_BUILDING_TINT = 0.6;
/** Roof colour mix (terracotta/slate from roofType/Dachneigung). Roofs carry
 *  more colour than walls — they're the strongest readability cue. */
export const DEFAULT_BUILDING_ROOF_TINT = 0.7;
/** Eave (Traufkante) cornice-stroke strength at the wall/roof boundary. */
export const DEFAULT_BUILDING_EAVE = 0.35;
/** Warm dusk interior glow on commercial/public buildings (gated by nightFactor). */
export const DEFAULT_BUILDING_DUSK_GLOW = 0.5;
/** Per-building roughness jitter — subtle matte/sheen variation between houses. */
export const DEFAULT_BUILDING_ROUGHNESS = 0.12;

/** Live uniform refs for the clay facade detail (mutate `.value`, no recompile). */
export interface ClayDetailUniforms {
  uAO: { value: number };
  uBands: { value: number };
  /** dusk interior glow strength (commercial/public) */
  uDuskGlow: { value: number };
  /** eave cornice-stroke strength */
  uEave: { value: number };
  /** night factor 0..1, driven by the sun rig (gates the dusk glow) */
  uNight: { value: number };
  uRim: { value: number };
  /** roof colour mix strength */
  uRoofTint: { value: number };
  /** per-building roughness jitter strength */
  uRough: { value: number };
  uTint: { value: number };
}

export interface StyleResources {
  clay: MeshStandardMaterial;
  /** Live uniforms for the clay Boden-Verlauf + Streiflicht. */
  clayDetail: ClayDetailUniforms;
  dispose: () => void;
  ghost: MeshPhysicalMaterial;
}

/**
 * Procedural facade detail injected into the opaque clay material, keyed to each
 * building's OWN base (the `aBaseZ` attribute written in city-layer) so it works
 * despite buildings standing on terrain at different elevations:
 *  - Farbvariation (uTint): blends each building's own muted clay-family colour
 *    (the per-vertex `aTint` attribute from city-layer) into the flat base so a
 *    dense block stops reading as one uniform mass. Applied FIRST so the shading
 *    below (ground-darken, contour lines) modulates the tinted colour. A missing
 *    `aTint` reads as (0,0,0); we treat that as "no tint" rather than letting it
 *    darken the building to black.
 *  - Boden-Verlauf (uAO): a soft darkening over the lowest ~5 m (ambient-occlusion
 *    surrogate that gives the massing physical contact with the ground).
 *  - Höhenlinien (uBands): thin, crisp horizontal contour strokes every storey
 *    (~3 m), drawn with fwidth for constant on-screen width — the SAME hand-drawn
 *    contour-line language as the terrain, so facades read height/scale without a
 *    heavy "banded" look. Walls only.
 *  - Streiflicht (uRim): a Fresnel rim that separates silhouettes from like-
 *    coloured neighbours. Strength is squared-Fresnel + a healthy multiplier
 *    because the rim competes with ACES tone-mapping and there is no bloom.
 * `aBaseZ`/`position.z` are LOCAL data-frame Z (elevation, pre −90° world spin);
 * normals/positions for the rim are taken in world space via `modelMatrix`.
 * The uniforms are passed by reference so a setter can retune them live.
 */
function addClayDetail(
  material: MeshStandardMaterial,
  uniforms: ClayDetailUniforms,
  heightFog?: HeightFogUniforms
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAO = uniforms.uAO;
    shader.uniforms.uBands = uniforms.uBands;
    shader.uniforms.uRim = uniforms.uRim;
    shader.uniforms.uTint = uniforms.uTint;
    shader.uniforms.uRoofTint = uniforms.uRoofTint;
    shader.uniforms.uEave = uniforms.uEave;
    shader.uniforms.uDuskGlow = uniforms.uDuskGlow;
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uRough = uniforms.uRough;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aBaseZ;\nattribute vec3 aTint;\nattribute vec4 aBuild;\nattribute float aRough;\nvarying float vLocalH;\nvarying vec3 vClayWN;\nvarying vec3 vClayWP;\nvarying vec3 vClayTint;\nvarying vec4 vClayBuild;\nvarying float vClayRough;"
      )
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\n vClayWN = normalize(mat3(modelMatrix) * objectNormal);"
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n vLocalH = position.z - aBaseZ;\n vClayWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\n vClayTint = aTint;\n vClayBuild = aBuild;\n vClayRough = aRough;"
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uAO;\nuniform float uBands;\nuniform float uRim;\nuniform float uTint;\nuniform float uRoofTint;\nuniform float uEave;\nuniform float uDuskGlow;\nuniform float uNight;\nuniform float uRough;\nvarying float vLocalH;\nvarying vec3 vClayWN;\nvarying vec3 vClayWP;\nvarying vec3 vClayTint;\nvarying vec4 vClayBuild;\nvarying float vClayRough;"
      )
      .replace(
        "#include <roughnessmap_fragment>",
        // Materialstreuung: nudge roughness per building so the matte sheen
        // varies house-to-house (clamped to stay matte, no shiny clay).
        "#include <roughnessmap_fragment>\n roughnessFactor = clamp(roughnessFactor + uRough * vClayRough, 0.55, 1.0);"
      )
      .replace(
        "#include <map_fragment>",
        [
          "#include <map_fragment>",
          // Farbvariation: blend in the building's own clay-family colour first,
          // so the shading below modulates it. Roof faces (aBuild.x = 1) carry the
          // roof colour at the roof mix strength, walls the wall colour. A zero
          // aTint = attribute absent → keep the base, don't mix toward black.
          "float clayIsRoof = step(0.5, vClayBuild.x);",
          "float clayTintMix = mix(uTint, uRoofTint, clayIsRoof);",
          "if (dot(vClayTint, vClayTint) > 1e-4) {",
          "  diffuseColor.rgb = mix(diffuseColor.rgb, vClayTint, clayTintMix);",
          "}",
          // Boden-Verlauf: darken the lowest ~5 m above the building's base.
          "float clayH = max(vLocalH, 0.0);",
          "diffuseColor.rgb *= mix(1.0 - 0.55 * uAO, 1.0, smoothstep(0.0, 5.0, clayH));",
          // walls vs near-horizontal faces (roofs/ground), reused below.
          "float clayWall = 1.0 - smoothstep(0.5, 0.7, abs(vClayWN.y));",
          // Höhenlinien: storey contour strokes at the building's OWN storey
          // height (from measuredHeight), fwidth-constant width, walls only.
          "float clayStoreys = clayH / max(vClayBuild.y, 0.5);",
          "float clayLine = 1.0 - min(abs(fract(clayStoreys - 0.5) - 0.5) / max(fwidth(clayStoreys), 1e-4), 1.0);",
          "diffuseColor.rgb *= 1.0 - clayLine * uBands * clayWall;",
          // Traufkante: one soft cornice stroke at the wall/roof boundary (eave).
          "float clayEave = 1.0 - min(abs(clayH - vClayBuild.z) / max(fwidth(clayH) * 2.0, 1e-4), 1.0);",
          "diffuseColor.rgb *= 1.0 - clayEave * uEave * clayWall * 0.6;",
        ].join("\n")
      )
      .replace(
        "#include <emissivemap_fragment>",
        [
          "#include <emissivemap_fragment>",
          // Streiflicht: squared Fresnel rim, warm — strong enough to survive ACES.
          "vec3 clayV = normalize(cameraPosition - vClayWP);",
          "float clayFres = 1.0 - clamp(dot(clayV, vClayWN), 0.0, 1.0);",
          "clayFres *= clayFres;",
          "totalEmissiveRadiance += clayFres * uRim * vec3(1.0, 0.95, 0.8);",
          // Abendlicht: warm interior glow on commercial/public buildings at
          // dusk (aBuild.w = 1), gated by nightFactor, walls only.
          "float clayGlow = vClayBuild.w * uDuskGlow * uNight;",
          "totalEmissiveRadiance += clayGlow * clayWall * vec3(1.0, 0.82, 0.5) * 0.5;",
        ].join("\n")
      );
    if (heightFog) {
      injectHeightFog(shader, heightFog);
    }
  };
}

/** Shared materials, created once per app instance. `night` is a uniform ref
 *  the sun rig mutates (0 = day, 1 = night) to gate the dusk glow live. */
export function createStyleResources(
  heightFog?: HeightFogUniforms,
  night?: { value: number }
): StyleResources {
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
  if (heightFog) {
    ghost.onBeforeCompile = (shader) => injectHeightFog(shader, heightFog);
  }

  const clay = new MeshStandardMaterial({
    color: 0xec_e7_df,
    roughness: 1,
    metalness: 0,
    // Hash-dithered transparency (see setCityTransparency) — opaque-pass
    // compositing keeps occlusion correct on the batched mesh.
    opacity: 1 - DEFAULT_CLAY_TRANSPARENCY,
    alphaHash: DEFAULT_CLAY_TRANSPARENCY > 0,
  });
  const clayDetail: ClayDetailUniforms = {
    uAO: { value: DEFAULT_BUILDING_GROUND_SHADE },
    uBands: { value: DEFAULT_BUILDING_BANDS },
    uRim: { value: DEFAULT_BUILDING_RIM },
    uTint: { value: DEFAULT_BUILDING_TINT },
    uRoofTint: { value: DEFAULT_BUILDING_ROOF_TINT },
    uEave: { value: DEFAULT_BUILDING_EAVE },
    uDuskGlow: { value: DEFAULT_BUILDING_DUSK_GLOW },
    uNight: night ?? { value: 0 },
    uRough: { value: DEFAULT_BUILDING_ROUGHNESS },
  };
  addClayDetail(clay, clayDetail, heightFog);

  // Shared across reloads — disposeObject3D must not free them mid-session.
  ghost.userData.shared = true;
  clay.userData.shared = true;

  return {
    ghost,
    clay,
    clayDetail,
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
