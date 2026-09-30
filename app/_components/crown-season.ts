import {
  type BufferGeometry,
  Color,
  InstancedBufferAttribute,
  type Material,
} from "three/webgpu";
import {
  abs,
  clamp,
  dFdx,
  dFdy,
  exp2,
  float,
  floor,
  fract,
  length,
  log2,
  mat3,
  max,
  min,
  positionGeometry,
  select,
  sin,
  step,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import {
  dayOfYear,
  EVERGREEN,
  phenologyOf,
  SEASON_JITTER_DAYS,
  seasonAt,
} from "@/lib/city/tree-season";
import { Instances, instanceFloat, instanceMatrix } from "./instancing";
import type { F, V2, V3 } from "./shader-chunks";

/**
 * The year in the crowns (lib/city/tree-season.ts in the scene): per crown
 * instance a colour between its summer green and its genus's autumn hue, and
 * a leaf cover that thins a bare crown down to a sparse, grey-brown twig
 * mass — in the main pass and, through the material's `maskNode` (which
 * three's shadow pass honours), in the shadow map, so a winter tree casts a
 * thin shadow.
 *
 * Nothing here runs per frame. `apply(day)` evaluates the season per
 * instance on a date change and writes two per-instance buffers (the crown
 * tint, `instanceTints`, and `aBare`, 1 − leaf); the node material does the
 * rest with a hashed alpha test in the crown's own local space, so the
 * stipple is fixed to the tree (it sways with it and does not crawl with
 * the camera) and about a pixel fine at every distance.
 *
 * A chunk whose crowns are all in full leaf keeps the plain crown material
 * (no mask, so early depth testing stays on); a chunk with any bare
 * instance switches to the seasonal variant.
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

/** The crown material's base colour: the material multiplies the
 *  per-instance tint by it, so an autumn hue is divided by it to land as
 *  itself. */
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

/** three's alpha-hash hash (alphahash_pars_fragment), as nodes. */
function crownHash2(v: V2): F {
  return fract(
    float(1e4)
      .mul(sin(v.x.mul(17).add(v.y.mul(0.1))))
      .mul(abs(sin(v.y.mul(13).add(v.x))).add(0.1))
  );
}

function crownHash3(v: V3): F {
  return crownHash2(vec2(crownHash2(v.xy), v.z));
}

/**
 * three's alpha-hash threshold at HASH_PIXELS: the hash of the cell `p`
 * falls in at the two power-of-two pixel scales around its derivative,
 * blended and remapped so the threshold stays uniform across the blend.
 * `seed` joins the integer cell, after the pixel-scale floor: added to the
 * position it would be multiplied by that scale too (thousands up close),
 * and the hash's sin() would lose its precision to arguments near 1e6 —
 * banding on mobile GPUs. The derivatives are taken here, in the mask at
 * the top of the fragment, before any discard.
 */
export function crownThreshold(p: V3, seed: V3): F {
  const maxDeriv = max(length(dFdx(p)), length(dFdy(p)));
  const pixScale = float(1).div(max(maxDeriv, 1e-6).mul(HASH_PIXELS));
  const level = log2(pixScale);
  const lo = exp2(floor(level));
  const hi = exp2(level.ceil());
  const alphaLo = crownHash3(floor(p.mul(lo)).add(seed));
  const alphaHi = crownHash3(floor(p.mul(hi)).add(seed));
  const lerpFactor = fract(level);
  const x = float(1).sub(lerpFactor).mul(alphaLo).add(lerpFactor.mul(alphaHi));
  const a = min(lerpFactor, float(1).sub(lerpFactor));
  const spread = a.mul(2).mul(float(1).sub(a));
  const low = x.mul(x).div(spread);
  const mid = x.sub(a.mul(0.5)).div(float(1).sub(a));
  const high = float(1).sub(float(1).sub(x).mul(float(1).sub(x)).div(spread));
  const t = select(
    x.lessThan(float(1).sub(a)),
    select(x.lessThan(a), low, mid),
    high
  );
  return clamp(t, 1e-6, 1);
}

/** The seasonal crown's nodes (crownSeasonNodes). */
export interface CrownSeasonNodes {
  /** false where the leaf cover drops the fragment: the material's
   *  `maskNode`, which the shadow pass honours too */
  keep: Node<"bool">;
  /** how much of the fragment is twig (0 leaf or 1 twig): the lit pass
   *  tints it grey-brown and takes its shimmer away */
  twig: F;
  /** the twig colour (linear, as `new Color(hex)` holds it), mixed in by
   *  `twig` */
  twigColour: V3;
}

/**
 * The leaf cover of a bare crown as nodes. A fixed rotation (rows
 * (2,2,1)/3, (2,−1,−2)/3, (1,−2,2)/3; symmetric, so the column order does
 * not matter) turns the cell grid off the crown's axes, so the cells do not
 * line up in visible rows; the cell is the geometry's own position (before
 * the sway and the instance transform), so the stipple sticks to the tree.
 * A seed from the instance's ground position (its matrix's translation)
 * offsets the hash, so neighbours differ.
 */
export function crownSeasonNodes(): CrownSeasonNodes {
  const bare = varying(instanceFloat("aBare"));
  const turn = mat3(
    0.6667,
    0.6667,
    0.3333,
    0.6667,
    -0.3333,
    -0.6667,
    0.3333,
    -0.6667,
    0.6667
  );
  const cell = varying(turn.mul(positionGeometry));
  // the instance's ground position: its matrix's translation (m · e₃)
  const origin = instanceMatrix().mul(vec4(0, 0, 0, 1));
  const seed = varying(fract(origin.xz.mul(0.0137)).mul(97));
  const cellH = crownThreshold(cell, vec3(seed, 0)).toVar("crownCellH");
  const leafy = float(1).sub(bare);
  const isBare = bare.greaterThan(BARE_EPS);
  const twig = new Color(TWIG_COLOR);
  return {
    keep: isBare.not().or(cellH.lessThan(max(leafy, TWIG_DENSITY))),
    twig: select(isBare, step(leafy, cellH), float(0)),
    twigColour: vec3(twig.r, twig.g, twig.b),
  };
}

/** One chunk's crowns (the two LOD sets share instance order), driven by
 *  the date. */
export interface SeasonalCrowns {
  /** re-evaluates every instance for `day` (days since 1 January); true
   *  when anything changed (the shadow map must then be redrawn) */
  apply: (day: number) => boolean;
}

/** The two crown materials a chunk switches between. */
export interface CrownMaterials {
  /** with the seasonal mask (any instance bare) */
  bare: Material;
  /** the plain crown (all instances in full leaf) */
  leafy: Material;
}

/**
 * Stand-ins that take the crown materials a date change switches to
 * through the scene's compile path ahead of time. A tile compiles what its
 * sets wear (tile-stream.ts `compileRepresentatives`): in summer the plain
 * crown only, in winter the seasonal one only. Without these, the first
 * drag across the leaf fall would build the other crown inside a frame.
 * Builds are shared by material and attribute layout, and the crown
 * materials are scene-wide (`sceneMaterial`), so one set per scene covers
 * every tile's crowns. The seasonal crown thins its shadow through
 * `maskNode`, so there is no depth material to warm any more.
 */
export interface CrownWarmup {
  /** frees the stand-ins' geometry (never the scene-wide materials) */
  dispose: () => void;
  /** wear the seasonal and the plain crown: compile against the scene */
  main: Instances[];
}

/**
 * Builds the stand-ins over a crown geometry and the pair of crown
 * materials, each a one-instance set with instance tints and `aBare`, as a
 * crown is (the same attribute layout, so the same build). They are never
 * added to the scene; keep them until the scene goes, then `dispose`.
 */
export function crownWarmup(
  geometry: BufferGeometry,
  materials: CrownMaterials
): CrownWarmup {
  const stand = (material: Material): Instances => {
    const set = new Instances(geometry, material, 1);
    set.castShadow = true;
    set.receiveShadow = true;
    set.setColorAt(0, new Color(1, 1, 1));
    set.geometry.setAttribute(
      "aBare",
      new InstancedBufferAttribute(new Float32Array(1), 1)
    );
    return set;
  };
  const main = [stand(materials.bare), stand(materials.leafy)];
  return {
    main,
    dispose: () => {
      for (const set of main) {
        set.geometry.dispose();
      }
      geometry.dispose();
    },
  };
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
 * Hooks one chunk's crowns to the season. Call after the sets are painted
 * with their summer colours (those are kept as the baseline). The mid and
 * rich tiers share one tint buffer and one `aBare`, so a date change
 * writes each instance once; the far tier holds a subset of the instances
 * (`farSlots[j]` is the shared slot of its instance `j`) and gets a copy.
 * `aBare` goes on each set's own geometry view (an `Instances` set owns
 * one), so the shared crown geometry stays as it is.
 */
export function seasonCrowns(
  meshes: {
    far?: Instances;
    farSlots?: readonly number[];
    mid: Instances;
    rich: Instances;
  },
  keys: CrownSeasonKey[],
  materials: CrownMaterials
): SeasonalCrowns {
  const { mid, rich, far, farSlots } = meshes;
  const colourAttr = mid.instanceTints;
  if (!colourAttr || keys.length !== mid.drawCount) {
    return { apply: () => false };
  }
  rich.instanceTints = colourAttr;
  const bareAttr = new InstancedBufferAttribute(
    new Float32Array(keys.length),
    1
  );
  mid.geometry.setAttribute("aBare", bareAttr);
  rich.geometry.setAttribute("aBare", bareAttr);
  const arrays = {
    bare: bareAttr.array as Float32Array,
    colour: colourAttr.array as Float32Array,
    summer: Float32Array.from(colourAttr.array as Float32Array),
    target: autumnTargets(keys),
  };
  const farSeason =
    far?.instanceTints && farSlots && farSlots.length === far.drawCount
      ? farTier(far, farSlots)
      : null;
  const tiers = farSeason ? [mid, rich, farSeason.mesh] : [mid, rich];
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
        farSeason?.copy(arrays);
      }
      if (anyBare !== wasBare) {
        wasBare = anyBare;
        moved = true;
        for (const mesh of tiers) {
          mesh.material = anyBare ? materials.bare : materials.leafy;
        }
      }
      return moved;
    },
  };
}

/** The far tier's own `aBare` and a copier from the shared arrays. */
function farTier(
  mesh: Instances,
  slots: readonly number[]
): {
  copy: (from: { bare: Float32Array; colour: Float32Array }) => void;
  mesh: Instances;
} {
  const colourAttr = mesh.instanceTints as InstancedBufferAttribute;
  const bareAttr = new InstancedBufferAttribute(
    new Float32Array(slots.length),
    1
  );
  mesh.geometry.setAttribute("aBare", bareAttr);
  const bare = bareAttr.array as Float32Array;
  const colour = colourAttr.array as Float32Array;
  return {
    mesh,
    copy: (from) => {
      slots.forEach((slot, j) => {
        bare[j] = from.bare[slot];
        colour[j * 3] = from.colour[slot * 3];
        colour[j * 3 + 1] = from.colour[slot * 3 + 1];
        colour[j * 3 + 2] = from.colour[slot * 3 + 2];
      });
      bareAttr.needsUpdate = true;
      colourAttr.needsUpdate = true;
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
