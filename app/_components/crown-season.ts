import {
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  type InstancedMesh,
  type Material,
  MeshDepthMaterial,
  type WebGLProgramParametersWithUniforms,
} from "three";
import {
  dayOfYear,
  EVERGREEN,
  phenologyOf,
  SEASON_JITTER_DAYS,
  seasonAt,
} from "@/lib/city/tree-season";

/**
 * The year in the crowns (lib/city/tree-season.ts in the scene): per crown
 * instance a colour between its summer green and its genus's autumn hue, and
 * a leaf cover that thins a bare crown down to a sparse, grey-brown twig
 * mass — in the main pass and, through a matching depth material, in the
 * shadow map, so a winter tree casts a thin shadow.
 *
 * Nothing here runs per frame. `apply(day)` evaluates the season per
 * instance on a date change and writes two per-instance buffers (the crown
 * colour three already carries, and `aBare`, 1 − leaf); the shader does the
 * rest with a hashed alpha test in the crown's own local space, so the
 * stipple is fixed to the tree (it sways with it and does not crawl with
 * the camera) and about a pixel fine at every distance.
 *
 * A chunk whose crowns are all in full leaf keeps the plain crown material
 * (no discard, so early depth testing stays on); a chunk with any bare
 * instance switches to the seasonal variant and its depth material.
 */

/** What one crown instance needs to follow the year. */
export interface CrownSeasonKey {
  /** evergreen: never changes */
  evergreen: boolean;
  /** lib/city/tree-season.ts TREE_GENERA index; 0 = other deciduous */
  genus: number;
  /** the tree's own offset (days, ±SEASON_JITTER_DAYS) */
  jitter: number;
}

/** The crown material's base colour: three multiplies the per-instance
 *  colour by it, so an autumn hue is divided by it to land as itself. */
export const CROWN_BASE_COLOR = 0xa6_bf_92;
/** Twig colour of a bare crown: the trunk's grey-brown, a little paler. */
const TWIG_COLOR = 0x9a_8f_80;
/** Fraction of a bare crown's surface kept as twigs. */
const TWIG_DENSITY = 0.25;
/**
 * Size of the dither's cells in pixels. The pattern is a hashed alpha test
 * (Wyman & McGuire 2017, the method three's `alphaHash` implements): cells
 * in the crown's own local space whose size follows the screen-space
 * derivative of that position, blended between two power-of-two scales —
 * so the stipple stays about this many pixels wide at every distance and
 * sticks to the tree instead of crawling across it. Object-space cells of
 * a fixed size (the first cut) read as large flat shards up close and as
 * sparkle far away.
 */
const HASH_PIXELS = 1.25;
/** Below this `aBare` a crown counts as in full leaf. */
const BARE_EPS = 0.002;

const twigUniform = { value: new Color(TWIG_COLOR) };

// A fixed rotation (rows (2,2,1)/3, (2,−1,−2)/3, (1,−2,2)/3) turns the cell
// grid off the crown's axes, so the cells do not line up in visible rows;
// the instance's ground position offsets it, so neighbours differ.
const VERTEX_DECL = [
  "attribute float aBare;",
  "varying float vBare;",
  "varying vec3 vCrownCell;",
].join("\n");

const VERTEX_BODY = [
  "vBare = aBare;",
  "#ifdef USE_INSTANCING",
  " vec2 crownSeed = fract(instanceMatrix[3].xz * 0.0137) * 97.0;",
  "#else",
  " vec2 crownSeed = vec2(0.0);",
  "#endif",
  "const mat3 crownTurn = mat3(0.6667, 0.6667, 0.3333, 0.6667, -0.3333, -0.6667, 0.3333, -0.6667, 0.6667);",
  "vCrownCell = crownTurn * position + vec3(crownSeed, 0.0);",
].join("\n");

// three's getAlphaHashThreshold (alphahash_pars_fragment), renamed so it
// cannot clash with a material's own alphaHash, at HASH_PIXELS.
const FRAGMENT_DECL = [
  "varying float vBare;",
  "varying vec3 vCrownCell;",
  "float crownHash2(vec2 v) { return fract(1.0e4 * sin(17.0 * v.x + 0.1 * v.y) * (0.1 + abs(sin(13.0 * v.y + v.x)))); }",
  "float crownHash3(vec3 v) { return crownHash2(vec2(crownHash2(v.xy), v.z)); }",
  "float crownThreshold(vec3 p) {",
  " float maxDeriv = max(length(dFdx(p)), length(dFdy(p)));",
  ` float pixScale = 1.0 / (${HASH_PIXELS.toFixed(2)} * max(maxDeriv, 1e-6));`,
  " vec2 pixScales = vec2(exp2(floor(log2(pixScale))), exp2(ceil(log2(pixScale))));",
  " vec2 alpha = vec2(crownHash3(floor(pixScales.x * p)), crownHash3(floor(pixScales.y * p)));",
  " float lerpFactor = fract(log2(pixScale));",
  " float x = (1.0 - lerpFactor) * alpha.x + lerpFactor * alpha.y;",
  " float a = min(lerpFactor, 1.0 - lerpFactor);",
  " vec3 cases = vec3(x * x / (2.0 * a * (1.0 - a)), (x - 0.5 * a) / (1.0 - a), 1.0 - ((1.0 - x) * (1.0 - x) / (2.0 * a * (1.0 - a))));",
  " float t = (x < (1.0 - a)) ? ((x < a) ? cases.x : cases.y) : cases.z;",
  " return clamp(t, 1.0e-6, 1.0);",
  "}",
].join("\n");

/** The discard, and how much of this fragment is twig (`crownTwig`, 0 leaf
 *  or 1 twig) for the main pass's tint. The derivatives are taken before
 *  any branch, as GLSL requires. */
const FRAGMENT_BODY = [
  "float crownTwig = 0.0;",
  "float crownCellH = crownThreshold(vCrownCell);",
  `if (vBare > ${BARE_EPS}) {`,
  " float crownLeafy = 1.0 - vBare;",
  ` if (crownCellH >= max(crownLeafy, ${TWIG_DENSITY})) discard;`,
  " crownTwig = step(crownLeafy, crownCellH);",
  "}",
].join("\n");

/** Patches a crown shader with the seasonal leaf cover (`main`: the lit
 *  pass, with the twig tint; otherwise the depth pass). */
export function injectCrownSeason(
  sh: WebGLProgramParametersWithUniforms,
  main: boolean
): void {
  sh.vertexShader = sh.vertexShader
    .replace("#include <common>", `#include <common>\n${VERTEX_DECL}`)
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>\n${VERTEX_BODY}`
    );
  sh.fragmentShader = sh.fragmentShader
    .replace("#include <common>", `#include <common>\n${FRAGMENT_DECL}`)
    .replace(
      "#include <clipping_planes_fragment>",
      `#include <clipping_planes_fragment>\n${FRAGMENT_BODY}`
    );
  if (main) {
    sh.uniforms.uTwig = twigUniform;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uTwig;")
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uTwig, crownTwig);"
      );
  }
}

let depthMaterial: MeshDepthMaterial | null = null;

/**
 * The shadow pass's crown material: three's own depth material plus the same
 * discard, so the shadow thins with the crown. One for the whole scene (its
 * program is shared anyway); never disposed.
 */
export function crownDepthMaterial(): MeshDepthMaterial {
  if (!depthMaterial) {
    const m = new MeshDepthMaterial();
    m.customProgramCacheKey = () => "crown-season-depth";
    m.onBeforeCompile = (sh) => injectCrownSeason(sh, false);
    depthMaterial = m;
  }
  return depthMaterial;
}

/** A second geometry over the same buffers plus the chunk's `aBare`: the
 *  shared crown geometry cannot carry a per-chunk instanced attribute. */
function withBare(
  geometry: BufferGeometry,
  bare: InstancedBufferAttribute
): BufferGeometry {
  const view = new BufferGeometry();
  view.setIndex(geometry.index);
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    view.setAttribute(name, attribute);
  }
  view.setAttribute("aBare", bare);
  view.boundingBox = geometry.boundingBox;
  view.boundingSphere = geometry.boundingSphere;
  return view;
}

/** One chunk's crowns (the two LOD meshes share instance order), driven by
 *  the date. */
export interface SeasonalCrowns {
  /** re-evaluates every instance for `day` (days since 1 January); true
   *  when anything changed (the shadow map must then be redrawn) */
  apply: (day: number) => boolean;
}

/** The two crown materials a chunk switches between. */
export interface CrownMaterials {
  /** with the seasonal discard (any instance bare) */
  bare: Material;
  /** the plain crown (all instances in full leaf) */
  leafy: Material;
}

const scratch = new Color();
const base = new Color();

/**
 * Each instance's autumn colour: its genus's hue, varied a little by the
 * tree's own jitter so a row does not turn one flat colour, divided by the
 * material's base colour so it renders as itself.
 */
function autumnTargets(keys: CrownSeasonKey[]): Float32Array {
  base.set(CROWN_BASE_COLOR);
  const out = new Float32Array(keys.length * 3);
  keys.forEach((k, i) => {
    const [h, s, l] = phenologyOf(k.genus).hue;
    const v = k.jitter / (2 * SEASON_JITTER_DAYS); // −0.5 … 0.5
    scratch.setHSL((h + v * 0.02 + 1) % 1, s, l + v * 0.08);
    out[i * 3] = scratch.r / base.r;
    out[i * 3 + 1] = scratch.g / base.g;
    out[i * 3 + 2] = scratch.b / base.b;
  });
  return out;
}

/** Writes one instance's season; true when its values moved. */
function writeInstance(
  i: number,
  key: CrownSeasonKey,
  day: number,
  arrays: {
    bare: Float32Array;
    colour: Float32Array;
    summer: Float32Array;
    target: Float32Array;
  }
): boolean {
  const s = key.evergreen ? EVERGREEN : seasonAt(day, key.genus, key.jitter);
  const bare = 1 - s.leaf;
  let moved = Math.abs(arrays.bare[i] - bare) > 1e-4;
  arrays.bare[i] = bare;
  for (let c = 0; c < 3; c++) {
    const j = i * 3 + c;
    const v =
      arrays.summer[j] + (arrays.target[j] - arrays.summer[j]) * s.autumn;
    moved ||= Math.abs(arrays.colour[j] - v) > 1e-4;
    arrays.colour[j] = v;
  }
  return moved;
}

/**
 * Hooks one chunk's crowns to the season. Call after the meshes are painted
 * with their summer colours (those are kept as the baseline). The two LOD
 * meshes then share one colour buffer and one `aBare`, so a date change
 * writes each instance once.
 */
export function seasonCrowns(
  meshes: { cheap: InstancedMesh; rich: InstancedMesh },
  keys: CrownSeasonKey[],
  materials: CrownMaterials
): SeasonalCrowns {
  const { cheap, rich } = meshes;
  const colourAttr = cheap.instanceColor;
  if (!colourAttr || keys.length !== cheap.count) {
    return { apply: () => false };
  }
  rich.instanceColor = colourAttr;
  const bareAttr = new InstancedBufferAttribute(
    new Float32Array(keys.length),
    1
  );
  cheap.geometry = withBare(cheap.geometry, bareAttr);
  rich.geometry = withBare(rich.geometry, bareAttr);
  const arrays = {
    bare: bareAttr.array as Float32Array,
    colour: colourAttr.array as Float32Array,
    summer: Float32Array.from(colourAttr.array as Float32Array),
    target: autumnTargets(keys),
  };
  const deciduous = keys.some((k) => !k.evergreen);
  let wasBare = false;
  return {
    apply: (day) => {
      if (!deciduous) {
        return false;
      }
      let moved = false;
      let anyBare = false;
      keys.forEach((key, i) => {
        moved = writeInstance(i, key, day, arrays) || moved;
        anyBare ||= arrays.bare[i] > BARE_EPS;
      });
      if (moved) {
        bareAttr.needsUpdate = true;
        colourAttr.needsUpdate = true;
      }
      if (anyBare !== wasBare) {
        wasBare = anyBare;
        moved = true;
        for (const mesh of [cheap, rich]) {
          mesh.material = anyBare ? materials.bare : materials.leafy;
          mesh.customDepthMaterial = anyBare ? crownDepthMaterial() : undefined;
        }
      }
      return moved;
    },
  };
}

/** The scene's day of the year, handed to the trees. */
export interface SeasonClock {
  /** the current day (whole days since 1 January) */
  day: () => number;
  dispose: () => void;
  /** a new scene date; the trees follow when its calendar day differs */
  set: (date: Date) => void;
}

/** How often (ms) a run of date changes re-seasons the trees at most. */
export const SEASON_THROTTLE_MS = 150;

/**
 * Keeps the scene's day of the year and runs `apply` when the calendar day
 * changes — never for a time-of-day change, never per frame, and at most
 * once per `throttleMs` while the day keeps changing (the last day wins, so
 * a run of clicks through the calendar ends on the day it stopped at).
 */
export function createSeasonClock(
  initial: Date,
  apply: (day: number) => void,
  throttleMs = SEASON_THROTTLE_MS
): SeasonClock {
  let day = Math.floor(dayOfYear(initial));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = Number.NEGATIVE_INFINITY;
  const flush = () => {
    timer = null;
    last = performance.now();
    apply(day);
  };
  return {
    day: () => day,
    set: (date) => {
      const next = Math.floor(dayOfYear(date));
      if (next === day) {
        return;
      }
      day = next;
      if (timer !== null) {
        return;
      }
      const wait = last + throttleMs - performance.now();
      if (wait <= 0) {
        flush();
      } else {
        timer = setTimeout(flush, wait);
      }
    },
    dispose: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
