import { type DataTexture, MeshStandardMaterial } from "three";
import { OBJECT_TEXTURE_WIDTH } from "@/lib/city/city-mesh";
import {
  type ClayLookKey,
  LOOK_DEFAULTS,
  type LookValues,
} from "@/lib/city/look-controls";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";
import { DATA_POSITION } from "./shader-chunks";

/**
 * The city is rendered in one style: archviz clay — opaque, cheap, and the
 * carrier for all the facade detail below. Picking/demolish read geometry
 * attributes, not materials, so swapping the loader's own per-type material
 * for the shared clay one costs nothing but the swap.
 *
 * Two earlier styles were dropped: "standard" (the loader's LoD colours) and
 * "ghost" (MeshPhysicalMaterial transmission — frosted massing, but it
 * re-rendered the whole scene into a transmission buffer every frame).
 */

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
  /** roof vividness (Dachsättigung): hue-preserving chroma boost on DOP colour */
  uRoofVibrance: { value: number };
  /** per-building roughness jitter strength */
  uRough: { value: number };
  uTint: { value: number };
}

/**
 * What every tile's clay material shares: the live facade uniforms, the
 * height fog, and the material settings the look drives. Each tile's
 * buildings get their own material (it binds that tile's object table) —
 * the program is shared, three caches it by the material's key.
 */
export interface StyleResources {
  /** Live uniforms for the clay Boden-Verlauf + Streiflicht. */
  clayDetail: ClayDetailUniforms;
  /** every live clay material, for the look (transparency) fan-out */
  materials: Set<MeshStandardMaterial>;
  heightFog?: HeightFogUniforms;
  /** the current transparency, applied to materials created later too */
  transparency: number;
}

/**
 * Procedural facade detail injected into the opaque clay material, keyed to each
 * building's OWN base (its row of the object table, lib/city/city-mesh.ts —
 * read per vertex from `uObjects` by the `featureId` attribute) so it works
 * despite buildings standing on terrain at different elevations:
 *  - Farbvariation (uTint): blends each building's own muted clay-family colour
 *    into the flat base so a dense block stops reading as one uniform mass.
 *    Applied FIRST so the shading below (ground-darken, contour lines)
 *    modulates the tinted colour. A zero tint reads as "no tint" rather than
 *    darkening the building to black.
 *  - Boden-Verlauf (uAO): a soft darkening over the lowest ~5 m (ambient-occlusion
 *    surrogate that gives the massing physical contact with the ground).
 *  - Höhenlinien (uBands): thin, crisp horizontal contour strokes every storey
 *    (~3 m), drawn with fwidth for constant on-screen width — the SAME hand-drawn
 *    contour-line language as the terrain, so facades read height/scale without a
 *    heavy "banded" look. Walls only.
 *  - Streiflicht (uRim): a Fresnel rim that separates silhouettes from like-
 *    coloured neighbours. Strength is squared-Fresnel + a healthy multiplier
 *    because the rim competes with ACES tone-mapping and there is no bloom.
 * Heights come from world space (world Y is elevation), normals/positions
 * for the rim too, via `modelMatrix`. The uniforms are passed by reference
 * so a setter can retune them live.
 */
function addClayDetail(
  material: MeshStandardMaterial,
  uniforms: ClayDetailUniforms,
  objects: { rows: number; texture: DataTexture },
  heightFog?: HeightFogUniforms
): void {
  // The closure branches on `heightFog`, but three keys its program cache on
  // `onBeforeCompile.toString()` — identical either way. Name the branch.
  material.customProgramCacheKey = () => `clay-${heightFog !== undefined}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uObjects = { value: objects.texture };
    shader.uniforms.uObjectRows = { value: objects.rows };
    shader.uniforms.uAO = uniforms.uAO;
    shader.uniforms.uBands = uniforms.uBands;
    shader.uniforms.uRim = uniforms.uRim;
    shader.uniforms.uTint = uniforms.uTint;
    shader.uniforms.uRoofTint = uniforms.uRoofTint;
    shader.uniforms.uRoofVibrance = uniforms.uRoofVibrance;
    shader.uniforms.uEave = uniforms.uEave;
    shader.uniforms.uDuskGlow = uniforms.uDuskGlow;
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uRough = uniforms.uRough;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float featureId;\nattribute float roof;\nuniform highp sampler2D uObjects;\nuniform int uObjectRows;\nvarying float vLocalH;\nvarying vec3 vClayWN;\nvarying vec3 vClayWP;\nvarying vec3 vClayTint;\nvarying vec4 vClayBuild;\nvarying float vClayRough;"
      )
      .replace(
        "#include <beginnormal_vertex>",
        // A triangle that was degenerate when its flat normal was baked has a
        // zero normal, and position quantisation can give it area again: it
        // then rasterises with normalize(0) = NaN lighting — single black
        // pixels on roofs that the DoF blur spread into black squares. Any
        // unit vector will do for a sliver that thin.
        "#include <beginnormal_vertex>\n if (dot(objectNormal, objectNormal) < 1e-8) objectNormal = vec3(0.0, 1.0, 0.0);\n vClayWN = normalize(mat3(modelMatrix) * objectNormal);"
      )
      .replace(
        "#include <begin_vertex>",
        [
          "#include <begin_vertex>",
          DATA_POSITION,
          // The object's three texels: (tint, baseZ) (roof, eaveH)
          // (storeyH, glow, rough) — lib/city/city-mesh.ts packObjectTexels.
          `int clayId = int( featureId + 0.5 );`,
          `ivec2 clayAt = ivec2( clayId % ${OBJECT_TEXTURE_WIDTH}, clayId / ${OBJECT_TEXTURE_WIDTH} );`,
          "vec4 clayA = texelFetch( uObjects, clayAt, 0 );",
          "vec4 clayB = texelFetch( uObjects, clayAt + ivec2( 0, uObjectRows ), 0 );",
          "vec4 clayC = texelFetch( uObjects, clayAt + ivec2( 0, 2 * uObjectRows ), 0 );",
          "vLocalH = dataPos.z - clayA.w;",
          "vClayWP = dataWP.xyz;",
          "vClayTint = roof > 0.5 ? clayB.rgb : clayA.rgb;",
          "vClayBuild = vec4( roof, clayC.x, clayB.w, clayC.y );",
          "vClayRough = clayC.z;",
        ].join("\n")
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uAO;\nuniform float uBands;\nuniform float uRim;\nuniform float uTint;\nuniform float uRoofTint;\nuniform float uRoofVibrance;\nuniform float uEave;\nuniform float uDuskGlow;\nuniform float uNight;\nuniform float uRough;\nvarying float vLocalH;\nvarying vec3 vClayWN;\nvarying vec3 vClayWP;\nvarying vec3 vClayTint;\nvarying vec4 vClayBuild;\nvarying float vClayRough;"
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
          // so the shading below modulates it. Roof faces (build.x = 1) carry the
          // roof colour at the roof mix strength, walls the wall colour. A zero
          // tint = no colour known → keep the base, don't mix toward black.
          "float clayIsRoof = step(0.5, vClayBuild.x);",
          "float clayTintMix = mix(uTint, uRoofTint, clayIsRoof);",
          // Dachsättigung (uRoofVibrance): lift the REAL roof colour into a confident
          // watercolour register WITHOUT choosing a target hue — copper-green stays
          // green, terracotta red, slate cool. Hue-preserving chroma boost around
          // the grey axis (vibrance: dull/hazy roofs lifted most, already-vivid
          // ones barely, so nothing blows out), plus a tiny warm nudge on the
          // muddy-grey roofs only (the audited cool haze cast). Roofs only; 0 = raw.
          "float clayRoofL = dot(vClayTint, vec3(0.299, 0.587, 0.114));",
          "vec3 clayRoofC = vClayTint - clayRoofL;",
          "float clayDull = 1.0 - smoothstep(0.04, 0.30, length(clayRoofC));",
          "float clayVib = uRoofVibrance * clayDull;",
          "vec3 clayRoofCol = clayRoofL + clayRoofC * (1.0 + 2.4 * clayVib);",
          "clayRoofCol += vec3(0.018, 0.004, -0.014) * uRoofVibrance * clayDull;",
          "vec3 clayCol = mix(vClayTint, clamp(clayRoofCol, 0.0, 1.0), clayIsRoof);",
          "if (dot(vClayTint, vClayTint) > 1e-4) {",
          "  diffuseColor.rgb = mix(diffuseColor.rgb, clayCol, clayTintMix);",
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
          // dusk (build.w = 1), gated by nightFactor, walls only.
          "float clayGlow = vClayBuild.w * uDuskGlow * uNight;",
          "totalEmissiveRadiance += clayGlow * clayWall * vec3(1.0, 0.82, 0.5) * 0.5;",
        ].join("\n")
      );
    addOsmFacade(shader);
    if (heightFog) {
      injectHeightFog(shader, heightFog);
    }
  };
}

/**
 * What OSM knows about a building (the `flags` float of its third texel,
 * lib/city/city-mesh.ts: shop 1, heritage 2), layered onto the clay after
 * `addClayDetail` has written its chunks — it reuses that block's locals
 * (`clayWall`, `clayH`, `vClayBuild`) and uniforms, and adds no slider:
 *  - Ladenlicht: a warm wash on a shop's ground floor at dusk, under the
 *    first storey line with a soft top edge, walls only, on the dusk-glow
 *    slider × nightFactor. A low-frequency hash along the facade (≈3.5 m
 *    cells) keeps a long front from reading as one strip. No window
 *    structure: the procedural window grid is a recorded veto.
 *  - Denkmal: a barely-there warm lift of a listed facade (on the
 *    Farbvariation slider) and a finer second cornice line under the eave
 *    (on the Traufkante slider).
 * Strengths are conservative defaults, not yet judged on a real GPU.
 */
function addOsmFacade(shader: {
  fragmentShader: string;
  vertexShader: string;
}): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      "varying float vClayRough;",
      "varying float vClayRough;\nvarying float vClayFlags;"
    )
    .replace(
      "vClayRough = clayC.z;",
      "vClayRough = clayC.z;\nvClayFlags = clayC.w;"
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "varying float vClayRough;",
      "varying float vClayRough;\nvarying float vClayFlags;"
    )
    .replace(
      "#include <color_fragment>",
      [
        "#include <color_fragment>",
        "float clayFlags = floor(vClayFlags + 0.5);",
        "float clayShop = mod(clayFlags, 2.0);",
        "float clayListed = mod(floor(clayFlags / 2.0), 2.0);",
        "diffuseColor.rgb *= 1.0 + clayListed * uTint * clayWall * vec3(0.035, 0.012, -0.012);",
        "float clayCornice = 1.0 - min(abs(clayH - (vClayBuild.z - 0.45)) / max(fwidth(clayH), 1e-4), 1.0);",
        "diffuseColor.rgb *= 1.0 - clayCornice * clayListed * step(2.0, vClayBuild.z) * uEave * clayWall * 0.35;",
      ].join("\n")
    )
    .replace(
      "#include <emissivemap_fragment>",
      [
        "#include <emissivemap_fragment>",
        "float clayFloor = 1.0 - smoothstep(0.7, 1.0, clayH / max(vClayBuild.y, 0.5));",
        "vec2 clayAlong = normalize(vec2(-vClayWN.z, vClayWN.x) + 1e-5);",
        "float claySeg = dot(vClayWP.xz, clayAlong) / 3.5;",
        "float clayCell = floor(claySeg);",
        "float clayN0 = fract(sin(clayCell * 12.9898) * 43758.5453);",
        "float clayN1 = fract(sin((clayCell + 1.0) * 12.9898) * 43758.5453);",
        "float clayLit = mix(0.45, 1.0, mix(clayN0, clayN1, smoothstep(0.0, 1.0, fract(claySeg))));",
        "float clayShopGlow = clayShop * clayFloor * clayWall * clayLit * uDuskGlow * uNight;",
        "totalEmissiveRadiance += clayShopGlow * vec3(1.0, 0.78, 0.45) * 0.4;",
      ].join("\n")
    );
}

/** The shared clay state, created once per app instance. `night` is a
 *  uniform ref the sun rig mutates (0 = day, 1 = night) to gate the dusk
 *  glow live. */
export function createStyleResources(
  heightFog?: HeightFogUniforms,
  night?: { value: number }
): StyleResources {
  // Booted at the table defaults; applyCityLook retunes them live.
  const clayDetail: ClayDetailUniforms = {
    uAO: { value: LOOK_DEFAULTS.groundShade },
    uBands: { value: LOOK_DEFAULTS.bands },
    uRim: { value: LOOK_DEFAULTS.rim },
    uTint: { value: LOOK_DEFAULTS.tint },
    uRoofTint: { value: LOOK_DEFAULTS.roofTint },
    uRoofVibrance: { value: LOOK_DEFAULTS.roofVibrance },
    uEave: { value: LOOK_DEFAULTS.eave },
    uDuskGlow: { value: LOOK_DEFAULTS.duskGlow },
    uNight: night ?? { value: 0 },
    uRough: { value: LOOK_DEFAULTS.roughness },
  };
  return {
    clayDetail,
    heightFog,
    materials: new Set(),
    transparency: LOOK_DEFAULTS.transparency,
  };
}

/**
 * One tile's clay material, reading that tile's object table. Registered in
 * `resources.materials` until the tile disposes it.
 */
export function createClayMaterial(
  resources: StyleResources,
  objects: { rows: number; texture: DataTexture }
): MeshStandardMaterial {
  const clay = new MeshStandardMaterial({
    color: 0xec_e7_df,
    roughness: 1,
    metalness: 0,
  });
  addClayDetail(clay, resources.clayDetail, objects, resources.heightFog);
  applyTransparency(clay, resources.transparency);
  resources.materials.add(clay);
  clay.addEventListener("dispose", () => resources.materials.delete(clay));
  return clay;
}

/**
 * Building transparency, 0 (solid) .. 1 (fully see-through).
 *
 * Hash-dithered (`alphaHash`): stochastic coverage composited in the OPAQUE
 * pass with full depth testing, so buildings behind buildings, backsides and
 * roofs all occlude correctly — the batched mesh makes sorted alpha blending
 * impossible.
 *
 * NOTE on needsUpdate: three bakes an OPAQUE define (alpha forced to 1) and
 * the alpha-hash code path into the compiled program. Crossing the on/off
 * boundary without flagging needsUpdate leaves the stale program running
 * until something else (e.g. the sun light count changing at sunrise)
 * happens to force a rebuild.
 */
function applyTransparency(clay: MeshStandardMaterial, t: number): void {
  const wasHashed = clay.alphaHash;
  clay.opacity = 1 - t;
  clay.alphaHash = t > 0;
  clay.transparent = false;
  if (clay.alphaHash !== wasHashed) {
    clay.needsUpdate = true;
  }
}

export function setCityTransparency(
  resources: StyleResources,
  transparency: number
): void {
  resources.transparency = Math.min(Math.max(transparency, 0), 1);
  for (const clay of resources.materials) {
    applyTransparency(clay, resources.transparency);
  }
}

/**
 * The clay uniform each building row drives. Transparency is the material's
 * opacity (setCityTransparency), not a uniform. A Record over the row keys,
 * so a row added to the table cannot go unapplied.
 */
const CLAY_UNIFORM_FOR: Record<
  Exclude<ClayLookKey, "transparency">,
  keyof Omit<ClayDetailUniforms, "uNight">
> = {
  bands: "uBands",
  duskGlow: "uDuskGlow",
  eave: "uEave",
  groundShade: "uAO",
  rim: "uRim",
  roofTint: "uRoofTint",
  roofVibrance: "uRoofVibrance",
  roughness: "uRough",
  tint: "uTint",
};

/**
 * Pushes the building rows of the look into the clay: the nine facade
 * detail uniforms (live references, no recompile) and the transparency.
 */
export function applyCityLook(
  resources: StyleResources,
  look: LookValues
): void {
  for (const [key, uniform] of Object.entries(CLAY_UNIFORM_FOR) as [
    keyof typeof CLAY_UNIFORM_FOR,
    keyof ClayDetailUniforms,
  ][]) {
    resources.clayDetail[uniform].value = look[key];
  }
  setCityTransparency(resources, look.transparency);
}
