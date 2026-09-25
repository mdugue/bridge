import { type DataTexture, MeshStandardMaterial, Vector3 } from "three";
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
  /** low-sun glint in the panes (Scheibenglanz) */
  uGlint: { value: number };
  /** night light strength: lit panes, floodlit landmarks (Nachtlicht) */
  uNightLights: { value: number };
  /** world direction surface → sun, shared with the sun rig */
  uSunDir: { value: Vector3 };
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
 * Nachtlicht and Scheibenglanz: how a building shows at night and in the
 * low sun. The data has no windows (LoD2), and a drawn window grid was
 * rejected — it made historic houses read as office blocks (ADR 0010) — so
 * windows only ever appear as light: lit from inside after dusk, or
 * catching the low sun. By full day both terms are zero and the clay stays
 * calm. What lights up depends on the building's `night` column
 * (building-tint.ts `nightLight`):
 *
 *  - Houses and commerce: soft panes on a grid that needs no UVs — along
 *    the wall the world position on its tangent, in window axes of the
 *    building's own rhythm (2.5–3.5 m, pane proportions per building);
 *    upwards the building's storeys. A pane is a tall rounded rectangle with
 *    a soft edge and a pool of lamp light inside it (honey under the
 *    lintel, amber at the sill, dimmer at the jambs), with a faint round
 *    glow on the wall around it in the wall's own colour. A hash of (axis, storey, wall plane, building)
 *    decides which panes are lit and whether their curtains are drawn, at a
 *    density per building; commerce is busier and lights its shop fronts.
 *    Only whole storeys under the eave, and none on sheds and garages.
 *  - Landmarks (churches, castles, theatres, museums): no panes at all —
 *    they are floodlit from their foot, as Dresden lights them: overlapping
 *    cones every ~6.5 m that merge into an even wash higher up, in the
 *    wall's own colour, fading softly towards the top.
 *  - In the low sun (altitude ≲ 15°) the panes of sunlit facades turned
 *    towards it catch a warm glint along the mirror direction — only where
 *    the sun really reaches (see CLAY_GLINT_SHADOW).
 *
 * Far away the pane pattern fades to its mean before it can shimmer.
 */
const CLAY_NIGHT_PARS = /* glsl */ `
uvec4 clayPcg4(uvec4 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}
vec4 clayRand4(ivec4 key) {
  return vec4(clayPcg4(uvec4(key))) / 4294967295.0;
}
// Signed distance (m) to a rounded rectangle, negative inside.
float claySdBox(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
`;

const CLAY_NIGHT = /* glsl */ `
  float nlNight = uNightLights * uNight;
  float nlGlint = uGlint * (1.0 - uNight)
    * smoothstep(-0.02, 0.04, uSunDir.y) * (1.0 - smoothstep(0.12, 0.28, uSunDir.y));
  vec3 nlGlintRad = vec3(0.0);
  // A uniform branch: by full day nothing below runs. Derivatives are taken
  // here, before the per-building branches.
  if (nlNight + nlGlint > 0.0) {
    float nlCat = floor(vClayNight + 0.5);
    int nlId = int(vClayId + 0.5);
    vec4 nlB = clayRand4(ivec4(nlId, 40503, 7, 1));
    vec2 nlN = vClayWN.xz;
    float nlNL = max(length(nlN), 1e-3);
    float nlU = dot(vClayWP.xz, vec2(-nlN.y, nlN.x) / nlNL);
    float nlPx = max(length(fwidth(vec2(nlU, clayH))), 1e-4);
    if (nlCat > 2.5) {
      // Anstrahlung: cones from the foot, an even wash higher up.
      float nlDu = (fract(nlU / 6.5 + 0.5) - 0.5) * 6.5;
      float nlSig = 0.9 + 0.3 * clayH;
      float nlCone = exp(-nlDu * nlDu / (2.0 * nlSig * nlSig));
      float nlWash = mix(0.35 + 0.9 * nlCone, 1.0, max(smoothstep(1.5, 14.0, clayH), smoothstep(0.3, 1.2, nlPx)));
      float nlFall = 0.4 + 0.6 * exp(-clayH / max(0.7 * vClayBuild.z, 8.0));
      // Walls, towers and domes catch the beams; flat roofs stay dark.
      float nlSteep = 1.0 - smoothstep(0.82, 0.98, abs(vClayWN.y));
      totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.85, 0.64) * (nlFall * nlWash * nlSteep * nlNight * 1.1);
    } else if (nlCat > 0.5) {
      float nlStorey = max(vClayBuild.y, 2.5);
      float nlA = mix(2.5, 3.5, nlB.y);
      vec2 nlCR = vec2(nlU / nlA, clayH / nlStorey);
      vec2 nlCell = floor(nlCR);
      vec2 nlF = nlCR - nlCell;
      float nlPlane = floor(dot(vClayWP.xz, nlN / nlNL) + 0.5);
      vec4 nlR = clayRand4(ivec4(int(nlCell.x), int(nlCell.y), int(nlPlane), nlId));
      bool nlShop = nlCat > 1.5 && nlCell.y < 0.5;
      vec2 nlSize = nlShop
        ? vec2(0.8 * nlA, 0.6 * nlStorey)
        : vec2(mix(0.26, 0.36, nlB.z) * nlA, mix(0.52, 0.64, nlB.w) * nlStorey);
      nlSize *= 0.94 + 0.12 * nlR.zw;
      vec2 nlP = (nlF - vec2(0.5, 0.52)) * vec2(nlA, nlStorey);
      float nlD = claySdBox(nlP, 0.5 * nlSize, 0.1);
      float nlSoft = max(0.09, 1.5 * nlPx);
      float nlPane = 1.0 - smoothstep(-nlSoft, nlSoft, nlD);
      float nlRows = step(0.0, nlCell.y)
        * step((nlCell.y + 0.85) * nlStorey, vClayBuild.z)
        * step(3.8, vClayBuild.z) * clayWall * (1.0 - clayIsRoof);
      float nlFar = smoothstep(0.45, 1.0, nlPx / min(nlSize.x, nlSize.y));
      float nlArea = nlSize.x * nlSize.y / (nlA * nlStorey);
      // Lit from inside.
      float nlDensity = (nlShop ? 0.8 : mix(0.2, 0.42, step(1.5, nlCat))) * (0.55 + 0.9 * nlB.x);
      float nlOn = step(nlR.x, nlDensity) * (nlR.y < 0.35 ? 0.4 : 1.0);
      float nlUp = clamp(nlP.y / nlSize.y + 0.5, 0.0, 1.0);
      // The room's lamp: a pool of light under the lintel, amber at the sill
      // and dimmer towards the jambs; now and then the cool of a screen.
      float nlSide = nlP.x / (0.5 * nlSize.x);
      float nlPool = mix(0.45, 1.0, nlUp * nlUp) * (1.0 - 0.3 * nlSide * nlSide);
      vec3 nlRoom = nlR.z < 0.07
        ? vec3(0.62, 0.68, 0.95) * mix(0.55, 0.85, nlUp)
        : mix(vec3(0.9, 0.46, 0.24), vec3(1.0, 0.76, 0.5), nlUp) * nlPool;
      // A faint round glow on the wall, in the wall's own colour.
      float nlGlow = exp(-2.2 * length(nlP / (0.5 * nlSize + 0.35))) * (1.0 - nlPane);
      vec3 nlLit = (nlRoom * nlPane + diffuseColor.rgb * vec3(1.0, 0.8, 0.55) * nlGlow * 0.3) * nlOn;
      vec3 nlMean = vec3(1.0, 0.68, 0.42) * nlDensity * 0.6 * (nlArea + 0.05);
      totalEmissiveRadiance += mix(nlLit, nlMean, nlFar) * nlRows * nlNight;
      // The low sun in the glass, along the mirror direction.
      vec3 nlRefl = reflect(normalize(vClayWP - cameraPosition), vClayWN);
      float nlSpec = pow(max(dot(nlRefl, uSunDir), 0.0), 20.0);
      float nlFacing = smoothstep(0.0, 0.3, dot(vClayWN, uSunDir));
      // Panes stand at slightly different angles: each catches it its own way.
      float nlTilt = nlR.w * nlR.w;
      float nlGlass = mix(nlPane * nlTilt, nlArea * 0.33, nlFar);
      nlGlintRad = vec3(1.0, 0.8, 0.56) * (nlGlass * nlSpec * nlFacing * nlRows * nlGlint * 1.8);
    }
  }
`;

/**
 * The glint only where the sun really reaches: the lit fraction of the
 * sun's direct light (shadowed / unshadowed Lambert) after the light loop.
 * Without a sun (below the horizon) there is no glint.
 */
const CLAY_GLINT_SHADOW = /* glsl */ `
  #if NUM_DIR_LIGHTS > 0
    float nlSunIrr = dot(BRDF_Lambert(material.diffuseContribution)
      * directionalLights[0].color * max(dot(normal, directionalLights[0].direction), 0.0), vec3(1.0));
    float nlSunLit = smoothstep(0.2, 0.8, dot(reflectedLight.directDiffuse, vec3(1.0)) / max(nlSunIrr, 1e-4));
    totalEmissiveRadiance += nlGlintRad * nlSunLit;
  #endif
`;

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
 *  - Nachtlicht / Scheibenglanz (uNightLights, uGlint): lit panes and
 *    floodlit landmarks at night, the low sun in the glass — CLAY_NIGHT.
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
    shader.uniforms.uNightLights = uniforms.uNightLights;
    shader.uniforms.uGlint = uniforms.uGlint;
    shader.uniforms.uSunDir = uniforms.uSunDir;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float featureId;\nattribute float roof;\nuniform highp sampler2D uObjects;\nuniform int uObjectRows;\nvarying float vLocalH;\nvarying vec3 vClayWN;\nvarying vec3 vClayWP;\nvarying vec3 vClayTint;\nvarying vec4 vClayBuild;\nvarying float vClayRough;\nvarying float vClayId;\nvarying float vClayNight;"
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
          "vClayId = featureId;",
          "vClayNight = clayC.w;",
        ].join("\n")
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uAO;\nuniform float uBands;\nuniform float uRim;\nuniform float uTint;\nuniform float uRoofTint;\nuniform float uRoofVibrance;\nuniform float uEave;\nuniform float uDuskGlow;\nuniform float uNight;\nuniform float uRough;\nuniform float uNightLights;\nuniform float uGlint;\nuniform vec3 uSunDir;\nvarying float vLocalH;\nvarying vec3 vClayWN;\nvarying vec3 vClayWP;\nvarying vec3 vClayTint;\nvarying vec4 vClayBuild;\nvarying float vClayRough;\nvarying float vClayId;\nvarying float vClayNight;\n" +
          CLAY_NIGHT_PARS
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
          // dusk (build.w = 1), gated by nightFactor, walls only. Landmarks
          // are floodlit instead (CLAY_NIGHT).
          "float clayGlow = vClayBuild.w * uDuskGlow * uNight * step(vClayNight, 2.5);",
          "totalEmissiveRadiance += clayGlow * clayWall * vec3(1.0, 0.82, 0.5) * 0.5;",
          CLAY_NIGHT,
        ].join("\n")
      )
      .replace(
        "#include <aomap_fragment>",
        `${CLAY_GLINT_SHADOW}\n#include <aomap_fragment>`
      );
    if (heightFog) {
      injectHeightFog(shader, heightFog);
    }
  };
}

/** The shared clay state, created once per app instance. `night` is a
 *  uniform ref the sun rig mutates (0 = day, 1 = night) to gate the dusk
 *  glow live. */
export function createStyleResources(
  heightFog?: HeightFogUniforms,
  night?: { value: number },
  sunDirection?: Vector3
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
    uNightLights: { value: LOOK_DEFAULTS.nightLights },
    uGlint: { value: LOOK_DEFAULTS.glint },
    uSunDir: { value: sunDirection ?? new Vector3(0, 1, 0) },
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
  keyof Omit<ClayDetailUniforms, "uNight" | "uSunDir">
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
  glint: "uGlint",
  nightLights: "uNightLights",
};

/**
 * Pushes the building rows of the look into the clay: the eleven facade
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
